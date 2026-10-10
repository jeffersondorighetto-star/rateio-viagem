-- 0012 — Expurgo automático da dieta (aprovado pelo Jefferson em 10/10): LIGADO por padrão.
-- A migração tenta ligar a extensão pg_cron e agenda public.purge_expired_health() todo dia às 04:00 UTC
-- (apaga person_diet de eventos terminados há mais de 30 dias).
-- Se o pg_cron não puder ser ligado por aqui: Database › Extensions › pg_cron › Enable e depois
--     select public.enable_health_purge();
-- Conferir:  select public.health_purge_status();     Desligar (não recomendado): select public.disable_health_purge();
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

-- Liga o pg_cron (no Supabase fica no schema pg_catalog) e agenda. Nunca faz a migração falhar.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension if not exists pg_cron with schema pg_catalog;
    exception when others then
      raise notice 'pg_cron indisponível aqui (%). Ligue em Database › Extensions › pg_cron e rode: select public.enable_health_purge();', sqlerrm;
    end;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '%', public.enable_health_purge();
  end if;
end $$;
