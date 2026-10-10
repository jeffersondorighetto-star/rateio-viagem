-- Testes de RLS e RPCs do design completo. Cada linha imprime PASS/FAIL; run.sh falha se houver FAIL.
-- Usuários: O = organizador (GitHub), A/B/C/D = anônimos.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
\set O 'aaaaaaaa-0000-0000-0000-00000000000a'
\set A 'aaaaaaaa-0000-0000-0000-000000000001'
\set B 'bbbbbbbb-0000-0000-0000-000000000002'
\set C 'cccccccc-0000-0000-0000-000000000003'
\set D 'dddddddd-0000-0000-0000-000000000004'
create function pg_temp.u(p uuid, anon boolean) returns void language sql as
  $$ select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'is_anonymous', anon)::text, false) $$;
create function pg_temp.ok(c boolean, label text) returns text language sql as
  $$ select case when coalesce(c, false) then 'PASS ' else 'FAIL ' end || label $$;
create function pg_temp.err(q text, pat text, label text) returns text language plpgsql as $$
begin execute q; return 'FAIL ' || label || ' (sem erro)';
exception when others then
  return case when sqlerrm ~* pat or sqlstate = pat then 'PASS ' || label else 'FAIL ' || label || ' (' || sqlstate || ': ' || sqlerrm || ')' end;
end $$;
create function pg_temp.op(ev uuid, t text, r jsonb, ver int default null, opid uuid default gen_random_uuid()) returns jsonb language sql as
  $$ select public.apply_ops(ev, jsonb_build_array(jsonb_build_object('op_id', opid, 'table', t, 'row', r, 'expected_version', ver))) -> 0 $$;
create function pg_temp.n(q text) returns bigint language plpgsql as $$ declare c bigint; begin execute 'select count(*) from (' || q || ') s' into c; return c; end $$;
set role authenticated;

\echo '--- criação e papéis'
select pg_temp.u(:'A', true);
select pg_temp.err($$select public.create_event('X', 'ABCD2345', 'Ana')$$, 'organizer_login_required', 'anônimo não cria evento');
select pg_temp.u(:'O', false);
select public.create_event('Viagem teste', 'ABCD2345', 'Jeff') as ev \gset
select pg_temp.ok((public.my_membership(:'ev') ->> 'role') = 'organizer' and (public.my_membership(:'ev') ->> 'status') = 'approved', 'criador é organizador aprovado');
select pg_temp.ok((pg_temp.op(:'ev', 'families', '{"id":"f1","name":"Família A"}') ->> 'status') = 'ok', 'organizador grava família (apply_ops insert)');
select pg_temp.ok((pg_temp.op(:'ev', 'families', '{"id":"f2","name":"Família B"}') ->> 'status') = 'ok', 'segunda família');
select pg_temp.ok((pg_temp.op(:'ev', 'people', '{"id":"p1","family_id":"f1","first_name":"Ana"}') ->> 'status') = 'ok', 'pessoa p1');
select pg_temp.ok((pg_temp.op(:'ev', 'people', '{"id":"p2","family_id":"f2","first_name":"Beto"}') ->> 'status') = 'ok', 'pessoa p2');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"e1","amount":100,"category":"food","description":"Feira","payer_person_id":"p1","proof":"none"}') ->> 'status') = 'ok', 'gasto e1');
select pg_temp.err($$select public.create_event('Dup', 'ABCD2345', 'Jeff')$$, 'code_taken', 'código repetido recusado');

\echo '--- entrada pendente'
select pg_temp.u(:'A', true);
select pg_temp.ok((public.join_event('abcd2345', 'Ana') ->> 'status') = 'pending', 'A entra com código e fica pendente');
select pg_temp.ok(pg_temp.n('select * from public.events') = 0 and pg_temp.n('select * from public.expenses') = 0 and pg_temp.n('select * from public.families') = 0, 'pendente não lê evento nem conteúdo');
select pg_temp.ok(pg_temp.n('select * from public.event_members') = 1, 'pendente vê só a própria linha de membro');
select pg_temp.ok((public.my_membership(:'ev') ->> 'status') = 'pending' and (public.my_membership(:'ev') ->> 'event_name') = 'Viagem teste', 'my_membership mostra pendente e nome do evento');
select pg_temp.err(format($$insert into public.expenses (event_id, id, amount, category) values (%L, 'x', 1, 'food')$$, :'ev'), 'row-level security', 'pendente não insere');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"x","amount":1,"category":"food"}') ->> 'status') = 'error', 'pendente não grava via apply_ops');
select pg_temp.err(format($$select public.approve_member(%L, %L)$$, :'ev', :'A'), 'organizer_only', 'pendente não se aprova');

