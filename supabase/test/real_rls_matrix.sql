-- =====================================================================================================
-- Rateatouille — matriz de isolamento (RLS) para rodar NO SUPABASE REAL, pelo SQL Editor.
-- NÃO GRAVA NADA: tudo roda dentro de um bloco que é sempre desfeito (subtransação com ROLLBACK
-- forçado no fim). Os usuários, a lista de organizadores de teste, os 2 eventos e a foto de teste somem.
-- Como usar: SQL Editor › New query › cole este arquivo inteiro › Run. O resultado é uma tabela:
-- a 1ª linha diz «RESULTADO: PASS n / FAIL m». Mande só essa linha (e as linhas FAIL, se houver).
-- Pré-requisito: supabase.sql já rodado (o script avisa se faltar).
-- Simula cada pessoa como o PostgREST faz: set local role authenticated + request.jwt.claims (sub,
-- role, is_anonymous, app_metadata.provider). Organizadores de teste usam ids GitHub fictícios
-- (990000001/990000002), inseridos e desfeitos aqui. Sem chaves, sem senhas.
-- =====================================================================================================
create or replace function pg_temp.rm_as(p uuid, anon boolean) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aud', 'authenticated', 'is_anonymous', anon,
    'app_metadata', json_build_object('provider', case when anon then 'anonymous' else 'github' end))::text, true);
  perform set_config('request.jwt.claim.sub', p::text, true);
  execute 'set local role authenticated';
