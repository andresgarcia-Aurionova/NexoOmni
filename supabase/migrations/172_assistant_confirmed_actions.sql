CREATE TABLE public.assistant_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL,
  source_message_id uuid NOT NULL REFERENCES public.assistant_messages(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN (
    'create_follow_up_task',
    'schedule_appointment',
    'update_contact',
    'send_whatsapp_text'
  )),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND pg_column_size(payload) <= 32768
  ),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'executing', 'completed', 'failed', 'cancelled', 'expired', 'needs_review'
  )),
  result jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (thread_id, account_id, user_id)
    REFERENCES public.assistant_threads(id, account_id, user_id) ON DELETE CASCADE,
  UNIQUE (source_message_id),
  UNIQUE (id, account_id)
);

CREATE INDEX assistant_action_requests_owner_idx
  ON public.assistant_action_requests(account_id, user_id, created_at DESC);
ALTER TABLE public.assistant_action_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assistant_action_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.assistant_action_requests TO service_role;

CREATE TABLE public.assistant_action_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_request_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  actor_user_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'proposed', 'confirmed', 'cancelled', 'completed', 'failed', 'expired', 'needs_review'
  )),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata) = 'object'
    AND pg_column_size(metadata) <= 4096
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- This append-only record deliberately survives a user deleting the assistant thread.

CREATE INDEX assistant_action_audit_request_idx
  ON public.assistant_action_audit_events(action_request_id, created_at);
ALTER TABLE public.assistant_action_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assistant_action_audit_events FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.prevent_assistant_action_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Assistant action audit events are immutable';
END;
$$;

CREATE TRIGGER assistant_action_audit_immutable
  BEFORE UPDATE ON public.assistant_action_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_assistant_action_audit_mutation();

ALTER TABLE public.assistant_messages
  ADD COLUMN action_request_id uuid;
CREATE UNIQUE INDEX assistant_messages_action_request_idx
  ON public.assistant_messages(action_request_id)
  WHERE action_request_id IS NOT NULL;

