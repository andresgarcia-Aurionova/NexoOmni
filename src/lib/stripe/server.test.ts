import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getStripeAppUrl,
  isStripeCheckoutConfigured,
} from './server';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Stripe server configuration', () => {
  it('keeps checkout disabled until enabled with credentials and a canonical URL', () => {
    vi.stubEnv('STRIPE_CHECKOUT_ENABLED', 'true');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_example');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_example');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://nexoomni.example');

    expect(isStripeCheckoutConfigured()).toBe(true);
    vi.stubEnv('STRIPE_CHECKOUT_ENABLED', 'false');
    expect(isStripeCheckoutConfigured()).toBe(false);
  });

  it('rejects unsafe or malformed return URLs', () => {
    vi.stubEnv('STRIPE_CHECKOUT_ENABLED', 'true');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_example');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_example');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'not-a-url');

    expect(isStripeCheckoutConfigured()).toBe(false);
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
});
