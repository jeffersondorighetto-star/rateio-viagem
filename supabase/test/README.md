# Testes locais do supabase.sql (não rodar no Supabase)

- `stub.sql`: imita o Supabase (papéis `anon`/`authenticated`, `auth.uid()`, `auth.jwt()` com `is_anonymous`, schema `extensions`, `storage.buckets`/`storage.objects` com RLS, publicação `supabase_realtime`).
- `run.sh`: gera o `supabase.sql` das migrações, roda 3 vezes (idempotência, inclusive com dados), testa a atualização a partir do script do MVP e roda `rls_test.sql` (imprime PASS/FAIL; falha se houver FAIL).
- `postgrest.test.js`: supabase-js 2.117.3 (mesma versão do app) contra PostgREST 12 local, usando o motor de sincronização do `index.html`.

```bash
# Postgres local na porta 54329 (socket em /tmp)
PGHOST=/tmp PGPORT=54329 PGUSER=postgres bash supabase/test/run.sh
# PostgREST: banco "rest" com stub.sql + supabase.sql + papel authenticator; jwt-secret só de teste
NODE_PATH=/caminho/node_modules node supabase/test/postgrest.test.js
```
