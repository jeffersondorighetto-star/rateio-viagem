-- =====================================================================
-- Rateatouille — banco do evento compartilhado (Supabase)
-- ARQUIVO GERADO por supabase/build.sh a partir de supabase/migrations/. Não edite à mão.
-- Cole TUDO no Supabase › SQL Editor › New query › Run. Idempotente: pode rodar de novo sem perder dados.
-- Sem segredos e sem dados reais. Nada de CPF, conta, cartão ou Pix.
-- =====================================================================

-- >>>>> migrations/0001_core_tables.sql
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

-- >>>>> migrations/0002_membership_access.sql
-- 0002 — Papéis e status de membro, trava do evento e regras de acesso (RLS).
-- Só membros APROVADOS leem; só aprovados com evento destravado gravam. Sem DELETE para clientes.

alter table public.events add column if not exists locked boolean not null default false;
alter table public.events add column if not exists code_version int not null default 1;
alter table public.event_secrets add column if not exists code_version int not null default 1;
alter table public.event_secrets add column if not exists rotated_at timestamptz;

alter table public.event_members add column if not exists role text not null default 'member';
alter table public.event_members add column if not exists status text not null default 'pending';
alter table public.event_members add column if not exists joined_code_version int not null default 1;
alter table public.event_members add column if not exists decided_by uuid;
alter table public.event_members add column if not exists decided_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'event_members_role_chk') then
    alter table public.event_members add constraint event_members_role_chk check (role in ('organizer','member'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_members_status_chk') then
    alter table public.event_members add constraint event_members_status_chk check (status in ('pending','approved','revoked'));
  end if;
end $$;
-- Bancos criados com o script do MVP: o criador de cada evento vira organizador aprovado.
update public.event_members m set role = 'organizer', status = 'approved', decided_by = m.user_id, decided_at = now()
  from public.events e
 where e.id = m.event_id and e.created_by = m.user_id and m.decided_at is null;
create index if not exists event_members_event_status_idx on public.event_members (event_id, status);

-- Tentativas de código (limite: 5 erros em 10 min por usuário). Sem policy: só funções.
create table if not exists public.join_attempts (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists join_attempts_user_at_idx on public.join_attempts (user_id, at);

-- ---------------------------------------------------------------------
-- Funções de acesso (security definer: leem event_members sem recursão de RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_event_member(e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.event_members m
                 where m.event_id = e and m.user_id = auth.uid() and m.status = 'approved');
$$;
create or replace function public.is_event_writable(e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.event_members m join public.events ev on ev.id = m.event_id
                 where m.event_id = e and m.user_id = auth.uid() and m.status = 'approved' and not ev.locked);
$$;
create or replace function public.is_event_organizer(e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.event_members m
                 where m.event_id = e and m.user_id = auth.uid() and m.status = 'approved' and m.role = 'organizer');
$$;

-- ---------------------------------------------------------------------
-- RLS + privilégios
-- ---------------------------------------------------------------------
alter table public.events           enable row level security;
alter table public.event_secrets    enable row level security;
alter table public.event_members    enable row level security;
alter table public.families         enable row level security;
alter table public.people           enable row level security;
alter table public.expenses         enable row level security;
alter table public.settlement_marks enable row level security;
alter table public.join_attempts    enable row level security;

revoke all on public.events, public.event_secrets, public.event_members, public.families, public.people,
              public.expenses, public.settlement_marks, public.join_attempts from anon, authenticated;

grant select on public.events to authenticated;
-- configurações do evento: só o organizador (política em 0009). Nome, trava e código só por RPC.
grant update (start_date, end_date, meals, split_mode, include_unconfirmed, kitty_per_family)
  on public.events to authenticated;
-- event_members: só leitura para clientes; nome, família e papel mudam por RPC (0003, 0009, 0013)
grant select on public.event_members to authenticated;
-- INSERT/UPDATE por COLUNA (a mesma lista do apply_ops) ficam em 0013_hardening.sql, depois da coluna version existir
grant select on public.families, public.people, public.expenses, public.settlement_marks to authenticated;

drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated using (public.is_event_member(id));
drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (public.is_event_writable(id)) with check (public.is_event_writable(id));

-- membros aprovados veem a lista (inclusive pendentes, para o organizador decidir); cada um vê a própria linha
drop policy if exists members_select on public.event_members;
create policy members_select on public.event_members for select to authenticated
  using (user_id = auth.uid() or public.is_event_member(event_id));
drop policy if exists members_update_self on public.event_members;

do $$
declare t text;
begin
  foreach t in array array['families','people','expenses','settlement_marks'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_event_member(event_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_event_writable(event_id))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_event_writable(event_id)) with check (public.is_event_writable(event_id))', t || '_update', t);
  end loop;
end $$;

revoke all on function public.is_event_member(uuid), public.is_event_writable(uuid), public.is_event_organizer(uuid) from public, anon;
grant execute on function public.is_event_member(uuid), public.is_event_writable(uuid), public.is_event_organizer(uuid) to authenticated;

-- >>>>> migrations/0003_event_rpcs.sql
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

-- >>>>> migrations/0004_versioning_ops.sql
-- 0004 — Versão por linha (o servidor recusa versão velha) e operações idempotentes (client_ops + apply_ops).
-- Regra: INSERT começa em version = 1; UPDATE só passa se NEW.version = OLD.version + 1 (senão erro PT409 'version_conflict' = HTTP 409 no PostgREST; 40001 faria o PostgREST repetir a transação).
-- O cliente manda só os campos alterados com a versão que conhecia; em conflito recebe a linha atual e mescla campo a campo.

do $$
declare t text;
begin
  foreach t in array array['events','families','people','expenses','settlement_marks'] loop
    execute format('alter table public.%I add column if not exists version int not null default 1', t);
  end loop;
end $$;
grant update (version) on public.events to authenticated;

create or replace function public.tg_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.version := 1; return new; end if;
  -- mudanças feitas por funções do servidor (RPCs, gatilhos) sobem a versão sozinhas
  if current_setting('rateio.server_write', true) = 'on' then
    new.version := old.version + 1; return new;
  end if;
  if new.version is distinct from old.version + 1 then
    raise exception 'version_conflict' using errcode = 'PT409', detail = format('current=%s sent=%s', old.version, new.version);
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['events','families','people','expenses','settlement_marks'] loop
    execute format('drop trigger if exists version_guard on public.%I', t);
    execute format('create trigger version_guard before insert or update on public.%I for each row execute function public.tg_version()', t);
  end loop;
end $$;

-- RPCs do organizador mexem em events (trava, nome, código): marcam a escrita como do servidor.
create or replace function public._server_write() returns void
language sql set search_path = '' as $$ select set_config('rateio.server_write', 'on', true) $$;
revoke all on function public._server_write() from public, anon, authenticated;

create or replace function public.lock_event(p_event uuid, p_locked boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_organizer(p_event); perform public._server_write();
  update public.events set locked = coalesce(p_locked, true) where id = p_event;
end $$;
create or replace function public.rename_event(p_event uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_organizer(p_event);
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'invalid_name' using errcode = '22023'; end if;
  perform public._server_write();
  update public.events set name = btrim(p_name) where id = p_event;
end $$;
create or replace function public.rotate_code(p_event uuid, p_new_code text, p_repend boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare v_code text := upper(btrim(coalesce(p_new_code, ''))); v_ver int;
begin
  perform public._require_organizer(p_event);
  if not public._code_ok(v_code) then raise exception 'invalid_code_format' using errcode = '22023'; end if;
  begin
    update public.event_secrets set code_lookup = public._code_lookup(v_code),
           code_hash = extensions.crypt(v_code, extensions.gen_salt('bf', 8)),
           code_version = code_version + 1, rotated_at = now()
     where event_id = p_event returning code_version into v_ver;
  exception when unique_violation then raise exception 'code_taken' using errcode = '23505';
  end;
  perform public._server_write();
  update public.events set code_version = v_ver where id = p_event;
  if p_repend then
    update public.event_members set status = 'pending', decided_by = auth.uid(), decided_at = now()
     where event_id = p_event and status = 'approved' and role <> 'organizer';
  end if;
  return v_ver;
end $$;

do $$
declare f text;
begin
  foreach f in array array['rotate_code(uuid,text,boolean)','lock_event(uuid,boolean)','rename_event(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Operações já aplicadas (idempotência da fila do aparelho).
create table if not exists public.client_ops (
  op_id      uuid primary key,
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null,
  applied_at timestamptz not null default now()
);
create index if not exists client_ops_event_idx on public.client_ops (event_id, applied_at);
alter table public.client_ops enable row level security;
revoke all on public.client_ops from anon, authenticated;
grant select, insert on public.client_ops to authenticated;
drop policy if exists client_ops_select on public.client_ops;
create policy client_ops_select on public.client_ops for select to authenticated using (user_id = auth.uid());
drop policy if exists client_ops_insert on public.client_ops;
create policy client_ops_insert on public.client_ops for insert to authenticated
  with check (user_id = auth.uid() and public.is_event_writable(event_id));

-- Colunas que cada tabela aceita via apply_ops (as próximas migrações substituem estas funções ao criar tabelas).
create or replace function public._op_columns(t text) returns text[]
language sql immutable set search_path = '' as $$
  select case t
    when 'events'           then array['start_date','end_date','meals','split_mode','include_unconfirmed','kitty_per_family']
    when 'families'         then array['name','color','pos','arrive','arrive_meal','depart','depart_meal','deleted_at']
    when 'people'           then array['family_id','first_name','type','drinks','pos','arrive','arrive_meal','depart','depart_meal','deleted_at']
    when 'expenses'         then array['description','amount','category','payer_person_id','participants','proof','estimated','note','items','client_ts','photo_path','deleted_at']
    when 'settlement_marks' then array['amount','deleted_at']
    when 'event_overrides'  then array['value','deleted_at']
    when 'expense_confirmations' then array['expense_id','family_id']
  end
$$;
create or replace function public._op_pk(t text) returns text[]
language sql immutable set search_path = '' as $$
  select case t when 'events' then array['id'] when 'settlement_marks' then array['event_id','from_family','to_family']
                when 'event_overrides' then array['event_id','kind','key'] else array['event_id','id'] end
$$;

-- apply_ops(evento, [{op_id, table, row, expected_version}]) -> [{op_id, status: ok|dup|conflict|error, row, error}]
-- SECURITY INVOKER: roda com as permissões e a RLS de quem chama. Cada operação numa subtransação.
--   expected_version null  -> INSERT (row completa)
--   expected_version n     -> UPDATE só dos campos enviados, se a versão no servidor ainda for n
create or replace function public.apply_ops(p_event uuid, p_ops jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  op jsonb; r jsonb; t text; res jsonb := '[]'::jsonb; allowed text[]; pkc text[]; cols text[];
  v_exp int; v_op uuid; n int; cur jsonb; pkw text; collist text;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 200 then raise exception 'too_many_ops' using errcode = '54000'; end if;
  for op in select value from jsonb_array_elements(p_ops) loop
    t := op->>'table';
    allowed := public._op_columns(t);
    pkc := public._op_pk(t);
    v_op := nullif(op->>'op_id', '')::uuid;
    if allowed is null or v_op is null or jsonb_typeof(op->'row') <> 'object' then
      res := res || jsonb_build_array(jsonb_build_object('op_id', op->>'op_id', 'status', 'error', 'error', 'bad_op')); continue;
    end if;
    r := (op->'row') || case when t = 'events' then jsonb_build_object('id', p_event) else jsonb_build_object('event_id', p_event) end;
    v_exp := nullif(op->>'expected_version', '')::int;
    pkw := (select string_agg(format('x.%1$I = (jsonb_populate_record(null::public.%2$I, $1)).%1$I', c, t), ' and ') from unnest(pkc) c);
    begin
      if exists (select 1 from public.client_ops where op_id = v_op) then
        execute format('select to_jsonb(x) from public.%I x where %s', t, pkw) into cur using r;
        res := res || jsonb_build_array(jsonb_build_object('op_id', v_op, 'status', 'dup', 'row', cur)); continue;
      end if;
      cols := array(select k from jsonb_object_keys(r) k where k = any(allowed) and not k = any(pkc));
      if v_exp is null then
        if t = 'events' then raise exception 'bad_op' using errcode = '22023'; end if;
        collist := (select string_agg(format('%I', c), ',') from unnest(pkc || cols) c);
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)', t, collist, collist, t) using r;
      else
        if t = 'expense_confirmations' then raise exception 'insert_only' using errcode = '42501'; end if;
        if coalesce(array_length(cols, 1), 0) = 0 then raise exception 'empty_patch' using errcode = '22023'; end if;
        collist := (select string_agg(format('%I', c), ',') from unnest(cols) c);
        execute format('update public.%1$I x set (%2$s, version) = (select %2$s, $2 + 1 from jsonb_populate_record(null::public.%1$I, $1)) where %3$s and x.version = $2',
                       t, collist, pkw) using r, v_exp;
        get diagnostics n = row_count;
        if n = 0 then
          -- linha visível na versão esperada e mesmo assim 0 linhas = a RLS não deixou (não é conflito)
          execute format('select x.version from public.%I x where %s', t, pkw) into n using r;
          if n = v_exp then raise exception 'not_allowed' using errcode = '42501'; end if;
          raise exception 'version_conflict' using errcode = 'PT409';
        end if;
      end if;
      insert into public.client_ops (op_id, event_id, user_id) values (v_op, p_event, auth.uid());
      execute format('select to_jsonb(x) from public.%I x where %s', t, pkw) into cur using r;
      res := res || jsonb_build_array(jsonb_build_object('op_id', v_op, 'status', 'ok', 'row', cur));
    exception
      when unique_violation or sqlstate 'PT409' then
        execute format('select to_jsonb(x) from public.%I x where %s', t, pkw) into cur using r;
        res := res || jsonb_build_array(jsonb_build_object('op_id', v_op, 'status', 'conflict', 'row', cur));
      when others then
        res := res || jsonb_build_array(jsonb_build_object('op_id', v_op, 'status', 'error', 'error', sqlerrm, 'code', sqlstate));
    end;
  end loop;
  return res;
end $$;
revoke all on function public.apply_ops(uuid, jsonb) from public, anon;
grant execute on function public.apply_ops(uuid, jsonb) to authenticated;

-- >>>>> migrations/0005_confirmations_overrides.sql
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

-- >>>>> migrations/0006_storage_comprovantes.sql
-- 0006 — Bucket privado "comprovantes": <event_id>/<expense_id>.jpg, até 150 KB, JPEG/WebP.
-- Ler e enviar: membros aprovados (enviar só com evento destravado). Trocar e apagar: só organizador.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprovantes', 'comprovantes', false, 153600, array['image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 153600, allowed_mime_types = array['image/jpeg','image/webp'];

-- Evento dono do arquivo, ou null se o caminho fugir do padrão.
create or replace function public.proof_event_id(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{1,40}\.jpg$'
              then split_part(p_name, '/', 1)::uuid end
$$;
grant execute on function public.proof_event_id(text) to authenticated;

drop policy if exists comprovantes_select on storage.objects;
create policy comprovantes_select on storage.objects for select to authenticated
  using (bucket_id = 'comprovantes' and public.is_event_member(public.proof_event_id(name)));
drop policy if exists comprovantes_insert on storage.objects;
create policy comprovantes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'comprovantes' and public.is_event_writable(public.proof_event_id(name)));
drop policy if exists comprovantes_update on storage.objects;
create policy comprovantes_update on storage.objects for update to authenticated
  using (bucket_id = 'comprovantes' and public.is_event_organizer(public.proof_event_id(name)))
  with check (bucket_id = 'comprovantes' and public.is_event_organizer(public.proof_event_id(name)));
drop policy if exists comprovantes_delete on storage.objects;
create policy comprovantes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'comprovantes' and public.is_event_organizer(public.proof_event_id(name)));

-- >>>>> migrations/0008_realtime.sql
-- 0008 — Tempo real (o Supabase Realtime aplica a RLS acima a cada evento). Dieta NÃO entra no tempo real.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['events','event_members','families','people','expenses','settlement_marks','expense_confirmations','event_overrides'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- >>>>> migrations/0009_organizer_settings_roles.sql
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

-- >>>>> migrations/0010_recipes_meal_plan.sql
-- 0010 — Receitas e cardápio compartilhados (o parser e a lista de compras continuam no cliente).
-- Uma linha por receita e uma por célula do cardápio (dia × refeição), versionadas como os gastos.
-- Nada de dieta/alergia aqui: os alertas de dieta usam o que está no aparelho.

create table if not exists public.recipes (
  event_id   uuid not null references public.events(id) on delete cascade,
  id         text not null check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  title      text not null check (char_length(title) between 1 and 120),
  yield      numeric(6,2) not null default 4 check (yield > 0 and yield <= 500),
  text       text check (text is null or char_length(text) <= 8000),
  parsed     jsonb not null default '{}'::jsonb check (jsonb_typeof(parsed) = 'object' and pg_column_size(parsed) <= 32768),
  pos        int not null default 0,
  version    int not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (event_id, id)
);
create index if not exists recipes_event_upd_idx on public.recipes (event_id, updated_at);

create table if not exists public.meal_plan (
  event_id        uuid not null references public.events(id) on delete cascade,
  day             date not null,
  meal            text not null check (meal in ('cafe','almoco','lanche','jantar')),
  mode            text not null default 'casa' check (mode in ('casa','fora','livre')),
  recipe_ids      text[] not null default '{}' check (cardinality(recipe_ids) <= 20),
  cook_family_id  text check (cook_family_id is null or cook_family_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  clean_family_id text check (clean_family_id is null or clean_family_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  version         int not null default 1,
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  primary key (event_id, day, meal)
);
create index if not exists meal_plan_event_upd_idx on public.meal_plan (event_id, updated_at);

create or replace function public.tg_recipe_ids_ok() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from unnest(new.recipe_ids) x where x !~ '^[A-Za-z0-9_-]{1,40}$') then
    raise exception 'invalid_recipe_id' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists recipe_ids_ok on public.meal_plan;
create trigger recipe_ids_ok before insert or update on public.meal_plan for each row execute function public.tg_recipe_ids_ok();

create or replace function public.tg_recipe_author() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now();
  else new.created_by := old.created_by; new.created_at := old.created_at; end if;
  return new;
end $$;
drop trigger if exists recipe_author on public.recipes;
create trigger recipe_author before insert or update on public.recipes for each row execute function public.tg_recipe_author();

do $$
declare t text;
begin
  foreach t in array array['recipes','meal_plan'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before insert or update on public.%I for each row execute function public.tg_touch()', t);
    execute format('drop trigger if exists version_guard on public.%I', t);
    execute format('create trigger version_guard before insert or update on public.%I for each row execute function public.tg_version()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t); -- insert/update por coluna em 0013
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_event_member(event_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_event_writable(event_id))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_event_writable(event_id)) with check (public.is_event_writable(event_id))', t || '_update', t);
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- apply_ops passa a aceitar as duas tabelas
create or replace function public._op_columns(t text) returns text[]
language sql immutable set search_path = '' as $$
  select case t
    when 'events'           then array['start_date','end_date','meals','split_mode','include_unconfirmed','kitty_per_family']
    when 'families'         then array['name','color','pos','arrive','arrive_meal','depart','depart_meal','deleted_at']
    when 'people'           then array['family_id','first_name','type','drinks','pos','arrive','arrive_meal','depart','depart_meal','deleted_at']
    when 'expenses'         then array['description','amount','category','payer_person_id','participants','proof','estimated','note','items','client_ts','photo_path','deleted_at']
    when 'settlement_marks' then array['amount','deleted_at']
    when 'event_overrides'  then array['value','deleted_at']
    when 'expense_confirmations' then array['expense_id','family_id']
    when 'recipes'          then array['title','yield','text','parsed','pos','deleted_at']
    when 'meal_plan'        then array['mode','recipe_ids','cook_family_id','clean_family_id','deleted_at']
  end
$$;
create or replace function public._op_pk(t text) returns text[]
language sql immutable set search_path = '' as $$
  select case t when 'events' then array['id'] when 'settlement_marks' then array['event_id','from_family','to_family']
                when 'event_overrides' then array['event_id','kind','key'] when 'meal_plan' then array['event_id','day','meal']
                else array['event_id','id'] end
$$;

-- >>>>> migrations/0011_delta_sync.sql
-- 0011 — Reconexão por delta: toda tabela sincronizada tem updated_at (o cliente busca só o que mudou
-- desde o último updated_at que viu, com folga de alguns segundos).
alter table public.expense_confirmations add column if not exists updated_at timestamptz not null default now();
create index if not exists confirmations_event_upd_idx on public.expense_confirmations (event_id, updated_at);
create index if not exists events_upd_idx on public.events (id, updated_at);
drop trigger if exists touch on public.expense_confirmations;
create trigger touch before insert or update on public.expense_confirmations for each row execute function public.tg_touch();

-- >>>>> migrations/0013_hardening.sql
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

-- >>>>> migrations/0014_photo_retention.sql
-- 0014 — Retenção dos comprovantes (revisão de governança N1): o organizador apaga as fotos do evento
-- até 30 dias depois do fim (end_date). O app lembra o organizador e faz tudo com um toque.
--
-- Por que duas etapas: no Supabase, DELETE direto em storage.objects por SQL é bloqueado
-- (gatilho storage.protect_delete) e, se passasse, deixaria o arquivo órfão no armazenamento.
-- Então:
--   1) purge_event_photos(evento): só organizador; tira a referência da foto dos gastos do evento e
--      devolve a lista de arquivos do evento no bucket;
--   2) o app apaga esses arquivos pela Storage API (remove), que a política comprovantes_delete permite
--      só ao organizador. Rodar de novo devolve o que ainda sobrar (0 = concluído).
-- event_photo_status(evento): quantas fotos restam e o prazo (fim + 30 dias), para o lembrete.

create or replace function public.event_photo_status(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_end date; v_n int;
begin
  perform public._require_organizer(p_event);
  select end_date into v_end from public.events where id = p_event;
  select count(*) into v_n from storage.objects o where o.bucket_id = 'comprovantes' and public.proof_event_id(o.name) = p_event;
  return jsonb_build_object('remaining', v_n, 'end_date', v_end, 'purge_by', v_end + 30,
                            'due', v_end is not null and current_date > v_end);
end $$;
revoke all on function public.event_photo_status(uuid) from public, anon;
grant execute on function public.event_photo_status(uuid) to authenticated;

create or replace function public.purge_event_photos(p_event uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_paths text[]; v_cleared int;
begin
  perform public._require_organizer(p_event); perform public._server_write();
  update public.expenses set photo_path = null where event_id = p_event and photo_path is not null;
  get diagnostics v_cleared = row_count;
  select coalesce(array_agg(o.name order by o.name), '{}') into v_paths
    from storage.objects o where o.bucket_id = 'comprovantes' and public.proof_event_id(o.name) = p_event;
  return jsonb_build_object('paths', to_jsonb(v_paths), 'cleared_refs', v_cleared);
end $$;
revoke all on function public.purge_event_photos(uuid) from public, anon;
grant execute on function public.purge_event_photos(uuid) to authenticated;

-- Pronto. Confira em Table Editor que todas as tabelas aparecem com "RLS enabled".
