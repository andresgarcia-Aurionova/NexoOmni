-- AI credit billing foundation. No credits are granted and billing remains
-- disabled until packages, payment capture, and tenant-key migration ship.

CREATE TABLE IF NOT EXISTS ai_billing_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  billing_mode text NOT NULL DEFAULT 'off'
    CHECK (billing_mode IN ('off', 'shadow', 'enforced')),
  target_margin_basis_points integer NOT NULL DEFAULT 5000
    CHECK (target_margin_basis_points BETWEEN 0 AND 9999),
  nano_usd_per_credit bigint NOT NULL DEFAULT 1000000
    CHECK (nano_usd_per_credit > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ai_billing_settings (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_model_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  model text NOT NULL,
  input_nano_usd_per_million_tokens bigint NOT NULL
    CHECK (input_nano_usd_per_million_tokens >= 0),
  output_nano_usd_per_million_tokens bigint NOT NULL
    CHECK (output_nano_usd_per_million_tokens >= 0),
  effective_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, model, effective_at)
);

CREATE INDEX IF NOT EXISTS idx_ai_model_prices_lookup
  ON ai_model_prices(provider, model, effective_at DESC);

CREATE TABLE IF NOT EXISTS ai_credit_wallets (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  available_credits bigint NOT NULL DEFAULT 0 CHECK (available_credits >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entry_type text NOT NULL
    CHECK (entry_type IN ('purchase', 'usage', 'adjustment', 'refund', 'expiration')),
  delta_credits bigint NOT NULL CHECK (delta_credits <> 0),
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  idempotency_key text NOT NULL,
  usage_id uuid REFERENCES ai_usage_log(id) ON DELETE SET NULL,
  cost_nano_usd bigint NOT NULL DEFAULT 0 CHECK (cost_nano_usd >= 0),
  price_nano_usd bigint NOT NULL DEFAULT 0 CHECK (price_nano_usd >= 0),
  provider text CHECK (provider IS NULL OR provider IN ('openai', 'anthropic')),
  model text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, idempotency_key),
  UNIQUE (usage_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_credit_ledger_account_created
  ON ai_credit_ledger(account_id, created_at DESC);

ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS cost_nano_usd bigint
    CHECK (cost_nano_usd IS NULL OR cost_nano_usd >= 0),
  ADD COLUMN IF NOT EXISTS price_nano_usd bigint
    CHECK (price_nano_usd IS NULL OR price_nano_usd >= 0),
  ADD COLUMN IF NOT EXISTS credits_charged bigint
    CHECK (credits_charged IS NULL OR credits_charged >= 0),
  ADD COLUMN IF NOT EXISTS billing_mode text
    CHECK (billing_mode IS NULL OR billing_mode IN ('shadow', 'enforced'));

ALTER TABLE ai_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_model_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_credit_wallets_select ON ai_credit_wallets;
CREATE POLICY ai_credit_wallets_select ON ai_credit_wallets FOR SELECT
  USING (is_account_member(account_id, 'supervisor'));

DROP POLICY IF EXISTS ai_credit_ledger_select ON ai_credit_ledger;
CREATE POLICY ai_credit_ledger_select ON ai_credit_ledger FOR SELECT
  USING (is_account_member(account_id, 'supervisor'));

-- Pricing and platform settings are intentionally service-role only.
-- Tenant-facing roles can read only their own wallet and ledger.
REVOKE ALL ON ai_billing_settings, ai_model_prices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ai_credit_wallets, ai_credit_ledger FROM PUBLIC, anon;
GRANT SELECT ON ai_credit_wallets, ai_credit_ledger TO authenticated;
GRANT ALL ON ai_billing_settings, ai_model_prices TO service_role;
GRANT SELECT ON ai_credit_wallets, ai_credit_ledger TO service_role;

INSERT INTO ai_credit_wallets (account_id)
SELECT id FROM accounts
ON CONFLICT (account_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_ai_credit_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO ai_credit_wallets (account_id)
  VALUES (NEW.id)
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.ensure_ai_credit_wallet() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ensure_ai_credit_wallet() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ensure_ai_credit_wallet_after_account_insert ON accounts;
CREATE TRIGGER ensure_ai_credit_wallet_after_account_insert
  AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION public.ensure_ai_credit_wallet();

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
      SELECT 'insufficient_funds'::text, COALESCE(v_balance, 0), NULL::uuid;
    RETURN;
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

COMMENT ON TABLE ai_credit_wallets IS
  'AI credit balances; initialized at zero. Credits are not granted by this migration.';
COMMENT ON TABLE ai_credit_ledger IS
  'Append-only account credit history. Mutations are performed by trusted server-side operations only.';
COMMENT ON FUNCTION public.ai_credit_debit(
  uuid, bigint, text, bigint, bigint, uuid, text, text, jsonb
) IS
  'Atomic, idempotent usage debit. Callable only with the Supabase service-role JWT.';
