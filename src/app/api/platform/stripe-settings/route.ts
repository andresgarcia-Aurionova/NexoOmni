import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import {
  decryptStripeSecret,
  readPlatformStripeSettings,
  StripeSecretUnreadableError,
  StripeSettingsMigrationPendingError,
  stripeSettingsSummary,
  type StripeMode,
} from '@/lib/stripe/platform-settings';
import { getStripeAppUrl } from '@/lib/stripe/server';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { requirePlatformOperator } from '@/lib/platform/operator';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';

const MAX_SECRET_LENGTH = 8192;
const MAX_WEBHOOK_SECRET_LENGTH = 1024;

class CredentialInputError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function isStripeMode(value: unknown): value is StripeMode {
  return value === 'test' || value === 'live';
}

function updateCredential(
  input: Record<string, unknown>,
  field: string,
  currentValue: string | null,
  mode: StripeMode,
  kind: 'api' | 'webhook',
  clear: boolean
): string | null {
  if (clear) return null;
  const raw = input[field];
  if (raw === undefined) return currentValue;
  if (typeof raw !== 'string') {
    throw new CredentialInputError('STRIPE_CREDENTIAL_INVALID');
  }
  const value = raw.trim();
  if (!value) return currentValue;

  if (kind === 'api') {
    if (
      value.length > MAX_SECRET_LENGTH ||
      (!value.startsWith(`sk_${mode}_`) && !value.startsWith(`rk_${mode}_`))
    ) {
      throw new CredentialInputError(
        mode === 'test'
          ? 'STRIPE_TEST_API_KEY_INVALID'
          : 'STRIPE_LIVE_API_KEY_INVALID'
      );
    }
  } else if (
    value.length > MAX_WEBHOOK_SECRET_LENGTH ||
    !value.startsWith('whsec_')
  ) {
    throw new CredentialInputError('STRIPE_WEBHOOK_SECRET_INVALID');
  }

  return encrypt(value);
}

function migrationPendingResponse() {
  return NextResponse.json(
    { error: 'STRIPE_SETTINGS_MIGRATION_PENDING' },
    { status: 503 }
  );
}

export async function GET() {
  try {
    await requirePlatformOperator();
    const settings = await readPlatformStripeSettings();
    return NextResponse.json(stripeSettingsSummary(settings), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof StripeSettingsMigrationPendingError) {
      return migrationPendingResponse();
    }
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const operator = await requirePlatformOperator();
    const limit = checkRateLimit(
      `platform:stripe-settings:${operator.user.id}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return NextResponse.json(
        { error: 'STRIPE_SETTINGS_INVALID' },
        { status: 400 }
      );
    }
    if (!isStripeMode(body.active_mode)) {
      return NextResponse.json(
        { error: 'STRIPE_MODE_INVALID' },
        { status: 400 }
      );
    }
    if (typeof body.checkout_enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'STRIPE_CHECKOUT_STATE_INVALID' },
        { status: 400 }
      );
    }
    for (const field of ['clear_test_credentials', 'clear_live_credentials']) {
      if (body[field] !== undefined && typeof body[field] !== 'boolean') {
        return NextResponse.json(
          { error: 'STRIPE_SETTINGS_INVALID' },
          { status: 400 }
        );
      }
    }

    const current = await readPlatformStripeSettings();
    const mode = body.active_mode;
    const clearTest = body.clear_test_credentials === true;
    const clearLive = body.clear_live_credentials === true;

    let testSecretKey: string | null;
    let testWebhookSecret: string | null;
    let liveSecretKey: string | null;
    let liveWebhookSecret: string | null;
    try {
      testSecretKey = updateCredential(
        body,
        'test_secret_key',
        current.test_secret_key_encrypted,
        'test',
        'api',
        clearTest
      );
      testWebhookSecret = updateCredential(
        body,
        'test_webhook_secret',
        current.test_webhook_secret_encrypted,
        'test',
        'webhook',
        clearTest
      );
      liveSecretKey = updateCredential(
        body,
        'live_secret_key',
        current.live_secret_key_encrypted,
        'live',
        'api',
        clearLive
      );
      liveWebhookSecret = updateCredential(
        body,
        'live_webhook_secret',
        current.live_webhook_secret_encrypted,
        'live',
        'webhook',
        clearLive
      );
    } catch (error) {
      if (error instanceof CredentialInputError) {
        return NextResponse.json({ error: error.code }, { status: 400 });
      }
      throw error;
    }

    if (
      body.checkout_enabled &&
      mode === 'live' &&
      body.confirm_live_activation !== true
    ) {
      return NextResponse.json(
        { error: 'STRIPE_LIVE_CONFIRMATION_REQUIRED' },
        { status: 400 }
      );
    }

    if (body.checkout_enabled) {
      const apiCiphertext = mode === 'test' ? testSecretKey : liveSecretKey;
      const webhookCiphertext =
        mode === 'test' ? testWebhookSecret : liveWebhookSecret;
      if (!apiCiphertext || !webhookCiphertext) {
        return NextResponse.json(
          { error: 'STRIPE_ACTIVE_CREDENTIALS_REQUIRED' },
          { status: 400 }
        );
      }

      try {
        const apiKey = decryptStripeSecret(apiCiphertext, `${mode} API key`);
        const webhookSecret = decryptStripeSecret(
          webhookCiphertext,
          `${mode} webhook secret`
        );
        if (
          !apiKey ||
          (!apiKey.startsWith(`sk_${mode}_`) &&
            !apiKey.startsWith(`rk_${mode}_`)) ||
          !webhookSecret?.startsWith('whsec_')
        ) {
          return NextResponse.json(
            { error: 'STRIPE_ACTIVE_CREDENTIALS_INVALID' },
            { status: 422 }
          );
        }
      } catch (error) {
        if (error instanceof StripeSecretUnreadableError) {
          return NextResponse.json(
            { error: 'STRIPE_SETTINGS_CREDENTIALS_UNREADABLE' },
            { status: 422 }
          );
        }
        throw error;
      }

      try {
        getStripeAppUrl();
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== 'The configured Stripe Checkout URL is invalid.'
        ) {
          throw error;
        }
        return NextResponse.json(
          { error: 'STRIPE_APP_URL_INVALID' },
          { status: 400 }
        );
      }
    }

    const { error } = await supabaseAdmin()
      .from('platform_stripe_settings')
      .upsert(
        {
          id: true,
          active_mode: mode,
          checkout_enabled: body.checkout_enabled,
          test_secret_key_encrypted: testSecretKey,
          test_webhook_secret_encrypted: testWebhookSecret,
          live_secret_key_encrypted: liveSecretKey,
          live_webhook_secret_encrypted: liveWebhookSecret,
          updated_by: operator.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
    if (error) throw error;

    const saved = await readPlatformStripeSettings();
    return NextResponse.json(stripeSettingsSummary(saved), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof StripeSettingsMigrationPendingError) {
      return migrationPendingResponse();
    }
    return toErrorResponse(error);
  }
}
