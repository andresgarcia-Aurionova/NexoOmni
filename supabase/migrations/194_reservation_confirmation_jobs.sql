-- Only voice reservations opt in; existing appointments keep their behavior.
ALTER TABLE public.appointments
  ADD COLUMN reservation_restaurant text
    CHECK (reservation_restaurant IS NULL OR reservation_restaurant IN ('A', 'B', 'C'));

ALTER TABLE public.reservation_alert_settings
  ADD COLUMN confirmation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN confirmation_template_name text NOT NULL DEFAULT 'confirmacion_reservacion'
    CHECK (confirmation_template_name ~ '^[a-z0-9_]+$' AND length(confirmation_template_name) <= 512),
  ADD COLUMN confirmation_template_language text NOT NULL DEFAULT 'es_MX'
    CHECK (confirmation_template_language ~ '^[a-z]{2}(_[A-Z]{2})?$');

CREATE TABLE public.reservation_confirmation_jobs (
  appointment_id uuid PRIMARY KEY REFERENCES public.appointments(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'scheduled', 'processing', 'sending', 'sent', 'failed', 'skipped')),
  due_at timestamptz NOT NULL DEFAULT now(),
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  sent_at timestamptz,
  response text CHECK (response IN ('yes', 'no')),
  responded_at timestamptz,
  response_memory_at timestamptz,
  failure_notice_at timestamptz,
  response_notice_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reservation_confirmation_due_idx
  ON public.reservation_confirmation_jobs (due_at)
  WHERE state IN ('queued', 'scheduled');
CREATE INDEX reservation_confirmation_conversation_idx
  ON public.reservation_confirmation_jobs (account_id, conversation_id)
  WHERE state = 'sent' AND response IS NULL;
CREATE INDEX reservation_confirmation_claim_idx
  ON public.reservation_confirmation_jobs (updated_at)
  WHERE state IN ('processing', 'sending');
CREATE INDEX reservation_confirmation_failure_notice_idx
  ON public.reservation_confirmation_jobs (created_at)
  WHERE state = 'failed' AND failure_notice_at IS NULL;
CREATE INDEX reservation_confirmation_decline_notice_idx
  ON public.reservation_confirmation_jobs (created_at)
  WHERE state = 'sent' AND response = 'no' AND response_notice_at IS NULL;
CREATE INDEX reservation_confirmation_response_memory_idx
  ON public.reservation_confirmation_jobs (created_at)
  WHERE state = 'sent' AND response IS NOT NULL AND response_memory_at IS NULL;

ALTER TABLE public.reservation_confirmation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_confirmation_jobs FROM PUBLIC, anon, authenticated;
CREATE POLICY reservation_confirmation_member_select ON public.reservation_confirmation_jobs
  FOR SELECT USING (public.is_account_member(account_id));
GRANT SELECT ON public.reservation_confirmation_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reservation_confirmation_jobs TO service_role;

CREATE TABLE public.reservation_confirmation_notices (
  appointment_id uuid NOT NULL REFERENCES public.reservation_confirmation_jobs(appointment_id) ON DELETE CASCADE,
  revision integer NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (appointment_id, revision, kind)
);
-- The internal worker is the only writer and reader of delivery receipts.
ALTER TABLE public.reservation_confirmation_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_confirmation_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.reservation_confirmation_notices TO service_role;

CREATE TABLE public.reservation_confirmation_decline_outbox (
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  PRIMARY KEY (appointment_id, revision)
);
CREATE INDEX reservation_confirmation_decline_outbox_pending_idx
  ON public.reservation_confirmation_decline_outbox (created_at) WHERE delivered_at IS NULL;
ALTER TABLE public.reservation_confirmation_decline_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_confirmation_decline_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reservation_confirmation_decline_outbox TO service_role;

