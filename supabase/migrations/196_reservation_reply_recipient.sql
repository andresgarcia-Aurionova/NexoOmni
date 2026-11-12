CREATE OR REPLACE FUNCTION public.record_voice_reservation_response(
  p_account_id uuid, p_appointment_id uuid, p_revision integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_contact_id uuid;
  v_recipient_id uuid;
  v_response text;
  v_recorded_at timestamptz;
BEGIN
  SELECT a.contact_id, c.contact_id, j.response, j.response_memory_at
    INTO v_contact_id, v_recipient_id, v_response, v_recorded_at
    FROM public.reservation_confirmation_jobs j
    JOIN public.appointments a ON a.id = j.appointment_id AND a.account_id = j.account_id
    LEFT JOIN public.conversations c ON c.id = j.conversation_id AND c.account_id = j.account_id
    WHERE j.appointment_id = p_appointment_id AND j.account_id = p_account_id
      AND j.revision = p_revision AND j.state = 'sent'
    FOR UPDATE OF j;
  IF NOT FOUND OR v_response IS NULL OR v_recorded_at IS NOT NULL THEN RETURN false; END IF;
  IF v_contact_id IS NULL THEN RAISE EXCEPTION 'Reservation response has no contact'; END IF;
  INSERT INTO public.contact_memory_events
    (account_id, contact_id, event_type, summary, importance, confidence, source_type, source_id)
    VALUES (p_account_id, v_contact_id, 'manual',
      CASE
        WHEN v_recipient_id IS NOT NULL AND v_recipient_id <> v_contact_id AND v_response = 'yes'
          THEN 'El destinatario del recordatorio confirmó la asistencia a la reservación por WhatsApp.'
        WHEN v_recipient_id IS NOT NULL AND v_recipient_id <> v_contact_id
          THEN 'El destinatario del recordatorio indicó por WhatsApp que no pueden asistir a la reservación.'
        WHEN v_response = 'yes' THEN 'El cliente confirmó su asistencia a la reservación por WhatsApp.'
        ELSE 'El cliente indicó por WhatsApp que no puede asistir a la reservación.'
      END,
      'normal', 1, 'manual', p_appointment_id);
  UPDATE public.reservation_confirmation_jobs SET response_memory_at = now()
    WHERE appointment_id = p_appointment_id AND account_id = p_account_id AND revision = p_revision;
  RETURN true;
END;
$$;

CREATE FUNCTION public.accept_voice_reservation_recipient_response(
  p_account_id uuid, p_appointment_id uuid, p_revision integer, p_contact_id uuid,
  p_conversation_id uuid, p_recipient_contact_id uuid, p_sender_phone text,
  p_response text, p_notice_title text, p_notice_body text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_preference text;
  v_phone text;
BEGIN
  SELECT reservation_whatsapp_preference, reservation_whatsapp_phone
    INTO v_preference, v_phone
    FROM public.appointments
    WHERE id = p_appointment_id AND account_id = p_account_id AND contact_id = p_contact_id
      AND starts_at > now() AND status NOT IN ('cancelled', 'completed', 'no_show')
      AND reservation_restaurant IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM 1 FROM public.conversations
    WHERE id = p_conversation_id AND account_id = p_account_id
      AND contact_id = p_recipient_contact_id FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_preference IS NULL THEN
    IF p_recipient_contact_id IS DISTINCT FROM p_contact_id THEN RETURN false; END IF;
  ELSIF v_preference NOT IN ('caller', 'other')
    OR (v_preference = 'caller' AND p_recipient_contact_id IS DISTINCT FROM p_contact_id)
    OR p_sender_phone IS NULL
    OR p_sender_phone IS DISTINCT FROM v_phone THEN
    RETURN false;
  END IF;

  RETURN public.accept_voice_reservation_response(
    p_account_id, p_appointment_id, p_revision, p_contact_id,
    p_conversation_id, p_response, p_notice_title, p_notice_body
  );
END;
$$;
REVOKE ALL ON FUNCTION public.accept_voice_reservation_recipient_response(uuid, uuid, integer, uuid, uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_voice_reservation_recipient_response(uuid, uuid, integer, uuid, uuid, uuid, text, text, text, text) TO service_role;
