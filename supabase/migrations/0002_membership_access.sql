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
-- configurações do evento: qualquer membro aprovado (nome, trava e código só por RPC do organizador)
grant update (start_date, end_date, meals, split_mode, include_unconfirmed, kitty_per_family)
  on public.events to authenticated;
grant select on public.event_members to authenticated;
grant update (display_name, family_id) on public.event_members to authenticated;
grant select, insert, update on public.families, public.people, public.expenses, public.settlement_marks to authenticated;

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
create policy members_update_self on public.event_members for update to authenticated
  using (user_id = auth.uid() and status <> 'revoked') with check (user_id = auth.uid());

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
