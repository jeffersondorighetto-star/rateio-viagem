-- =====================================================================
-- Rateatouille — backend mínimo (MVP) para o Supabase
-- Cole TUDO no Supabase › SQL Editor › New query › Run.
-- Idempotente: pode rodar de novo sem perder dados.
-- Sem segredos e sem dados reais. Nada de CPF, conta, cartão ou Pix.
-- Fora deste MVP (de propósito): dieta/alergia, receitas, cardápio,
-- fotos, aprovação de organizador, fila offline e versionamento.
-- =====================================================================

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

-- ---------------------------------------------------------------------
-- Função de pertencimento (usada pelas policies)
-- ---------------------------------------------------------------------
create or replace function public.is_event_member(e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.event_members m
                 where m.event_id = e and m.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- RLS + privilégios (sem DELETE para clientes; exclusão é lógica)
-- ---------------------------------------------------------------------
alter table public.events           enable row level security;
alter table public.event_secrets    enable row level security;
alter table public.event_members    enable row level security;
alter table public.families         enable row level security;
alter table public.people           enable row level security;
alter table public.expenses         enable row level security;
alter table public.settlement_marks enable row level security;

revoke all on public.events, public.event_secrets, public.event_members, public.families,
              public.people, public.expenses, public.settlement_marks from anon, authenticated;

grant select on public.events to authenticated;
grant update (name, start_date, end_date, meals, split_mode, include_unconfirmed, kitty_per_family, weights)
  on public.events to authenticated;
grant select on public.event_members to authenticated;
grant update (display_name, family_id) on public.event_members to authenticated;
grant select, insert, update on public.families, public.people, public.expenses, public.settlement_marks to authenticated;
-- event_secrets: nenhum privilégio, nenhuma policy.

drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated using (public.is_event_member(id));
drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (public.is_event_member(id)) with check (public.is_event_member(id));

drop policy if exists members_select on public.event_members;
create policy members_select on public.event_members for select to authenticated using (public.is_event_member(event_id));
drop policy if exists members_update_self on public.event_members;
create policy members_update_self on public.event_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['families','people','expenses','settlement_marks'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_event_member(event_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_event_member(event_id))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_event_member(event_id)) with check (public.is_event_member(event_id))', t || '_update', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- RPCs: criar evento e entrar com código
-- Código: 8 caracteres de ABCDEFGHJKMNPQRSTUVWXYZ23456789 (sem 0/O, 1/I/L).
-- ---------------------------------------------------------------------
create or replace function public.create_event(p_name text, p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_id   uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if v_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$' then raise exception 'invalid_code_format' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 40 then raise exception 'invalid_display_name' using errcode = '22023'; end if;
  if (select count(*) from public.events where created_by = v_uid) >= 20 then raise exception 'too_many_events' using errcode = '54000'; end if;

  insert into public.events (name, created_by) values (btrim(p_name), v_uid) returning id into v_id;
  begin
    insert into public.event_secrets (event_id, code_lookup, code_hash)
    values (v_id, encode(extensions.digest(v_code, 'sha256'), 'hex'), extensions.crypt(v_code, extensions.gen_salt('bf', 8)));
  exception when unique_violation then
    raise exception 'code_taken' using errcode = '23505';   -- o cliente gera outro código e tenta de novo
  end;
  insert into public.event_members (event_id, user_id, display_name) values (v_id, v_uid, btrim(p_display_name));
  return v_id;
end $$;

create or replace function public.join_event(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_id   uuid;
  v_hash text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 40 then raise exception 'invalid_display_name' using errcode = '22023'; end if;
  if v_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$' then raise exception 'invalid_code' using errcode = '22023'; end if;
  select s.event_id, s.code_hash into v_id, v_hash
    from public.event_secrets s where s.code_lookup = encode(extensions.digest(v_code, 'sha256'), 'hex');
  if v_id is null or extensions.crypt(v_code, v_hash) <> v_hash then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  insert into public.event_members (event_id, user_id, display_name) values (v_id, v_uid, btrim(p_display_name))
  on conflict (event_id, user_id) do update set display_name = excluded.display_name;
  return v_id;
end $$;

revoke all on function public.create_event(text, text, text) from public, anon;
revoke all on function public.join_event(text, text) from public, anon;
revoke all on function public.is_event_member(uuid) from public, anon;
grant execute on function public.create_event(text, text, text) to authenticated;
grant execute on function public.join_event(text, text) to authenticated;
grant execute on function public.is_event_member(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Tempo real (Supabase Realtime aplica a RLS acima a cada evento)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['events','event_members','families','people','expenses','settlement_marks'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- Pronto. Confira em Table Editor que todas as tabelas aparecem com "RLS enabled".
