-- NULL preserves the behavior of reservations created before this change.
ALTER TABLE public.appointments
  ADD COLUMN reservation_whatsapp_preference text
    CHECK (reservation_whatsapp_preference IS NULL OR reservation_whatsapp_preference IN ('caller', 'other', 'declined', 'unavailable')),
  ADD COLUMN reservation_whatsapp_phone text,
  ADD CONSTRAINT reservation_whatsapp_phone_choice_check CHECK (
    (reservation_whatsapp_preference IS NOT DISTINCT FROM 'other' AND reservation_whatsapp_phone IS NOT NULL AND reservation_whatsapp_phone ~ '^[1-9][0-9]{6,14}$')
    OR (reservation_whatsapp_preference IS NOT DISTINCT FROM 'caller' AND (reservation_whatsapp_phone IS NULL OR reservation_whatsapp_phone ~ '^[1-9][0-9]{6,14}$'))
    OR (reservation_whatsapp_preference IS DISTINCT FROM 'other' AND reservation_whatsapp_preference IS DISTINCT FROM 'caller' AND reservation_whatsapp_phone IS NULL)
  );

-- A destination change invalidates a claim in the same transaction as the edit.
CREATE FUNCTION public.refresh_reservation_whatsapp_preference_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.reservation_confirmation_jobs
    SET revision = revision + 1,
        state = CASE WHEN state IN ('sending', 'failed') THEN 'failed'
          WHEN NEW.status IN ('cancelled', 'completed', 'no_show') OR NEW.reservation_restaurant IS NULL THEN 'skipped'
          ELSE 'queued' END,
        due_at = now(), conversation_id = NULL, sent_at = NULL,
        response = NULL, responded_at = NULL, response_memory_at = NULL,
        failure_notice_at = CASE WHEN state = 'failed' THEN failure_notice_at ELSE NULL END,
        response_notice_at = NULL,
        error_message = CASE WHEN state = 'sending' THEN 'La preferencia de WhatsApp cambió durante el envío.'
          WHEN state = 'failed' THEN error_message ELSE NULL END,
        updated_at = now()
    WHERE appointment_id = NEW.id AND account_id = NEW.account_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_reservation_whatsapp_preference_job() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER voice_reservation_whatsapp_preference_update
  AFTER UPDATE OF reservation_whatsapp_preference, reservation_whatsapp_phone ON public.appointments
  FOR EACH ROW WHEN (
    OLD.reservation_whatsapp_preference IS DISTINCT FROM NEW.reservation_whatsapp_preference
    OR OLD.reservation_whatsapp_phone IS DISTINCT FROM NEW.reservation_whatsapp_phone
  )
  EXECUTE FUNCTION public.refresh_reservation_whatsapp_preference_job();
