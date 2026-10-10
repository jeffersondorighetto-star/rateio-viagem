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
\set F 'ffffffff-0000-0000-0000-00000000000f'
\set G '99999999-0000-0000-0000-000000000009'
-- O e F entram com GitHub e estão na lista de organizadores; G entra com GitHub mas não está na lista
-- G tem o MESMO login que O (login trocado e reaproveitado), mas outro id numérico: não pode organizar
insert into auth.identities (user_id, provider, identity_data, provider_id) values
  (:'O', 'github', '{"user_name":"org-teste"}', '1001'), (:'F', 'github', '{"user_name":"flor-teste"}', '1002'), (:'G', 'github', '{"user_name":"org-teste"}', '9009');
insert into public.organizer_allowlist (github_id, note) values (1001, 'org-teste'), (1002, 'flor-teste') on conflict do nothing;
-- Storage API: apaga com a RLS de quem chama e liga storage.allow_delete_query na transação (como o servidor do Supabase)
create function pg_temp.api_del(w text) returns bigint language plpgsql as $$ declare n bigint; begin
  perform set_config('storage.allow_delete_query', 'true', true); execute 'delete from storage.objects where ' || w; get diagnostics n = row_count;
  perform set_config('storage.allow_delete_query', 'false', true); return n; end $$;
set role authenticated;

\echo '--- criação e papéis'
select pg_temp.u(:'G', false);
select pg_temp.err($$select public.create_event('X', 'GGGG2345', 'Intruso')$$, 'organizer_only', 'mesmo login do GitHub com outro id numérico não cria evento (lista por id)');
select pg_temp.err($$select * from public.organizer_allowlist$$, 'permission denied', 'lista de organizadores ilegível para clientes');
select pg_temp.err($$insert into public.organizer_allowlist (github_id) values (9009)$$, 'permission denied', 'cliente não se coloca na lista');
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
select pg_temp.ok((public.my_membership(:'ev') ->> 'status') = 'pending' and not (public.my_membership(:'ev') ? 'event_name') and not (public.my_membership(:'ev') ? 'locked'), 'pendente: my_membership sem nome do evento');
select pg_temp.ok(not (public.join_event('ABCD2345', 'Ana') ? 'event_name'), 'pendente: join_event sem nome do evento');
select pg_temp.err(format($$insert into public.expenses (event_id, id, amount, category) values (%L, 'x', 1, 'food')$$, :'ev'), 'row-level security', 'pendente não insere');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"x","amount":1,"category":"food"}') ->> 'status') = 'error', 'pendente não grava via apply_ops');
select pg_temp.err(format($$select public.approve_member(%L, %L)$$, :'ev', :'A'), 'organizer_only', 'pendente não se aprova');

\echo '--- aprovação'
select pg_temp.u(:'O', false);
select public.approve_member(:'ev', :'A');
select pg_temp.u(:'A', true);
select pg_temp.ok(pg_temp.n('select * from public.expenses') = 1 and pg_temp.n('select * from public.event_members') = 2, 'aprovado lê gastos e lista de membros');
select pg_temp.ok((public.my_membership(:'ev') ->> 'event_name') = 'Viagem teste', 'aprovado: my_membership traz o nome');
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

