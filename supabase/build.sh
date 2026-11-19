#!/usr/bin/env bash
# Gera supabase/supabase.sql (arquivo único para colar no SQL Editor pelo celular) a partir de supabase/migrations/*.sql.
set -euo pipefail
cd "$(dirname "$0")"
{
  cat <<'HDR'
-- =====================================================================
-- Rateatouille — banco do evento compartilhado (Supabase)
-- ARQUIVO GERADO por supabase/build.sh a partir de supabase/migrations/. Não edite à mão.
-- Cole TUDO no Supabase › SQL Editor › New query › Run. Idempotente: pode rodar de novo sem perder dados.
-- Sem segredos e sem dados reais. Nada de CPF, conta, cartão ou Pix.
-- =====================================================================
HDR
  for f in migrations/*.sql; do
    printf '\n-- >>>>> %s\n' "$f"
    cat "$f"
  done
  printf '\n-- Pronto. Confira em Table Editor que todas as tabelas aparecem com "RLS enabled".\n'
} > supabase.sql
echo "supabase.sql: $(wc -l < supabase.sql) linhas de $(ls migrations/*.sql | wc -l) migrações"
