import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  decryptStripeSecret: vi.fn(),
  encrypt: vi.fn(),
  getStripeAppUrl: vi.fn(),
  readPlatformStripeSettings: vi.fn(),
  rateLimitResponse: vi.fn(),
  requirePlatformOperator: vi.fn(),
  stripeSettingsSummary: vi.fn(),
  supabaseAdmin: vi.fn(),
  toErrorResponse: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: mocks.toErrorResponse,
}));
vi.mock('@/lib/stripe/platform-settings', () => ({
  decryptStripeSecret: mocks.decryptStripeSecret,
  readPlatformStripeSettings: mocks.readPlatformStripeSettings,
  StripeSecretUnreadableError: class StripeSecretUnreadableError extends Error {},
  StripeSettingsMigrationPendingError: class StripeSettingsMigrationPendingError extends Error {},
  stripeSettingsSummary: mocks.stripeSettingsSummary,
}));
vi.mock('@/lib/stripe/server', () => ({
  getStripeAppUrl: mocks.getStripeAppUrl,
}));
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: mocks.encrypt,
}));
vi.mock('@/lib/platform/operator', () => ({
  requirePlatformOperator: mocks.requirePlatformOperator,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  RATE_LIMITS: { adminAction: {} },
  rateLimitResponse: mocks.rateLimitResponse,
}));

import { GET, POST } from './route';

function request(body: Record<string, unknown>) {
  return new Request('https://nexoomni.example/api/platform/stripe-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function storedSettings() {
  return {
    active_mode: 'test',
    checkout_enabled: false,
    test_secret_key_encrypted: null,
    test_webhook_secret_encrypted: null,
    live_secret_key_encrypted: null,
    live_webhook_secret_encrypted: null,
    updated_at: '2026-10-21T12:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePlatformOperator.mockResolvedValue({
    user: { id: 'operator-1' },
  });
  mocks.checkRateLimit.mockReturnValue({ success: true });
  mocks.toErrorResponse.mockImplementation(() =>
    Response.json({ error: 'Internal server error' }, { status: 500 })
  );
  mocks.readPlatformStripeSettings.mockResolvedValue(storedSettings());
  mocks.stripeSettingsSummary.mockReturnValue({
    active_mode: 'test',
    checkout_enabled: false,
    test_secret_configured: false,
    test_webhook_configured: false,
    live_secret_configured: false,
    live_webhook_configured: false,
    updated_at: '2026-10-21T12:00:00.000Z',
  });
  mocks.encrypt.mockImplementation((value: string) => `encrypted:${value}`);
  mocks.decryptStripeSecret.mockImplementation(
    (value: string | null) => value?.replace(/^encrypted:/, '') ?? null
  );
  mocks.getStripeAppUrl.mockReturnValue('https://nexoomni.example');
  mocks.supabaseAdmin.mockReturnValue({
    from: () => ({ upsert: mocks.upsert }),
  });
  mocks.upsert.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/api/platform/stripe-settings', () => {
  it('returns configuration status without returning stored secrets', async () => {
    mocks.readPlatformStripeSettings.mockResolvedValue({
      ...storedSettings(),
      test_secret_key_encrypted: 'encrypted:sk_test_private',
      test_webhook_secret_encrypted: 'encrypted:whsec_private',
    });
    mocks.stripeSettingsSummary.mockReturnValue({
      active_mode: 'test',
      checkout_enabled: false,
      test_secret_configured: true,
      test_webhook_configured: true,
      live_secret_configured: false,
      live_webhook_configured: false,
      updated_at: '2026-10-21T12:00:00.000Z',
    });

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"test_secret_configured":true');
    expect(body).not.toContain('sk_test_private');
    expect(body).not.toContain('whsec_private');
  });

  it('encrypts test credentials before storing them', async () => {
    const response = await POST(
      request({
        active_mode: 'test',
        checkout_enabled: false,
        test_secret_key: 'sk_test_private',
        test_webhook_secret: 'whsec_private',
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        active_mode: 'test',
        checkout_enabled: false,
        test_secret_key_encrypted: 'encrypted:sk_test_private',
        test_webhook_secret_encrypted: 'encrypted:whsec_private',
        updated_by: 'operator-1',
      }),
      { onConflict: 'id' }
    );
    expect(await response.text()).not.toContain('sk_test_private');
  });

  it('rejects enabling live Checkout without explicit confirmation', async () => {
    const response = await POST(
      request({
        active_mode: 'live',
        checkout_enabled: true,
        live_secret_key: 'sk_live_private',
        live_webhook_secret: 'whsec_live_private',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'STRIPE_LIVE_CONFIRMATION_REQUIRED',
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('rejects credentials whose prefix does not match the selected mode', async () => {
    const response = await POST(
      request({
        active_mode: 'test',
        checkout_enabled: false,
        test_secret_key: 'sk_live_private',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'STRIPE_TEST_API_KEY_INVALID',
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('allows confirmed live Checkout only when both live secrets are present', async () => {
    const response = await POST(
      request({
        active_mode: 'live',
        checkout_enabled: true,
        confirm_live_activation: true,
        live_secret_key: 'sk_live_private',
        live_webhook_secret: 'whsec_live_private',
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.getStripeAppUrl).toHaveBeenCalledOnce();
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        active_mode: 'live',
        checkout_enabled: true,
        live_secret_key_encrypted: 'encrypted:sk_live_private',
        live_webhook_secret_encrypted: 'encrypted:whsec_live_private',
      }),
      { onConflict: 'id' }
    );
  });
});
