CREATE TABLE public.assistant_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, account_id, user_id)
);

CREATE INDEX assistant_threads_user_updated_idx
  ON public.assistant_threads (account_id, user_id, updated_at DESC);

CREATE TRIGGER assistant_threads_updated_at
  BEFORE UPDATE ON public.assistant_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.assistant_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistant_threads_select ON public.assistant_threads
  FOR SELECT USING (
    user_id = auth.uid()
    AND is_account_member(account_id, 'supervisor')
  );
CREATE POLICY assistant_threads_delete ON public.assistant_threads
  FOR DELETE USING (
    user_id = auth.uid()
    AND is_account_member(account_id, 'supervisor')
  );

-- Writes are intentionally service-role-only so clients cannot forge assistant replies.
REVOKE ALL ON public.assistant_threads FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.assistant_threads TO authenticated;
GRANT ALL ON public.assistant_threads TO service_role;

CREATE TABLE public.assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 12000),
  client_message_id uuid,
  reply_to_message_id uuid REFERENCES public.assistant_messages(id) ON DELETE CASCADE,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (thread_id, account_id, user_id)
    REFERENCES public.assistant_threads(id, account_id, user_id) ON DELETE CASCADE,
  CHECK (
    (role = 'user' AND client_message_id IS NOT NULL AND reply_to_message_id IS NULL)
    OR (role = 'assistant' AND client_message_id IS NULL AND reply_to_message_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX assistant_messages_client_id_idx
  ON public.assistant_messages (thread_id, client_message_id)
  WHERE role = 'user';
CREATE UNIQUE INDEX assistant_messages_reply_idx
  ON public.assistant_messages (reply_to_message_id)
  WHERE role = 'assistant';
CREATE INDEX assistant_messages_thread_created_idx
  ON public.assistant_messages (thread_id, created_at);

ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistant_messages_select ON public.assistant_messages
  FOR SELECT USING (
    user_id = auth.uid()
    AND is_account_member(account_id, 'supervisor')
    AND EXISTS (
      SELECT 1
      FROM public.assistant_threads AS thread
      WHERE thread.id = assistant_messages.thread_id
        AND thread.account_id = assistant_messages.account_id
        AND thread.user_id = auth.uid()
    )
  );

-- Messages are written only by the authenticated assistant route after its role,
-- entitlement, input, and credit checks; direct client writes stay denied.
REVOKE ALL ON public.assistant_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.assistant_messages TO authenticated;
GRANT ALL ON public.assistant_messages TO service_role;

ALTER TABLE public.ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE public.ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
    CHECK (mode IN (
      'auto_reply',
      'draft',
      'analysis',
      'report',
      'call_summary',
      'voice_transcription',
      'image_description',
      'embeddings',
      'credential_test',
      'assistant'
    ));

CREATE OR REPLACE FUNCTION public.record_ai_usage_and_debit(
  p_account_id uuid,
  p_conversation_id uuid,
  p_mode text,
  p_provider text,
  p_model text,
  p_prompt_tokens integer,
  p_completion_tokens integer,
  p_total_tokens integer,
  p_latency_ms integer,
  p_cost_nano_usd bigint,
  p_price_nano_usd bigint,
  p_credits bigint,
  p_idempotency_key text
)
RETURNS TABLE (
  result text,
  available_credits bigint,
  usage_id uuid,
  ledger_entry_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usage ai_usage_log%ROWTYPE;
  v_debit record;
  v_balance bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_account_id IS NULL
     OR p_mode IS NULL
     OR p_mode NOT IN ('auto_reply', 'draft', 'analysis', 'report', 'call_summary', 'voice_transcription', 'image_description', 'embeddings', 'credential_test', 'assistant')
     OR p_provider IS NULL
     OR p_provider NOT IN ('openai', 'anthropic')
     OR p_model IS NULL OR length(btrim(p_model)) = 0
     OR p_prompt_tokens IS NULL OR p_prompt_tokens < 0
     OR p_completion_tokens IS NULL OR p_completion_tokens < 0
     OR p_total_tokens IS NULL OR p_total_tokens < 0
     OR (p_latency_ms IS NOT NULL AND p_latency_ms < 0)
     OR p_cost_nano_usd IS NULL OR p_cost_nano_usd < 0
     OR p_price_nano_usd IS NULL OR p_price_nano_usd < 0
     OR p_credits IS NULL OR p_credits < 0
     OR p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0
     OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'Invalid AI usage billing arguments' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ai_billing_settings
    WHERE id = true AND billing_mode = 'enforced'
  ) THEN
    RAISE EXCEPTION 'Enforced billing is not enabled';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_account_id::text || ':' || p_idempotency_key, 0)
  );

  SELECT * INTO v_usage
  FROM ai_usage_log
  WHERE billing_idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_usage.account_id <> p_account_id
       OR v_usage.mode <> p_mode
       OR v_usage.provider <> p_provider
       OR v_usage.model <> p_model
       OR v_usage.prompt_tokens <> p_prompt_tokens
       OR v_usage.completion_tokens <> p_completion_tokens
       OR v_usage.total_tokens <> p_total_tokens
       OR v_usage.cost_nano_usd <> p_cost_nano_usd
       OR v_usage.price_nano_usd <> p_price_nano_usd
       OR v_usage.credits_charged <> p_credits THEN
      RAISE EXCEPTION 'Idempotency key reused with different AI usage' USING ERRCODE = '22023';
    END IF;
  ELSE
    INSERT INTO ai_usage_log (
      account_id, conversation_id, mode, provider, model,
      prompt_tokens, completion_tokens, total_tokens, latency_ms,
      cost_nano_usd, price_nano_usd, credits_charged, billing_mode,
      billing_idempotency_key
    )
    VALUES (
      p_account_id, p_conversation_id, p_mode, p_provider, p_model,
      p_prompt_tokens, p_completion_tokens, p_total_tokens, p_latency_ms,
      p_cost_nano_usd, p_price_nano_usd, p_credits, 'enforced',
      p_idempotency_key
    )
    RETURNING * INTO v_usage;
  END IF;

  IF p_credits = 0 THEN
    SELECT available_credits INTO v_balance
    FROM ai_credit_wallets WHERE account_id = p_account_id;
    RETURN QUERY SELECT 'recorded'::text, COALESCE(v_balance, 0), v_usage.id, NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_debit
  FROM ai_credit_debit(
    p_account_id, p_credits, 'ai-usage:' || p_idempotency_key,
    p_cost_nano_usd, p_price_nano_usd, v_usage.id,
    p_provider, p_model, jsonb_build_object('mode', p_mode)
  );
  RETURN QUERY
    SELECT v_debit.result, v_debit.available_credits, v_usage.id, v_debit.ledger_entry_id;
