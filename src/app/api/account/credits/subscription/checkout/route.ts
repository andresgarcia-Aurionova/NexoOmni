import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getTranslations } from 'next-intl/server';
import { NextResponse } from 'next/server';

import { requireEntitlement } from '@/lib/account/entitlements';
import { loadBanxicoFix } from '@/lib/billing/banxico-fx';
import {
  calculateAiCreditCheckoutPrice,
  getAiSubscriptionPackage,
  type AiSubscriptionPackageId,
} from '@/lib/billing/stripe-credit-pricing';
import { toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';
import {
  createStripeServerClient,
  getStripeCheckoutConfiguration,
} from '@/lib/stripe/server';
import { StripeSettingsMigrationPendingError } from '@/lib/stripe/platform-settings';

export const runtime = 'nodejs';

const PACKAGE_NAME_KEYS: Record<
  AiSubscriptionPackageId,
  | 'subscription.names.starter'
  | 'subscription.names.entrepreneur'
  | 'subscription.names.commercial_pro'
  | 'subscription.names.corporate'
> = {
  starter: 'subscription.names.starter',
  entrepreneur: 'subscription.names.entrepreneur',
  commercial_pro: 'subscription.names.commercial_pro',
  corporate: 'subscription.names.corporate',
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase server configuration');
  return createAdminClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

/** Starts a monthly package subscription (Stripe Checkout, subscription mode). */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireEntitlement(
      'ai_credits',
      'supervisor'
    );
    const limit = checkRateLimit(
      `account:credit-checkout:${userId}`,
      RATE_LIMITS.creditCheckout
    );
    if (!limit.success) return rateLimitResponse(limit);

    const stripeConfiguration = await getStripeCheckoutConfiguration();
    if (!stripeConfiguration) {
      return NextResponse.json(
        { error: 'STRIPE_CHECKOUT_UNAVAILABLE' },
        { status: 503 }
      );
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const packageId =
      typeof body?.package_id === 'string' ? body.package_id : '';
    const creditPackage = getAiSubscriptionPackage(packageId);
    if (!creditPackage) {
      return NextResponse.json(
        { error: 'AI_CREDIT_PACKAGE_INVALID' },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const { data: existing, error: existingError } = await admin
      .from('ai_credit_subscriptions')
      .select('status')
      .eq('account_id', accountId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing && existing.status !== 'canceled') {
      return NextResponse.json(
        { error: 'AI_SUBSCRIPTION_ALREADY_ACTIVE' },
        { status: 409 }
      );
    }

    const t = await getTranslations('AiCredits');
    const fx = await loadBanxicoFix(admin);
    const price = calculateAiCreditCheckoutPrice(
      creditPackage.id,
      fx.mxnPerUsdMicro,
      'subscription'
    );
    const stripe = createStripeServerClient(stripeConfiguration.secretKey);
    const metadata = { account_id: accountId, package_id: creditPackage.id };
    const packageName = t(PACKAGE_NAME_KEYS[creditPackage.id]);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      allowed_payment_method_types: ['card'],
      locale: 'auto',
      client_reference_id: accountId,
      metadata,
      subscription_data: { metadata },
      line_items: [
        {
          price_data: {
            currency: 'mxn',
            product_data: {
              name: t('subscription.lineItem', { packageName }),
              description: t('subscription.lineItemDescription'),
            },
            recurring: { interval: 'month' },
            unit_amount: Number(price.totalCentavos),
          },
          quantity: 1,
        },
      ],
      success_url: `${stripeConfiguration.appUrl}/credits?checkout=success`,
      cancel_url: `${stripeConfiguration.appUrl}/credits?checkout=cancelled`,
    });
    if (!session.url) throw new Error('Stripe did not return a Checkout URL.');

    return NextResponse.json(
      {
        checkout_url: session.url,
        package_id: creditPackage.id,
        amount_total_mxn_centavos: price.totalCentavos,
        fx_date: fx.date,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof StripeSettingsMigrationPendingError) {
      return NextResponse.json(
        { error: 'STRIPE_SETTINGS_MIGRATION_PENDING' },
        { status: 503 }
      );
    }
    return toErrorResponse(error);
  }
}
