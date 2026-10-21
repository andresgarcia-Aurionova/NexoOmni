CREATE TABLE public.ai_credit_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  ledger_entry_id uuid UNIQUE REFERENCES public.ai_credit_ledger(id) ON DELETE CASCADE,
  batch_type text NOT NULL
    CHECK (batch_type IN ('purchase', 'adjustment', 'legacy')),
  granted_credits bigint NOT NULL CHECK (granted_credits > 0),
  remaining_credits bigint NOT NULL CHECK (
    remaining_credits >= 0 AND remaining_credits <= granted_credits
  ),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (batch_type = 'purchase' AND expires_at IS NOT NULL)
    OR (batch_type IN ('adjustment', 'legacy') AND expires_at IS NULL)
  )
);

CREATE INDEX ai_credit_batches_available_idx
  ON public.ai_credit_batches (account_id, expires_at, created_at, id)
  WHERE remaining_credits > 0;
CREATE INDEX ai_credit_batches_expiring_idx
  ON public.ai_credit_batches (expires_at, account_id, id)
  WHERE remaining_credits > 0 AND expires_at IS NOT NULL;
CREATE UNIQUE INDEX ai_credit_batches_legacy_account_idx
  ON public.ai_credit_batches (account_id)
  WHERE batch_type = 'legacy';