end $f$;
create or replace function pg_temp.rm_role(r text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', r)::text, true); perform set_config('request.jwt.claim.sub', '', true);
  if r = 'admin' then execute 'reset role'; else execute format('set local role %I', r); end if;
end $f$;
create or replace function pg_temp.rm_ok(c boolean, label text) returns text language sql as
  $f$ select case when coalesce(c, false) then 'PASS ' else 'FAIL ' end || label $f$;
create or replace function pg_temp.rm_err(q text, pat text, label text) returns text language plpgsql as $f$
begin execute q; return 'FAIL ' || label || ' (sem erro)';
exception when others then
  return case when sqlerrm ~* pat or sqlstate = pat then 'PASS ' || label else 'FAIL ' || label || ' (' || sqlstate || ': ' || sqlerrm || ')' end;
end $f$;
create or replace function pg_temp.rm_op(ev uuid, t text, r jsonb, ver int default null) returns jsonb language plpgsql as
  $f$ begin return public.apply_ops(ev, jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table', t, 'row', r, 'expected_version', ver))) -> 0; end $f$;
create or replace function pg_temp.rm_n(q text) returns bigint language plpgsql as
  $f$ declare c bigint; begin execute 'select count(*) from (' || q || ') s' into c; return c; end $f$;

-- organizador do evento grava uma linha em cada tabela sincronizada + 1 foto
create or replace function pg_temp.rm_seed(ev uuid, tag text) returns setof text language plpgsql as $f$
declare x text; ok boolean;
begin
  return next pg_temp.rm_ok((pg_temp.rm_op(ev, 'families', '{"id":"f1","name":"Família A"}') ->> 'status') = 'ok', tag || ': família f1');
  return next pg_temp.rm_ok((pg_temp.rm_op(ev, 'families', '{"id":"f2","name":"Família B"}') ->> 'status') = 'ok', tag || ': família f2');
  return next pg_temp.rm_ok((pg_temp.rm_op(ev, 'people', '{"id":"p1","family_id":"f1","first_name":"Ana"}') ->> 'status') = 'ok', tag || ': pessoa p1');
  return next pg_temp.rm_ok((pg_temp.rm_op(ev, 'people', '{"id":"p2","family_id":"f2","first_name":"Beto"}') ->> 'status') = 'ok', tag || ': pessoa p2');
  return next pg_temp.rm_ok((pg_temp.rm_op(ev, 'expenses', '{"id":"e1","amount":100,"category":"food","description":"Feira","payer_person_id":"p1","proof":"none"}') ->> 'status') = 'ok', tag || ': gasto e1');
  return next pg_temp.rm_ok((pg_temp.rm_op(ev, 'settlement_marks', '{"from_family":"f2","to_family":"f1","amount":10}') ->> 'status') = 'ok', tag || ': acerto');
  return next pg_temp.rm_ok((pg_temp.rm_op(ev, 'event_overrides', '{"kind":"weight","key":"crianca","value":0.5}') ->> 'status') = 'ok', tag || ': peso');
  return next pg_temp.rm_ok((pg_temp.rm_op(ev, 'recipes', '{"id":"r1","title":"Bolo","yield":8,"text":"Bolo"}') ->> 'status') = 'ok', tag || ': receita');
  return next pg_temp.rm_ok((pg_temp.rm_op(ev, 'meal_plan', '{"day":"2031-03-03","meal":"almoco","mode":"casa","recipe_ids":["r1"]}') ->> 'status') = 'ok', tag || ': cardápio');
  return next pg_temp.rm_ok((pg_temp.rm_op(ev, 'expense_confirmations', jsonb_build_object('id', gen_random_uuid(), 'expense_id', 'e1', 'family_id', 'f2')) ->> 'status') = 'ok', tag || ': confirmação');
  begin insert into storage.objects (bucket_id, name) values ('comprovantes', ev::text || '/e1.jpg'); ok := true;
  exception when others then ok := false; x := sqlstate || ': ' || sqlerrm; end;
  return next pg_temp.rm_ok(ok, tag || ': organizador envia foto <evento>/e1.jpg' || coalesce(' (' || x || ')', ''));
end $f$;

-- perfil sem acesso ao evento: lê 0, não grava (direto nem apply_ops), não vê/enviar foto, RPCs de organizador negadas
create or replace function pg_temp.rm_iso(ev uuid, who text) returns setof text language plpgsql as $f$
declare t text; c bigint; ok boolean; n int; ts text[] := array['families','people','expenses','settlement_marks','event_overrides','expense_confirmations','recipes','meal_plan'];
begin
  select count(*) into c from public.events where id = ev; return next pg_temp.rm_ok(c = 0, who || ': não lê events');
  select count(*) into c from public.event_members where event_id = ev and user_id <> auth.uid(); return next pg_temp.rm_ok(c = 0, who || ': não lê membros dos outros');
  foreach t in array ts loop
    execute format('select count(*) from public.%I where event_id = $1', t) into c using ev;
    return next pg_temp.rm_ok(c = 0, who || ': não lê ' || t);
    begin execute format('insert into public.%I (event_id) values ($1)', t) using ev; ok := false;
    exception when others then ok := sqlstate in ('42501', '23502', '23514', 'P0001'); end;
    return next pg_temp.rm_ok(ok, who || ': INSERT direto negado em ' || t);
    begin
      if t = 'expense_confirmations' then execute 'update public.expense_confirmations set family_id = family_id where event_id = $1' using ev;
      else execute format('update public.%I set deleted_at = now(), version = version + 1 where event_id = $1', t) using ev; end if;
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := sqlstate = '42501'; end;
    return next pg_temp.rm_ok(ok, who || ': UPDATE direto sem efeito em ' || t);
    return next pg_temp.rm_ok(coalesce((pg_temp.rm_op(ev, t, '{"id":"iso","name":"x","amount":1,"category":"food","kind":"weight","key":"x","value":1,"from_family":"f1","to_family":"f2","day":"2031-03-04","meal":"cafe","title":"x","expense_id":"e1","family_id":"f2"}'::jsonb) ->> 'status'), 'error') = 'error', who || ': apply_ops negado em ' || t);
  end loop;
  select count(*) into c from storage.objects where bucket_id = 'comprovantes' and name like ev::text || '/%'; return next pg_temp.rm_ok(c = 0, who || ': não lê comprovantes');
  begin insert into storage.objects (bucket_id, name) values ('comprovantes', ev::text || '/iso.jpg'); ok := false; exception when others then ok := sqlstate = '42501'; end;
  return next pg_temp.rm_ok(ok, who || ': não envia comprovante');
  begin update storage.objects set metadata = '{"x":1}' where bucket_id = 'comprovantes' and name like ev::text || '/%'; get diagnostics n = row_count; ok := n = 0; exception when others then ok := sqlstate = '42501'; end;
  return next pg_temp.rm_ok(ok, who || ': não troca comprovante');
  begin perform public.approve_member(ev, auth.uid()); ok := false; exception when others then ok := sqlerrm = 'organizer_only'; end; return next pg_temp.rm_ok(ok, who || ': approve_member negado');
  begin perform public.revoke_member(ev, auth.uid()); ok := false; exception when others then ok := sqlerrm = 'organizer_only'; end; return next pg_temp.rm_ok(ok, who || ': revoke_member negado');
  begin perform public.rotate_code(ev, 'TTTT2345'); ok := false; exception when others then ok := sqlerrm = 'organizer_only'; end; return next pg_temp.rm_ok(ok, who || ': rotate_code negado');
  begin perform public.lock_event(ev, true); ok := false; exception when others then ok := sqlerrm = 'organizer_only'; end; return next pg_temp.rm_ok(ok, who || ': lock_event negado');
  begin perform public.set_member_role(ev, auth.uid(), 'organizer'); ok := false; exception when others then ok := sqlerrm = 'organizer_only'; end; return next pg_temp.rm_ok(ok, who || ': set_member_role negado');
  begin perform public.set_member_family(ev, auth.uid(), 'f1'); ok := false; exception when others then ok := sqlerrm = 'organizer_only'; end; return next pg_temp.rm_ok(ok, who || ': set_member_family negado');
  begin perform public.update_event_settings(ev, '{"kitty_per_family":1}', 1); ok := false; exception when others then ok := sqlerrm = 'organizer_only'; end; return next pg_temp.rm_ok(ok, who || ': update_event_settings negado');
  begin perform public.purge_event_photos(ev); ok := false; exception when others then ok := sqlerrm = 'organizer_only'; end; return next pg_temp.rm_ok(ok, who || ': purge_event_photos negado');
  begin perform public.event_photo_status(ev); ok := false; exception when others then ok := sqlerrm = 'organizer_only'; end; return next pg_temp.rm_ok(ok, who || ': event_photo_status negado');
  return next pg_temp.rm_ok(not coalesce(public.my_membership(ev) ? 'event_name', false), who || ': my_membership sem nome do evento');
end $f$;

do $main$
declare
  res text[] := '{}'; ev1 uuid; ev2 uuid; j jsonb; i int; t text; c bigint;
  O uuid := gen_random_uuid(); F uuid := gen_random_uuid(); G uuid := gen_random_uuid(); X uuid := gen_random_uuid();
  P uuid := gen_random_uuid(); R uuid := gen_random_uuid(); B uuid := gen_random_uuid(); L uuid := gen_random_uuid();
  c1 text := (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 8));
  c2 text := (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 8));
