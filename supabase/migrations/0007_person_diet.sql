-- 0007 — Dieta/alergia (DADO DE SAÚDE, LGPD art. 11). SÓ SQL: o app continua guardando dieta no aparelho
-- até a revisão da Astreia. Mínimo necessário, aceite do responsável obrigatório, só membros aprovados,
-- nunca em texto de WhatsApp/export público, e expurgo 30 dias depois do fim do evento.

create table if not exists public.person_diet (
  event_id         uuid not null references public.events(id) on delete cascade,
  person_id        text not null check (person_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  veg              boolean not null default false,
  no_lactose       boolean not null default false,
  no_gluten        boolean not null default false,
  allergy_text     text check (allergy_text is null or char_length(allergy_text) <= 80),
  guardian_consent boolean not null check (guardian_consent),   -- sem aceite do responsável não grava
  consent_by       uuid,
  consent_at       timestamptz,
  version          int not null default 1,
  updated_at       timestamptz not null default now(),
  primary key (event_id, person_id)
);

create or replace function public.tg_person_diet() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.is_event_writable(new.event_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.people p where p.event_id = new.event_id and p.id = new.person_id and p.deleted_at is null) then
    raise exception 'person_not_found' using errcode = '23503';
  end if;
  if tg_op = 'INSERT' or new.guardian_consent is distinct from old.guardian_consent or new.consent_by is distinct from old.consent_by then
    new.consent_by := auth.uid(); new.consent_at := now();
  end if;
  return new;
end $$;
drop trigger if exists diet_consent on public.person_diet;
create trigger diet_consent before insert or update on public.person_diet for each row execute function public.tg_person_diet();
drop trigger if exists touch on public.person_diet;
create trigger touch before insert or update on public.person_diet for each row execute function public.tg_touch();
drop trigger if exists version_guard on public.person_diet;
create trigger version_guard before insert or update on public.person_diet for each row execute function public.tg_version();

alter table public.person_diet enable row level security;
revoke all on public.person_diet from anon, authenticated;
grant select, insert, update on public.person_diet to authenticated;
drop policy if exists diet_select on public.person_diet;
create policy diet_select on public.person_diet for select to authenticated using (public.is_event_member(event_id));
drop policy if exists diet_insert on public.person_diet;
create policy diet_insert on public.person_diet for insert to authenticated with check (public.is_event_writable(event_id));
drop policy if exists diet_update on public.person_diet;
create policy diet_update on public.person_diet for update to authenticated
  using (public.is_event_writable(event_id)) with check (public.is_event_writable(event_id));
-- Retirar o dado = organizador chama purge_health (não há DELETE para clientes).

-- Organizador apaga a dieta do evento a qualquer momento.
create or replace function public.purge_health(p_event uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public._require_organizer(p_event);
  delete from public.person_diet where event_id = p_event;
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.purge_health(uuid) from public, anon;
grant execute on function public.purge_health(uuid) to authenticated;

-- Expurgo automático: eventos terminados há mais de 30 dias (ou sem data e criados há mais de 90 dias).
-- Só para o servidor (SQL Editor ou pg_cron, se ligado em 0012); clientes não executam.
create or replace function public.purge_expired_health() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.person_diet d using public.events e
   where e.id = d.event_id
     and ((e.end_date is not null and e.end_date < current_date - 30)
       or (e.end_date is null and e.created_at < now() - interval '90 days'));
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.purge_expired_health() from public, anon, authenticated;

-- Agendamento automático: 0012_health_purge_cron.sql (ligado por padrão; aprovado pelo Jefferson em 10/10).
