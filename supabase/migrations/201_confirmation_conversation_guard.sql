-- Historical reminders have no reliable originating conversation.
ALTER TABLE public.agendapro_bookings
  ADD COLUMN confirmation_reminder_conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  ADD COLUMN confirmation_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN confirmation_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN confirmation_review_notified_at timestamptz;

-- Based on the latest definition, migration 134.
CREATE OR REPLACE FUNCTION public.agendapro_bookings_sync_confirmation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.start_time IS DISTINCT FROM OLD.start_time THEN
    NEW.confirmation_revision := CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE OLD.confirmation_revision + 1 END;
    NEW.confirmation_status := 'pending';
    NEW.confirmation_reminder_status := 'queued';
    NEW.confirmation_reminder_due_at := NEW.start_time - INTERVAL '24 hours';
    NEW.confirmation_reminder_sent_at := NULL;
    NEW.confirmation_responded_at := NULL;
    NEW.reception_alert_sent_at := NULL;
    NEW.confirmation_reminder_conversation_id := NULL;
    -- A reply to the previous reminder cannot be distinguished from a reply
    -- to the new appointment, including when the old send is still in flight.
    NEW.confirmation_review_required := CASE WHEN TG_OP = 'INSERT' THEN false
      ELSE OLD.confirmation_review_required
        OR COALESCE(OLD.confirmation_reminder_status IN ('sending', 'sent'), false) END;
    NEW.confirmation_review_notified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
