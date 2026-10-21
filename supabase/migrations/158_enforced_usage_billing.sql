ALTER TABLE public.ai_billing_settings
  ADD COLUMN IF NOT EXISTS mxn_fx_date date,
  ADD COLUMN IF NOT EXISTS mxn_fx_fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS mxn_fx_source text;

ALTER TABLE public.ai_billing_settings
  DROP CONSTRAINT IF EXISTS ai_billing_settings_billing_mode_check;

UPDATE public.ai_billing_settings
SET billing_mode = 'enforced',
    updated_at = now()
WHERE id = true;

ALTER TABLE public.ai_billing_settings
  ALTER COLUMN billing_mode SET DEFAULT 'enforced',
  ADD CONSTRAINT ai_billing_settings_billing_mode_check
    CHECK (billing_mode = 'enforced');

ALTER TABLE public.ai_credit_wallets
  DROP CONSTRAINT IF EXISTS ai_credit_wallets_available_credits_check;
ALTER TABLE public.ai_credit_ledger
  DROP CONSTRAINT IF EXISTS ai_credit_ledger_balance_after_check;

ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS billing_idempotency_key text;

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
      'credential_test'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_usage_log_billing_idempotency
  ON public.ai_usage_log (billing_idempotency_key)
  WHERE billing_idempotency_key IS NOT NULL;

