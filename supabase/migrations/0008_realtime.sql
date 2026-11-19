-- 0008 — Tempo real (o Supabase Realtime aplica a RLS acima a cada evento). Dieta NÃO entra no tempo real.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['events','event_members','families','people','expenses','settlement_marks','expense_confirmations','event_overrides'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