\echo '--- confirmação de gasto sem nota (só inserção; membro só pela própria família)'
select pg_temp.err(format($$update public.event_members set family_id = 'f2' where event_id = %L$$, :'ev'), 'permission denied', 'membro não escolhe a própria família direto');
select pg_temp.err(format($$select public.set_member_family(%L, %L, 'f2')$$, :'ev', :'A'), 'organizer_only', 'membro não usa set_member_family');
select pg_temp.ok((pg_temp.op(:'ev', 'expense_confirmations', '{"id":"44444444-4444-4444-4444-444444444444","expense_id":"e1","family_id":"f2"}') ->> 'code') = '42501', 'sem família definida o membro não confirma');
select pg_temp.u(:'O', false);
select public.set_member_family(:'ev', :'A', 'f2');
select pg_temp.err(format($$select public.set_member_family(%L, %L, 'fx')$$, :'ev', :'A'), 'family_not_found', 'família inexistente recusada');
select pg_temp.u(:'A', true);
select pg_temp.ok((public.my_membership(:'ev') ->> 'family_id') = 'f2', 'organizador liga A à família f2');
select pg_temp.err(format($$insert into public.expense_confirmations (event_id, id, expense_id, family_id) values (%L, gen_random_uuid(), 'e1', 'f1')$$, :'ev'), 'payer_family_cannot_confirm', 'família de quem pagou não confirma');
select pg_temp.err(format($$insert into public.expense_confirmations (event_id, id, expense_id, family_id) values (%L, gen_random_uuid(), 'e2', 'f1')$$, :'ev'), 'only_sem_nota', 'só gasto sem nota é confirmado');
select pg_temp.ok((pg_temp.op(:'ev', 'expense_confirmations', '{"id":"22222222-2222-2222-2222-222222222222","expense_id":"e1","family_id":"f2"}') ->> 'status') = 'ok', 'outra família (a do membro) confirma');
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
select pg_temp.ok((pg_temp.op(:'ev', 'meal_plan', '{"day":"2031-03-03","meal":"almoco","mode":"casa","recipe_ids":["r1","churrasco"]}') ->> 'status') = 'ok', 'célula do cardápio criada');
select pg_temp.ok((pg_temp.op(:'ev', 'meal_plan', '{"day":"2031-03-03","meal":"almoco","mode":"fora"}', 1) -> 'row' ->> 'mode') = 'fora', 'célula muda de modo (patch)');
select pg_temp.ok((select recipe_ids = array['r1','churrasco'] from public.meal_plan), 'patch preserva as receitas da célula');
select pg_temp.ok((pg_temp.op(:'ev', 'meal_plan', '{"day":"2031-03-03","meal":"ceia","mode":"casa"}') ->> 'status') = 'error', 'refeição fora da lista recusada');
select pg_temp.ok((pg_temp.op(:'ev', 'meal_plan', '{"day":"2031-03-04","meal":"jantar","recipe_ids":["ok","bad id!"]}') ->> 'status') = 'error', 'id de receita inválido no cardápio recusado');
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
select pg_temp.ok(pg_temp.api_del($$bucket_id = 'comprovantes'$$) = 0 and pg_temp.n($$select * from storage.objects$$) = 1, 'membro não apaga comprovante (Storage API)');
update storage.objects set metadata = '{"x":1}' where bucket_id = 'comprovantes';
select pg_temp.ok((select metadata is null from storage.objects), 'membro não substitui comprovante (update = 0 linhas)');
select pg_temp.u(:'O', false);
update storage.objects set metadata = '{"size":1000}' where bucket_id = 'comprovantes';
select pg_temp.ok((select metadata ->> 'size' = '1000' from storage.objects), 'organizador substitui comprovante');
select pg_temp.u(:'A', true);

\echo '--- dieta fora do servidor no piloto (Astreia 2.1)'
select pg_temp.ok(to_regclass('public.person_diet') is null, 'tabela person_diet não existe no banco');
select pg_temp.err(format($$insert into public.person_diet (event_id, person_id) values (%L, 'p1')$$, :'ev'), 'does not exist', 'membro aprovado não grava dieta (não há onde)');
select pg_temp.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ~ 'purge_health|purge_expired_health|health_purge'), 'sem funções de expurgo de saúde no build');
select pg_temp.u(:'C', true);
select pg_temp.ok((public.join_event('ABCD2345', 'Caio') ->> 'status') = 'pending', 'C pendente');
select pg_temp.u(:'B', true);
select pg_temp.ok(pg_temp.n('select * from storage.objects') = 0, 'quem não entrou não vê comprovante');
select pg_temp.u(:'A', true);

