-- 0003 — RPCs: criar evento (organizador com GitHub), entrar com código (fica pendente),
-- aprovar, revogar e mudar papel (girar código, travar e renomear ficam na 0004, com a versão por linha). Todas security definer com search_path fixo.
-- Código: 8 caracteres de ABCDEFGHJKMNPQRSTUVWXYZ23456789 (sem 0/O, 1/I/L), gerado no cliente.

create or replace function public._code_ok(c text) returns boolean
language sql immutable set search_path = '' as $$ select c ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$' $$;
create or replace function public._code_lookup(c text) returns text
language sql immutable set search_path = '' as $$ select encode(extensions.digest(c, 'sha256'), 'hex') $$;
create or replace function public._is_anonymous() returns boolean
language sql stable set search_path = '' as $$ select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) $$;

-- Quem pode criar evento: lista fechada (cota do projeto Free). Sem acesso de clientes; editar no SQL Editor:
--   insert into public.organizer_allowlist (github_id, note) values (<id numérico do GitHub>, 'login');
-- Chave = id NUMÉRICO do GitHub (auth.identities.provider_id). O login pode ser trocado e reaproveitado por outra
-- pessoa; o id não muda. Descubra o id em https://api.github.com/users/<login> (campo "id").
do $$
begin -- rascunho b6f4fa7 usava github_login (texto): não dá para converter login em id, então a tabela recomeça vazia
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organizer_allowlist' and column_name = 'github_login') then
    drop table public.organizer_allowlist;
    raise notice 'organizer_allowlist recriada por id numérico do GitHub: insira de novo (veja SETUP-CELULAR.md, passo 5.6)';
  end if;
end $$;
create table if not exists public.organizer_allowlist (
  github_id bigint primary key check (github_id > 0),
  note      text check (note is null or char_length(note) <= 80),
  added_at  timestamptz not null default now()
);
alter table public.organizer_allowlist enable row level security;
revoke all on public.organizer_allowlist from anon, authenticated;
create or replace function public._may_organize() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.identities i join public.organizer_allowlist a
                   on i.provider_id = a.github_id::text
                  where i.user_id = auth.uid() and i.provider = 'github');
$$;
revoke all on function public._may_organize() from public, anon, authenticated;

create or replace function public.create_event(p_name text, p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_id   uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if public._is_anonymous() then raise exception 'organizer_login_required' using errcode = '42501'; end if;
  if not public._may_organize() then raise exception 'organizer_only' using errcode = '42501', hint = 'GitHub fora de public.organizer_allowlist'; end if;
  if not public._code_ok(v_code) then raise exception 'invalid_code_format' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 40 then raise exception 'invalid_display_name' using errcode = '22023'; end if;
  if (select count(*) from public.events where created_by = v_uid) >= 20 then raise exception 'too_many_events' using errcode = '54000'; end if;
  insert into public.events (name, created_by) values (btrim(p_name), v_uid) returning id into v_id;
  begin
    insert into public.event_secrets (event_id, code_lookup, code_hash, code_version)
    values (v_id, public._code_lookup(v_code), extensions.crypt(v_code, extensions.gen_salt('bf', 8)), 1);
  exception when unique_violation then
    raise exception 'code_taken' using errcode = '23505';
  end;
  insert into public.event_members (event_id, user_id, display_name, role, status, joined_code_version, decided_by, decided_at)
  values (v_id, v_uid, btrim(p_display_name), 'organizer', 'approved', 1, v_uid, now());
  return v_id;
end $$;

-- Resultado em jsonb (sem exceção no código errado, para a tentativa ficar registrada):
-- {ok:true, event_id, event_name (só se aprovado), status, role} | {ok:false, error:'invalid_code'|'too_many_attempts'|'revoked'|...}
-- Pendente não recebe nada sobre o evento além do id (o nome pode ter sobrenome de família).
drop function if exists public.join_event(text, text);
create or replace function public.join_event(p_code text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  s      record;
  m      record;
  v_name text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 40 then return jsonb_build_object('ok', false, 'error', 'invalid_display_name'); end if;
  delete from public.join_attempts where at < now() - interval '1 day';
  if (select count(*) from public.join_attempts where user_id = v_uid and at > now() - interval '10 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;
  select es.event_id, es.code_hash, es.code_version into s
    from public.event_secrets es where public._code_ok(v_code) and es.code_lookup = public._code_lookup(v_code);
  if s.event_id is null or extensions.crypt(v_code, s.code_hash) <> s.code_hash then
    insert into public.join_attempts (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  select name into v_name from public.events where id = s.event_id;
  select * into m from public.event_members where event_id = s.event_id and user_id = v_uid;
  if m.user_id is null then
    insert into public.event_members (event_id, user_id, display_name, role, status, joined_code_version)
    values (s.event_id, v_uid, btrim(p_display_name), 'member', 'pending', s.code_version);
    return jsonb_build_object('ok', true, 'event_id', s.event_id, 'status', 'pending', 'role', 'member');
  end if;
  if m.status = 'revoked' then return jsonb_build_object('ok', false, 'error', 'revoked'); end if;
  update public.event_members set display_name = btrim(p_display_name) where event_id = s.event_id and user_id = v_uid;
  return jsonb_build_object('ok', true, 'event_id', s.event_id, 'status', m.status, 'role', m.role)
         || case when m.status = 'approved' then jsonb_build_object('event_name', v_name) else '{}'::jsonb end;
end $$;

-- Situação do próprio aparelho num evento (funciona também para pendente/revogado).
create or replace function public.my_membership(p_event uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('status', m.status, 'role', m.role, 'display_name', m.display_name)
                          || case when m.status = 'approved' then jsonb_build_object('event_name', e.name, 'locked', e.locked, 'family_id', m.family_id) else '{}'::jsonb end
                     from public.event_members m join public.events e on e.id = m.event_id
                    where m.event_id = p_event and m.user_id = auth.uid()), jsonb_build_object('status', 'none'));
$$;

create or replace function public._require_organizer(p_event uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_event_organizer(p_event) then raise exception 'organizer_only' using errcode = '42501'; end if;
end $$;

create or replace function public.approve_member(p_event uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ver int;
begin
  perform public._require_organizer(p_event);
  select code_version into v_ver from public.event_secrets where event_id = p_event;
  update public.event_members set status = 'approved', joined_code_version = greatest(joined_code_version, v_ver),
         decided_by = auth.uid(), decided_at = now()
   where event_id = p_event and user_id = p_user;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.revoke_member(p_event uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_organizer(p_event);
  if p_user = auth.uid() then raise exception 'cannot_revoke_self' using errcode = '22023'; end if;
  if p_user = (select created_by from public.events where id = p_event) then raise exception 'cannot_revoke_creator' using errcode = '22023'; end if;
  update public.event_members set status = 'revoked', decided_by = auth.uid(), decided_at = now()
   where event_id = p_event and user_id = p_user;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.set_member_role(p_event uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_organizer(p_event);
  if p_role not in ('organizer', 'member') then raise exception 'invalid_role' using errcode = '22023'; end if;
  if p_user = (select created_by from public.events where id = p_event) and p_role <> 'organizer' then raise exception 'cannot_demote_creator' using errcode = '22023'; end if;
  update public.event_members set role = p_role, decided_by = auth.uid(), decided_at = now()
   where event_id = p_event and user_id = p_user and status = 'approved';
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['create_event(text,text,text)','join_event(text,text)','my_membership(uuid)','approve_member(uuid,uuid)',
    'revoke_member(uuid,uuid)','set_member_role(uuid,uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['_code_ok(text)','_code_lookup(text)','_is_anonymous()','_require_organizer(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