\echo '--- aprovação'
select pg_temp.u(:'O', false);
select public.approve_member(:'ev', :'A');
select pg_temp.u(:'A', true);
select pg_temp.ok(pg_temp.n('select * from public.expenses') = 1 and pg_temp.n('select * from public.event_members') = 2, 'aprovado lê gastos e lista de membros');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"e2","amount":30,"category":"gas","payer_person_id":"p2"}') ->> 'status') = 'ok', 'aprovado grava');
select pg_temp.err(format($$select public.rotate_code(%L, 'QQQQ2222')$$, :'ev'), 'organizer_only', 'membro não gira código');
select pg_temp.err(format($$select public.lock_event(%L)$$, :'ev'), 'organizer_only', 'membro não trava evento');
select pg_temp.err(format($$select public.revoke_member(%L, %L)$$, :'ev', :'O'), 'organizer_only', 'membro não revoga');
select pg_temp.err(format($$update public.events set name = 'x' where id = %L$$, :'ev'), 'permission denied', 'membro não renomeia (só RPC do organizador)');
select pg_temp.err(format($$update public.events set locked = false where id = %L$$, :'ev'), 'permission denied', 'membro não destrava direto');
select pg_temp.err($$delete from public.expenses$$, 'permission denied', 'DELETE físico negado');
select pg_temp.err($$select * from public.event_secrets$$, 'permission denied', 'event_secrets ilegível');
select pg_temp.err($$select * from public.join_attempts$$, 'permission denied', 'join_attempts ilegível');

\echo '--- versão por linha'
select pg_temp.err($$update public.expenses set amount = 50 where id = 'e1'$$, 'version_conflict', 'update sem subir versão é recusado');
select pg_temp.ok(pg_temp.n($$select 1 from (select 1) s where (select count(*) from public.expenses where id = 'e1') = 1$$) = 1, '(linha e1 existe)');
update public.expenses set amount = 50, version = 2 where id = 'e1';
select pg_temp.ok((select amount = 50 and version = 2 from public.expenses where id = 'e1'), 'update com versão+1 aceito');
select pg_temp.err($$update public.expenses set amount = 60, version = 2 where id = 'e1'$$, 'version_conflict', 'versão velha recusada (PT409)');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"e1","amount":70}', 1) ->> 'status') = 'conflict', 'apply_ops com versão velha = conflict');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"e1","amount":70}', 1) -> 'row' ->> 'version') = '2', 'conflict devolve a linha atual (v2)');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"e1","note":"só a nota"}', 2) -> 'row' ->> 'version') = '3', 'patch com versão certa sobe para v3');
select pg_temp.ok((select note = 'só a nota' and amount = 50 and description = 'Feira' from public.expenses where id = 'e1'), 'patch muda só o campo enviado');
select pg_temp.ok((pg_temp.op(:'ev', 'families', '{"id":"f1","name":"outra"}') ->> 'status') = 'conflict', 'insert de id existente = conflict');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"e3","amount":5,"category":"food"}', null, '11111111-1111-1111-1111-111111111111') ->> 'status') = 'ok', 'op nova ok');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"e3","amount":5,"category":"food"}', null, '11111111-1111-1111-1111-111111111111') ->> 'status') = 'dup', 'mesma op_id de novo = dup (idempotente)');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"e4","amount":5000000,"category":"food"}') ->> 'status') = 'error', 'limite de valor (check) dentro do apply_ops');
select pg_temp.ok((pg_temp.op(:'ev', 'event_secrets', '{"event_id":"x"}') ->> 'error') = 'bad_op', 'apply_ops só aceita tabelas da lista');
select pg_temp.ok((pg_temp.op(:'ev', 'events', '{"kitty_per_family":200}', 1) ->> 'status') = 'error', 'membro NÃO ajusta caixinha (configuração é do organizador)');
select pg_temp.err(format($$update public.events set split_mode = 'igual', version = version + 1 where id = %L$$, :'ev') || '; select 1/(select count(*) - count(*) from public.events where split_mode = ''igual'')', 'division', 'membro não muda modo de divisão direto (0 linhas)');
select pg_temp.err(format($$select public.update_event_settings(%L, '{"kitty_per_family":1}', 1)$$, :'ev'), 'organizer_only', 'membro não usa update_event_settings');
select pg_temp.u(:'O', false);
select pg_temp.ok((public.update_event_settings(:'ev', '{"kitty_per_family":200,"split_mode":"porcoes"}', 1) ->> 'version') = '2', 'organizador ajusta caixinha e modo (v1->v2)');
select pg_temp.err(format($$select public.update_event_settings(%L, '{"kitty_per_family":300}', 1)$$, :'ev'), 'version_conflict', 'update_event_settings com versão velha = PT409');
select pg_temp.ok((select kitty_per_family = 200 and split_mode = 'porcoes' from public.events), 'configuração do organizador gravada');
select pg_temp.u(:'A', true);