CREATE FUNCTION public.record_ai_assistant_turn_with_action(
  p_account_id uuid,
  p_user_id uuid,
  p_thread_id uuid,
  p_user_message_id uuid,
  p_content text,
  p_sources jsonb,
  p_provider text,
  p_model text,
  p_prompt_tokens integer,
  p_completion_tokens integer,
  p_total_tokens integer,
  p_latency_ms integer,
  p_cost_nano_usd bigint,
  p_price_nano_usd bigint,
  p_credits bigint,
  p_idempotency_key text,
  p_report_data jsonb,
  p_action_type text,
  p_action_payload jsonb
)
RETURNS TABLE (
  result text,
  available_credits bigint,
  assistant_message_id uuid,
  action_request_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_turn record;
  v_action public.assistant_action_requests%ROWTYPE;
  v_inserted integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF (p_action_type IS NULL) <> (p_action_payload IS NULL)
     OR (p_action_type IS NOT NULL AND p_action_type NOT IN (
       'create_follow_up_task', 'schedule_appointment', 'update_contact', 'send_whatsapp_text'
     ))
     OR (p_action_payload IS NOT NULL AND (
       jsonb_typeof(p_action_payload) <> 'object'
       OR pg_column_size(p_action_payload) > 32768
       OR p_action_payload->'action'->>'action_type' IS DISTINCT FROM p_action_type
     )) THEN
    RAISE EXCEPTION 'Invalid assistant action proposal' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_turn
  FROM public.record_ai_assistant_turn_with_report(
    p_account_id, p_user_id, p_thread_id, p_user_message_id, p_content,
    p_sources, p_provider, p_model, p_prompt_tokens, p_completion_tokens,
    p_total_tokens, p_latency_ms, p_cost_nano_usd, p_price_nano_usd,
    p_credits, p_idempotency_key, p_report_data
  );

  IF p_action_type IS NOT NULL AND v_turn.assistant_message_id IS NOT NULL THEN
    INSERT INTO public.assistant_action_requests (
      account_id, user_id, thread_id, source_message_id, action_type, payload
    ) VALUES (
      p_account_id, p_user_id, p_thread_id, p_user_message_id, p_action_type, p_action_payload
    ) ON CONFLICT (source_message_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    SELECT * INTO v_action
    FROM public.assistant_action_requests
    WHERE source_message_id = p_user_message_id
    FOR UPDATE;

    IF v_action.account_id <> p_account_id
       OR v_action.user_id <> p_user_id
       OR v_action.action_type <> p_action_type
       OR v_action.payload <> p_action_payload THEN
      RAISE EXCEPTION 'Assistant action idempotency conflict' USING ERRCODE = '22023';
    END IF;

    IF v_inserted = 1 THEN
      INSERT INTO public.assistant_action_audit_events (
        action_request_id, account_id, actor_user_id, event_type, metadata
      ) VALUES (
        v_action.id, p_account_id, p_user_id, 'proposed',
        jsonb_build_object(
          'action_type', p_action_type,
          'target_id', p_action_payload->'action'->>'contact_id'
        )
      );
    END IF;

    UPDATE public.assistant_messages
      SET action_request_id = v_action.id
      WHERE id = v_turn.assistant_message_id
        AND account_id = p_account_id
        AND user_id = p_user_id
        AND reply_to_message_id = p_user_message_id
        AND role = 'assistant'
        AND (action_request_id IS NULL OR action_request_id = v_action.id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Assistant action could not be attached to its response';
    END IF;
  END IF;

  RETURN QUERY SELECT v_turn.result, v_turn.available_credits,
    v_turn.assistant_message_id, v_action.id;
END;
$$;

ALTER FUNCTION public.record_ai_assistant_turn_with_action(
  uuid, uuid, uuid, uuid, text, jsonb, text, text, integer, integer,
  integer, integer, bigint, bigint, bigint, text, jsonb, text, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_ai_assistant_turn_with_action(
  uuid, uuid, uuid, uuid, text, jsonb, text, text, integer, integer,
  integer, integer, bigint, bigint, bigint, text, jsonb, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_assistant_turn_with_action(
  uuid, uuid, uuid, uuid, text, jsonb, text, text, integer, integer,
  integer, integer, bigint, bigint, bigint, text, jsonb, text, jsonb
) TO service_role;

CREATE FUNCTION public.claim_assistant_action(
  p_action_id uuid,
  p_account_id uuid,
  p_user_id uuid
)
RETURNS SETOF public.assistant_action_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action public.assistant_action_requests%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.assistant_action_requests
    SET status = 'executing', updated_at = now()
    WHERE id = p_action_id AND account_id = p_account_id AND user_id = p_user_id
      AND status = 'pending' AND expires_at > now()
    RETURNING * INTO v_action;

  IF FOUND THEN
    INSERT INTO public.assistant_action_audit_events (
      action_request_id, account_id, actor_user_id, event_type, metadata
    ) VALUES (
      v_action.id, p_account_id, p_user_id, 'confirmed',
      jsonb_build_object(
        'action_type', v_action.action_type,
        'target_id', v_action.payload->'action'->>'contact_id'
      )
    );
    RETURN NEXT v_action;
    RETURN;
  END IF;

  UPDATE public.assistant_action_requests
    SET status = 'expired', updated_at = now()
    WHERE id = p_action_id AND account_id = p_account_id AND user_id = p_user_id
      AND status = 'pending' AND expires_at <= now()
    RETURNING * INTO v_action;
  IF FOUND THEN
    INSERT INTO public.assistant_action_audit_events (
      action_request_id, account_id, actor_user_id, event_type, metadata
    ) VALUES (
      v_action.id, p_account_id, p_user_id, 'expired',
      jsonb_build_object(
        'action_type', v_action.action_type,
        'target_id', v_action.payload->'action'->>'contact_id'
      )
    );
    RETURN NEXT v_action;
  END IF;
END;
$$;

CREATE FUNCTION public.finish_assistant_action(
  p_action_id uuid,
  p_account_id uuid,
  p_user_id uuid,
  p_status text,
  p_result jsonb
)
RETURNS SETOF public.assistant_action_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action public.assistant_action_requests%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('completed', 'failed', 'needs_review')
     OR (p_result IS NOT NULL AND (
       jsonb_typeof(p_result) <> 'object' OR pg_column_size(p_result) > 4096
     )) THEN
    RAISE EXCEPTION 'Invalid assistant action result' USING ERRCODE = '22023';
  END IF;

  UPDATE public.assistant_action_requests
    SET status = p_status, result = coalesce(p_result, '{}'::jsonb), updated_at = now()
    WHERE id = p_action_id AND account_id = p_account_id AND user_id = p_user_id
      AND status = 'executing'
    RETURNING * INTO v_action;
  IF FOUND THEN
    INSERT INTO public.assistant_action_audit_events (
      action_request_id, account_id, actor_user_id, event_type, metadata
    ) VALUES (
      v_action.id, p_account_id, p_user_id, p_status,
      jsonb_build_object(
        'action_type', v_action.action_type,
        'object_type', p_result->>'object_type',
        'object_id', p_result->>'object_id',
        'result_code', p_result->>'code'
      )
    );
    RETURN NEXT v_action;
  END IF;
END;
$$;

CREATE FUNCTION public.cancel_assistant_action(
  p_action_id uuid,
  p_account_id uuid,
  p_user_id uuid
)
RETURNS SETOF public.assistant_action_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action public.assistant_action_requests%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.assistant_action_requests
    SET status = 'cancelled', updated_at = now()
    WHERE id = p_action_id AND account_id = p_account_id AND user_id = p_user_id
      AND status = 'pending'
    RETURNING * INTO v_action;
  IF FOUND THEN
    INSERT INTO public.assistant_action_audit_events (
      action_request_id, account_id, actor_user_id, event_type
    ) VALUES (
      v_action.id, p_account_id, p_user_id, 'cancelled',
      jsonb_build_object(
        'action_type', v_action.action_type,
        'target_id', v_action.payload->'action'->>'contact_id'
      )
    );
    RETURN NEXT v_action;
  END IF;
END;
$$;

ALTER FUNCTION public.claim_assistant_action(uuid, uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.finish_assistant_action(uuid, uuid, uuid, text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.cancel_assistant_action(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_assistant_action(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_assistant_action(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_assistant_action(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_assistant_action(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_assistant_action(uuid, uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_assistant_action(uuid, uuid, uuid) TO service_role;
