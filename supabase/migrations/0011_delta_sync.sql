-- 0011 — Reconexão por delta: toda tabela sincronizada tem updated_at (o cliente busca só o que mudou
-- desde o último updated_at que viu, com folga de alguns segundos).
alter table public.expense_confirmations add column if not exists updated_at timestamptz not null default now();
create index if not exists confirmations_event_upd_idx on public.expense_confirmations (event_id, updated_at);
create index if not exists events_upd_idx on public.events (id, updated_at);
drop trigger if exists touch on public.expense_confirmations;
create trigger touch before insert or update on public.expense_confirmations for each row execute function public.tg_touch();
