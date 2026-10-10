-- Testes de RLS. Usuários: A (cria evento 1), B (sem entrar), C (entra com código), D (cria evento 2).
\set ON_ERROR_STOP 0
\set QUIET 1
create or replace function pg_temp.as_user(u text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', u, false) $$;
\echo '--- T1: A cria evento 1'
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select public.create_event('Viagem teste', 'ABCD2345', 'Ana') as ev1 \gset
\echo :ev1
insert into public.families (event_id, id, name) values (:'ev1', 'f1', 'Família A');
insert into public.people (event_id, id, family_id, first_name, drinks) values (:'ev1', 'p1', 'f1', 'Ana', true);
insert into public.expenses (event_id, id, description, amount, category, payer_person_id) values (:'ev1', 'e1', 'Mercado', 100.50, 'groceries', 'p1');
insert into public.settlement_marks (event_id, from_family, to_family, amount) values (:'ev1', 'f2', 'f1', 50);
select 'T1 A lê seus gastos (esperado 1): ' || count(*) from public.expenses;
update public.expenses set amount = 120 where id = 'e1';
select 'T1 A atualizou (esperado 120.00): ' || amount || ' created_by ok=' || (created_by = auth.uid()) from public.expenses where id='e1';
\echo '--- T2: A não consegue apagar fisicamente (esperado erro de permissão)'
delete from public.expenses where id = 'e1';
\echo '--- T3: ninguém lê event_secrets (esperado erro de permissão)'
select * from public.event_secrets;
\echo '--- T4: B sem entrar não lê nada'
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select 'T4 events='||(select count(*) from public.events)||' members='||(select count(*) from public.event_members)
  ||' families='||(select count(*) from public.families)||' people='||(select count(*) from public.people)
  ||' expenses='||(select count(*) from public.expenses)||' marks='||(select count(*) from public.settlement_marks)||' (esperado tudo 0)';
\echo '--- T5: B não insere no evento 1 (esperado erro RLS)'
insert into public.expenses (event_id, id, amount, category) values (:'ev1', 'hack', 10, 'food');
\echo '--- T6: B não altera gasto do evento 1 (esperado UPDATE 0)'
update public.expenses set amount = 1 where id = 'e1';
select 'T6 B update afetou 0 linhas: ' || (select count(*) = 0 from public.expenses);
\echo '--- T7: B não se insere direto em event_members (esperado erro de permissão)'
insert into public.event_members (event_id, user_id, display_name) values (:'ev1', auth.uid(), 'Hacker');
\echo '--- T8: B não chama crypt para ler secrets nem atualiza events (esperado UPDATE 0)'
update public.events set name = 'x' where id = :'ev1';
\echo '--- T9: join com código errado falha (esperado ERROR invalid_code)'
select public.join_event('ZZZZ2345', 'Beto');
select public.join_event('abc', 'Beto');
\echo '--- T10: C entra com código certo (minúsculas aceitas)'
select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select 'T10 join ok=' || (public.join_event('abcd2345', 'Caio') = :'ev1');
select 'T10 C lê gastos (esperado 1): ' || count(*) from public.expenses;
insert into public.expenses (event_id, id, amount, category) values (:'ev1', 'e2', 30, 'food');
update public.expenses set deleted_at = now() where id = 'e2';
select 'T10 soft delete ok: ' || (deleted_at is not null) from public.expenses where id='e2';
update public.event_members set family_id = 'f1' where user_id = auth.uid();
select 'T10 C vê membros (esperado 2): ' || count(*) from public.event_members;
\echo '--- T11: C não muda o membro de A (esperado UPDATE 0)'
update public.event_members set display_name = 'x' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'T11 nome de A intacto: ' || (display_name = 'Ana') from public.event_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
\echo '--- T12: C não muda created_by de evento (esperado erro de permissão)'
update public.events set created_by = auth.uid();
\echo '--- T13: limites (esperado 4 erros de check)'
insert into public.expenses (event_id, id, amount, category) values (:'ev1', 'cat', 5, 'zzz');
insert into public.expenses (event_id, id, amount, category) values (:'ev1', 'big', 2000000, 'food');
insert into public.expenses (event_id, id, amount, category) values (:'ev1', 'neg', -5, 'food');
insert into public.expenses (event_id, id, amount, category, description) values (:'ev1', 'long', 5, 'food', repeat('x', 500));
\echo '--- T14: D cria evento 2 e não vê evento 1; A não vê evento 2'
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select public.create_event('Outro', 'WXYZ6789', 'Duda') as ev2 \gset
select 'T14 D vê events (esperado 1): ' || count(*) || ' gastos (esperado 0): ' || (select count(*) from public.expenses) from public.events;
insert into public.expenses (event_id, id, amount, category) values (:'ev2', 'e1', 10, 'food');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'T14 A vê events (esperado 1): ' || count(*) || ' gastos ev1 ativos (esperado 1): ' || (select count(*) from public.expenses where deleted_at is null) from public.events;
select 'T6/T8 gasto e1 de A intacto (120.00): ' || amount from public.expenses where id='e1' and event_id = :'ev1';
select 'T8 nome do evento intacto: ' || (name = 'Viagem teste') from public.events;
\echo '--- T15: código repetido (esperado ERROR code_taken)'
select public.create_event('Dup', 'ABCD2345', 'Ana');
\echo '--- T16: anon (sem login) não lê nada (esperado erro de permissão)'
reset role; set role anon;
select count(*) from public.expenses;
select public.join_event('ABCD2345', 'X');
reset role;
