CREATE TABLE public.platform_stripe_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  active_mode text NOT NULL DEFAULT 'test'
    CHECK (active_mode IN ('test', 'live')),
  checkout_enabled boolean NOT NULL DEFAULT false,
  test_secret_key_encrypted text,
  test_webhook_secret_encrypted text,
  live_secret_key_encrypted text,
  live_webhook_secret_encrypted text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    NOT checkout_enabled
    OR (
      active_mode = 'test'
      AND test_secret_key_encrypted IS NOT NULL
      AND test_webhook_secret_encrypted IS NOT NULL
    )
    OR (
      active_mode = 'live'
      AND live_secret_key_encrypted IS NOT NULL
      AND live_webhook_secret_encrypted IS NOT NULL
    )
  )
);

INSERT INTO public.platform_stripe_settings (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_stripe_settings ENABLE ROW LEVEL SECURITY;
-- Intentionally no user policies: only service-role routes after platform
-- operator authorization may read or write the encrypted payment credentials.
REVOKE ALL ON TABLE public.platform_stripe_settings
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.platform_stripe_settings TO service_role;

COMMENT ON TABLE public.platform_stripe_settings IS
  'Central, encrypted Stripe credentials and Checkout mode shared by all tenants; service-role-only.';

ALTER TABLE public.stripe_ai_credit_checkouts
  ADD COLUMN stripe_mode text
  CHECK (stripe_mode IN ('test', 'live'));

COMMENT ON COLUMN public.stripe_ai_credit_checkouts.stripe_mode IS
  'Stripe environment used for this Checkout; NULL is reserved for records created before migration 167.';
