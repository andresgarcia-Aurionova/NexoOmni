-- AI turns are internal service-role records; customer message text is not stored here.
CREATE TABLE public.flow_ai_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_run_id uuid NOT NULL REFERENCES public.flow_runs(id) ON DELETE CASCADE,
  node_key text NOT NULL,
  inbound_message_id text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'handed_off')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  UNIQUE (flow_run_id, inbound_message_id)
);

CREATE UNIQUE INDEX flow_ai_turns_one_processing_per_run
  ON public.flow_ai_turns (flow_run_id) WHERE status = 'processing';
CREATE INDEX flow_ai_turns_processing_started_at
  ON public.flow_ai_turns (started_at) WHERE status = 'processing';

-- This table has no client policies: only the internal service role accesses it.
ALTER TABLE public.flow_ai_turns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flow_ai_turns FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.flow_ai_turns TO service_role;

CREATE FUNCTION public.claim_flow_ai_turn(
  p_account_id uuid,
  p_run_id uuid,
  p_node_key text,
  p_inbound_message_id text
) RETURNS TABLE (outcome text, turn_id uuid, turn_node_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.flow_runs%ROWTYPE;
  v_turn public.flow_ai_turns%ROWTYPE;
BEGIN
  IF p_account_id IS NULL OR p_run_id IS NULL OR p_node_key IS NULL
     OR p_inbound_message_id IS NULL OR length(p_inbound_message_id) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'Invalid AI flow turn' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM public.flow_runs
    WHERE id = p_run_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'stale'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_turn FROM public.flow_ai_turns
    WHERE flow_run_id = p_run_id AND inbound_message_id = p_inbound_message_id;
  IF FOUND THEN
    RETURN QUERY SELECT 'duplicate'::text, v_turn.id, v_turn.node_key;
    RETURN;
  END IF;

  IF v_run.status <> 'active' THEN
    RETURN QUERY SELECT 'stale'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_turn FROM public.flow_ai_turns
    WHERE flow_run_id = p_run_id AND status = 'processing';
  IF FOUND THEN
    UPDATE public.flow_ai_turns SET status = 'handed_off', finished_at = clock_timestamp()
      WHERE id = v_turn.id;
    UPDATE public.flow_runs SET status = 'handed_off', ended_at = clock_timestamp(),
      end_reason = 'ai_turn_interrupted' WHERE id = p_run_id;
    UPDATE public.conversations SET status = 'pending', updated_at = clock_timestamp()
      WHERE id = v_run.conversation_id AND account_id = p_account_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Flow conversation not found for AI handoff' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.flow_run_events (flow_run_id, event_type, node_key, payload)
      VALUES (p_run_id, 'handoff', v_turn.node_key, jsonb_build_object('reason', 'ai_turn_interrupted'));
    RETURN QUERY SELECT 'handed_off'::text, v_turn.id, v_turn.node_key;
    RETURN;
  END IF;

  IF v_run.current_node_key IS DISTINCT FROM p_node_key THEN
    RETURN QUERY SELECT 'stale'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  INSERT INTO public.flow_ai_turns (flow_run_id, node_key, inbound_message_id)
    VALUES (p_run_id, p_node_key, p_inbound_message_id) RETURNING * INTO v_turn;
  RETURN QUERY SELECT 'claimed'::text, v_turn.id, v_turn.node_key;
END;
$$;

CREATE FUNCTION public.is_flow_ai_turn_active(
  p_account_id uuid,
  p_run_id uuid,
  p_turn_id uuid,
  p_node_key text
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.flow_runs r
    JOIN public.flow_ai_turns t ON t.flow_run_id = r.id
    WHERE r.id = p_run_id AND r.account_id = p_account_id AND r.status = 'active'
      AND r.current_node_key IS NOT DISTINCT FROM p_node_key
      AND t.id = p_turn_id AND t.node_key = p_node_key AND t.status = 'processing'
  );
$$;

-- Finish after processing the inbound. The claim does not make an external
-- message send transactional; an interrupted send may still arrive late.
CREATE FUNCTION public.finish_flow_ai_turn(
  p_account_id uuid,
  p_run_id uuid,
  p_turn_id uuid,
  p_node_key text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.flow_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.flow_runs
    WHERE id = p_run_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE public.flow_ai_turns SET status = 'completed', finished_at = clock_timestamp()
    WHERE id = p_turn_id AND flow_run_id = p_run_id
      AND node_key = p_node_key AND status = 'processing';
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.handoff_flow_ai_turn(
  p_account_id uuid,
  p_run_id uuid,
  p_turn_id uuid,
  p_node_key text,
  p_stalled_only boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.flow_runs%ROWTYPE;
  v_turn public.flow_ai_turns%ROWTYPE;
  v_reason text;
BEGIN
  IF p_stalled_only IS NULL THEN
    RAISE EXCEPTION 'Invalid AI flow recovery mode' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM public.flow_runs
    WHERE id = p_run_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND OR v_run.status <> 'active' THEN
    RETURN false;
  END IF;
  SELECT * INTO v_turn FROM public.flow_ai_turns
    WHERE id = p_turn_id AND flow_run_id = p_run_id
      AND node_key = p_node_key AND status = 'processing' FOR UPDATE;
  IF NOT FOUND OR (p_stalled_only AND v_turn.started_at > clock_timestamp() - interval '3 minutes') THEN
    RETURN false;
  END IF;

  v_reason := CASE WHEN p_stalled_only THEN 'ai_turn_stalled' ELSE 'ai_turn_interrupted' END;
  UPDATE public.flow_ai_turns SET status = 'handed_off', finished_at = clock_timestamp()
    WHERE id = p_turn_id;
  UPDATE public.flow_runs SET status = 'handed_off', ended_at = clock_timestamp(), end_reason = v_reason
    WHERE id = p_run_id;
  UPDATE public.conversations SET status = 'pending', updated_at = clock_timestamp()
    WHERE id = v_run.conversation_id AND account_id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flow conversation not found for AI handoff' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.flow_run_events (flow_run_id, event_type, node_key, payload)
    VALUES (p_run_id, 'handoff', p_node_key, jsonb_build_object('reason', v_reason));
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_flow_ai_turn(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_flow_ai_turn(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_flow_ai_turn_active(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handoff_flow_ai_turn(uuid, uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_flow_ai_turn(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_flow_ai_turn(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_flow_ai_turn_active(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.handoff_flow_ai_turn(uuid, uuid, uuid, text, boolean) TO service_role;
