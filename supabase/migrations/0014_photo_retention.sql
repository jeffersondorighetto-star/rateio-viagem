-- 0014 — Retenção dos comprovantes (revisão de governança N1): o organizador apaga as fotos do evento
-- até 30 dias depois do fim (end_date). O app lembra o organizador e faz tudo com um toque.
--
-- Por que duas etapas: no Supabase, DELETE direto em storage.objects por SQL é bloqueado
-- (gatilho storage.protect_delete) e, se passasse, deixaria o arquivo órfão no armazenamento.
-- Então:
--   1) purge_event_photos(evento): só organizador; tira a referência da foto dos gastos do evento e
--      devolve a lista de arquivos do evento no bucket;
--   2) o app apaga esses arquivos pela Storage API (remove), que a política comprovantes_delete permite
--      só ao organizador. Rodar de novo devolve o que ainda sobrar (0 = concluído).
-- event_photo_status(evento): quantas fotos restam e o prazo (fim + 30 dias), para o lembrete.

create or replace function public.event_photo_status(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_end date; v_n int;
begin
  perform public._require_organizer(p_event);
  select end_date into v_end from public.events where id = p_event;
  select count(*) into v_n from storage.objects o where o.bucket_id = 'comprovantes' and public.proof_event_id(o.name) = p_event;
  return jsonb_build_object('remaining', v_n, 'end_date', v_end, 'purge_by', v_end + 30,
                            'due', v_end is not null and current_date > v_end);
end $$;
revoke all on function public.event_photo_status(uuid) from public, anon;
grant execute on function public.event_photo_status(uuid) to authenticated;

create or replace function public.purge_event_photos(p_event uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_paths text[]; v_cleared int;
begin
  perform public._require_organizer(p_event); perform public._server_write();
  update public.expenses set photo_path = null where event_id = p_event and photo_path is not null;
  get diagnostics v_cleared = row_count;
  select coalesce(array_agg(o.name order by o.name), '{}') into v_paths
    from storage.objects o where o.bucket_id = 'comprovantes' and public.proof_event_id(o.name) = p_event;
  return jsonb_build_object('paths', to_jsonb(v_paths), 'cleared_refs', v_cleared);
end $$;
revoke all on function public.purge_event_photos(uuid) from public, anon;
grant execute on function public.purge_event_photos(uuid) to authenticated;