\echo '--- revogar'
select pg_temp.u(:'B', true);
select (public.join_event('ABCD2345', 'Bia') ->> 'status') is not null as x \gset
select pg_temp.u(:'O', false);
select public.approve_member(:'ev', :'B');
select public.revoke_member(:'ev', :'A');
select pg_temp.err(format($$select public.revoke_member(%L, %L)$$, :'ev', :'O'), 'cannot_revoke_self', 'organizador não revoga a si');
select pg_temp.u(:'A', true);
select pg_temp.ok(pg_temp.n('select * from public.expenses') = 0 and pg_temp.n('select * from storage.objects') = 0, 'revogado perde a leitura na hora (tabelas e comprovantes)');
select pg_temp.ok(not (public.my_membership(:'ev') ? 'event_name'), 'revogado: sem nome do evento');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"e9","amount":1,"category":"food"}') ->> 'status') = 'error', 'revogado não grava');
select pg_temp.ok((public.join_event('ABCD2345', 'Ana') ->> 'error') = 'revoked', 'revogado não volta com o código');
select pg_temp.err(format($$update public.event_members set display_name = 'x' where event_id = %L$$, :'ev'), 'permission denied', 'revogado não edita a própria linha');

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
select pg_temp.err($$delete from storage.objects where bucket_id = 'comprovantes'$$, 'Direct deletion', 'DELETE direto por SQL em storage.objects é bloqueado (como no Supabase)');
select pg_temp.ok(pg_temp.api_del($$bucket_id = 'comprovantes'$$) = 1 and pg_temp.n('select * from storage.objects') = 0, 'organizador apaga comprovante (Storage API)');

\echo '--- limite de tentativas de código'
select pg_temp.u('eeeeeeee-0000-0000-0000-00000000000e', true);
select count(*) from (select public.join_event('ZZZZ2345', 'X') from generate_series(1, 5)) s \gset
select pg_temp.ok((public.join_event('WXYZ6789', 'X') ->> 'error') = 'too_many_attempts', '5 erros em 10 min bloqueiam até o código certo');

\echo '--- isolamento entre eventos e anon'
select pg_temp.u(:'F', false);
select public.create_event('Outro', 'MNPQ3456', 'Flor') as ev2 \gset
select pg_temp.ok(pg_temp.n('select * from public.events') = 1 and pg_temp.n('select * from public.expenses') = 0, 'outro organizador só vê o próprio evento');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', '{"id":"h","amount":1,"category":"food"}') ->> 'status') = 'error', 'não grava no evento alheio');
reset role;
set role anon;
select pg_temp.err($$select * from public.expenses$$, 'permission denied', 'papel anon (sem login) não lê');
select pg_temp.err($$select public.join_event('WXYZ6789', 'X')$$, 'permission denied', 'papel anon não chama RPC');
reset role;
set role authenticated;
select pg_temp.u(:'O', false);

\echo '--- delta: updated_at em tudo que sincroniza'
select pg_temp.ok((select count(*) = 0 from unnest(array['events','families','people','expenses','settlement_marks','event_overrides','expense_confirmations','recipes','meal_plan']) t
  where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name = 'updated_at')), 'todas as tabelas sincronizadas têm updated_at');
select pg_temp.ok((select bool_and(updated_at >= confirmed_at) from public.expense_confirmations), 'anulação de confirmação atualiza updated_at');

