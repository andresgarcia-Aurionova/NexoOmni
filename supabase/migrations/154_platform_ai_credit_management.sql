-- Platform-only, audited credit grants and exact month-to-date usage summaries.
ALTER TABLE public.ai_credit_ledger
  ADD COLUMN IF NOT EXISTS actor_user_id uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.platform_ai_credit_grant(
  p_account_id uuid,
  p_credits bigint,
  p_idempotency_key text,
  p_entry_type text,
  p_reason text,
  p_actor_user_id uuid
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
  v_metadata jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  IF p_account_id IS NULL
     OR p_credits IS NULL OR p_credits <= 0 OR p_credits > 1000000000000
     OR p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0
     OR length(p_idempotency_key) > 200
     OR p_entry_type IS NULL OR p_entry_type NOT IN ('purchase', 'adjustment')
     OR p_reason IS NULL OR length(btrim(p_reason)) < 5
     OR length(p_reason) > 500
     OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid AI credit grant arguments' USING ERRCODE = '22023';
  END IF;

  v_metadata := jsonb_build_object(
    'source', 'platform_manual',
    'reason', btrim(p_reason)
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_account_id::text || ':' || p_idempotency_key, 0)
  );

  SELECT * INTO v_existing
  FROM ai_credit_ledger
  WHERE account_id = p_account_id
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.entry_type <> p_entry_type
       OR v_existing.delta_credits <> p_credits
       OR v_existing.metadata <> v_metadata
       OR v_existing.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION 'Idempotency key reused with different credit grant'
        USING ERRCODE = '22023';
    END IF;

    SELECT w.available_credits INTO v_balance
    FROM ai_credit_wallets AS w
    WHERE w.account_id = p_account_id;

    RETURN QUERY
      SELECT 'duplicate'::text, COALESCE(v_balance, v_existing.balance_after), v_existing.id;
    RETURN;
  END IF;

  SELECT w.available_credits INTO v_balance
  FROM ai_credit_wallets AS w
  WHERE w.account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI credit wallet not found' USING ERRCODE = '22023';
  END IF;

  IF v_balance > 9223372036854775807 - p_credits THEN
    RAISE EXCEPTION 'AI credit balance overflow' USING ERRCODE = '22003';
  END IF;

  UPDATE ai_credit_wallets AS w
  SET available_credits = w.available_credits + p_credits,
      updated_at = now()
  WHERE w.account_id = p_account_id
  RETURNING w.available_credits INTO v_balance;

  INSERT INTO ai_credit_ledger (
    account_id,
    entry_type,
    delta_credits,
    balance_after,
    idempotency_key,
    actor_user_id,
    metadata
  )
  VALUES (
    p_account_id,
    p_entry_type,
    p_credits,
    v_balance,
    p_idempotency_key,
    p_actor_user_id,
    v_metadata
  )
  RETURNING id INTO v_entry_id;

  RETURN QUERY SELECT 'granted'::text, v_balance, v_entry_id;
END;
$$;

ALTER FUNCTION public.platform_ai_credit_grant(uuid, bigint, text, text, text, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_ai_credit_grant(uuid, bigint, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_ai_credit_grant(uuid, bigint, text, text, text, uuid)
  TO service_role;

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
    sum(usage.cost_nano_usd),
    sum(usage.credits_charged),
    count(*) FILTER (
      WHERE usage.cost_nano_usd IS NULL OR usage.credits_charged IS NULL
    )::bigint
  FROM public.ai_usage_log AS usage
  WHERE usage.created_at >= date_trunc('month', now())
  GROUP BY usage.account_id, usage.mode, usage.provider, usage.model
  ORDER BY usage.account_id, usage.mode, usage.provider, usage.model;
$$;

ALTER FUNCTION public.platform_ai_credit_usage_summary() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_ai_credit_usage_summary()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_ai_credit_usage_summary()
  TO service_role;
