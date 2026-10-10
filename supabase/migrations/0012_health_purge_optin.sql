-- 0012 — Expurgo automático de dieta (pg_cron): DESLIGADO até o "sim" do Jefferson.
-- Para ligar (uma vez, no SQL Editor):  Database › Extensions › pg_cron (Enable)  e depois
--     select public.enable_health_purge();     -- agenda todo dia 04:00 UTC
-- Para desligar:                             select public.disable_health_purge();
-- Ver se está ligado:                        select public.health_purge_status();
-- Sem pg_cron, o organizador continua podendo apagar a dieta do evento (purge_health) e o
-- servidor pode rodar à mão: select public.purge_expired_health();
-- Só o dono do banco (SQL Editor) executa estas funções; clientes não.

create or replace function public.enable_health_purge() returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return 'pg_cron não está ligado: Database › Extensions › pg_cron › Enable, e rode de novo';
  end if;
  execute $q$ select cron.unschedule(jobid) from cron.job where jobname = 'rateio_purge_health' $q$;
  execute $q$ select cron.schedule('rateio_purge_health', '0 4 * * *', 'select public.purge_expired_health()') $q$;
  return 'expurgo diário ligado (04:00 UTC)';
end $$;
create or replace function public.disable_health_purge() returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return 'pg_cron não está ligado: nada agendado'; end if;
  execute $q$ select cron.unschedule(jobid) from cron.job where jobname = 'rateio_purge_health' $q$;
  return 'expurgo diário desligado';
end $$;
create or replace function public.health_purge_status() returns text
language plpgsql stable security definer set search_path = '' as $$
declare n int := 0;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return 'desligado (sem pg_cron)'; end if;
  execute $q$ select count(*)::int from cron.job where jobname = 'rateio_purge_health' $q$ into n;
  return case when n > 0 then 'ligado' else 'desligado' end;
end $$;
revoke all on function public.enable_health_purge(), public.disable_health_purge(), public.health_purge_status() from public, anon, authenticated;
