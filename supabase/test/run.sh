#!/usr/bin/env bash
# Roda o supabase.sql 2x num Postgres local com stub do Supabase e executa os testes de RLS.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres bash supabase/test/run.sh
set -euo pipefail
cd "$(dirname "$0")"
P="psql -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists rateio_test" -c "create database rateio_test" >/dev/null
$P -d rateio_test -f stub.sql >/dev/null 2>&1
$P -d rateio_test -f ../supabase.sql >/dev/null 2>&1 && echo "run 1: ok"
$P -d rateio_test -f ../supabase.sql >/dev/null 2>&1 && echo "run 2 (idempotência): ok"
psql -d rateio_test -f rls_test.sql 2>&1 | grep -E '^(--- T| T[0-9]|psql:.*ERROR)' | sed 's/psql:rls_test.sql:[0-9]*: //'
$P -d rateio_test -f ../supabase.sql >/dev/null 2>&1 && echo "run 3 (com dados): ok"
