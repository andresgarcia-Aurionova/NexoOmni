CREATE TABLE public.ai_credit_call_pause_accounts (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  balance_at_pause bigint NOT NULL DEFAULT 0 CHECK (balance_at_pause >= 0),
  pause_reason text NOT NULL DEFAULT 'balance_exhausted'
    CHECK (pause_reason IN ('balance_exhausted', 'insufficient_call_balance'))
);

CREATE TABLE public.ai_credit_call_pause_numbers (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL,
  zernio_account_id text NOT NULL,
  balance_at_pause bigint NOT NULL DEFAULT 0 CHECK (balance_at_pause >= 0),
  pause_reason text NOT NULL DEFAULT 'balance_exhausted'
    CHECK (pause_reason IN ('balance_exhausted', 'insufficient_call_balance')),
  paused_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, phone_number_id)
);

ALTER TABLE public.ai_credit_call_pause_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_credit_call_pause_numbers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_credit_call_pause_accounts,
  public.ai_credit_call_pause_numbers FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_credit_call_pause_accounts,
  public.ai_credit_call_pause_numbers TO service_role;

COMMENT ON TABLE public.ai_credit_call_pause_accounts IS
  'Internal retry marker for synchronizing Zernio call availability with credit balances. Service-role-only by design.';
COMMENT ON TABLE public.ai_credit_call_pause_numbers IS
  'Records only WhatsApp numbers that NexoOmni disabled for credit exhaustion or an uncovered call charge, so recharging never enables numbers that were already disabled. Service-role-only by design.';