CREATE FUNCTION public.deliver_voice_reservation_decline(p_appointment_id uuid, p_revision integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_notice public.reservation_confirmation_decline_outbox%ROWTYPE;
  v_recipients integer;
BEGIN
  SELECT * INTO v_notice FROM public.reservation_confirmation_decline_outbox
    WHERE appointment_id = p_appointment_id AND revision = p_revision AND delivered_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.notifications (account_id, user_id, type, contact_id, title, body)
    SELECT v_notice.account_id, p.user_id, 'nexo_memory_alert', v_notice.contact_id, v_notice.title, v_notice.body
      FROM public.profiles p
      WHERE p.account_id = v_notice.account_id AND p.is_active = true AND p.account_role IN ('owner', 'admin');
  GET DIAGNOSTICS v_recipients = ROW_COUNT;
  IF v_recipients = 0 THEN RAISE EXCEPTION 'No active account administrator for reservation notification'; END IF;
  UPDATE public.reservation_confirmation_decline_outbox SET delivered_at = now()
    WHERE appointment_id = p_appointment_id AND revision = p_revision;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.deliver_voice_reservation_decline(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_voice_reservation_decline(uuid, integer) TO service_role;

CREATE FUNCTION public.notify_reservation_confirmation(
  p_appointment_id uuid, p_account_id uuid, p_revision integer, p_kind text, p_title text, p_body text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_contact_id uuid;
  v_inserted integer;
  v_recipients integer;
BEGIN
  SELECT a.contact_id INTO v_contact_id
    FROM public.appointments a
    JOIN public.reservation_confirmation_jobs j ON j.appointment_id = a.id
    WHERE a.id = p_appointment_id AND a.account_id = p_account_id AND j.revision = p_revision;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.reservation_confirmation_notices (appointment_id, revision, kind)
    VALUES (p_appointment_id, p_revision, p_kind) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN RETURN false; END IF;
  INSERT INTO public.notifications (account_id, user_id, type, contact_id, title, body)
    SELECT p_account_id, p.user_id, 'nexo_memory_alert', v_contact_id, p_title, p_body
      FROM public.profiles p
      WHERE p.account_id = p_account_id AND p.is_active = true AND p.account_role IN ('owner', 'admin');
  GET DIAGNOSTICS v_recipients = ROW_COUNT;
  IF v_recipients = 0 THEN RAISE EXCEPTION 'No active account administrator for reservation notification'; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_reservation_confirmation(uuid, uuid, integer, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_reservation_confirmation(uuid, uuid, integer, text, text, text) TO service_role;

CREATE FUNCTION public.record_voice_reservation_memory(
  p_account_id uuid, p_appointment_id uuid, p_contact_id uuid, p_summary text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_summary IS NULL OR p_summary NOT LIKE 'Reservación en Restaurante %' THEN
    RAISE EXCEPTION 'Invalid reservation memory summary';
  END IF;
  PERFORM 1 FROM public.appointments
    WHERE id = p_appointment_id AND account_id = p_account_id
      AND contact_id = p_contact_id AND reservation_restaurant IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation contact does not match'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_appointment_id::text || ':' || p_contact_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.contact_memory_events
    WHERE account_id = p_account_id AND contact_id = p_contact_id
      AND source_type = 'manual' AND source_id = p_appointment_id
      AND summary LIKE 'Reservación en Restaurante %'
  ) THEN RETURN false; END IF;
  INSERT INTO public.contact_memory_events
    (account_id, contact_id, event_type, summary, importance, confidence, source_type, source_id)
    VALUES (p_account_id, p_contact_id, 'manual', left(p_summary, 500), 'normal', 1, 'manual', p_appointment_id);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_voice_reservation_memory(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_voice_reservation_memory(uuid, uuid, uuid, text) TO service_role;

CREATE FUNCTION public.record_voice_reservation_response(
  p_account_id uuid, p_appointment_id uuid, p_revision integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_contact_id uuid;
  v_response text;
  v_recorded_at timestamptz;
BEGIN
  SELECT a.contact_id, j.response, j.response_memory_at
    INTO v_contact_id, v_response, v_recorded_at
    FROM public.reservation_confirmation_jobs j
    JOIN public.appointments a ON a.id = j.appointment_id AND a.account_id = j.account_id
    WHERE j.appointment_id = p_appointment_id AND j.account_id = p_account_id
      AND j.revision = p_revision AND j.state = 'sent'
    FOR UPDATE OF j;
  IF NOT FOUND OR v_response IS NULL OR v_recorded_at IS NOT NULL THEN RETURN false; END IF;
  IF v_contact_id IS NULL THEN RAISE EXCEPTION 'Reservation response has no contact'; END IF;
  INSERT INTO public.contact_memory_events
    (account_id, contact_id, event_type, summary, importance, confidence, source_type, source_id)
    VALUES (p_account_id, v_contact_id, 'manual',
      CASE WHEN v_response = 'yes' THEN 'El cliente confirmó su asistencia a la reservación por WhatsApp.'
        ELSE 'El cliente indicó por WhatsApp que no puede asistir a la reservación.' END,
      'normal', 1, 'manual', p_appointment_id);
  UPDATE public.reservation_confirmation_jobs SET response_memory_at = now()
    WHERE appointment_id = p_appointment_id AND account_id = p_account_id AND revision = p_revision;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_voice_reservation_response(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_voice_reservation_response(uuid, uuid, integer) TO service_role;

CREATE FUNCTION public.accept_voice_reservation_response(
  p_account_id uuid, p_appointment_id uuid, p_revision integer, p_contact_id uuid,
  p_conversation_id uuid, p_response text, p_notice_title text, p_notice_body text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_response IS NULL OR p_response NOT IN ('yes', 'no') THEN
    RAISE EXCEPTION 'Invalid reservation response';
  END IF;
  -- Match the appointment-before-job lock order used by appointment update triggers.
  PERFORM 1 FROM public.appointments
    WHERE id = p_appointment_id AND account_id = p_account_id AND contact_id = p_contact_id
      AND starts_at > now() AND status NOT IN ('cancelled', 'completed', 'no_show')
      AND reservation_restaurant IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.reservation_confirmation_jobs
    SET response = p_response, responded_at = now(), updated_at = now()
    WHERE appointment_id = p_appointment_id AND account_id = p_account_id
      AND revision = p_revision AND state = 'sent' AND response IS NULL
      AND conversation_id = p_conversation_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT public.record_voice_reservation_response(p_account_id, p_appointment_id, p_revision) THEN
    RAISE EXCEPTION 'Could not record reservation response in memory';
  END IF;
  IF p_response = 'no' THEN
    INSERT INTO public.reservation_confirmation_decline_outbox
      (appointment_id, revision, account_id, contact_id, title, body)
      VALUES (p_appointment_id, p_revision, p_account_id, p_contact_id, p_notice_title, p_notice_body);
    UPDATE public.reservation_confirmation_jobs SET response_notice_at = now()
      WHERE appointment_id = p_appointment_id AND account_id = p_account_id AND revision = p_revision;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_voice_reservation_response(uuid, uuid, integer, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_voice_reservation_response(uuid, uuid, integer, uuid, uuid, text, text, text) TO service_role;

-- Maintain the job in the appointment transaction, including Google/API edits.
CREATE FUNCTION public.sync_voice_reservation_confirmation_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.reservation_restaurant IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.reservation_restaurant IS NOT NULL THEN
      UPDATE public.reservation_confirmation_jobs
        SET revision = revision + 1,
            state = CASE WHEN state IN ('sending', 'failed') THEN 'failed' ELSE 'skipped' END,
            error_message = CASE WHEN state = 'sending' THEN 'La reserva cambió durante el envío.'
              WHEN state = 'failed' THEN error_message ELSE NULL END,
            failure_notice_at = CASE WHEN state = 'failed' THEN failure_notice_at ELSE NULL END,
            updated_at = now()
        WHERE appointment_id = NEW.id AND account_id = NEW.account_id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR OLD.reservation_restaurant IS NULL THEN
    INSERT INTO public.reservation_confirmation_jobs (appointment_id, account_id, state)
    VALUES (NEW.id, NEW.account_id,
      CASE WHEN NEW.status IN ('cancelled', 'completed', 'no_show') THEN 'skipped' ELSE 'queued' END)
    ON CONFLICT (appointment_id) DO UPDATE
      SET revision = public.reservation_confirmation_jobs.revision + 1,
          state = EXCLUDED.state, due_at = now(), conversation_id = NULL, sent_at = NULL,
          response = NULL, responded_at = NULL, response_memory_at = NULL, failure_notice_at = NULL, response_notice_at = NULL,
          error_message = NULL, updated_at = now();
  ELSIF NEW.starts_at IS DISTINCT FROM OLD.starts_at
      OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.reservation_restaurant IS DISTINCT FROM OLD.reservation_restaurant THEN
    UPDATE public.reservation_confirmation_jobs
      SET revision = revision + 1,
          state = CASE WHEN state IN ('sending', 'failed') THEN 'failed'
            WHEN NEW.status IN ('cancelled', 'completed', 'no_show') THEN 'skipped' ELSE 'queued' END,
          due_at = now(), conversation_id = NULL, sent_at = NULL,
          response = NULL, responded_at = NULL, response_memory_at = NULL,
          failure_notice_at = CASE WHEN state = 'failed' THEN failure_notice_at ELSE NULL END,
          response_notice_at = NULL,
          error_message = CASE WHEN state = 'sending' THEN 'La reserva cambió durante el envío.'
            WHEN state = 'failed' THEN error_message ELSE NULL END,
          updated_at = now()
      WHERE appointment_id = NEW.id AND account_id = NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_voice_reservation_confirmation_job() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER voice_reservation_confirmation_insert
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.sync_voice_reservation_confirmation_job();
CREATE TRIGGER voice_reservation_confirmation_update
  AFTER UPDATE OF starts_at, contact_id, status, title, reservation_restaurant ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.sync_voice_reservation_confirmation_job();

CREATE FUNCTION public.refresh_voice_reservation_confirmation_jobs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_account_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.account_id ELSE NEW.account_id END;
BEGIN
  IF TG_TABLE_NAME = 'reservation_alert_settings' AND TG_OP = 'UPDATE' THEN
    IF NEW.confirmation_enabled IS NOT DISTINCT FROM OLD.confirmation_enabled
      AND NEW.confirmation_template_name IS NOT DISTINCT FROM OLD.confirmation_template_name
      AND NEW.confirmation_template_language IS NOT DISTINCT FROM OLD.confirmation_template_language THEN
      RETURN NEW;
    END IF;
  END IF;
  UPDATE public.reservation_confirmation_jobs j
    SET revision = j.revision + 1, state = CASE WHEN j.state = 'sending' THEN 'failed' ELSE 'queued' END,
        due_at = now(), failure_notice_at = NULL,
        error_message = CASE WHEN j.state = 'sending' THEN 'La configuración cambió durante el envío.' ELSE NULL END,
        updated_at = now()
    FROM public.appointments a
    WHERE j.appointment_id = a.id AND j.account_id = v_account_id
      AND j.state IN ('queued', 'scheduled', 'processing', 'sending', 'skipped')
      AND a.starts_at > now() AND a.status NOT IN ('cancelled', 'completed', 'no_show')
      AND a.reservation_restaurant IS NOT NULL;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_voice_reservation_confirmation_jobs() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER voice_reservation_confirmation_settings
  AFTER INSERT OR UPDATE OF confirmation_enabled, confirmation_template_name, confirmation_template_language
  ON public.reservation_alert_settings
  FOR EACH ROW EXECUTE FUNCTION public.refresh_voice_reservation_confirmation_jobs();
CREATE TRIGGER voice_reservation_confirmation_hours
  AFTER INSERT OR UPDATE OR DELETE ON public.connected_whatsapp_business_hours
  FOR EACH ROW EXECUTE FUNCTION public.refresh_voice_reservation_confirmation_jobs();

CREATE FUNCTION public.refresh_contact_reservation_confirmation_jobs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.reservation_confirmation_jobs j
    SET revision = j.revision + 1, state = CASE WHEN j.state = 'sending' THEN 'failed' ELSE 'queued' END,
        due_at = now(), failure_notice_at = NULL,
        error_message = CASE WHEN j.state = 'sending' THEN 'El teléfono cambió durante el envío.' ELSE NULL END,
        updated_at = now()
    FROM public.appointments a
    WHERE j.appointment_id = a.id AND j.account_id = NEW.account_id AND a.contact_id = NEW.id
      AND j.state IN ('queued', 'scheduled', 'processing', 'sending', 'skipped')
      AND a.starts_at > now() AND a.status NOT IN ('cancelled', 'completed', 'no_show')
      AND a.reservation_restaurant IS NOT NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_contact_reservation_confirmation_jobs() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER voice_reservation_confirmation_contact_phone
  AFTER UPDATE OF phone ON public.contacts
  FOR EACH ROW WHEN (OLD.phone IS DISTINCT FROM NEW.phone)
  EXECUTE FUNCTION public.refresh_contact_reservation_confirmation_jobs();
