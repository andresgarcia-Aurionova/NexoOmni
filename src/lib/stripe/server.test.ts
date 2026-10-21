import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decryptStripeSecret: vi.fn(),
  readPlatformStripeSettings: vi.fn(),
}));

vi.mock('./platform-settings', () => ({
  decryptStripeSecret: mocks.decryptStripeSecret,
  readPlatformStripeSettings: mocks.readPlatformStripeSettings,
  StripeSecretUnreadableError: class StripeSecretUnreadableError extends Error {},
  StripeSettingsMigrationPendingError: class StripeSettingsMigrationPendingError extends Error {},
}));

import {
  getStripeAppUrl,
  getStripeCheckoutConfiguration,
  getStripeWebhookSecrets,
  isStripeCheckoutConfigured,
} from './server';

function settings(overrides: Record<string, unknown> = {}) {
  return {
    active_mode: 'test',
    checkout_enabled: true,
    test_secret_key_encrypted: 'encrypted-test-api',
    test_webhook_secret_encrypted: 'encrypted-test-webhook',
    live_secret_key_encrypted: 'encrypted-live-api',
    live_webhook_secret_encrypted: 'encrypted-live-webhook',
    updated_at: '2026-10-21T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readPlatformStripeSettings.mockResolvedValue(settings());
  mocks.decryptStripeSecret.mockImplementation((value: string | null) => {
    const decrypted: Record<string, string> = {
      'encrypted-test-api': 'sk_test_example',
      'encrypted-test-webhook': 'whsec_test_example',
      'encrypted-live-api': 'sk_live_example',
      'encrypted-live-webhook': 'whsec_live_example',
    };
    return value ? (decrypted[value] ?? null) : null;
  });
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://nexoomni.example');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Stripe server configuration', () => {
  it('loads the active mode credentials from central settings', async () => {
    await expect(getStripeCheckoutConfiguration()).resolves.toEqual({
      mode: 'test',
      secretKey: 'sk_test_example',
      webhookSecret: 'whsec_test_example',
      appUrl: 'https://nexoomni.example',
    });
    await expect(isStripeCheckoutConfigured()).resolves.toBe(true);
  });

  it('selects live credentials when live mode is active', async () => {
    mocks.readPlatformStripeSettings.mockResolvedValue(
      settings({ active_mode: 'live' })
    );

    await expect(getStripeCheckoutConfiguration()).resolves.toEqual({
      mode: 'live',
      secretKey: 'sk_live_example',
      webhookSecret: 'whsec_live_example',
      appUrl: 'https://nexoomni.example',
    });
  });

  it('keeps checkout disabled until explicitly enabled', async () => {
    mocks.readPlatformStripeSettings.mockResolvedValue(
      settings({ checkout_enabled: false })
    );

    await expect(getStripeCheckoutConfiguration()).resolves.toBeNull();
    await expect(isStripeCheckoutConfigured()).resolves.toBe(false);
  });

  it('rejects unsafe or malformed return URLs', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'not-a-url');

    await expect(getStripeCheckoutConfiguration()).resolves.toBeNull();
    await expect(isStripeCheckoutConfigured()).resolves.toBe(false);
    expect(() => getStripeAppUrl()).toThrow(
      'The configured Stripe Checkout URL is invalid.'
    );
  });

  it('allows HTTPS only for deployed checkout return URLs', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://nexoomni.example');

    expect(() => getStripeAppUrl()).toThrow(
      'The configured Stripe Checkout URL is invalid.'
    );
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://nexoomni.example');
    expect(getStripeAppUrl()).toBe('https://nexoomni.example');
  });

  it('loads webhook secrets for both modes independently of the active mode', async () => {
    await expect(getStripeWebhookSecrets()).resolves.toEqual({
      test: 'whsec_test_example',
      live: 'whsec_live_example',
    });
  });
});
