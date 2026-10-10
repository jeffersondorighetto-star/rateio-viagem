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
    execute format('grant select, insert, update on public.%I to authenticated', t);
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
