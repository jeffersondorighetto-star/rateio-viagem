-- 0013 — Endurecimento pedido na revisão de governança (Astreia, 10/10/2026).
-- 1) Dieta fora do servidor no piloto: remove person_diet e o expurgo (se um script antigo os criou).
--    O modelo aprovado para o futuro está em docs/FUTURO-DIETA.md (não é SQL ativo).
-- 2) INSERT/UPDATE por COLUNA, iguais à lista do apply_ops: pelo PostgREST direto ninguém troca
--    event_id, id, created_by, confirmed_*, family_id de membro etc. (achado 1.1).
-- 3) event_members sem UPDATE de cliente; família do membro só pelo organizador (set_member_family, achado 1.4).

-- 1) dieta / expurgo -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule(jobid) from cron.job where jobname = 'rateio_purge_health';
    exception when others then null;
    end;
  end if;
end $$;
drop function if exists public.enable_health_purge();
drop function if exists public.disable_health_purge();
drop function if exists public.health_purge_status();
drop function if exists public.purge_expired_health();
drop function if exists public.purge_health(uuid);
drop table if exists public.person_diet cascade;
drop function if exists public.tg_person_diet() cascade;

-- 2) privilégios por coluna ---------------------------------------------------------------------
do $$
declare t text; cols text[]; pk text[]; ins text; upd text;
begin
  foreach t in array array['events','families','people','expenses','settlement_marks','event_overrides','expense_confirmations','recipes','meal_plan'] loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', t);
    cols := public._op_columns(t); pk := public._op_pk(t);
    if t <> 'events' then
      select string_agg(format('%I', c), ', ') into ins from unnest(pk || cols) c where c <> 'id' or t <> 'events';
      execute format('grant insert (%s) on public.%I to authenticated', ins, t);
    end if;
    if t <> 'expense_confirmations' then
      select string_agg(format('%I', c), ', ') into upd from unnest(cols || array['version']) c;
      execute format('grant update (%s) on public.%I to authenticated', upd, t);
    end if;
  end loop;
end $$;

-- 3) membros ------------------------------------------------------------------------------------
revoke insert, update, delete on public.event_members from anon, authenticated;
drop policy if exists members_update_self on public.event_members;

create or replace function public.set_member_family(p_event uuid, p_user uuid, p_family text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_organizer(p_event);
  if p_family is not null and not exists (select 1 from public.families f where f.event_id = p_event and f.id = p_family and f.deleted_at is null) then
    raise exception 'family_not_found' using errcode = '23503';
  end if;
  update public.event_members set family_id = p_family where event_id = p_event and user_id = p_user and status <> 'revoked';
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.set_member_family(uuid, uuid, text) from public, anon;
grant execute on function public.set_member_family(uuid, uuid, text) to authenticated;