\echo '--- confirmação de gasto sem nota (só inserção)'
select pg_temp.err(format($$insert into public.expense_confirmations (event_id, id, expense_id, family_id) values (%L, gen_random_uuid(), 'e1', 'f1')$$, :'ev'), 'payer_family_cannot_confirm', 'família de quem pagou não confirma');
select pg_temp.err(format($$insert into public.expense_confirmations (event_id, id, expense_id, family_id) values (%L, gen_random_uuid(), 'e2', 'f1')$$, :'ev'), 'only_sem_nota', 'só gasto sem nota é confirmado');
select pg_temp.ok((pg_temp.op(:'ev', 'expense_confirmations', '{"id":"22222222-2222-2222-2222-222222222222","expense_id":"e1","family_id":"f2"}') ->> 'status') = 'ok', 'outra família confirma');
select pg_temp.ok((select confirmed_by = auth.uid() from public.expense_confirmations), 'confirmed_by preenchido pelo servidor');
select pg_temp.ok((pg_temp.op(:'ev', 'expense_confirmations', '{"id":"33333333-3333-3333-3333-333333333333","expense_id":"e1","family_id":"f2"}') ->> 'status') = 'conflict', 'segunda confirmação ativa = conflict');
select pg_temp.err($$update public.expense_confirmations set family_id = 'f1'$$, 'permission denied', 'confirmação não é editável');
select pg_temp.err($$delete from public.expense_confirmations$$, 'permission denied', 'confirmação não é apagável');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"e1","payer_person_id":"p2"}', 3) ->> 'status') = 'ok', 'troca de pagador');
select pg_temp.ok(pg_temp.n('select * from public.expense_confirmations where voided_at is null') = 0, 'troca de pagador anula a confirmação');

\echo '--- sobreposições (pesos/preços: só organizador)'
select pg_temp.ok((pg_temp.op(:'ev', 'event_overrides', '{"kind":"weight","key":"crianca","value":0.6}') ->> 'status') = 'error', 'membro não grava peso');
select pg_temp.u(:'O', false);
select pg_temp.ok((pg_temp.op(:'ev', 'event_overrides', '{"kind":"weight","key":"crianca","value":0.6}') ->> 'status') = 'ok', 'organizador grava peso');
select pg_temp.ok((pg_temp.op(:'ev', 'event_overrides', '{"kind":"price","key":"carne","value":69.9}') ->> 'status') = 'ok', 'organizador grava preço');
select pg_temp.ok((pg_temp.op(:'ev', 'event_overrides', '{"kind":"weight","key":"crianca","value":0.7}', 1) -> 'row' ->> 'value') = '0.7', 'peso atualizado com versão');
select pg_temp.u(:'A', true);
select pg_temp.ok(pg_temp.n('select * from public.event_overrides') = 2, 'membro lê pesos e preços');
select pg_temp.ok((pg_temp.op(:'ev', 'event_overrides', '{"kind":"weight","key":"crianca","value":0.9}', 2) ->> 'status') = 'error', 'membro não altera peso existente');

