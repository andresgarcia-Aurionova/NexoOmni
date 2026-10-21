import { supabaseAdmin } from '@/lib/ai/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';

export type StripeMode = 'test' | 'live';

export type PlatformStripeSettings = {
  active_mode: StripeMode;
  checkout_enabled: boolean;
  test_secret_key_encrypted: string | null;
  test_webhook_secret_encrypted: string | null;
  live_secret_key_encrypted: string | null;
  live_webhook_secret_encrypted: string | null;
  updated_at: string;
};

export class StripeSettingsMigrationPendingError extends Error {
  constructor() {
    super('Stripe platform settings migration 167 is not available.');
  }
}

export class StripeSecretUnreadableError extends Error {
  constructor(field: string) {
    super(`The stored Stripe ${field} could not be decrypted.`);
  }
}

function isStripeMode(value: unknown): value is StripeMode {
  return value === 'test' || value === 'live';
}

function encryptedValue(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid stored Stripe settings field: ${field}.`);
  }
  return value;
}

export async function readPlatformStripeSettings(): Promise<PlatformStripeSettings> {
  const { data, error } = await supabaseAdmin()
    .from('platform_stripe_settings')
    .select(
      'active_mode,checkout_enabled,test_secret_key_encrypted,test_webhook_secret_encrypted,live_secret_key_encrypted,live_webhook_secret_encrypted,updated_at'
    )
    .eq('id', true)
    .maybeSingle();

  if (
    error?.code === '42P01' ||
    error?.code === '42703' ||
    error?.code === 'PGRST204' ||
    error?.code === 'PGRST205'
  ) {
    throw new StripeSettingsMigrationPendingError();
  }
  if (error) throw error;
  if (!data) throw new Error('Platform Stripe settings row is missing.');
  if (!isStripeMode(data.active_mode)) {
    throw new Error('Invalid stored Stripe mode.');
  }
  if (typeof data.checkout_enabled !== 'boolean') {
    throw new Error('Invalid stored Stripe checkout state.');
  }
  if (typeof data.updated_at !== 'string') {
    throw new Error('Invalid stored Stripe settings timestamp.');
  }

  return {
    active_mode: data.active_mode,
    checkout_enabled: data.checkout_enabled,
    test_secret_key_encrypted: encryptedValue(
      data.test_secret_key_encrypted,
      'test_secret_key_encrypted'
    ),
    test_webhook_secret_encrypted: encryptedValue(
      data.test_webhook_secret_encrypted,
      'test_webhook_secret_encrypted'
    ),
    live_secret_key_encrypted: encryptedValue(
      data.live_secret_key_encrypted,
      'live_secret_key_encrypted'
    ),
    live_webhook_secret_encrypted: encryptedValue(
      data.live_webhook_secret_encrypted,
      'live_webhook_secret_encrypted'
    ),
    updated_at: data.updated_at,
  };
}

export function decryptStripeSecret(
  encryptedValue: string | null,
  field: string
): string | null {
  if (!encryptedValue) return null;
  try {
    return decrypt(encryptedValue);
  } catch (error) {
    console.error(
      `[stripe settings] Stored ${field} could not be decrypted:`,
      error
    );
    throw new StripeSecretUnreadableError(field);
  }
}

export function stripeSettingsSummary(settings: PlatformStripeSettings) {
  return {
    active_mode: settings.active_mode,
    checkout_enabled: settings.checkout_enabled,
    test_secret_configured: Boolean(settings.test_secret_key_encrypted),
    test_webhook_configured: Boolean(settings.test_webhook_secret_encrypted),
    live_secret_configured: Boolean(settings.live_secret_key_encrypted),
    live_webhook_configured: Boolean(settings.live_webhook_secret_encrypted),
    updated_at: settings.updated_at,
  };
}
