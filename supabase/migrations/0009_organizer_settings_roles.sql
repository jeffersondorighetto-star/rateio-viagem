-- 0009 — Configurações do evento só pelo organizador; papéis com proteção do último organizador.
-- Configurações = datas, refeições, modo de divisão, incluir não confirmados, caixinha (events) e
-- pesos/preços/quantidades (event_overrides). Membros aprovados só leem.

create or replace function public.is_event_settings_writable(e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.event_members m join public.events ev on ev.id = m.event_id
                 where m.event_id = e and m.user_id = auth.uid() and m.status = 'approved' and m.role = 'organizer' and not ev.locked);
$$;
revoke all on function public.is_event_settings_writable(uuid) from public, anon;
grant execute on function public.is_event_settings_writable(uuid) to authenticated;

drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (public.is_event_settings_writable(id)) with check (public.is_event_settings_writable(id));
drop policy if exists overrides_insert on public.event_overrides;
create policy overrides_insert on public.event_overrides for insert to authenticated with check (public.is_event_settings_writable(event_id));
drop policy if exists overrides_update on public.event_overrides;
create policy overrides_update on public.event_overrides for update to authenticated
  using (public.is_event_settings_writable(event_id)) with check (public.is_event_settings_writable(event_id));

-- Configurações numa chamada só (alternativa ao apply_ops, com a mesma regra de versão).
-- p_patch: só as chaves enviadas mudam. Devolve a linha nova; versão velha = PT409.
create or replace function public.update_event_settings(p_event uuid, p_patch jsonb, p_expected_version int)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r jsonb;
begin
  if not public.is_event_settings_writable(p_event) then raise exception 'organizer_only' using errcode = '42501'; end if;
  r := public.apply_ops(p_event, jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table', 'events',
         'row', p_patch, 'expected_version', p_expected_version))) -> 0;
  if r ->> 'status' = 'conflict' then raise exception 'version_conflict' using errcode = 'PT409', detail = r::text; end if;
  if r ->> 'status' <> 'ok' then raise exception '%', coalesce(r ->> 'error', 'error') using errcode = coalesce(r ->> 'code', 'P0001'); end if;
  return r -> 'row';
end $$;
revoke all on function public.update_event_settings(uuid, jsonb, int) from public, anon;
grant execute on function public.update_event_settings(uuid, jsonb, int) to authenticated;

create or replace function public._organizer_count(p_event uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.event_members where event_id = p_event and role = 'organizer' and status = 'approved'
$$;
revoke all on function public._organizer_count(uuid) from public, anon, authenticated;

-- Promover/rebaixar. Nunca deixa o evento sem organizador; quem criou não é rebaixado.
create or replace function public.set_member_role(p_event uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  perform public._require_organizer(p_event);
  if p_role not in ('organizer', 'member') then raise exception 'invalid_role' using errcode = '22023'; end if;
  select * into m from public.event_members where event_id = p_event and user_id = p_user for update;
  if m.user_id is null or m.status <> 'approved' then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  if m.role = p_role then return; end if;
  if p_role = 'member' and public._organizer_count(p_event) <= 1 then raise exception 'last_organizer' using errcode = '22023'; end if;
  if p_role = 'member' and p_user = (select created_by from public.events where id = p_event) then raise exception 'cannot_demote_creator' using errcode = '22023'; end if;
  update public.event_members set role = p_role, decided_by = auth.uid(), decided_at = now()
   where event_id = p_event and user_id = p_user;
end $$;

create or replace function public.revoke_member(p_event uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  perform public._require_organizer(p_event);
  if p_user = auth.uid() then raise exception 'cannot_revoke_self' using errcode = '22023'; end if;
  if p_user = (select created_by from public.events where id = p_event) then raise exception 'cannot_revoke_creator' using errcode = '22023'; end if;
  select * into m from public.event_members where event_id = p_event and user_id = p_user for update;
  if m.user_id is null then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  if m.role = 'organizer' and m.status = 'approved' and public._organizer_count(p_event) <= 1 then raise exception 'last_organizer' using errcode = '22023'; end if;
  -- organizador removido perde o papel (se voltar, volta como membro)
  update public.event_members set status = 'revoked', role = 'member', decided_by = auth.uid(), decided_at = now()
   where event_id = p_event and user_id = p_user;
end $$;