\echo '--- isolamento: 2 eventos x perfis (de fora, pendente, revogado, membro dos dois) x tabelas, bucket e RPCs'
-- tabelas sincronizadas: leitura 0, INSERT direto negado, UPDATE direto 0 linhas/negado, apply_ops negado
create function pg_temp.iso(ev uuid, who text) returns setof text language plpgsql as $$
declare t text; c bigint; ok boolean; n int; ts text[] := array['families','people','expenses','settlement_marks','event_overrides','expense_confirmations','recipes','meal_plan'];
begin
  select count(*) into c from public.events where id = ev; return next pg_temp.ok(c = 0, who || ': não lê events');
  select count(*) into c from public.event_members where event_id = ev and user_id <> auth.uid(); return next pg_temp.ok(c = 0, who || ': não lê membros dos outros');
  foreach t in array ts loop
    execute format('select count(*) from public.%I where event_id = $1', t) into c using ev;
    return next pg_temp.ok(c = 0, who || ': não lê ' || t);
    begin execute format('insert into public.%I (event_id) values ($1)', t) using ev; ok := false;
    exception when others then ok := sqlstate in ('42501', '23502', '23514', 'P0001') ; end;
    return next pg_temp.ok(ok, who || ': INSERT direto negado em ' || t);
    begin
      if t = 'expense_confirmations' then execute 'update public.expense_confirmations set family_id = family_id where event_id = $1' using ev; get diagnostics n = row_count;
      else execute format('update public.%I set deleted_at = now(), version = version + 1 where event_id = $1', t) using ev; get diagnostics n = row_count; end if;
      ok := n = 0;
    exception when others then ok := sqlstate = '42501'; end;
    return next pg_temp.ok(ok, who || ': UPDATE direto sem efeito em ' || t);
    return next pg_temp.ok(coalesce((pg_temp.op(ev, t, '{"id":"iso","name":"x","amount":1,"category":"food","kind":"weight","key":"x","value":1,"from_family":"f1","to_family":"f2","day":"2031-03-03","meal":"cafe","title":"x","expense_id":"e1","family_id":"f2","family_id_":"x"}'::jsonb) ->> 'status'), 'error') = 'error', who || ': apply_ops negado em ' || t);
  end loop;
  select count(*) into c from storage.objects where bucket_id = 'comprovantes' and name like ev::text || '/%'; return next pg_temp.ok(c = 0, who || ': não lê comprovantes');
  begin insert into storage.objects (bucket_id, name) values ('comprovantes', ev::text || '/iso.jpg'); ok := false; exception when others then ok := sqlstate = '42501'; end;
  return next pg_temp.ok(ok, who || ': não envia comprovante');
  begin perform public.approve_member(ev, auth.uid()); ok := false; exception when others then ok := sqlerrm = 'organizer_only'; end; return next pg_temp.ok(ok, who || ': approve_member negado');
  begin perform public.rotate_code(ev, 'TTTT2345'); ok := false; exception when others then ok := sqlerrm = 'organizer_only'; end; return next pg_temp.ok(ok, who || ': rotate_code negado');
  begin perform public.lock_event(ev, true); ok := false; exception when others then ok := sqlerrm = 'organizer_only'; end; return next pg_temp.ok(ok, who || ': lock_event negado');
  begin perform public.set_member_role(ev, auth.uid(), 'organizer'); ok := false; exception when others then ok := sqlerrm = 'organizer_only'; end; return next pg_temp.ok(ok, who || ': set_member_role negado');
  begin perform public.set_member_family(ev, auth.uid(), 'f1'); ok := false; exception when others then ok := sqlerrm = 'organizer_only'; end; return next pg_temp.ok(ok, who || ': set_member_family negado');
  begin perform public.update_event_settings(ev, '{"kitty_per_family":1}', 1); ok := false; exception when others then ok := sqlerrm = 'organizer_only'; end; return next pg_temp.ok(ok, who || ': update_event_settings negado');
  return next pg_temp.ok(not (public.my_membership(ev) ? 'event_name'), who || ': my_membership sem nome do evento');