\echo '--- receitas e cardápio (membros aprovados editam, com versão)'
select pg_temp.ok((pg_temp.op(:'ev', 'recipes', '{"id":"r1","title":"Bolo","yield":8,"text":"Bolo\nRende 8","parsed":{"ingredients":[{"name":"farinha","qty":500,"unit":"g"}],"steps":["assar"]}}') ->> 'status') = 'ok', 'membro cria receita');
select pg_temp.ok((select created_by = auth.uid() from public.recipes where id = 'r1'), 'autor da receita pelo servidor');
select pg_temp.ok((pg_temp.op(:'ev', 'recipes', '{"id":"r1","title":"Bolo de fubá"}', 1) -> 'row' ->> 'version') = '2', 'receita editada (v2)');
select pg_temp.ok((pg_temp.op(:'ev', 'recipes', '{"id":"r1","title":"x"}', 1) ->> 'status') = 'conflict', 'receita com versão velha = conflict');
select pg_temp.ok((pg_temp.op(:'ev', 'meal_plan', '{"day":"2026-10-10","meal":"almoco","mode":"casa","recipe_ids":["r1","churrasco"]}') ->> 'status') = 'ok', 'célula do cardápio criada');
select pg_temp.ok((pg_temp.op(:'ev', 'meal_plan', '{"day":"2026-10-10","meal":"almoco","mode":"fora"}', 1) -> 'row' ->> 'mode') = 'fora', 'célula muda de modo (patch)');
select pg_temp.ok((select recipe_ids = array['r1','churrasco'] from public.meal_plan), 'patch preserva as receitas da célula');
select pg_temp.ok((pg_temp.op(:'ev', 'meal_plan', '{"day":"2026-10-10","meal":"ceia","mode":"casa"}') ->> 'status') = 'error', 'refeição fora da lista recusada');
select pg_temp.ok((pg_temp.op(:'ev', 'meal_plan', '{"day":"2026-10-11","meal":"jantar","recipe_ids":["ok","bad id!"]}') ->> 'status') = 'error', 'id de receita inválido no cardápio recusado');
select pg_temp.ok((pg_temp.op(:'ev', 'recipes', format('{"id":"big","title":"x","parsed":{"t":"%s"}}', repeat('x', 40000))::jsonb) ->> 'status') = 'error', 'receita acima de 32 KB recusada');
select pg_temp.u(:'O', false);
select pg_temp.err(format($$insert into public.event_overrides (event_id, kind, key, value) values (%L, 'diet', 'x', '1')$$, :'ev'), 'check', 'tipo de sobreposição fora da lista');
select pg_temp.u(:'A', true);

\echo '--- storage comprovantes'
select pg_temp.ok((select not public and file_size_limit = 153600 from storage.buckets where id = 'comprovantes'), 'bucket privado com 150 KB');
insert into storage.objects (bucket_id, name) values ('comprovantes', :'ev' || '/e1.jpg');
select pg_temp.ok(pg_temp.n($$select * from storage.objects where bucket_id = 'comprovantes'$$) = 1, 'aprovado envia e lê <evento>/<gasto>.jpg');
select pg_temp.err($$insert into storage.objects (bucket_id, name) values ('comprovantes', 'qualquer/e1.jpg')$$, 'row-level security', 'caminho fora do padrão recusado');
select pg_temp.err(format($$insert into storage.objects (bucket_id, name) values ('comprovantes', %L)$$, :'ev' || '/e1.png'), 'row-level security', 'extensão diferente de .jpg recusada');
delete from storage.objects where bucket_id = 'comprovantes';
select pg_temp.ok(pg_temp.n($$select * from storage.objects$$) = 1, 'membro não apaga comprovante');
update storage.objects set metadata = '{"x":1}' where bucket_id = 'comprovantes';
select pg_temp.ok((select metadata is null from storage.objects), 'membro não substitui comprovante (update = 0 linhas)');
select pg_temp.u(:'O', false);
update storage.objects set metadata = '{"size":1000}' where bucket_id = 'comprovantes';
select pg_temp.ok((select metadata ->> 'size' = '1000' from storage.objects), 'organizador substitui comprovante');
select pg_temp.u(:'A', true);

