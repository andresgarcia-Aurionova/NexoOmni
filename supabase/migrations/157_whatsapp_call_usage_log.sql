-- Per-call usage of WhatsApp calls reported by Zernio (call.ended webhook).
-- Shadow measurement only: nothing here touches wallets or the credit ledger.

ALTER TABLE public.ai_billing_settings
  ADD COLUMN IF NOT EXISTS call_minute_price_mxn_centavos integer NOT NULL DEFAULT 50
    CHECK (call_minute_price_mxn_centavos >= 0),
  ADD COLUMN IF NOT EXISTS mxn_per_usd_micro bigint
    CHECK (mxn_per_usd_micro IS NULL OR mxn_per_usd_micro > 0);

COMMENT ON COLUMN public.ai_billing_settings.call_minute_price_mxn_centavos IS
  'Price charged to the tenant per started talk minute of a WhatsApp call, in MXN centavos (50 = $0.50 MXN).';
COMMENT ON COLUMN public.ai_billing_settings.mxn_per_usd_micro IS
  'MXN per 1 USD in millionths (17500000 = 17.50). NULL until set; minute credits are not computed without it.';

CREATE TABLE IF NOT EXISTS public.call_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  connector_id uuid REFERENCES public.omnichannel_connectors(id) ON DELETE SET NULL,
  zernio_call_id text NOT NULL,
  zernio_event_id text,
  zernio_account_id text NOT NULL,
  phone_number_id text,
  direction text CHECK (direction IS NULL OR direction IN ('inbound', 'outbound')),
  end_reason text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  billable_minutes integer NOT NULL DEFAULT 0 CHECK (billable_minutes >= 0),
  -- Zernio-billed amount (Telnyx leg + recording), nanodollars.
  zernio_cost_nano_usd bigint NOT NULL DEFAULT 0 CHECK (zernio_cost_nano_usd >= 0),
  -- Billed by Meta directly to the WABA; informational, never charged to credits.
  meta_cost_nano_usd bigint NOT NULL DEFAULT 0 CHECK (meta_cost_nano_usd >= 0),
  connection_price_nano_usd bigint NOT NULL DEFAULT 0 CHECK (connection_price_nano_usd >= 0),
  connection_credits bigint NOT NULL DEFAULT 0 CHECK (connection_credits >= 0),
  minute_price_mxn_centavos integer NOT NULL DEFAULT 0 CHECK (minute_price_mxn_centavos >= 0),
  mxn_per_usd_micro bigint CHECK (mxn_per_usd_micro IS NULL OR mxn_per_usd_micro > 0),
  minute_credits bigint CHECK (minute_credits IS NULL OR minute_credits >= 0),
  billing_mode text NOT NULL DEFAULT 'off'
    CHECK (billing_mode IN ('off', 'shadow', 'enforced')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (zernio_call_id)
);

CREATE INDEX IF NOT EXISTS idx_call_usage_log_account_created
  ON public.call_usage_log (account_id, created_at DESC);

-- Contains provider costs, so (like ai_usage_log) it is service-role only.
ALTER TABLE public.call_usage_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.call_usage_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.call_usage_log TO service_role;