end $$;
-- de fora (nunca entrou)
select pg_temp.u('12121212-0000-0000-0000-000000000012', true);
select pg_temp.iso(:'ev', 'de fora');
-- pendente (C entrou e não foi aprovado; girar com reaprovação o deixou pendente)
select pg_temp.u(:'C', true);
select pg_temp.iso(:'ev', 'pendente');
-- revogado (A)
select pg_temp.u(:'A', true);
select pg_temp.iso(:'ev', 'revogado');
-- organizador de um evento não alcança o outro
select pg_temp.u(:'F', false);
select pg_temp.iso(:'ev', 'organizador do outro evento');
-- membro dos dois eventos (B aprovado em ev; entra e é aprovado em ev2)
select pg_temp.u(:'B', true);
select (public.join_event('MNPQ3456', 'Bia') ->> 'status') as x \gset
select pg_temp.u(:'F', false);
select public.approve_member(:'ev2', :'B');
select pg_temp.ok((pg_temp.op(:'ev2', 'families', '{"id":"g1","name":"Família G"}') ->> 'status') = 'ok', 'ev2: família g1');
select pg_temp.ok((pg_temp.op(:'ev2', 'people', '{"id":"q1","family_id":"g1","first_name":"Gil"}') ->> 'status') = 'ok', 'ev2: pessoa q1');
select pg_temp.ok((pg_temp.op(:'ev2', 'expenses', '{"id":"k1","amount":10,"category":"food","payer_person_id":"q1","proof":"none"}') ->> 'status') = 'ok', 'ev2: gasto k1');
select pg_temp.u(:'B', true);
select pg_temp.ok(pg_temp.n('select * from public.events') = 2 and pg_temp.n(format($$select * from public.expenses where event_id = %L$$, :'ev2')) = 1, 'membro dos dois vê os dois eventos');
select pg_temp.err(format($$update public.expenses set event_id = %L, version = version + 1 where id = 'e1'$$, :'ev2'), 'permission denied', 'membro dos dois NÃO move gasto entre eventos (event_id por coluna)');
select pg_temp.err(format($$update public.families set event_id = %L, version = version + 1 where id = 'f1'$$, :'ev2'), 'permission denied', 'nem família');
select pg_temp.err($$update public.expenses set id = 'novo', version = version + 1 where id = 'e1'$$, 'permission denied', 'id não muda por PATCH');
select pg_temp.err($$update public.expenses set confirmed_by_family_id = 'f1', version = version + 1 where id = 'e1'$$, 'permission denied', 'confirmed_by_family_id não muda por PATCH');
select pg_temp.err($$update public.recipes set created_by = auth.uid(), version = version + 1$$, 'permission denied', 'autor da receita não muda por PATCH');
select pg_temp.err(format($$insert into public.expense_confirmations (event_id, id, expense_id, family_id, confirmed_by) values (%L, gen_random_uuid(), 'k1', 'g1', %L)$$, :'ev2', :'O'), 'permission denied', 'confirmed_by não é enviado pelo cliente');
select pg_temp.err(format($$insert into public.expenses (event_id, id, amount, category, version) values (%L, 'v9', 1, 'food', 7)$$, :'ev2'), 'permission denied', 'version não é enviada no INSERT');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', format('{"id":"e1","event_id":"%s","amount":11}', :'ev2')::jsonb, (select version from public.expenses where event_id = :'ev' and id = 'e1')) -> 'row' ->> 'event_id') = :'ev', 'apply_ops ignora event_id do corpo (fica no evento chamado)');
select pg_temp.ok(pg_temp.n(format($$select * from public.expenses where event_id = %L and id = 'e1'$$, :'ev2')) = 0, 'nada vazou para ev2');
select pg_temp.ok((pg_temp.op(:'ev2', 'event_overrides', '{"kind":"weight","key":"crianca","value":0.5}') ->> 'status') = 'error', 'membro (não organizador) de ev2 não mexe em configurações de ev2');
select pg_temp.err(format($$select public.approve_member(%L, %L)$$, :'ev2', :'D'), 'organizer_only', 'membro dos dois não aprova em ev2');

