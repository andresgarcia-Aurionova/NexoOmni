import Stripe from 'stripe';

import {
  decryptStripeSecret,
  readPlatformStripeSettings,
  StripeSecretUnreadableError,
  StripeSettingsMigrationPendingError,
  type StripeMode,
} from './platform-settings';

export type StripeCheckoutConfiguration = {
  mode: StripeMode;
  secretKey: string;
  webhookSecret: string;
  appUrl: string;
};

export function createStripeServerClient(secretKey: string): Stripe {
  if (!secretKey) throw new Error('The Stripe secret key is not configured.');
  return new Stripe(secretKey);
}

export async function getStripeCheckoutConfiguration(): Promise<StripeCheckoutConfiguration | null> {
  const settings = await readPlatformStripeSettings();
  if (!settings.checkout_enabled) return null;

  const mode = settings.active_mode;
  const secretKey = decryptStripeSecret(
    mode === 'test'
      ? settings.test_secret_key_encrypted
      : settings.live_secret_key_encrypted,
    `${mode} API key`
  );
  const webhookSecret = decryptStripeSecret(
    mode === 'test'
      ? settings.test_webhook_secret_encrypted
      : settings.live_webhook_secret_encrypted,
    `${mode} webhook secret`
  );
  const appUrl = parseStripeAppUrl();
  if (!secretKey || !webhookSecret || !appUrl) return null;
  return { mode, secretKey, webhookSecret, appUrl: appUrl.origin };
}

export async function getStripeWebhookSecrets(): Promise<
  Record<StripeMode, string | null>
> {
  const settings = await readPlatformStripeSettings();
  const loadSecret = (
    encryptedValue: string | null,
    field: string
  ): string | null => {
    try {
      return decryptStripeSecret(encryptedValue, field);
    } catch (error) {
      if (error instanceof StripeSecretUnreadableError) return null;
      throw error;
    }
  };

  return {
    test: loadSecret(
      settings.test_webhook_secret_encrypted,
      'test webhook secret'
    ),
    live: loadSecret(
      settings.live_webhook_secret_encrypted,
      'live webhook secret'
    ),
  };
}

export async function isStripeCheckoutConfigured(): Promise<boolean> {
  try {
    return Boolean(await getStripeCheckoutConfiguration());
  } catch (error) {
    if (
      error instanceof StripeSettingsMigrationPendingError ||
      error instanceof StripeSecretUnreadableError
    ) {
      console.error('[stripe settings] Checkout is not ready:', error);
      return false;
    }
    throw error;
  }
}

function parseStripeAppUrl(): URL | null {
  const configuredUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.APP_URL?.trim();
  if (!configuredUrl || !URL.canParse(configuredUrl)) return null;

  const url = new URL(configuredUrl);
  const isLocalhost =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1';
  if (
    (url.protocol !== 'https:' &&
      !(process.env.NODE_ENV !== 'production' && isLocalhost)) ||
    url.username ||
    url.password
  ) {
    return null;
  }

  return url;
}

export function getStripeAppUrl(): string {
  const url = parseStripeAppUrl();
  if (!url) throw new Error('The configured Stripe Checkout URL is invalid.');
  return url.origin;
}
