-- Never let a usage debit push a wallet below zero. Provider requests are
-- preflight-checked too, but the atomic predicate also covers concurrent calls.
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
    SELECT 1 FROM ai_usage_log
    WHERE id = p_usage_id AND account_id = p_account_id
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
    AND w.available_credits >= p_credits
  RETURNING w.available_credits INTO v_balance;

  IF NOT FOUND THEN
    SELECT w.available_credits INTO v_balance
    FROM ai_credit_wallets AS w
    WHERE w.account_id = p_account_id;
    RETURN QUERY
      SELECT 'insufficient_credits'::text, COALESCE(v_balance, 0), NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO ai_credit_ledger (
    account_id, entry_type, delta_credits, balance_after, idempotency_key,
    usage_id, cost_nano_usd, price_nano_usd, provider, model, metadata
  )
  VALUES (
    p_account_id, 'usage', -p_credits, v_balance, p_idempotency_key,
    p_usage_id, p_cost_nano_usd, p_price_nano_usd, p_provider, p_model, p_metadata
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

COMMENT ON FUNCTION public.ai_credit_debit(
  uuid, bigint, text, bigint, bigint, uuid, text, text, jsonb
) IS
  'Atomic, idempotent usage debit. Returns insufficient_credits without changing a wallet that cannot cover the charge.';

UPDATE public.call_usage_log AS calls
SET billing_status = 'unbilled'
WHERE calls.billing_status = 'charged'
  AND calls.ledger_entry_id IS NULL
  AND calls.connection_credits + calls.minute_credits > 0;

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
    ) AS d;
  ELSE
    INSERT INTO ai_credit_wallets (account_id)
    VALUES (p_account_id)
    ON CONFLICT (account_id) DO NOTHING;
    SELECT available_credits INTO v_balance
    FROM ai_credit_wallets WHERE account_id = p_account_id;
    v_result := 'recorded';
    v_entry_id := NULL;
  END IF;

  IF v_result IN ('debited', 'duplicate', 'recorded') THEN
    UPDATE call_usage_log
    SET billing_status = 'charged',
        ledger_entry_id = v_entry_id
    WHERE id = v_call.id;
  END IF;

  RETURN QUERY SELECT v_result, v_balance, v_entry_id;
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
