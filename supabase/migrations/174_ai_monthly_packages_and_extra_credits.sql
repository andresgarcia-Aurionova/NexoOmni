-- Monthly AI credit packages (Stripe subscriptions), extra credits sold at a
-- surcharge, and a fixed WhatsApp call connection price.

-- 1) Fixed connection price charged per WhatsApp call (default US$0.10). The
--    charge is the greater of this and Zernio's billed cost plus margin.
ALTER TABLE public.ai_billing_settings
  ADD COLUMN IF NOT EXISTS call_connection_price_nano_usd bigint NOT NULL
    DEFAULT 100000000
    CHECK (call_connection_price_nano_usd >= 0);

COMMENT ON COLUMN public.ai_billing_settings.call_connection_price_nano_usd IS
  'Minimum price (nano USD) debited as credits for each WhatsApp call connection.';

-- 2) One-time checkouts now also sell extra credit packs (list price + 20 %).
--    Legacy package ids stay valid so historical rows and in-flight sessions
--    still pass validation.
DO $$
DECLARE
  v_constraint text;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.stripe_ai_credit_checkouts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%package_id%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.stripe_ai_credit_checkouts DROP CONSTRAINT %I',
      v_constraint
    );
  END LOOP;
END $$;

ALTER TABLE public.stripe_ai_credit_checkouts
  ADD CONSTRAINT stripe_ai_credit_checkouts_package_credits_check CHECK (
    (package_id = 'entrepreneur' AND credits = 50000)
    OR (package_id = 'commercial_pro' AND credits = 150000)
    OR (package_id = 'corporate' AND credits = 300000)
    OR (package_id = 'extra_10k' AND credits = 10000)
    OR (package_id = 'extra_25k' AND credits = 25000)
  );

-- 3) Monthly package subscription per account. Written only by the Stripe
--    webhook and the account billing routes through service_role; customers
--    read it via /api/account/credits, so no user RLS policy is defined.
CREATE TABLE public.ai_credit_subscriptions (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  package_id text NOT NULL CHECK (
    package_id IN ('starter', 'entrepreneur', 'commercial_pro', 'corporate')
  ),
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'past_due', 'canceled')
  ),
  stripe_mode text NOT NULL CHECK (stripe_mode IN ('test', 'live')),
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text NOT NULL UNIQUE,
  monthly_total_mxn_centavos bigint CHECK (monthly_total_mxn_centavos > 0),
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_credit_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_credit_subscriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_credit_subscriptions TO service_role;

COMMENT ON TABLE public.ai_credit_subscriptions IS
  'Service-role-only monthly AI credit package subscriptions; credits are granted per paid Stripe invoice.';

-- 4) Grants one month of package credits. The lot expires at the end of the
--    paid period (credits do not roll over): on a renewal the unused credits
--    of earlier subscription lots expire immediately. On an upgrade the old
--    lot is kept until its own expiry. Idempotent per invoice.
CREATE OR REPLACE FUNCTION public.platform_ai_subscription_grant(
  p_account_id uuid,
  p_credits bigint,
  p_idempotency_key text,
  p_reason text,
  p_expires_at timestamptz,
  p_expire_previous boolean
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
  v_grant record;
  v_balance bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'Invalid subscription credit expiry' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_grant
  FROM public.platform_ai_credit_grant(
    p_account_id,
    p_credits,
    p_idempotency_key,
    'purchase',
    p_reason,
    NULL,
    'stripe_checkout'
  );

  IF v_grant.result = 'granted' THEN
    UPDATE ai_credit_ledger AS ledger
    SET metadata = ledger.metadata || jsonb_build_object(
      'expires_at', p_expires_at,
      'subscription', true
    )
    WHERE ledger.id = v_grant.ledger_entry_id;

    UPDATE ai_credit_batches AS batch
    SET expires_at = p_expires_at
    WHERE batch.ledger_entry_id = v_grant.ledger_entry_id;

    IF p_expire_previous THEN
      UPDATE ai_credit_batches AS batch
      SET expires_at = now()
      FROM ai_credit_ledger AS ledger
      WHERE batch.ledger_entry_id = ledger.id
        AND batch.account_id = p_account_id
        AND batch.ledger_entry_id <> v_grant.ledger_entry_id
        AND batch.remaining_credits > 0
        AND batch.expires_at > now()
        AND ledger.metadata ->> 'subscription' = 'true';

      PERFORM public.expire_ai_credit_batches(p_account_id, 100);
    END IF;
  END IF;

  SELECT wallet.available_credits INTO v_balance
  FROM ai_credit_wallets AS wallet
  WHERE wallet.account_id = p_account_id;

  RETURN QUERY
    SELECT v_grant.result, v_balance, v_grant.ledger_entry_id;
END;
$$;

ALTER FUNCTION public.platform_ai_subscription_grant(uuid, bigint, text, text, timestamptz, boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_ai_subscription_grant(uuid, bigint, text, text, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_ai_subscription_grant(uuid, bigint, text, text, timestamptz, boolean)
  TO service_role;