ALTER TABLE public.call_usage_log
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled'
    CHECK (billing_status IN ('unbilled', 'charged')),
  ADD COLUMN IF NOT EXISTS ledger_entry_id uuid
    REFERENCES public.ai_credit_ledger(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_call_usage_log_unbilled
  ON public.call_usage_log (created_at)
  WHERE billing_status = 'unbilled';

ALTER TABLE public.call_usage_log
  ALTER COLUMN billing_mode SET DEFAULT 'enforced';

COMMENT ON COLUMN public.call_usage_log.zernio_cost_nano_usd IS
  'Zernio billableCostUSD reported for the configured WhatsApp SIP call, stored in nanodollars.';
COMMENT ON TABLE public.call_usage_log IS
  'Per-call Zernio WhatsApp usage. New rows and their credit debits are committed atomically.';
COMMENT ON TABLE public.ai_credit_wallets IS
  'AI and voice credit balances. Negative balances are allowed until the tenant is recharged.';
COMMENT ON TABLE public.ai_credit_ledger IS
  'Append-only credit history. Usage debits may take the balance below zero.';
COMMENT ON FUNCTION public.ai_credit_debit(
  uuid, bigint, text, bigint, bigint, uuid, text, text, jsonb
) IS
  'Atomic, idempotent usage debit. Callable only with the Supabase service-role JWT; negative balances are permitted.';

CREATE OR REPLACE FUNCTION public.ai_credit_debit(
  p_account_id uuid,
  p_credits bigint,
  p_idempotency_key text,
  p_cost_nano_usd bigint DEFAULT 0,
  p_price_nano_usd bigint DEFAULT 0,
  p_usage_id uuid DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  result text,
  available_credits bigint,
  ledger_entry_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing ai_credit_ledger%ROWTYPE;
  v_balance bigint;
  v_entry_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  IF p_account_id IS NULL OR p_credits IS NULL OR p_credits <= 0
     OR p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0
     OR length(p_idempotency_key) > 200
     OR p_cost_nano_usd IS NULL OR p_cost_nano_usd < 0
     OR p_price_nano_usd IS NULL OR p_price_nano_usd < 0
     OR p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object'
     OR (p_provider IS NOT NULL AND p_provider NOT IN ('openai', 'anthropic')) THEN
    RAISE EXCEPTION 'Invalid AI credit debit arguments' USING ERRCODE = '22023';
  END IF;

  IF p_usage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM ai_usage_log
    WHERE id = p_usage_id
      AND account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Usage record does not belong to account' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_account_id::text || ':' || p_idempotency_key, 0)
  );

  SELECT * INTO v_existing
  FROM ai_credit_ledger
  WHERE account_id = p_account_id
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.entry_type <> 'usage'
       OR v_existing.delta_credits <> -p_credits
       OR v_existing.cost_nano_usd <> p_cost_nano_usd
       OR v_existing.price_nano_usd <> p_price_nano_usd
       OR v_existing.usage_id IS DISTINCT FROM p_usage_id
       OR v_existing.provider IS DISTINCT FROM p_provider
       OR v_existing.model IS DISTINCT FROM p_model
       OR v_existing.metadata IS DISTINCT FROM p_metadata THEN
      RAISE EXCEPTION 'Idempotency key reused with different debit' USING ERRCODE = '22023';
    END IF;
    SELECT w.available_credits INTO v_balance
    FROM ai_credit_wallets AS w
    WHERE w.account_id = p_account_id;
    RETURN QUERY
      SELECT 'duplicate'::text, COALESCE(v_balance, v_existing.balance_after), v_existing.id;
    RETURN;
  END IF;

  INSERT INTO ai_credit_wallets (account_id)
  VALUES (p_account_id)
  ON CONFLICT (account_id) DO NOTHING;

  UPDATE ai_credit_wallets AS w
  SET available_credits = w.available_credits - p_credits,
      updated_at = now()
  WHERE w.account_id = p_account_id
  RETURNING w.available_credits INTO v_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit wallet could not be initialized';
  END IF;

  INSERT INTO ai_credit_ledger (
    account_id,
    entry_type,
    delta_credits,
    balance_after,
    idempotency_key,
    usage_id,
    cost_nano_usd,
    price_nano_usd,
    provider,
    model,
    metadata
  )
  VALUES (
    p_account_id,
    'usage',
    -p_credits,
    v_balance,
    p_idempotency_key,
    p_usage_id,
    p_cost_nano_usd,
    p_price_nano_usd,
    p_provider,
    p_model,
    p_metadata
  )
  RETURNING id INTO v_entry_id;

  RETURN QUERY SELECT 'debited'::text, v_balance, v_entry_id;
END;
$$;

ALTER FUNCTION public.ai_credit_debit(
  uuid, bigint, text, bigint, bigint, uuid, text, text, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ai_credit_debit(
  uuid, bigint, text, bigint, bigint, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_credit_debit(
  uuid, bigint, text, bigint, bigint, uuid, text, text, jsonb
) TO service_role;

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
     OR p_mode NOT IN ('auto_reply', 'draft', 'analysis', 'report', 'call_summary', 'voice_transcription', 'image_description', 'embeddings', 'credential_test')
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

CREATE OR REPLACE FUNCTION public.record_whatsapp_call_and_debit(
  p_account_id uuid,
  p_connector_id uuid,
  p_call_id text,
  p_event_id text,
  p_zernio_account_id text,
  p_phone_number_id text,
  p_direction text,
  p_end_reason text,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_duration_seconds integer,
  p_billable_minutes integer,
  p_zernio_cost_nano_usd bigint,
  p_meta_cost_nano_usd bigint,
  p_connection_price_nano_usd bigint,
  p_connection_credits bigint,
  p_minute_price_mxn_centavos integer,
  p_mxn_per_usd_micro bigint,
  p_minute_price_nano_usd bigint,
  p_minute_credits bigint,
  p_total_credits bigint,
  p_total_price_nano_usd bigint
)
RETURNS TABLE (result text, available_credits bigint, ledger_entry_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_call call_usage_log%ROWTYPE;
  v_result text;
  v_balance bigint;
  v_entry_id uuid;
  v_total_cost bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_account_id IS NULL OR p_connector_id IS NULL
     OR p_call_id IS NULL OR length(btrim(p_call_id)) = 0
     OR p_zernio_account_id IS NULL
     OR p_direction IS NOT NULL AND p_direction NOT IN ('inbound', 'outbound')
     OR p_duration_seconds IS NULL OR p_duration_seconds < 0
     OR p_billable_minutes IS NULL OR p_billable_minutes < 0
     OR p_zernio_cost_nano_usd IS NULL OR p_zernio_cost_nano_usd < 0
     OR p_meta_cost_nano_usd IS NULL OR p_meta_cost_nano_usd < 0
     OR p_connection_price_nano_usd IS NULL OR p_connection_price_nano_usd < 0
     OR p_connection_credits IS NULL OR p_connection_credits < 0
     OR p_minute_price_mxn_centavos IS NULL OR p_minute_price_mxn_centavos < 0
     OR p_mxn_per_usd_micro IS NULL OR p_mxn_per_usd_micro <= 0
     OR p_minute_price_nano_usd IS NULL OR p_minute_price_nano_usd < 0
     OR p_minute_credits IS NULL OR p_minute_credits < 0
     OR p_total_credits IS NULL OR p_total_credits < 0
     OR p_total_price_nano_usd IS NULL OR p_total_price_nano_usd < 0 THEN
    RAISE EXCEPTION 'Invalid WhatsApp call billing arguments' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ai_billing_settings
    WHERE id = true AND billing_mode = 'enforced'
  ) THEN
    RAISE EXCEPTION 'Enforced billing is not enabled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM omnichannel_connectors
    WHERE id = p_connector_id
      AND account_id = p_account_id
      AND provider = 'zernio_whatsapp'
      AND zernio_account_id = p_zernio_account_id
  ) THEN
    RAISE EXCEPTION 'WhatsApp connector does not belong to account' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_account_id::text || ':zernio-call:' || p_call_id, 0)
  );

  INSERT INTO call_usage_log (
    account_id, connector_id, zernio_call_id, zernio_event_id,
    zernio_account_id, phone_number_id, direction, end_reason,
    started_at, ended_at, duration_seconds, billable_minutes,
    zernio_cost_nano_usd, meta_cost_nano_usd,
    connection_price_nano_usd, connection_credits,
    minute_price_mxn_centavos, mxn_per_usd_micro, minute_credits,
    billing_mode, billing_status
  )
  VALUES (
    p_account_id, p_connector_id, p_call_id, p_event_id,
    p_zernio_account_id, p_phone_number_id, p_direction, p_end_reason,
    p_started_at, p_ended_at, p_duration_seconds, p_billable_minutes,
    p_zernio_cost_nano_usd, p_meta_cost_nano_usd,
    p_connection_price_nano_usd, p_connection_credits,
    p_minute_price_mxn_centavos, p_mxn_per_usd_micro, p_minute_credits,
    'enforced', 'unbilled'
  )
  ON CONFLICT (zernio_call_id) DO NOTHING;

  SELECT * INTO v_call
  FROM call_usage_log
  WHERE zernio_call_id = p_call_id
  FOR UPDATE;
  IF v_call.account_id <> p_account_id THEN
    RAISE EXCEPTION 'Call id is already assigned to another account' USING ERRCODE = '22023';
  END IF;
  IF v_call.billing_status = 'charged' THEN
    SELECT available_credits INTO v_balance
    FROM ai_credit_wallets WHERE account_id = p_account_id;
    RETURN QUERY SELECT 'duplicate'::text, COALESCE(v_balance, 0), v_call.ledger_entry_id;
    RETURN;
  END IF;

  UPDATE call_usage_log
  SET zernio_event_id = p_event_id,
      phone_number_id = p_phone_number_id,
      direction = p_direction,
      end_reason = p_end_reason,
      started_at = p_started_at,
      ended_at = p_ended_at,
      duration_seconds = p_duration_seconds,
      billable_minutes = p_billable_minutes,
      zernio_cost_nano_usd = p_zernio_cost_nano_usd,
      meta_cost_nano_usd = p_meta_cost_nano_usd,
      connection_price_nano_usd = p_connection_price_nano_usd,
      connection_credits = p_connection_credits,
      minute_price_mxn_centavos = p_minute_price_mxn_centavos,
      mxn_per_usd_micro = p_mxn_per_usd_micro,
      minute_credits = p_minute_credits,
      billing_mode = 'enforced'
  WHERE id = v_call.id;

  v_total_cost := p_zernio_cost_nano_usd + p_minute_price_nano_usd;
  IF p_total_credits > 0 THEN
    SELECT d.result, d.available_credits, d.ledger_entry_id
    INTO v_result, v_balance, v_entry_id
    FROM ai_credit_debit(
      p_account_id,
      p_total_credits,
      'zernio-call:' || p_call_id,
      v_total_cost,
      p_total_price_nano_usd,
      NULL,
      NULL,
      NULL,
      jsonb_build_object(
        'source', 'zernio_whatsapp_call',
        'call_id', p_call_id,
        'direction', p_direction,
        'duration_seconds', p_duration_seconds,
        'billable_minutes', p_billable_minutes
      )
    );
  ELSE
    INSERT INTO ai_credit_wallets (account_id)
    VALUES (p_account_id)
    ON CONFLICT (account_id) DO NOTHING;
    SELECT available_credits INTO v_balance
    FROM ai_credit_wallets WHERE account_id = p_account_id;
    v_result := 'recorded';
    v_entry_id := NULL;
  END IF;

  UPDATE call_usage_log
  SET billing_status = 'charged',
      ledger_entry_id = v_entry_id
  WHERE id = v_call.id;

  RETURN QUERY
    SELECT v_result, v_balance, v_entry_id;
