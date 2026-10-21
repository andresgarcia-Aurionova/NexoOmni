CREATE TABLE public.stripe_ai_credit_checkouts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  purchaser_user_id uuid NOT NULL,
  package_id text NOT NULL CHECK (
    package_id IN ('entrepreneur', 'commercial_pro', 'corporate')
  ),
  credits bigint NOT NULL CHECK (
    (package_id = 'entrepreneur' AND credits = 50000)
    OR (package_id = 'commercial_pro' AND credits = 150000)
    OR (package_id = 'corporate' AND credits = 300000)
  ),
  package_base_mxn_centavos bigint NOT NULL CHECK (package_base_mxn_centavos > 0),
  processing_cost_included_mxn_centavos bigint NOT NULL CHECK (
    processing_cost_included_mxn_centavos > 0
  ),
  vat_mxn_centavos bigint NOT NULL CHECK (vat_mxn_centavos > 0),
  amount_total_mxn_centavos bigint NOT NULL CHECK (amount_total_mxn_centavos > 0),
  fx_rate_micro bigint NOT NULL CHECK (fx_rate_micro > 0),
  fx_date date NOT NULL,
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  credit_ledger_entry_id uuid REFERENCES public.ai_credit_ledger(id)
    ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'credited', 'failed')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  credited_at timestamptz,
  CHECK (
    amount_total_mxn_centavos =
      package_base_mxn_centavos
      + processing_cost_included_mxn_centavos
      + vat_mxn_centavos
  ),
  CHECK (
    (status = 'credited'
      AND credit_ledger_entry_id IS NOT NULL
      AND credited_at IS NOT NULL
      AND paid_at IS NOT NULL
      AND stripe_checkout_session_id IS NOT NULL
      AND stripe_payment_intent_id IS NOT NULL)
    OR (status <> 'credited' AND credit_ledger_entry_id IS NULL AND credited_at IS NULL)
  )
);

CREATE INDEX stripe_ai_credit_checkouts_account_created_idx
  ON public.stripe_ai_credit_checkouts (account_id, created_at DESC);

ALTER TABLE public.stripe_ai_credit_checkouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_ai_credit_checkouts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stripe_ai_credit_checkouts TO service_role;

COMMENT ON TABLE public.stripe_ai_credit_checkouts IS
  'Service-role-only Stripe Checkout records; verified paid sessions are credited idempotently through the AI credit ledger.';

CREATE OR REPLACE FUNCTION public.platform_ai_credit_grant(
  p_account_id uuid,
  p_credits bigint,
  p_idempotency_key text,
  p_entry_type text,
  p_reason text,
  p_actor_user_id uuid,
  p_source text
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
  v_batch_type text;
  v_expires_at timestamptz;
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
     OR p_source IS NULL OR p_source NOT IN ('platform_manual', 'stripe_checkout')
     OR (p_source = 'platform_manual' AND p_actor_user_id IS NULL)
     OR (p_source = 'stripe_checkout' AND (
       p_entry_type <> 'purchase' OR p_actor_user_id IS NOT NULL
     )) THEN
    RAISE EXCEPTION 'Invalid AI credit grant arguments' USING ERRCODE = '22023';
  END IF;

  v_metadata := jsonb_build_object(
    'source', p_source,
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
       OR (v_existing.metadata - 'expires_at') <> v_metadata
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

  v_batch_type := p_entry_type;
  IF p_entry_type = 'purchase' THEN
    v_expires_at := now() + interval '30 days';
    v_metadata := v_metadata || jsonb_build_object('expires_at', v_expires_at);
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

  INSERT INTO ai_credit_batches (
    account_id,
    ledger_entry_id,
    batch_type,
    granted_credits,
    remaining_credits,
    expires_at
  )
  VALUES (
    p_account_id,
    v_entry_id,
    v_batch_type,
    p_credits,
    p_credits,
    v_expires_at
  );

  RETURN QUERY SELECT 'granted'::text, v_balance, v_entry_id;
END;
$$;

ALTER FUNCTION public.platform_ai_credit_grant(uuid, bigint, text, text, text, uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_ai_credit_grant(uuid, bigint, text, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_ai_credit_grant(uuid, bigint, text, text, text, uuid, text)
  TO service_role;

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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.platform_ai_credit_grant(
    p_account_id,
    p_credits,
    p_idempotency_key,
    p_entry_type,
    p_reason,
    p_actor_user_id,
    'platform_manual'
  );
$$;

ALTER FUNCTION public.platform_ai_credit_grant(uuid, bigint, text, text, text, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_ai_credit_grant(uuid, bigint, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_ai_credit_grant(uuid, bigint, text, text, text, uuid)
  TO service_role;
