-- 0005 — Confirmação de gasto "sem nota" (só inserção) e sobreposições do evento (pesos, preços, quantidades).

-- Uma confirmação ativa por gasto. Clientes só inserem. O servidor anula (voided_at) quando o gasto muda
-- de pagador ou deixa de ser "sem nota" (mesma regra do app). Sem UPDATE/DELETE para clientes.
create table if not exists public.expense_confirmations (
  event_id     uuid not null references public.events(id) on delete cascade,
  id           uuid not null,
  expense_id   text not null check (expense_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  family_id    text not null check (family_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  confirmed_by uuid,
  confirmed_at timestamptz not null default now(),
  voided_at    timestamptz,
  primary key (event_id, id)
);
create unique index if not exists expense_confirmations_active_key
  on public.expense_confirmations (event_id, expense_id) where voided_at is null;

create or replace function public.tg_confirmation_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_payer_family text; v_proof text;
begin
  if not public.is_event_writable(new.event_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select p.family_id, e.proof into v_payer_family, v_proof
    from public.expenses e left join public.people p on p.event_id = e.event_id and p.id = e.payer_person_id
   where e.event_id = new.event_id and e.id = new.expense_id and e.deleted_at is null;
  if v_proof is null then raise exception 'expense_not_found' using errcode = '23503'; end if;
  if v_proof <> 'none' then raise exception 'only_sem_nota' using errcode = '23514'; end if;
  if new.family_id = v_payer_family then raise exception 'payer_family_cannot_confirm' using errcode = '23514'; end if;
  if not exists (select 1 from public.families f where f.event_id = new.event_id and f.id = new.family_id and f.deleted_at is null) then
    raise exception 'family_not_found' using errcode = '23503';
  end if;
  -- membro só confirma pela própria família (event_members.family_id, definida pelo organizador); organizador por qualquer uma
  if not public.is_event_organizer(new.event_id) and not exists (
       select 1 from public.event_members m where m.event_id = new.event_id and m.user_id = auth.uid() and m.family_id = new.family_id) then
    raise exception 'not_your_family' using errcode = '42501';
  end if;
  new.confirmed_by := auth.uid(); new.confirmed_at := now(); new.voided_at := null;
  return new;
end $$;
drop trigger if exists confirmation_insert on public.expense_confirmations;
create trigger confirmation_insert before insert on public.expense_confirmations
  for each row execute function public.tg_confirmation_insert();

create or replace function public.tg_expense_void_confirmation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.payer_person_id is distinct from old.payer_person_id or new.proof <> 'none' or new.deleted_at is not null then
    update public.expense_confirmations set voided_at = now()
     where event_id = new.event_id and expense_id = new.id and voided_at is null;
  end if;
  return new;
end $$;
drop trigger if exists void_confirmation on public.expenses;
create trigger void_confirmation after update on public.expenses
  for each row execute function public.tg_expense_void_confirmation();

alter table public.expense_confirmations enable row level security;
revoke all on public.expense_confirmations from anon, authenticated;
grant select on public.expense_confirmations to authenticated; -- insert por coluna em 0013
drop policy if exists confirmations_select on public.expense_confirmations;
create policy confirmations_select on public.expense_confirmations for select to authenticated using (public.is_event_member(event_id));
drop policy if exists confirmations_insert on public.expense_confirmations;
create policy confirmations_insert on public.expense_confirmations for insert to authenticated with check (public.is_event_writable(event_id));

-- Sobreposições: um registro por peso/preço/quantidade, nunca o objeto inteiro.
create table if not exists public.event_overrides (
  event_id   uuid not null references public.events(id) on delete cascade,
  kind       text not null check (kind in ('weight','price','plan_qty')),
  key        text not null check (key ~ '^[A-Za-z0-9_|:.-]{1,80}$'),
  value      jsonb not null check (jsonb_typeof(value) in ('number','string','boolean','object') and pg_column_size(value) <= 512),
  version    int not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (event_id, kind, key)
);
create index if not exists overrides_event_upd_idx on public.event_overrides (event_id, updated_at);
drop trigger if exists touch on public.event_overrides;
create trigger touch before insert or update on public.event_overrides for each row execute function public.tg_touch();
drop trigger if exists version_guard on public.event_overrides;
create trigger version_guard before insert or update on public.event_overrides for each row execute function public.tg_version();
alter table public.event_overrides enable row level security;
revoke all on public.event_overrides from anon, authenticated;
grant select on public.event_overrides to authenticated; -- insert/update por coluna em 0013
drop policy if exists overrides_select on public.event_overrides;
create policy overrides_select on public.event_overrides for select to authenticated using (public.is_event_member(event_id));
drop policy if exists overrides_insert on public.event_overrides;
create policy overrides_insert on public.event_overrides for insert to authenticated with check (public.is_event_writable(event_id));
drop policy if exists overrides_update on public.event_overrides;
create policy overrides_update on public.event_overrides for update to authenticated
  using (public.is_event_writable(event_id)) with check (public.is_event_writable(event_id));

-- Caminho da foto no Storage (o app ainda guarda fotos só no aparelho; envio fica para depois).
alter table public.expenses add column if not exists photo_path text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_photo_path_chk') then
    alter table public.expenses add constraint expenses_photo_path_chk
      check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,40}\.jpg$');
  end if;
end $$;