END;
$$;

ALTER FUNCTION public.record_whatsapp_call_and_debit(
  uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz,
  integer, integer, bigint, bigint, bigint, bigint, integer, bigint, bigint,
  bigint, bigint, bigint
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_whatsapp_call_and_debit(
  uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz,
  integer, integer, bigint, bigint, bigint, bigint, integer, bigint, bigint,
  bigint, bigint, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_call_and_debit(
  uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz,
  integer, integer, bigint, bigint, bigint, bigint, integer, bigint, bigint,
  bigint, bigint, bigint
) TO service_role;

CREATE OR REPLACE FUNCTION public.platform_ai_credit_usage_summary()
RETURNS TABLE (
  account_id uuid,
  mode text,
  provider text,
  model text,
  calls bigint,
  prompt_tokens bigint,
  completion_tokens bigint,
  estimated_cost_nano_usd numeric,
  estimated_credits numeric,
  unpriced_calls bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    usage.account_id,
    usage.mode,
    usage.provider,
    usage.model,
    count(*)::bigint,
    COALESCE(sum(usage.prompt_tokens), 0)::bigint,
    COALESCE(sum(usage.completion_tokens), 0)::bigint,
    COALESCE(sum(usage.cost_nano_usd) FILTER (WHERE ledger.id IS NOT NULL), 0),
    COALESCE(sum(-ledger.delta_credits), 0),
    count(*) FILTER (WHERE ledger.id IS NULL)::bigint
  FROM public.ai_usage_log AS usage
  LEFT JOIN public.ai_credit_ledger AS ledger
    ON ledger.usage_id = usage.id
   AND ledger.entry_type = 'usage'
  WHERE usage.created_at >= date_trunc('month', now())
  GROUP BY usage.account_id, usage.mode, usage.provider, usage.model
  ORDER BY usage.account_id, usage.mode, usage.provider, usage.model;
$$;

ALTER FUNCTION public.platform_ai_credit_usage_summary() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_ai_credit_usage_summary()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_ai_credit_usage_summary()
  TO service_role;
