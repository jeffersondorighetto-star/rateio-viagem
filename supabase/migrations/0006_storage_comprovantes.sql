-- 0006 — Bucket privado "comprovantes": <event_id>/<expense_id>.jpg, até 150 KB, JPEG/WebP.
-- Ler e enviar: membros aprovados (enviar só com evento destravado). Trocar e apagar: só organizador.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprovantes', 'comprovantes', false, 153600, array['image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 153600, allowed_mime_types = array['image/jpeg','image/webp'];

-- Evento dono do arquivo, ou null se o caminho fugir do padrão.
create or replace function public.proof_event_id(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{1,40}\.jpg$'
              then split_part(p_name, '/', 1)::uuid end
$$;
grant execute on function public.proof_event_id(text) to authenticated;

drop policy if exists comprovantes_select on storage.objects;
create policy comprovantes_select on storage.objects for select to authenticated
  using (bucket_id = 'comprovantes' and public.is_event_member(public.proof_event_id(name)));
drop policy if exists comprovantes_insert on storage.objects;
create policy comprovantes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'comprovantes' and public.is_event_writable(public.proof_event_id(name)));
drop policy if exists comprovantes_update on storage.objects;
create policy comprovantes_update on storage.objects for update to authenticated
  using (bucket_id = 'comprovantes' and public.is_event_organizer(public.proof_event_id(name)))
  with check (bucket_id = 'comprovantes' and public.is_event_organizer(public.proof_event_id(name)));
drop policy if exists comprovantes_delete on storage.objects;
create policy comprovantes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'comprovantes' and public.is_event_organizer(public.proof_event_id(name)));
