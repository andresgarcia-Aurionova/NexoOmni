import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  requireEntitlement: vi.fn(),
  loadBanxicoFix: vi.fn(),
  getStripeCheckoutConfiguration: vi.fn(),
  createStripeServerClient: vi.fn(),
  getLocale: vi.fn(),
  getTranslations: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createAdminClient,
}));
vi.mock('@/lib/account/entitlements', () => ({
  requireEntitlement: mocks.requireEntitlement,
}));
vi.mock('@/lib/billing/banxico-fx', () => ({
  loadBanxicoFix: mocks.loadBanxicoFix,
}));
vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: () =>
    Response.json({ error: 'Internal server error' }, { status: 500 }),
}));
vi.mock('@/lib/stripe/server', () => ({
  createStripeServerClient: mocks.createStripeServerClient,
  getStripeCheckoutConfiguration: mocks.getStripeCheckoutConfiguration,
}));
vi.mock('next-intl/server', () => ({
  getLocale: mocks.getLocale,
  getTranslations: mocks.getTranslations,
}));

import { POST } from './route';

function request(packageId: string) {
  return new Request('https://nexoomni.example/api/account/credits/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ package_id: packageId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test');
  const insertedRows: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  mocks.requireEntitlement.mockResolvedValue({
    accountId: 'account-1',
    userId: randomUUID(),
  });
  mocks.loadBanxicoFix.mockResolvedValue({
    mxnPerUsdMicro: BigInt(18_420_000),
    date: '2026-10-21',
    fetchedAt: '2026-10-21T12:00:00.000Z',
    source: 'Banxico SIE SF43718',
  });
  mocks.getStripeCheckoutConfiguration.mockResolvedValue({
    mode: 'test',
    secretKey: 'sk_test_example',
    webhookSecret: 'whsec_test_example',
    appUrl: 'https://nexoomni.example',
  });
  mocks.getLocale.mockResolvedValue('es');
  mocks.getTranslations.mockResolvedValue(
    (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key
  );
  mocks.createStripeServerClient.mockReturnValue({
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: 'cs_test_123',
          url: 'https://checkout.stripe.com/c/pay/cs_test_123',
        }),
      },
    },
  });
  mocks.createAdminClient.mockReturnValue({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        insertedRows.push(row);
        return { error: null };
      },
      update: (row: Record<string, unknown>) => ({
        eq: async () => {
          updates.push(row);
          return { error: null };
        },
      }),
    }),
  });
  Object.assign(mocks, { insertedRows, updates });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/account/credits/checkout', () => {
  it('creates a MXN card checkout using the current FIX and approved package', async () => {
    const response = await POST(request('entrepreneur'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      package_id: 'entrepreneur',
      credits: 50_000,
      fx_date: '2026-10-21',
    });
    expect(mocks.requireEntitlement).toHaveBeenCalledWith(
      'ai_conversation_intelligence',
      'supervisor'
    );

    const stripe = mocks.createStripeServerClient.mock.results[0]?.value;
    const [params, options] = stripe.checkout.sessions.create.mock.calls[0];
    expect(params).toMatchObject({
      mode: 'payment',
      allowed_payment_method_types: ['card'],
      invoice_creation: { enabled: false },
      client_reference_id: expect.any(String),
      line_items: [
        { price_data: { currency: 'mxn', unit_amount: expect.any(Number) } },
        { price_data: { currency: 'mxn', unit_amount: expect.any(Number) } },
      ],
      success_url:
        'https://nexoomni.example/credits?checkout=success',
      cancel_url:
        'https://nexoomni.example/credits?checkout=cancelled',
    });
    expect(
      params.line_items.map(
        (item: { price_data: { unit_amount: number } }) =>
          item.price_data.unit_amount
      )
    ).toEqual([97_847, 15_656]);
    expect(options).toEqual({
      idempotencyKey: `ai-credit-checkout:${params.client_reference_id}`,
    });

    const { insertedRows, updates } = mocks as unknown as {
      insertedRows: Record<string, unknown>[];
      updates: Record<string, unknown>[];
    };
    expect(insertedRows[0]).toMatchObject({
      account_id: 'account-1',
      package_id: 'entrepreneur',
      stripe_mode: 'test',
      credits: 50_000,
      package_base_mxn_centavos: '92100',
      processing_cost_included_mxn_centavos: '5747',
      fx_rate_micro: '18420000',
    });
    expect(updates).toContainEqual({
      stripe_checkout_session_id: 'cs_test_123',
    });
  });

  it('rejects unknown packages without creating a session', async () => {
    const response = await POST(request('made-up-package'));
    expect(response.status).toBe(400);
    expect(mocks.createStripeServerClient).not.toHaveBeenCalled();
  });

  it('does not create a session until checkout is explicitly enabled', async () => {
    mocks.getStripeCheckoutConfiguration.mockResolvedValue(null);

    const response = await POST(request('entrepreneur'));

    expect(response.status).toBe(503);
    expect(mocks.createStripeServerClient).not.toHaveBeenCalled();
  });
});