CREATE TABLE public.ai_credit_batch_debits (
  ledger_entry_id uuid NOT NULL
    REFERENCES public.ai_credit_ledger(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL
    REFERENCES public.ai_credit_batches(id) ON DELETE RESTRICT,
  credits bigint NOT NULL CHECK (credits > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ledger_entry_id, batch_id)
);

CREATE INDEX ai_credit_batch_debits_batch_idx
  ON public.ai_credit_batch_debits (batch_id, created_at DESC);

ALTER TABLE public.ai_credit_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_credit_batch_debits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_credit_batches, public.ai_credit_batch_debits
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_credit_batches, public.ai_credit_batch_debits
  TO service_role;

COMMENT ON TABLE public.ai_credit_batches IS
  'Service-role-only credit lots. Paid purchases expire 30 days after crediting; adjustments and balances present at rollout do not expire.';

INSERT INTO public.ai_credit_batches (
  account_id,
  batch_type,
  granted_credits,
  remaining_credits,
  expires_at
)
SELECT
  wallet.account_id,
  'legacy',
  wallet.available_credits,
  wallet.available_credits,
  NULL
FROM public.ai_credit_wallets AS wallet
WHERE wallet.available_credits > 0
ON CONFLICT (account_id) WHERE batch_type = 'legacy' DO NOTHING;

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

ALTER FUNCTION public.platform_ai_credit_grant(uuid, bigint, text, text, text, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_ai_credit_grant(uuid, bigint, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_ai_credit_grant(uuid, bigint, text, text, text, uuid)
  TO service_role;

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
  v_batch ai_credit_batches%ROWTYPE;
  v_balance bigint;
  v_batch_balance bigint;
  v_spendable_balance bigint;
  v_remaining bigint;
  v_take bigint;
  v_entry_id uuid;
  v_allocations jsonb := '[]'::jsonb;
  v_allocation jsonb;
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

  PERFORM expire_ai_credit_batches(p_account_id, 1000);

  SELECT w.available_credits INTO v_balance
  FROM ai_credit_wallets AS w
  WHERE w.account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI credit wallet not found' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sum(batch.remaining_credits), 0)
  INTO v_batch_balance
  FROM ai_credit_batches AS batch
  WHERE batch.account_id = p_account_id;
  IF v_batch_balance <> v_balance THEN
    RAISE EXCEPTION 'AI credit batch balance does not match wallet'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(sum(batch.remaining_credits), 0)
  INTO v_spendable_balance
  FROM ai_credit_batches AS batch
  WHERE batch.account_id = p_account_id
    AND batch.remaining_credits > 0
    AND (batch.expires_at IS NULL OR batch.expires_at > now());

  IF v_spendable_balance < p_credits THEN
    RETURN QUERY
      SELECT 'insufficient_credits'::text, v_spendable_balance, NULL::uuid;
    RETURN;
  END IF;

  v_remaining := p_credits;
  FOR v_batch IN
    SELECT batch.*
    FROM ai_credit_batches AS batch
    WHERE batch.account_id = p_account_id
      AND batch.remaining_credits > 0
      AND (batch.expires_at IS NULL OR batch.expires_at > now())
    ORDER BY batch.expires_at ASC NULLS LAST, batch.created_at ASC, batch.id ASC
    FOR UPDATE
  LOOP
    v_take := LEAST(v_batch.remaining_credits, v_remaining);
    UPDATE ai_credit_batches
    SET remaining_credits = remaining_credits - v_take
    WHERE id = v_batch.id;
    v_allocations := v_allocations || jsonb_build_array(
      jsonb_build_object('batch_id', v_batch.id, 'credits', v_take)
    );
    v_remaining := v_remaining - v_take;
    EXIT WHEN v_remaining = 0;
  END LOOP;

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'AI credit batches could not cover the locked wallet balance'
      USING ERRCODE = '23514';
  END IF;

  UPDATE ai_credit_wallets AS w
  SET available_credits = w.available_credits - p_credits,
      updated_at = now()
  WHERE w.account_id = p_account_id
  RETURNING w.available_credits INTO v_balance;

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

  FOR v_allocation IN
    SELECT value FROM jsonb_array_elements(v_allocations)
  LOOP
    INSERT INTO ai_credit_batch_debits (
      ledger_entry_id,
      batch_id,
      credits
    )
    VALUES (
      v_entry_id,
      (v_allocation ->> 'batch_id')::uuid,
      (v_allocation ->> 'credits')::bigint
    );
  END LOOP;

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

CREATE OR REPLACE FUNCTION public.expire_ai_credit_batches(
  p_account_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  processed_batches integer,
  expired_credits bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate record;
  v_batch ai_credit_batches%ROWTYPE;
  v_balance bigint;
  v_processed integer := 0;
  v_expired bigint := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Invalid credit expiration batch limit' USING ERRCODE = '22023';
  END IF;

  FOR v_candidate IN
    SELECT batch.id, batch.account_id
    FROM ai_credit_batches AS batch
    WHERE batch.remaining_credits > 0
      AND batch.expires_at <= now()
      AND (p_account_id IS NULL OR batch.account_id = p_account_id)
    ORDER BY batch.account_id, batch.expires_at, batch.id
    LIMIT p_limit
  LOOP
    SELECT wallet.available_credits INTO v_balance
    FROM ai_credit_wallets AS wallet
    WHERE wallet.account_id = v_candidate.account_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AI credit wallet not found for expiring batch'
        USING ERRCODE = '23503';
    END IF;

    SELECT batch.* INTO v_batch
    FROM ai_credit_batches AS batch
    WHERE batch.id = v_candidate.id
      AND batch.account_id = v_candidate.account_id
    FOR UPDATE;
    IF NOT FOUND
       OR v_batch.remaining_credits = 0
       OR v_batch.expires_at IS NULL
       OR v_batch.expires_at > now() THEN
      CONTINUE;
    END IF;

    IF v_balance < v_batch.remaining_credits THEN
      RAISE EXCEPTION 'AI credit batch balance exceeds wallet balance'
        USING ERRCODE = '23514';
    END IF;

    UPDATE ai_credit_wallets
    SET available_credits = available_credits - v_batch.remaining_credits,
        updated_at = now()
    WHERE account_id = v_batch.account_id
    RETURNING available_credits INTO v_balance;

    UPDATE ai_credit_batches
    SET remaining_credits = 0
    WHERE id = v_batch.id;

    INSERT INTO ai_credit_ledger (
      account_id,
      entry_type,
      delta_credits,
      balance_after,
      idempotency_key,
      metadata
    )
    VALUES (
      v_batch.account_id,
      'expiration',
      -v_batch.remaining_credits,
      v_balance,
      'credit-expiration:' || v_batch.id::text,
      jsonb_build_object(
        'source', 'credit_batch_expiration',
        'batch_id', v_batch.id,
        'original_ledger_entry_id', v_batch.ledger_entry_id,
        'expired_at', v_batch.expires_at
      )
    );

    v_processed := v_processed + 1;
    v_expired := v_expired + v_batch.remaining_credits;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_expired;
END;
$$;

ALTER FUNCTION public.expire_ai_credit_batches(uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.expire_ai_credit_batches(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_ai_credit_batches(uuid, integer)
  TO service_role;
