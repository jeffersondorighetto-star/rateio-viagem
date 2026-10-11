#!/usr/bin/env bash
# Roda o supabase.sql (gerado das migrações) num Postgres local com stub do Supabase e executa os testes de RLS.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres bash supabase/test/run.sh
set -euo pipefail
cd "$(dirname "$0")"
P="psql -v ON_ERROR_STOP=1 -q"
bash ../build.sh >/dev/null
git -C .. diff --quiet -- supabase.sql 2>/dev/null || echo "aviso: supabase.sql regenerado (commite junto)"
$P -c "drop database if exists rateio_test" -c "create database rateio_test" >/dev/null 2>&1
$P -d rateio_test -f stub.sql >/dev/null 2>&1
$P -d rateio_test -f ../supabase.sql >/dev/null 2>&1 && echo "run 1: ok"
$P -d rateio_test -f ../supabase.sql >/dev/null 2>&1 && echo "run 2 (idempotência): ok"
out=$(psql -X -d rateio_test -f rls_test.sql 2>&1 || true)
echo "$out" | grep -E '^(---|PASS|FAIL|psql)' || true
$P -d rateio_test -f ../supabase.sql >/dev/null 2>&1 && echo "run 3 (com dados): ok"
# atualização a partir do script do MVP (commit 7f4682e), se o git estiver disponível
if git -C .. cat-file -e 7f4682e:supabase/supabase.sql 2>/dev/null; then
  $P -c "drop database if exists rateio_up" -c "create database rateio_up" >/dev/null 2>&1
  $P -d rateio_up -f stub.sql >/dev/null 2>&1
  git -C .. show 7f4682e:supabase/supabase.sql | $P -d rateio_up >/dev/null 2>&1
  $P -d rateio_up -f ../supabase.sql >/dev/null 2>&1 && echo "atualização a partir do MVP: ok"
fi
# atualização a partir do rascunho do PR #1 que tinha person_diet (commit 6154b28): a dieta precisa sumir
if git -C .. cat-file -e 6154b28:supabase/supabase.sql 2>/dev/null; then
  $P -c "drop database if exists rateio_up2" -c "create database rateio_up2" >/dev/null 2>&1
  $P -d rateio_up2 -f stub.sql >/dev/null 2>&1
  git -C .. show 6154b28:supabase/supabase.sql | $P -d rateio_up2 >/dev/null 2>&1
  $P -d rateio_up2 -f ../supabase.sql >/dev/null 2>&1 && \
  [ "$(psql -X -tA -d rateio_up2 -c "select to_regclass('public.person_diet') is null and not has_column_privilege('authenticated','public.expenses','event_id','UPDATE')")" = t ] && echo "atualização a partir do rascunho com dieta: ok (person_diet removida, grants por coluna)"
fi
# atualização a partir de b6f4fa7 (lista de organizadores por login): vira por id numérico
if git -C .. cat-file -e b6f4fa7:supabase/supabase.sql 2>/dev/null; then
  $P -c "drop database if exists rateio_up3" -c "create database rateio_up3" >/dev/null 2>&1
  $P -d rateio_up3 -f stub.sql >/dev/null 2>&1
  git -C .. show b6f4fa7:supabase/supabase.sql | $P -d rateio_up3 >/dev/null 2>&1
  psql -X -q -d rateio_up3 -c "insert into public.organizer_allowlist (github_login) values ('alguem')" >/dev/null 2>&1
  $P -d rateio_up3 -f ../supabase.sql >/dev/null 2>&1 && \
  [ "$(psql -X -tA -d rateio_up3 -c "select exists (select 1 from information_schema.columns where table_name = 'organizer_allowlist' and column_name = 'github_id') and not exists (select 1 from information_schema.columns where table_name = 'organizer_allowlist' and column_name = 'github_login')")" = t ] && echo "atualização a partir de b6f4fa7: ok (organizer_allowlist por id numérico)"
fi
# matriz para o Supabase real (real_rls_matrix.sql): roda como papel NÃO superusuário (como o postgres do Supabase),
# tem que dar FAIL 0 e não deixar nada gravado; num banco sem o esquema, avisa em vez de quebrar
$P -c "drop database if exists rateio_rm" -c "create database rateio_rm" >/dev/null 2>&1
$P -d rateio_rm -f stub.sql >/dev/null 2>&1
psql -X -q -d rateio_rm -f real_rls_matrix.sql 2>/dev/null | grep -q "esquema ausente" && echo "matriz real sem esquema: avisa (ok)" || out="$out
FAIL matriz real: não avisou esquema ausente"
$P -d rateio_rm -f ../supabase.sql >/dev/null 2>&1
psql -X -q -d rateio_rm -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'sb_admin_teste') then create role sb_admin_teste login nosuperuser bypassrls; end if; end \$\$;
  grant authenticated, anon to sb_admin_teste; grant usage on schema auth, storage to sb_admin_teste; grant all on all tables in schema auth, public, storage to sb_admin_teste;" >/dev/null 2>&1
rm_out=$(psql -X -At -d rateio_rm -U sb_admin_teste -f real_rls_matrix.sql 2>&1 | grep -v '^CREATE FUNCTION\|^DO$\|NOTICE')
rm_left=$(psql -X -tA -d rateio_rm -c "select (select count(*) from public.events) + (select count(*) from auth.users) + (select count(*) from public.organizer_allowlist) + (select count(*) from storage.objects) + (select count(*) from public.join_attempts)")
echo "$rm_out" | head -1
if echo "$rm_out" | head -1 | grep -q 'FAIL 0 ' && [ "$rm_left" = 0 ]; then out="$out
PASS matriz real (local): FAIL 0 e nada gravado"; else out="$out
FAIL matriz real (local): $(echo "$rm_out" | grep -v '^PASS' | head -5 | tr '\n' ' ') restos=$rm_left"; fi
pass=$(echo "$out" | grep -c '^PASS' || true); fail=$(echo "$out" | grep -c -E '^(FAIL|psql:.*ERROR)' || true)
echo "RESULTADO: $pass PASS, $fail FAIL"
[ "$fail" = 0 ]
