-- 0001 — Extensões, tabelas base e gatilho de updated_at/autoria.
-- Idempotente. Sem segredos e sem dados reais. Nada de CPF, conta, cartão ou Pix.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(name) between 1 and 80),
  start_date          date,
  end_date            date,
  meals               jsonb not null default '{"cafe":true,"almoco":true,"lanche":false,"jantar":true}'::jsonb
                      check (jsonb_typeof(meals) = 'object' and pg_column_size(meals) <= 512),
  split_mode          text not null default 'pessoa' check (split_mode in ('porcoes','pessoa','igual')),
  include_unconfirmed boolean not null default true,
  kitty_per_family    numeric(12,2) not null default 0 check (kitty_per_family between 0 and 1000000),
  weights             jsonb not null default '{}'::jsonb
                      check (jsonb_typeof(weights) = 'object' and pg_column_size(weights) <= 512),
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (end_date is null or start_date is null or (end_date >= start_date and end_date - start_date <= 60))
);

-- Segredo do código: SEM policy, nenhum cliente lê (só as funções abaixo).
create table if not exists public.event_secrets (
  event_id    uuid primary key references public.events(id) on delete cascade,
  code_lookup text not null,            -- sha256(upper(código)) em hex, para achar o evento
  code_hash   text not null,            -- bcrypt (gen_salt('bf')) do código, conferido no join
  created_at  timestamptz not null default now()
);
create unique index if not exists event_secrets_code_lookup_key on public.event_secrets (code_lookup);

create table if not exists public.event_members (
  event_id     uuid not null references public.events(id) on delete cascade,
  user_id      uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 40),
  family_id    text check (family_id is null or family_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  joined_at    timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists event_members_user_idx on public.event_members (user_id);

-- Ids de conteúdo são texto gerado no cliente (ids curtos do app ou UUID).
create table if not exists public.families (
  event_id    uuid not null references public.events(id) on delete cascade,
  id          text not null check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  name        text not null check (char_length(name) between 1 and 60),
  color       text check (color is null or char_length(color) <= 40),
  pos         int  not null default 0 check (pos between 0 and 1000),
  arrive      date, arrive_meal text check (arrive_meal is null or arrive_meal in ('cafe','almoco','lanche','jantar')),
  depart      date, depart_meal text check (depart_meal is null or depart_meal in ('cafe','almoco','lanche','jantar')),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  primary key (event_id, id)
);

-- Pessoas: só primeiro nome. SEM campos de dieta/alergia (dado de saúde fica no aparelho).
create table if not exists public.people (
  event_id    uuid not null references public.events(id) on delete cascade,
  id          text not null check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  family_id   text not null check (family_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  first_name  text not null check (char_length(first_name) between 1 and 40),
  type        text not null default 'adulto' check (type in ('adulto','adolescente','crianca','bebe')),
  drinks      boolean not null default false,
  pos         int  not null default 0 check (pos between 0 and 1000),
  arrive      date, arrive_meal text check (arrive_meal is null or arrive_meal in ('cafe','almoco','lanche','jantar')),
  depart      date, depart_meal text check (depart_meal is null or depart_meal in ('cafe','almoco','lanche','jantar')),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  primary key (event_id, id)
);

-- Gastos: só valor e descrição. SEM foto no servidor neste MVP.
create table if not exists public.expenses (
  event_id               uuid not null references public.events(id) on delete cascade,
  id                     text not null check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  description            text not null default '' check (char_length(description) <= 120),
  amount                 numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  category               text not null check (category in ('food','groceries','gas','alcohol')),
  payer_person_id        text check (payer_person_id is null or payer_person_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  participants           jsonb check (participants is null or (jsonb_typeof(participants) = 'array'
                                      and jsonb_array_length(participants) <= 100 and pg_column_size(participants) <= 4096)),
  proof                  text not null default 'nf' check (proof in ('nf','comp','none')),
  estimated              boolean not null default false,
  note                   text check (note is null or char_length(note) <= 300),
  items                  jsonb check (items is null or pg_column_size(items) <= 8192),
  confirmed_by_family_id text check (confirmed_by_family_id is null or confirmed_by_family_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  confirmed_at           timestamptz,
  client_ts              bigint,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  primary key (event_id, id)
);

-- Marcações de "transferência acertada". Desmarcar = deleted_at preenchido.
create table if not exists public.settlement_marks (
  event_id    uuid not null references public.events(id) on delete cascade,
  from_family text not null check (from_family ~ '^[A-Za-z0-9_-]{1,40}$'),
  to_family   text not null check (to_family ~ '^[A-Za-z0-9_-]{1,40}$'),
  amount      numeric(12,2) not null check (amount >= 0 and amount <= 1000000),
  marked_by   uuid,
  marked_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  primary key (event_id, from_family, to_family)
);

create index if not exists families_event_upd_idx  on public.families (event_id, updated_at);
create index if not exists people_event_upd_idx    on public.people (event_id, updated_at);
create index if not exists expenses_event_upd_idx  on public.expenses (event_id, updated_at);
create index if not exists marks_event_upd_idx     on public.settlement_marks (event_id, updated_at);

-- ---------------------------------------------------------------------
-- Gatilhos: updated_at / autoria preenchidos pelo servidor
-- ---------------------------------------------------------------------
create or replace function public.tg_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    if tg_table_name = 'expenses' then
      new.created_by := old.created_by; new.created_at := old.created_at;
    end if;
  elsif tg_table_name = 'expenses' then
    new.created_by := auth.uid(); new.created_at := now();
  end if;
  if tg_table_name = 'settlement_marks' then
    new.marked_by := auth.uid();
    if tg_op = 'INSERT' or new.amount is distinct from old.amount or new.deleted_at is distinct from old.deleted_at then
      new.marked_at := now();
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['events','families','people','expenses','settlement_marks'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before insert or update on public.%I for each row execute function public.tg_touch()', t);
  end loop;
end $$;