\echo '--- dieta (saúde)'
select pg_temp.err(format($$insert into public.person_diet (event_id, person_id, veg, guardian_consent) values (%L, 'p1', true, false)$$, :'ev'), 'check', 'sem aceite do responsável não grava');
insert into public.person_diet (event_id, person_id, allergy_text, guardian_consent) values (:'ev', 'p1', 'amendoim', true);
select pg_temp.ok((select consent_by = auth.uid() and consent_at is not null from public.person_diet), 'aceite registrado (quem e quando)');
select pg_temp.err(format($$insert into public.person_diet (event_id, person_id, allergy_text, guardian_consent) values (%L, 'p2', repeat('x', 81), true)$$, :'ev'), 'check', 'alergia até 80 caracteres');
select pg_temp.err(format($$select public.purge_health(%L)$$, :'ev'), 'organizer_only', 'membro não expurga');
select pg_temp.err($$select public.purge_expired_health()$$, 'permission denied', 'expurgo automático só no servidor');
select pg_temp.u(:'C', true);
select pg_temp.ok((public.join_event('ABCD2345', 'Caio') ->> 'status') = 'pending', 'C pendente');
select pg_temp.ok(pg_temp.n('select * from public.person_diet') = 0, 'pendente não vê dieta');
select pg_temp.u(:'B', true);
select pg_temp.ok(pg_temp.n('select * from public.person_diet') = 0 and pg_temp.n('select * from storage.objects') = 0, 'quem não entrou não vê dieta nem comprovante');
select pg_temp.u(:'A', true);
select pg_temp.ok(pg_temp.n('select * from public.person_diet') = 1, 'aprovado vê dieta');

\echo '--- revogar'
select pg_temp.u(:'B', true);
select (public.join_event('ABCD2345', 'Bia') ->> 'status') is not null as x \gset
select pg_temp.u(:'O', false);
select public.approve_member(:'ev', :'B');
select public.revoke_member(:'ev', :'A');
select pg_temp.err(format($$select public.revoke_member(%L, %L)$$, :'ev', :'O'), 'cannot_revoke_self', 'organizador não revoga a si');
select pg_temp.u(:'A', true);
select pg_temp.ok(pg_temp.n('select * from public.expenses') = 0 and pg_temp.n('select * from public.person_diet') = 0, 'revogado perde a leitura na hora');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"e9","amount":1,"category":"food"}') ->> 'status') = 'error', 'revogado não grava');
select pg_temp.ok((public.join_event('ABCD2345', 'Ana') ->> 'error') = 'revoked', 'revogado não volta com o código');
select pg_temp.err(format($$update public.event_members set display_name = 'x' where event_id = %L$$, :'ev') || '; select 1/(select count(*) - count(*) from public.event_members where display_name = ''x'')', 'division', 'revogado não edita a própria linha');

\echo '--- papéis (promover/rebaixar, último organizador)'
select pg_temp.u(:'O', false);
select pg_temp.err(format($$select public.set_member_role(%L, %L, 'member')$$, :'ev', :'O'), 'last_organizer', 'único organizador não se rebaixa');
select pg_temp.err(format($$select public.set_member_role(%L, %L, 'organizer')$$, :'ev', :'A'), 'member_not_found', 'removido não vira organizador');
select public.set_member_role(:'ev', :'B', 'organizer');
select pg_temp.u(:'B', true);
select pg_temp.ok((public.my_membership(:'ev') ->> 'role') = 'organizer', 'B promovido a organizador');
select pg_temp.ok((public.update_event_settings(:'ev', '{"include_unconfirmed":false}', (select version from public.events)) ->> 'include_unconfirmed') = 'false', 'novo organizador muda configuração');
select pg_temp.err(format($$select public.set_member_role(%L, %L, 'member')$$, :'ev', :'O'), 'cannot_demote_creator', 'quem criou não é rebaixado');
select pg_temp.err(format($$select public.revoke_member(%L, %L)$$, :'ev', :'O'), 'cannot_revoke_creator', 'quem criou não é removido');
select public.set_member_role(:'ev', :'B', 'member');
select pg_temp.ok((public.my_membership(:'ev') ->> 'role') = 'member', 'organizador (não criador) se rebaixa havendo outro');
select pg_temp.err(format($$select public.set_member_role(%L, %L, 'organizer')$$, :'ev', :'B'), 'organizer_only', 'membro não se promove');
select pg_temp.u(:'O', false);

