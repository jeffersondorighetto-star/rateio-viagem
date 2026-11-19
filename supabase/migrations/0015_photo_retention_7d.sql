-- 0015 — Praia Brava: prazo dos comprovantes passa a ser fim da viagem + 7 dias (antes: + 30).
-- Só muda o prazo devolvido para o lembrete; quem apaga continua sendo o organizador (0014).
-- O app também apaga a foto local assim que o gasto é confirmado.
create or replace function public.event_photo_status(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_end date; v_n int;
begin
  perform public._require_organizer(p_event);
  select end_date into v_end from public.events where id = p_event;
  select count(*) into v_n from storage.objects o where o.bucket_id = 'comprovantes' and public.proof_event_id(o.name) = p_event;
  return jsonb_build_object('remaining', v_n, 'end_date', v_end, 'purge_by', v_end + 7,
                            'due', v_end is not null and current_date > v_end);
end $$;
revoke all on function public.event_photo_status(uuid) from public, anon;
grant execute on function public.event_photo_status(uuid) to authenticated;