begin
  if to_regclass('public.events') is null or to_regprocedure('public.purge_event_photos(uuid)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organizer_allowlist' and column_name = 'github_id') then
    res := array_append(res, 'FAIL esquema ausente ou desatualizado: rode o supabase.sql do branch rateio-e2 antes'::text);
  else
  begin
    -- ===== preparação (como admin): usuários de teste, identidades GitHub, lista de organizadores
    insert into auth.users (id, aud, role, is_anonymous)
      select u, 'authenticated', 'authenticated', u not in (O, F, G) from unnest(array[O, F, G, X, P, R, B, L]) u;
    insert into auth.identities (user_id, provider, identity_data, provider_id) values
      (O, 'github', jsonb_build_object('sub', '990000001', 'user_name', 'matriz-org'), '990000001'),
      (F, 'github', jsonb_build_object('sub', '990000002', 'user_name', 'matriz-org-2'), '990000002'),
      (G, 'github', jsonb_build_object('sub', '990000009', 'user_name', 'matriz-org'), '990000009');   -- mesmo login de O, outro id
    insert into public.organizer_allowlist (github_id, note) values (990000001, 'matriz (desfeito)'), (990000002, 'matriz (desfeito)');

    -- ===== criação de evento
    perform pg_temp.rm_role('anon');
    res := res || pg_temp.rm_err($$select public.create_event('x', 'ANON2345', 'x')$$, 'permission denied|42501', 'papel anon (sem login) não chama create_event');
    res := res || pg_temp.rm_err($$select * from public.events$$, 'permission denied', 'papel anon não lê events');
    res := res || pg_temp.rm_err($$select public.join_event('ABCD2345', 'x')$$, 'permission denied', 'papel anon não chama join_event');
    perform pg_temp.rm_as(X, true);
    res := res || pg_temp.rm_err($$select public.create_event('x', 'XXXX2345', 'x')$$, 'organizer_login_required', 'anônimo não cria evento');
    perform pg_temp.rm_as(G, false);
    res := res || pg_temp.rm_err($$select public.create_event('x', 'GGGG2345', 'x')$$, 'organizer_only', 'GitHub com mesmo login mas outro id (fora da lista) não cria evento');
    perform pg_temp.rm_as(O, false);
    ev1 := public.create_event('Matriz 1 (desfeito)', c1, 'Org1');
    res := res || pg_temp.rm_ok(ev1 is not null and (public.my_membership(ev1) ->> 'role') = 'organizer', 'organizador da lista cria evento 1');
    res := res || array(select pg_temp.rm_seed(ev1, 'ev1'));
    perform pg_temp.rm_as(F, false);
    ev2 := public.create_event('Matriz 2 (desfeito)', c2, 'Org2');
    res := res || pg_temp.rm_ok(ev2 is not null, 'outro organizador cria evento 2');
    res := res || array(select pg_temp.rm_seed(ev2, 'ev2'));

    -- ===== tabelas internas ilegíveis para qualquer cliente
    perform pg_temp.rm_as(B, true);
    foreach t in array array['event_secrets', 'join_attempts', 'organizer_allowlist'] loop
      res := res || pg_temp.rm_err(format('select * from public.%I', t), 'permission denied', t || ' ilegível para clientes');
    end loop;
    select count(*) into c from public.client_ops where user_id <> auth.uid();
    res := res || pg_temp.rm_ok(c = 0 and pg_temp.rm_n('select * from public.client_ops') = 0, 'client_ops: cada um vê só as próprias operações (B não vê as do organizador)');
    res := res || pg_temp.rm_err($$insert into public.organizer_allowlist (github_id) values (1)$$, 'permission denied', 'cliente não se põe na lista de organizadores');
    res := res || pg_temp.rm_err($$select * from public.person_diet$$, 'does not exist', 'não existe person_diet');

    -- ===== entradas: código errado, limite de tentativas, pendente sem nome
    perform pg_temp.rm_as(L, true);
    for i in 1..5 loop j := public.join_event('ZZZZ2345', 'x'); end loop;
    res := res || pg_temp.rm_ok((j ->> 'error') = 'invalid_code', 'código errado recusado');
    res := res || pg_temp.rm_ok((public.join_event(c1, 'x') ->> 'error') = 'too_many_attempts', 'depois de 5 erros em 10 min, nem o código certo entra');
    perform pg_temp.rm_as(P, true);
    j := public.join_event(lower(c1), 'Pendente');
    res := res || pg_temp.rm_ok((j ->> 'status') = 'pending' and not (j ? 'event_name'), 'pendente: join_event sem nome do evento');
    perform pg_temp.rm_as(R, true); perform public.join_event(c1, 'Revogado');
    perform pg_temp.rm_as(B, true); perform public.join_event(c1, 'Membro'); perform public.join_event(c2, 'Membro');
    perform pg_temp.rm_as(O, false);
    perform public.approve_member(ev1, R); perform public.approve_member(ev1, B); perform public.revoke_member(ev1, R);
    perform public.set_member_family(ev1, B, 'f2');
    perform pg_temp.rm_as(F, false); perform public.approve_member(ev2, B);
    perform pg_temp.rm_as(R, true);
    res := res || pg_temp.rm_ok((public.join_event(c1, 'Revogado') ->> 'error') = 'revoked', 'revogado não volta com o código');

    -- ===== controle positivo: membro dos dois vê tudo dos dois (senão os «0 linhas» abaixo não provam nada)
    perform pg_temp.rm_as(B, true);
    foreach t in array array['events', 'families', 'people', 'expenses', 'settlement_marks', 'event_overrides', 'expense_confirmations', 'recipes', 'meal_plan'] loop
      execute format('select count(distinct %s) from public.%I where %s in ($1, $2)', case when t = 'events' then 'id' else 'event_id' end, t, case when t = 'events' then 'id' else 'event_id' end) into c using ev1, ev2;
      res := res || pg_temp.rm_ok(c = 2, 'membro dos dois lê ' || t || ' dos dois eventos');
    end loop;
    select count(*) into c from storage.objects where bucket_id = 'comprovantes' and name in (ev1 || '/e1.jpg', ev2 || '/e1.jpg');
    res := res || pg_temp.rm_ok(c = 2, 'membro dos dois lê as fotos dos dois eventos');
    res := res || pg_temp.rm_ok(public.my_membership(ev1) ? 'event_name', 'aprovado recebe o nome do evento');
    -- membro dos dois não move linhas entre eventos nem mexe em colunas protegidas
    res := res || pg_temp.rm_err(format($$update public.expenses set event_id = %L, version = version + 1 where event_id = %L and id = 'e1'$$, ev2, ev1), 'permission denied', 'membro dos dois NÃO move gasto entre eventos');
    res := res || pg_temp.rm_err(format($$update public.families set event_id = %L, version = version + 1 where event_id = %L and id = 'f1'$$, ev2, ev1), 'permission denied', 'nem família');
    res := res || pg_temp.rm_err(format($$update public.expenses set id = 'novo', version = version + 1 where event_id = %L and id = 'e1'$$, ev1), 'permission denied', 'id não muda por PATCH');
    res := res || pg_temp.rm_err(format($$update public.expenses set confirmed_by_family_id = 'f1', version = version + 1 where event_id = %L$$, ev1), 'permission denied', 'confirmed_by_family_id não muda por PATCH');
    res := res || pg_temp.rm_err(format($$update public.recipes set created_by = auth.uid(), version = version + 1 where event_id = %L$$, ev1), 'permission denied', 'autor da receita não muda por PATCH');
    res := res || pg_temp.rm_err(format($$update public.event_members set family_id = 'f1' where event_id = %L and user_id = auth.uid()$$, ev1), 'permission denied', 'membro não muda a própria família');
    res := res || pg_temp.rm_err(format($$insert into public.expenses (event_id, id, amount, category, version) values (%L, 'v9', 1, 'food', 7)$$, ev1), 'permission denied', 'version não vai no INSERT');
    begin update public.events set split_mode = 'igual', version = version + 1 where id = ev1; get diagnostics i = row_count; exception when others then i := case when sqlstate = '42501' then 0 else -1 end; end;
    res := res || pg_temp.rm_ok(i = 0, 'membro não muda modo de divisão por PATCH (0 linhas)');
    select count(*) into c from public.events where id = ev1 and split_mode = 'igual'; res := res || pg_temp.rm_ok(c = 0, 'modo de divisão intacto');
    res := res || pg_temp.rm_ok((pg_temp.rm_op(ev1, 'event_overrides', '{"kind":"weight","key":"crianca","value":0.9}', 1) ->> 'status') = 'error', 'membro não muda configurações (pesos)');
    res := res || pg_temp.rm_ok((pg_temp.rm_op(ev1, 'expense_confirmations', jsonb_build_object('id', gen_random_uuid(), 'expense_id', 'e1', 'family_id', 'f1')) ->> 'status') <> 'ok', 'membro não confirma por outra família');
    res := res || pg_temp.rm_err(format($$delete from public.expenses where event_id = %L$$, ev1), 'permission denied', 'DELETE físico negado');
    res := res || pg_temp.rm_err(format($$select public.approve_member(%L, %L)$$, ev2, P), 'organizer_only', 'membro não aprova ninguém');
    res := res || pg_temp.rm_ok((pg_temp.rm_op(ev1, 'expenses', jsonb_build_object('id', 'e1', 'event_id', ev2, 'note', 'x'), (select version from public.expenses where event_id = ev1 and id = 'e1')) -> 'row' ->> 'event_id') = ev1::text, 'apply_ops ignora event_id do corpo');
    select count(*) into c from storage.objects where bucket_id = 'comprovantes' and name like ev1 || '/%';
    begin update storage.objects set metadata = '{"x":1}' where bucket_id = 'comprovantes' and name = ev1 || '/e1.jpg'; get diagnostics i = row_count; exception when others then i := 0; end;
    res := res || pg_temp.rm_ok(i = 0, 'membro não troca foto enviada');
    res := res || pg_temp.rm_err(format($$delete from storage.objects where name = %L$$, ev1 || '/e1.jpg'), 'Direct deletion|42501|permission', 'DELETE direto em storage.objects bloqueado');

    -- ===== matriz: 2 eventos × de fora / pendente / revogado / organizador do outro
    perform pg_temp.rm_as(X, true); res := res || array(select pg_temp.rm_iso(ev1, 'ev1 de fora')) || array(select pg_temp.rm_iso(ev2, 'ev2 de fora'));
    perform pg_temp.rm_as(P, true); res := res || array(select pg_temp.rm_iso(ev1, 'ev1 pendente')) || array(select pg_temp.rm_iso(ev2, 'ev2 pendente (nunca entrou)'));
    perform pg_temp.rm_as(R, true); res := res || array(select pg_temp.rm_iso(ev1, 'ev1 revogado')) || array(select pg_temp.rm_iso(ev2, 'ev2 revogado de outro evento'));
    perform pg_temp.rm_as(F, false); res := res || array(select pg_temp.rm_iso(ev1, 'ev1 organizador do ev2'));
    perform pg_temp.rm_as(O, false); res := res || array(select pg_temp.rm_iso(ev2, 'ev2 organizador do ev1'));
    perform pg_temp.rm_as(G, false); res := res || array(select pg_temp.rm_iso(ev1, 'ev1 GitHub fora da lista'));

    -- ===== retenção: só o organizador lista/limpa as fotos do próprio evento
    perform pg_temp.rm_as(O, false);
    j := public.purge_event_photos(ev1);
    res := res || pg_temp.rm_ok(jsonb_array_length(j -> 'paths') = 1 and (j -> 'paths' ->> 0) = ev1 || '/e1.jpg', 'purge_event_photos devolve só a foto do próprio evento');
    perform pg_temp.rm_as(F, false);
    select count(*) into c from storage.objects where name = ev2 || '/e1.jpg'; res := res || pg_temp.rm_ok(c = 1, 'foto do outro evento intacta');

    raise exception using message = 'rateio_matrix_rollback';
  exception when others then
    if sqlerrm <> 'rateio_matrix_rollback' then res := res || ('FAIL erro inesperado (' || sqlstate || '): ' || sqlerrm); end if;
  end;
  end if;
  -- aqui o bloco acima já foi desfeito por inteiro (usuários, lista, eventos, fotos) e o papel voltou ao admin
  drop table if exists pg_temp.rateio_matrix;
  create temp table rateio_matrix (ord int, resultado text);
  insert into rateio_matrix select u.rn::int, u.txt from unnest(res) with ordinality as u(txt, rn);
end $main$;

select resultado from (
  select 0 as k, 0 as ord, format('RESULTADO: PASS %s / FAIL %s  (nada foi gravado: tudo desfeito)',
         count(*) filter (where resultado like 'PASS%'), count(*) filter (where resultado not like 'PASS%')) as resultado from pg_temp.rateio_matrix
  union all
  select case when resultado like 'PASS%' then 2 else 1 end, ord, resultado from pg_temp.rateio_matrix
) s order by k, ord;