\echo '--- girar código'
select pg_temp.u(:'O', false);
select pg_temp.ok(public.rotate_code(:'ev', 'WXYZ6789', true) = 2, 'código girado (versão 2) e todos voltam a pendente');
select pg_temp.u(:'D', true);
select pg_temp.ok((public.join_event('ABCD2345', 'Duda') ->> 'error') = 'invalid_code', 'código antigo não entra mais');
select pg_temp.ok((public.join_event('WXYZ6789', 'Duda') ->> 'status') = 'pending', 'código novo entra (pendente)');
select pg_temp.u(:'B', true);
select pg_temp.ok((public.my_membership(:'ev') ->> 'status') = 'pending' and pg_temp.n('select * from public.expenses') = 0, 'B voltou a pendente após girar com reaprovação');
select pg_temp.u(:'O', false);
select public.approve_member(:'ev', :'B');
select pg_temp.ok((select joined_code_version = 2 from public.event_members where user_id = :'B'), 'reaprovado com a versão nova do código');

\echo '--- travar evento'
select public.lock_event(:'ev', true);
select pg_temp.u(:'B', true);
select pg_temp.ok(pg_temp.n('select * from public.expenses') > 0, 'travado: leitura continua');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"e8","amount":1,"category":"food"}') ->> 'status') = 'error', 'travado: membro não grava');
select pg_temp.err($$insert into storage.objects (bucket_id, name) values ('comprovantes', (select id::text from public.events) || '/e8.jpg')$$, 'row-level security', 'travado: sem envio de comprovante');
select pg_temp.u(:'O', false);
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"e8","amount":1,"category":"food"}') ->> 'status') = 'error', 'travado: nem o organizador grava');
select public.lock_event(:'ev', false);
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"e8","amount":1,"category":"food"}') ->> 'status') = 'ok', 'destravado: grava de novo');
select pg_temp.ok((select version from public.events) >= 3, 'trava/código sobem a versão do evento (servidor)');
delete from storage.objects where bucket_id = 'comprovantes';
select pg_temp.ok(pg_temp.n('select * from storage.objects') = 0, 'organizador apaga comprovante');

\echo '--- limite de tentativas de código'
select pg_temp.u('eeeeeeee-0000-0000-0000-00000000000e', true);
select count(*) from (select public.join_event('ZZZZ2345', 'X') from generate_series(1, 5)) s \gset
select pg_temp.ok((public.join_event('WXYZ6789', 'X') ->> 'error') = 'too_many_attempts', '5 erros em 10 min bloqueiam até o código certo');

\echo '--- isolamento entre eventos e anon'
select pg_temp.u('ffffffff-0000-0000-0000-00000000000f', false);
select public.create_event('Outro', 'MNPQ3456', 'Flor') as ev2 \gset
select pg_temp.ok(pg_temp.n('select * from public.events') = 1 and pg_temp.n('select * from public.expenses') = 0, 'outro organizador só vê o próprio evento');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"h","amount":1,"category":"food"}') ->> 'status') = 'error', 'não grava no evento alheio');
reset role;
set role anon;
select pg_temp.err($$select * from public.expenses$$, 'permission denied', 'papel anon (sem login) não lê');
select pg_temp.err($$select public.join_event('WXYZ6789', 'X')$$, 'permission denied', 'papel anon não chama RPC');
reset role;

\echo '--- expurgo automático agendado (pg_cron)'
set role authenticated;
select pg_temp.u(:'O', false);
select pg_temp.err($$select public.disable_health_purge()$$, 'permission denied', 'cliente não desliga o expurgo agendado');
reset role;
select pg_temp.ok(public.health_purge_status() = 'desligado (sem pg_cron)', 'sem pg_cron (Postgres local): migração passa e o status avisa');
select pg_temp.ok(public.enable_health_purge() like 'pg_cron não está ligado%', 'sem pg_cron: enable explica como ligar');

\echo '--- delta: updated_at em tudo que sincroniza'
select pg_temp.ok((select count(*) = 0 from unnest(array['events','families','people','expenses','settlement_marks','event_overrides','expense_confirmations','recipes','meal_plan']) t
  where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name = 'updated_at')), 'todas as tabelas sincronizadas têm updated_at');
select pg_temp.ok((select bool_and(updated_at >= confirmed_at) from public.expense_confirmations), 'anulação de confirmação atualiza updated_at');

\echo '--- expurgo automático (servidor)'
update public.events set end_date = current_date - 40, start_date = current_date - 42, version = version + 1 where id = :'ev';
select pg_temp.ok(public.purge_expired_health() = 1, 'dieta apagada 30 dias após o fim do evento');
select pg_temp.ok((select count(*) from public.person_diet) = 0, 'nenhuma dieta restante');
