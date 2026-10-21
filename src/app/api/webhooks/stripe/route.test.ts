import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createStripeServerClient: vi.fn(),
  syncZernioCallsWithCreditBalance: vi.fn(),
  toErrorResponse: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createAdminClient,
}));
vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: mocks.toErrorResponse,
}));
vi.mock('@/lib/stripe/server', () => ({
  createStripeServerClient: mocks.createStripeServerClient,
}));
vi.mock('@/lib/zernio/call-credit-pause', () => ({
  syncZernioCallsWithCreditBalance: mocks.syncZernioCallsWithCreditBalance,
}));

import { calculateAiCreditCheckoutPrice } from '@/lib/billing/stripe-credit-pricing';
import { POST } from './route';

const checkoutId = '123e4567-e89b-42d3-a456-426614174000';
const accountId = '123e4567-e89b-42d3-a456-426614174001';

function paidSession() {
  const price = calculateAiCreditCheckoutPrice(
    'entrepreneur',
    BigInt(18_420_000)
  );
  return {
    id: 'cs_test_123',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    currency: 'mxn',
    client_reference_id: checkoutId,
    metadata: {
      credit_checkout_id: checkoutId,
      package_id: 'entrepreneur',
    },
    amount_total: Number(price.totalCentavos),
    payment_intent: 'pi_test_123',
  };
}

function configureDatabase(status: 'pending' | 'credited' = 'pending') {
  const row = {
    id: checkoutId,
    account_id: accountId,
    package_id: 'entrepreneur',
    credits: 50_000,
    amount_total_mxn_centavos: paidSession().amount_total,
    stripe_checkout_session_id: status === 'credited' ? 'cs_test_123' : null,
    stripe_payment_intent_id: status === 'credited' ? 'pi_test_123' : null,
    credit_ledger_entry_id: status === 'credited' ? 'ledger-123' : null,
    status,
  };
  const updates: Record<string, unknown>[] = [];
  const builder = {
    select: vi.fn(() => builder),
    update: vi.fn((values: Record<string, unknown>) => {
      updates.push(values);
      return builder;
    }),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
    then: (
      resolve: (value: { error: null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve({ error: null }).then(resolve, reject),
  };
  const admin = {
    from: vi.fn(() => builder),
    rpc: vi.fn(async () => ({
      data: [
        {
          result: 'granted',
          available_credits: '50000',
          ledger_entry_id: 'ledger-123',
        },
      ],
      error: null,
    })),
  };
  mocks.createAdminClient.mockReturnValue(admin);
  return { admin, updates, row };
}

function signedRequest() {
  return new Request('https://nexoomni.example/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=signature' },
    body: '{}',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_example');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_example');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test');
  mocks.toErrorResponse.mockImplementation(() =>
    Response.json({ error: 'Internal server error' }, { status: 500 })
  );
  mocks.syncZernioCallsWithCreditBalance.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/webhooks/stripe', () => {
  it('verifies and idempotently credits a paid session', async () => {
    const { admin, updates } = configureDatabase();
    const session = paidSession();
    mocks.createStripeServerClient.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn().mockReturnValue({
          type: 'checkout.session.completed',
          data: { object: session },
        }),
      },
    });

    const response = await POST(signedRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(admin.rpc).toHaveBeenCalledWith('platform_ai_credit_grant', {
      p_account_id: accountId,
      p_credits: 50_000,
      p_idempotency_key: 'stripe:payment:pi_test_123',
      p_entry_type: 'purchase',
      p_reason: 'Stripe Checkout package entrepreneur',
      p_actor_user_id: null,
      p_source: 'stripe_checkout',
    });
    expect(updates).toEqual([
      {
        stripe_checkout_session_id: 'cs_test_123',
        stripe_payment_intent_id: 'pi_test_123',
        paid_at: expect.any(String),
      },
      {
        status: 'credited',
        credit_ledger_entry_id: 'ledger-123',
        credited_at: expect.any(String),
      },
    ]);
    expect(mocks.syncZernioCallsWithCreditBalance).toHaveBeenCalledWith(
      expect.anything(),
      accountId,
      BigInt(50_000)
    );
  });

  it('does not credit a duplicate already-completed session', async () => {
    const { admin } = configureDatabase('credited');
    mocks.createStripeServerClient.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn().mockReturnValue({
          type: 'checkout.session.completed',
          data: { object: paidSession() },
        }),
      },
    });

    const response = await POST(signedRequest());

    expect(response.status).toBe(200);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(mocks.syncZernioCallsWithCreditBalance).not.toHaveBeenCalled();
  });

  it('does not credit a session whose total differs from the stored checkout', async () => {
    const { admin } = configureDatabase();
    const session = { ...paidSession(), amount_total: 1 };
    mocks.createStripeServerClient.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn().mockReturnValue({
          type: 'checkout.session.completed',
          data: { object: session },
        }),
      },
    });

    const response = await POST(signedRequest());

    expect(response.status).toBe(500);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(mocks.syncZernioCallsWithCreditBalance).not.toHaveBeenCalled();
  });

  it('rejects a webhook with an invalid signature', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createStripeServerClient.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => {
          throw new Error('invalid signature');
        }),
      },
    });

    const response = await POST(signedRequest());

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      '[stripe webhook] Signature verification failed:',
      expect.any(Error)
    );
  });
});