\echo '--- retenção dos comprovantes: purge_event_photos (só organizador, outros eventos intactos)'
select pg_temp.u(:'O', false);
insert into storage.objects (bucket_id, name) values ('comprovantes', :'ev' || '/e1.jpg'), ('comprovantes', :'ev' || '/e3.jpg');
select pg_temp.ok((pg_temp.op(:'ev', 'expenses', format('{"id":"e3","photo_path":"%s/e3.jpg"}', :'ev')::jsonb, (select version from public.expenses where event_id = :'ev' and id = 'e3')) ->> 'status') = 'ok', 'gasto e3 com foto');
select pg_temp.u(:'F', false);
insert into storage.objects (bucket_id, name) values ('comprovantes', :'ev2' || '/k1.jpg');
select pg_temp.ok((pg_temp.op(:'ev2', 'expenses', format('{"id":"k1","photo_path":"%s/k1.jpg"}', :'ev2')::jsonb, (select version from public.expenses where event_id = :'ev2' and id = 'k1')) ->> 'status') = 'ok', 'gasto k1 (outro evento) com foto');
select pg_temp.err(format($$select public.purge_event_photos(%L)$$, :'ev'), 'organizer_only', 'organizador de outro evento não apaga fotos deste');
select pg_temp.err(format($$select public.event_photo_status(%L)$$, :'ev'), 'organizer_only', 'nem vê o status');
select pg_temp.u(:'B', true);
select pg_temp.err(format($$select public.purge_event_photos(%L)$$, :'ev'), 'organizer_only', 'membro não apaga as fotos do evento');
select pg_temp.u('12121212-0000-0000-0000-000000000012', true);
select pg_temp.err(format($$select public.purge_event_photos(%L)$$, :'ev'), 'organizer_only', 'de fora não apaga');
reset role; set role anon;
select pg_temp.err(format($$select public.purge_event_photos(%L)$$, :'ev'), 'permission denied', 'anon não chama');
reset role; set role authenticated;
select pg_temp.u(:'O', false);
select pg_temp.ok((public.event_photo_status(:'ev') ->> 'remaining') = '2', 'status: 2 fotos no evento');
select public.purge_event_photos(:'ev') as pr \gset
select pg_temp.ok(jsonb_array_length(:'pr'::jsonb -> 'paths') = 2 and (:'pr'::jsonb ->> 'cleared_refs')::int >= 1, 'purge devolve as 2 fotos do evento e limpa as referências');
select pg_temp.ok(pg_temp.n(format($$select * from public.expenses where event_id = %L and photo_path is not null$$, :'ev')) = 0, 'nenhum gasto do evento aponta para foto');
select pg_temp.ok(pg_temp.api_del(format($$name = any (array(select jsonb_array_elements_text(%L::jsonb -> 'paths')))$$, :'pr')) = 2, 'organizador apaga os arquivos devolvidos (Storage API)');
select pg_temp.ok((public.event_photo_status(:'ev') ->> 'remaining') = '0' and jsonb_array_length(public.purge_event_photos(:'ev') -> 'paths') = 0, 'depois: 0 fotos restantes (rodar de novo é inofensivo)');
select pg_temp.u(:'F', false);
select pg_temp.ok(pg_temp.n(format($$select * from storage.objects where name = %L$$, :'ev2' || '/k1.jpg')) = 1, 'foto do outro evento intacta');
select pg_temp.ok((select photo_path is not null from public.expenses where event_id = :'ev2' and id = 'k1'), 'referência do outro evento intacta');
select pg_temp.u(:'O', false);
select public.update_event_settings(:'ev', format('{"start_date":"%s","end_date":"%s"}', current_date - 12, current_date - 10)::jsonb, (select version from public.events where id = :'ev')) is not null as x \gset
select pg_temp.ok((public.event_photo_status(:'ev') ->> 'due') = 'true' and (public.event_photo_status(:'ev') ->> 'purge_by')::date = current_date + 20, 'prazo = fim + 30 dias; lembrete devido depois do fim');

