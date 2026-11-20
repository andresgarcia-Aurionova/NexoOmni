-- Internal receipts prevent a retried flow step from creating another appointment.
-- No client policies: flow state is updated only by the internal service role.
CREATE FUNCTION public.update_flow_run_vars_if_current(
  p_account_id uuid,
  p_run_id uuid,
  p_expected_node_key text,
  p_expected_vars jsonb,
  p_new_vars jsonb,
  p_reset_reprompts boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF jsonb_typeof(p_expected_vars) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_new_vars) IS DISTINCT FROM 'object'
     OR p_reset_reprompts IS NULL THEN
    RAISE EXCEPTION 'Invalid flow state' USING ERRCODE = '22023';
  END IF;
  UPDATE public.flow_runs
    SET vars = p_new_vars,
        reprompt_count = CASE WHEN p_reset_reprompts THEN 0 ELSE reprompt_count END,
        last_advanced_at = clock_timestamp()
    WHERE id = p_run_id AND account_id = p_account_id AND status = 'active'
      AND current_node_key IS NOT DISTINCT FROM p_expected_node_key
      AND vars = p_expected_vars;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.update_flow_run_vars_if_current(uuid, uuid, text, jsonb, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_flow_run_vars_if_current(uuid, uuid, text, jsonb, jsonb, boolean)
  TO service_role;

CREATE FUNCTION public.prepare_guarded_appointment_offer(
  p_account_id uuid,
  p_run_id uuid,
  p_expected_node_key text,
  p_expected_vars jsonb,
  p_offer_node_key text,
  p_new_vars jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token text;
BEGIN
  v_token := p_new_vars->>('__offer_token_' || p_offer_node_key);
  IF p_offer_node_key IS NULL OR jsonb_typeof(p_expected_vars) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_new_vars) IS DISTINCT FROM 'object'
     OR p_new_vars->'__guarded_appointments' IS DISTINCT FROM 'true'::jsonb
     OR v_token IS NULL
     OR p_new_vars->>('__offer_pending_' || p_offer_node_key) IS DISTINCT FROM v_token
     OR p_new_vars ? ('__offer_claim_' || p_offer_node_key)
     OR jsonb_typeof(p_new_vars->('__slots_' || p_offer_node_key)) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_new_vars->('__slots_' || p_offer_node_key)) = 0 THEN
    RAISE EXCEPTION 'Invalid guarded offer' USING ERRCODE = '22023';
  END IF;
  UPDATE public.flow_runs r
    SET vars = p_new_vars, current_node_key = p_offer_node_key, last_advanced_at = clock_timestamp()
    WHERE r.id = p_run_id AND r.account_id = p_account_id AND r.status = 'active'
      AND r.current_node_key IS NOT DISTINCT FROM p_expected_node_key AND r.vars = p_expected_vars
      AND r.vars->'__guarded_appointments' = 'true'::jsonb
      AND EXISTS (
        SELECT 1 FROM public.flow_nodes offer
        JOIN public.flow_nodes booking ON booking.flow_id = offer.flow_id
          AND booking.node_key = offer.config->>'next_node_key'
        WHERE offer.flow_id = r.flow_id AND offer.node_key = p_offer_node_key
          AND offer.node_type = 'offer_slots' AND booking.node_type = 'book_appointment'
          AND booking.config->'idempotent_booking' = 'true'::jsonb
      );
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_guarded_appointment_offer(uuid, uuid, text, jsonb, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_guarded_appointment_offer(uuid, uuid, text, jsonb, text, jsonb)
  TO service_role;

CREATE FUNCTION public.apply_guarded_offer_fallback(
  p_account_id uuid,
  p_run_id uuid,
  p_expected_node_key text,
  p_expected_vars jsonb,
  p_expected_reprompt_count integer,
  p_new_reprompt_count integer,
  p_action text,
  p_reason text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.flow_runs%ROWTYPE;
  v_token text;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('reprompt', 'ignore', 'handoff', 'end')
     OR p_reason IS NULL OR p_reason NOT IN ('fallback', 'selection_failed', 'reprompt_failed', 'offer_send_failed')
     OR jsonb_typeof(p_expected_vars) IS DISTINCT FROM 'object'
     OR p_expected_reprompt_count IS NULL OR p_new_reprompt_count IS NULL
     OR p_new_reprompt_count NOT BETWEEN p_expected_reprompt_count AND p_expected_reprompt_count + 1 THEN
    RAISE EXCEPTION 'Invalid guarded offer action' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM public.flow_runs
    WHERE id = p_run_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND OR v_run.status <> 'active'
     OR v_run.current_node_key IS DISTINCT FROM p_expected_node_key
     OR v_run.vars IS DISTINCT FROM p_expected_vars
     OR v_run.reprompt_count IS DISTINCT FROM p_expected_reprompt_count
     OR v_run.vars->'__guarded_appointments' IS DISTINCT FROM 'true'::jsonb THEN
    RETURN false;
  END IF;
  v_token := v_run.vars->>('__offer_token_' || p_expected_node_key);
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'Guarded flow offer token is missing' USING ERRCODE = '22023';
  END IF;
  IF v_run.vars->>('__offer_claim_' || p_expected_node_key) = v_token
     OR NOT EXISTS (
       SELECT 1 FROM public.flow_nodes offer
       JOIN public.flow_nodes booking ON booking.flow_id = offer.flow_id
         AND booking.node_key = offer.config->>'next_node_key'
       WHERE offer.flow_id = v_run.flow_id AND offer.node_key = p_expected_node_key
         AND offer.node_type = 'offer_slots' AND booking.node_type = 'book_appointment'
         AND booking.config->'idempotent_booking' = 'true'::jsonb
     ) THEN
    RETURN false;
  END IF;

  UPDATE public.flow_runs
    SET reprompt_count = p_new_reprompt_count,
        status = CASE p_action WHEN 'handoff' THEN 'handed_off' WHEN 'end' THEN 'completed' ELSE status END,
        ended_at = CASE WHEN p_action IN ('handoff', 'end') THEN clock_timestamp() ELSE ended_at END,
        end_reason = CASE WHEN p_action = 'handoff' THEN p_reason
          WHEN p_action = 'end' THEN 'fallback_exhausted_end' ELSE end_reason END
    WHERE id = p_run_id;
  IF p_action = 'handoff' THEN
    UPDATE public.conversations SET status = 'pending', updated_at = clock_timestamp()
      WHERE id = v_run.conversation_id AND account_id = p_account_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Flow conversation not found for handoff' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.flow_run_events (flow_run_id, event_type, node_key, payload)
      VALUES (p_run_id, 'handoff', p_expected_node_key, jsonb_build_object('reason', p_reason));
  END IF;
  IF p_reason = 'fallback' THEN
    INSERT INTO public.flow_run_events (flow_run_id, event_type, node_key, payload)
      VALUES (p_run_id, 'fallback_fired', p_expected_node_key,
        jsonb_build_object('action', p_action, 'reprompt_count', p_new_reprompt_count));
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_guarded_offer_fallback(uuid, uuid, text, jsonb, integer, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_guarded_offer_fallback(uuid, uuid, text, jsonb, integer, integer, text, text)
  TO service_role;

CREATE FUNCTION public.handoff_guarded_appointment_send_failure(
  p_account_id uuid,
  p_run_id uuid,
  p_expected_node_key text,
  p_expected_vars jsonb,
  p_message_node_key text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.flow_runs%ROWTYPE;
  v_token text;
BEGIN
  SELECT * INTO v_run FROM public.flow_runs
    WHERE id = p_run_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND OR v_run.status <> 'active'
     OR v_run.current_node_key IS DISTINCT FROM p_expected_node_key
     OR v_run.vars IS DISTINCT FROM p_expected_vars
     OR v_run.vars->'__guarded_appointments' IS DISTINCT FROM 'true'::jsonb THEN
    RETURN false;
  END IF;
  v_token := v_run.vars->>('__offer_token_' || p_expected_node_key);
  IF v_token IS NULL OR v_run.vars->>('__offer_claim_' || p_expected_node_key) IS DISTINCT FROM v_token THEN
    RETURN false;
  END IF;
  UPDATE public.flow_runs SET status = 'handed_off', ended_at = clock_timestamp(),
    end_reason = 'appointment_message_send_failed' WHERE id = p_run_id;
  UPDATE public.conversations SET status = 'pending', updated_at = clock_timestamp()
    WHERE id = v_run.conversation_id AND account_id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flow conversation not found for handoff' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.flow_run_events (flow_run_id, event_type, node_key, payload)
    VALUES (p_run_id, 'handoff', p_message_node_key, '{"reason":"appointment_message_send_failed"}'::jsonb);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.handoff_guarded_appointment_send_failure(uuid, uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handoff_guarded_appointment_send_failure(uuid, uuid, text, jsonb, text)
  TO service_role;

CREATE FUNCTION public.handoff_stalled_flow_appointment(
  p_run_id uuid,
  p_expected_node_key text,
  p_expected_offer_token text,
  p_expected_advanced_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.flow_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.flow_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status <> 'active'
     OR v_run.current_node_key IS DISTINCT FROM p_expected_node_key
     OR v_run.last_advanced_at IS DISTINCT FROM p_expected_advanced_at
     OR v_run.last_advanced_at > clock_timestamp() - interval '3 minutes'
     OR v_run.vars->'__guarded_appointments' IS DISTINCT FROM 'true'::jsonb
     OR p_expected_offer_token IS NULL
     OR v_run.vars->>('__offer_token_' || p_expected_node_key) IS DISTINCT FROM p_expected_offer_token
     OR (v_run.vars->>('__offer_claim_' || p_expected_node_key) IS DISTINCT FROM p_expected_offer_token
       AND v_run.vars->>('__offer_pending_' || p_expected_node_key) IS DISTINCT FROM p_expected_offer_token) THEN
    RETURN false;
  END IF;
  UPDATE public.flow_runs
    SET status = 'handed_off', ended_at = clock_timestamp(), end_reason = 'appointment_claim_stalled'
    WHERE id = p_run_id;
  UPDATE public.conversations SET status = 'pending', updated_at = clock_timestamp()
    WHERE id = v_run.conversation_id AND account_id = v_run.account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flow conversation not found for handoff' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.flow_run_events (flow_run_id, event_type, node_key, payload)
    VALUES (p_run_id, 'handoff', p_expected_node_key, '{"reason":"appointment_claim_stalled"}'::jsonb);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.handoff_stalled_flow_appointment(uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handoff_stalled_flow_appointment(uuid, text, text, timestamptz)
  TO service_role;

CREATE TABLE public.flow_appointment_receipts (
  flow_run_id uuid NOT NULL REFERENCES public.flow_runs(id) ON DELETE CASCADE,
  node_key text NOT NULL,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  PRIMARY KEY (flow_run_id, node_key)
);

ALTER TABLE public.flow_appointment_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flow_appointment_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_appointment_receipts TO service_role;

CREATE FUNCTION public.book_flow_appointment_once(
  p_account_id uuid,
  p_run_id uuid,
  p_node_key text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_specialist_id uuid,
  p_title text,
  p_notes text,
  p_timezone text,
  p_has_conflict boolean,
  p_expected_node_key text,
  p_expected_offer_token uuid
) RETURNS TABLE (result text, appointment_id uuid, starts_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.flow_runs%ROWTYPE;
  v_config jsonb;
  v_receipt public.flow_appointment_receipts%ROWTYPE;
  v_appointment public.appointments%ROWTYPE;
  v_duration integer;
  v_slot text;
BEGIN
  SELECT * INTO v_run FROM public.flow_runs
    WHERE id = p_run_id AND account_id = p_account_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flow run not found' USING ERRCODE = '22023';
  END IF;

  SELECT config INTO v_config FROM public.flow_nodes
    WHERE flow_id = v_run.flow_id AND node_key = p_node_key AND node_type = 'book_appointment';
  IF v_run.status <> 'active' OR v_run.current_node_key IS DISTINCT FROM p_expected_node_key
     OR v_run.contact_id IS NULL OR v_run.conversation_id IS NULL
     OR v_run.vars->'__guarded_appointments' IS DISTINCT FROM 'true'::jsonb
     OR v_config IS NULL OR v_config->'idempotent_booking' IS DISTINCT FROM 'true'::jsonb
     OR p_expected_offer_token IS NULL
     OR v_run.vars->>('__offer_token_' || p_expected_node_key) IS DISTINCT FROM p_expected_offer_token::text
     OR NOT EXISTS (SELECT 1 FROM public.flow_nodes
       WHERE flow_id = v_run.flow_id AND node_key = p_expected_node_key
         AND node_type = 'offer_slots' AND config->>'next_node_key' = p_node_key)
     OR v_run.vars->>('__offer_claim_' || p_expected_node_key) IS DISTINCT FROM p_expected_offer_token::text
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(v_run.vars->('__slots_' || p_expected_node_key)) = 'array'
           THEN v_run.vars->('__slots_' || p_expected_node_key) ELSE '[]'::jsonb END
       ) AS offered(slot)
       WHERE (offered.slot->>'start')::timestamptz = p_starts_at
     )
     OR p_starts_at IS NULL OR p_ends_at IS NULL OR p_starts_at <= clock_timestamp()
     OR p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 160
     OR p_timezone IS NULL OR btrim(p_timezone) = '' OR p_has_conflict IS NULL THEN
    RETURN QUERY SELECT 'stale'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  v_slot := v_run.vars->>(v_config->>'slot_var_key');
  v_duration := least(480, greatest(5, coalesce((v_config->>'duration_minutes')::integer, 30)));
  IF v_slot IS NULL OR v_slot::timestamptz IS DISTINCT FROM p_starts_at
     OR p_ends_at IS DISTINCT FROM p_starts_at + make_interval(mins => v_duration)
     OR nullif(v_config->>'specialist_id', '')::uuid IS DISTINCT FROM p_specialist_id THEN
    RETURN QUERY SELECT 'stale'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_receipt FROM public.flow_appointment_receipts
    WHERE flow_run_id = p_run_id AND node_key = p_node_key;
  IF FOUND THEN
    SELECT * INTO v_appointment FROM public.appointments
      WHERE id = v_receipt.appointment_id AND account_id = p_account_id;
    IF FOUND AND v_appointment.status IN ('scheduled', 'confirmed')
       AND v_appointment.contact_id = v_run.contact_id
       AND v_appointment.source_conversation_id = v_run.conversation_id
       AND v_appointment.starts_at = p_starts_at AND v_appointment.ends_at = p_ends_at
       AND v_appointment.specialist_id IS NOT DISTINCT FROM p_specialist_id THEN
      RETURN QUERY SELECT 'already_booked'::text, v_appointment.id, v_appointment.starts_at;
    ELSE
      RETURN QUERY SELECT 'stale'::text, NULL::uuid, NULL::timestamptz;
    END IF;
    RETURN;
  END IF;
  IF p_has_conflict THEN
    RETURN QUERY SELECT 'conflict'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.appointments (
      account_id, created_by, contact_id, source_conversation_id, specialist_id,
      title, notes, starts_at, ends_at, timezone
    ) VALUES (
      p_account_id, v_run.user_id, v_run.contact_id, v_run.conversation_id, p_specialist_id,
      p_title, p_notes, p_starts_at, p_ends_at, p_timezone
    ) RETURNING * INTO v_appointment;
  EXCEPTION WHEN exclusion_violation THEN
    RETURN QUERY SELECT 'conflict'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END;
  INSERT INTO public.flow_appointment_receipts (flow_run_id, node_key, appointment_id)
    VALUES (p_run_id, p_node_key, v_appointment.id);
  IF p_starts_at - interval '1 hour' > clock_timestamp() THEN
    INSERT INTO public.appointment_reminders (account_id, appointment_id, due_at)
      VALUES (p_account_id, v_appointment.id, p_starts_at - interval '1 hour');
  END IF;
  RETURN QUERY SELECT 'booked'::text, v_appointment.id, v_appointment.starts_at;
END;
$$;

REVOKE ALL ON FUNCTION public.book_flow_appointment_once(uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text, boolean, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_flow_appointment_once(uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text, boolean, text, uuid)
  TO service_role;
