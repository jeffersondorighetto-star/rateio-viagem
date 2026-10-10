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
    allowed := case t
      when 'events'           then array['start_date','end_date','meals','split_mode','include_unconfirmed','kitty_per_family']
      when 'families'         then array['name','color','pos','arrive','arrive_meal','depart','depart_meal','deleted_at']
      when 'people'           then array['family_id','first_name','type','drinks','pos','arrive','arrive_meal','depart','depart_meal','deleted_at']
      when 'expenses'         then array['description','amount','category','payer_person_id','participants','proof','estimated','note','items','client_ts','photo_path','deleted_at']
      when 'settlement_marks' then array['amount','deleted_at']
      when 'event_overrides'  then array['value','deleted_at']
      when 'expense_confirmations' then array['expense_id','family_id']
      else null end;
    pkc := case t when 'events' then array['id'] when 'settlement_marks' then array['event_id','from_family','to_family']
                  when 'event_overrides' then array['event_id','kind','key'] else array['event_id','id'] end;
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
        if n = 0 then raise exception 'version_conflict' using errcode = 'PT409'; end if;
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