END;
$$;

ALTER FUNCTION public.record_ai_usage_and_debit(
  uuid, uuid, text, text, text, integer, integer, integer, integer,
  bigint, bigint, bigint, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_ai_usage_and_debit(
  uuid, uuid, text, text, text, integer, integer, integer, integer,
  bigint, bigint, bigint, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_usage_and_debit(
  uuid, uuid, text, text, text, integer, integer, integer, integer,
  bigint, bigint, bigint, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.record_ai_assistant_turn(
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
  p_idempotency_key text
)
RETURNS TABLE (
  result text,
  available_credits bigint,
  assistant_message_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread assistant_threads%ROWTYPE;
  v_user_message assistant_messages%ROWTYPE;
  v_assistant_message assistant_messages%ROWTYPE;
  v_usage record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_account_id IS NULL OR p_user_id IS NULL OR p_thread_id IS NULL
     OR p_user_message_id IS NULL
     OR p_content IS NULL OR char_length(trim(p_content)) NOT BETWEEN 1 AND 12000
     OR p_sources IS NULL OR jsonb_typeof(p_sources) <> 'array'
     OR jsonb_array_length(p_sources) > 5
     OR p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0
     OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'Invalid assistant turn arguments' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('assistant:' || p_thread_id::text || ':' || p_user_message_id::text, 0)
  );

  SELECT * INTO v_thread
  FROM assistant_threads
  WHERE id = p_thread_id
    AND account_id = p_account_id
    AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assistant thread not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_user_message
  FROM assistant_messages
  WHERE id = p_user_message_id
    AND thread_id = p_thread_id
    AND account_id = p_account_id
    AND user_id = p_user_id
    AND role = 'user'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assistant user message not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_assistant_message
  FROM assistant_messages
  WHERE reply_to_message_id = p_user_message_id
    AND role = 'assistant';
  IF FOUND THEN
    SELECT available_credits INTO v_usage
    FROM ai_credit_wallets WHERE account_id = p_account_id;
    RETURN QUERY SELECT 'duplicate'::text, COALESCE(v_usage.available_credits, 0), v_assistant_message.id;
    RETURN;
  END IF;

  SELECT * INTO v_usage
  FROM record_ai_usage_and_debit(
    p_account_id, NULL, 'assistant', p_provider, p_model,
    p_prompt_tokens, p_completion_tokens, p_total_tokens, p_latency_ms,
    p_cost_nano_usd, p_price_nano_usd, p_credits, p_idempotency_key
  );

  IF v_usage.result = 'insufficient_credits' THEN
    RETURN QUERY SELECT v_usage.result, v_usage.available_credits, NULL::uuid;
    RETURN;
  END IF;
  IF v_usage.result NOT IN ('debited', 'duplicate', 'recorded') THEN
    RAISE EXCEPTION 'AI usage debit was not confirmed';
  END IF;

  INSERT INTO assistant_messages (
    thread_id, account_id, user_id, role, content, reply_to_message_id, sources
  )
  VALUES (
    p_thread_id, p_account_id, p_user_id, 'assistant', p_content,
    p_user_message_id, p_sources
  )
  RETURNING * INTO v_assistant_message;

  UPDATE assistant_threads
  SET updated_at = now()
  WHERE id = p_thread_id
    AND account_id = p_account_id
    AND user_id = p_user_id;

  RETURN QUERY
    SELECT v_usage.result, v_usage.available_credits, v_assistant_message.id;
END;
$$;

ALTER FUNCTION public.record_ai_assistant_turn(
  uuid, uuid, uuid, uuid, text, jsonb, text, text, integer, integer,
  integer, integer, bigint, bigint, bigint, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_ai_assistant_turn(
  uuid, uuid, uuid, uuid, text, jsonb, text, text, integer, integer,
  integer, integer, bigint, bigint, bigint, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_assistant_turn(
  uuid, uuid, uuid, uuid, text, jsonb, text, text, integer, integer,
  integer, integer, bigint, bigint, bigint, text
) TO service_role;