-- An ambiguous reply is durably flagged before notifications are attempted.
-- The booking lock makes concurrent notifications idempotent.
CREATE FUNCTION public.notify_agendapro_confirmation_review(
  p_account_id uuid, p_booking_id uuid, p_title text, p_body text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_booking public.agendapro_bookings%ROWTYPE;
  v_recipients integer;
BEGIN
  SELECT * INTO v_booking FROM public.agendapro_bookings
    WHERE id = p_booking_id AND account_id = p_account_id AND confirmation_review_required
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_booking.confirmation_review_notified_at IS NOT NULL THEN RETURN true; END IF;
  INSERT INTO public.notifications (account_id, user_id, type, contact_id, title, body)
    SELECT p_account_id, p.user_id, 'agendapro_unconfirmed_appointment', v_booking.contact_id, p_title, p_body
    FROM public.profiles p
    WHERE p.account_id = p_account_id AND p.is_active = true AND p.account_role IN ('owner', 'admin');
  GET DIAGNOSTICS v_recipients = ROW_COUNT;
  IF v_recipients = 0 THEN RETURN false; END IF;
  UPDATE public.agendapro_bookings SET confirmation_review_notified_at = clock_timestamp()
    WHERE id = p_booking_id AND account_id = p_account_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_agendapro_confirmation_review(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_agendapro_confirmation_review(uuid, uuid, text, text) TO service_role;

-- A flow start and a confirmation decision for the same conversation must
-- observe one another, even when the flow insert has not committed yet.
CREATE FUNCTION public.lock_flow_confirmation_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'active' AND NEW.conversation_id IS NOT NULL THEN
    PERFORM 1 FROM public.conversations
      WHERE id = NEW.conversation_id AND account_id = NEW.account_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Flow conversation does not match account'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_flow_confirmation_conversation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER flow_confirmation_conversation_lock
  BEFORE INSERT OR UPDATE OF status, conversation_id ON public.flow_runs
  FOR EACH ROW EXECUTE FUNCTION public.lock_flow_confirmation_conversation();

-- Lock every potentially relevant reminder before deciding whether this
-- response can identify exactly one booking on this conversation.
CREATE FUNCTION public.handle_agendapro_confirmation_reply(
  p_account_id uuid, p_contact_id uuid, p_conversation_id uuid, p_response text,
  p_flow_consumed boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_booking public.agendapro_bookings%ROWTYPE;
  v_ids uuid[] := '{}';
  v_count integer := 0;
  v_ambiguous boolean := false;
BEGIN
  IF p_response IS NULL OR p_response NOT IN ('yes', 'no') THEN RAISE EXCEPTION 'Invalid confirmation response'; END IF;
  PERFORM 1 FROM public.conversations
    WHERE id = p_conversation_id AND account_id = p_account_id AND contact_id = p_contact_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Confirmation conversation does not match contact';
  END IF;
  FOR v_booking IN
    SELECT * FROM public.agendapro_bookings
    WHERE account_id = p_account_id AND contact_id = p_contact_id
      AND confirmation_status = 'pending'
      AND (confirmation_reminder_status IN ('sending', 'sent') OR confirmation_review_required)
      AND start_time > clock_timestamp()
      AND (confirmation_reminder_status = 'sending'
        OR confirmation_reminder_conversation_id IS NULL
        OR confirmation_reminder_conversation_id = p_conversation_id)
    ORDER BY id FOR UPDATE
  LOOP
    v_ids := array_append(v_ids, v_booking.id);
    v_count := v_count + 1;
    IF v_booking.confirmation_reminder_status <> 'sent'
      OR v_booking.confirmation_reminder_conversation_id IS NULL
      OR v_booking.confirmation_review_required THEN
      v_ambiguous := true;
    END IF;
  END LOOP;
  IF v_count = 0 THEN RETURN jsonb_build_object('outcome', 'none'); END IF;
  IF v_count <> 1 OR COALESCE(p_flow_consumed, false) OR EXISTS (
    SELECT 1 FROM public.flow_runs WHERE account_id = p_account_id
      AND conversation_id = p_conversation_id AND status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.reservation_confirmation_jobs j
    JOIN public.appointments a ON a.id = j.appointment_id AND a.account_id = j.account_id
    JOIN public.contacts c ON c.id = p_contact_id AND c.account_id = p_account_id
    WHERE j.account_id = p_account_id AND j.response IS NULL
      AND a.starts_at > clock_timestamp() AND a.status NOT IN ('cancelled', 'completed', 'no_show')
      AND ((j.state = 'sent' AND j.conversation_id = p_conversation_id)
        OR (j.state = 'sending' AND (a.contact_id = p_contact_id
          OR a.reservation_whatsapp_phone = regexp_replace(c.phone, '[^0-9]', '', 'g'))))
  ) THEN v_ambiguous := true; END IF;
  IF v_ambiguous THEN
    UPDATE public.agendapro_bookings SET confirmation_review_required = true
      WHERE account_id = p_account_id AND id = ANY(v_ids);
    RETURN jsonb_build_object('outcome', 'review', 'booking_ids', to_jsonb(v_ids));
  END IF;
  UPDATE public.agendapro_bookings
    SET confirmation_status = CASE p_response WHEN 'yes' THEN 'confirmed' ELSE 'declined' END,
        confirmation_responded_at = clock_timestamp()
    WHERE account_id = p_account_id AND id = v_ids[1];
  RETURN jsonb_build_object('outcome', 'handled', 'booking_id', v_ids[1]);
END;
$$;
REVOKE ALL ON FUNCTION public.handle_agendapro_confirmation_reply(uuid, uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_agendapro_confirmation_reply(uuid, uuid, uuid, text, boolean) TO service_role;

-- Based on migration 196; use the same conversation lock as flow starts.
CREATE OR REPLACE FUNCTION public.accept_voice_reservation_recipient_response(
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
      AND contact_id = p_recipient_contact_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.flow_runs
    WHERE account_id = p_account_id AND conversation_id = p_conversation_id AND status = 'active') THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.agendapro_bookings
    WHERE account_id = p_account_id AND contact_id = p_recipient_contact_id
      AND confirmation_status = 'pending' AND start_time > clock_timestamp()
      AND (confirmation_reminder_status IN ('sending', 'sent') OR confirmation_review_required)
      AND (confirmation_reminder_status = 'sending'
        OR confirmation_reminder_conversation_id IS NULL
        OR confirmation_reminder_conversation_id = p_conversation_id)) THEN
    RETURN false;
  END IF;

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
