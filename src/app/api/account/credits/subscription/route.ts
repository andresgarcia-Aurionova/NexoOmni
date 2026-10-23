import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { requireEntitlement } from '@/lib/account/entitlements';
import { loadBanxicoFix } from '@/lib/billing/banxico-fx';
import {
  aiSubscriptionPackageRank,
  calculateAiCreditCheckoutPrice,
  getAiSubscriptionPackage,
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

async function loadContext() {
  const { accountId, userId } = await requireEntitlement(
    'ai_credits',
    'supervisor'
  );
  const limit = checkRateLimit(
    `account:credit-checkout:${userId}`,
    RATE_LIMITS.creditCheckout
  );
  if (!limit.success) return { response: rateLimitResponse(limit) } as const;

  const stripeConfiguration = await getStripeCheckoutConfiguration();
  if (!stripeConfiguration) {
    return {
      response: NextResponse.json(
        { error: 'STRIPE_CHECKOUT_UNAVAILABLE' },
        { status: 503 }
      ),
    } as const;
  }
  const admin = adminClient();
  const { data: row, error } = await admin
    .from('ai_credit_subscriptions')
    .select(
      'package_id,status,stripe_mode,stripe_subscription_id,cancel_at_period_end'
    )
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  if (
    !row ||
    row.status === 'canceled' ||
    row.stripe_mode !== stripeConfiguration.mode
  ) {
    return {
      response: NextResponse.json(
        { error: 'AI_SUBSCRIPTION_NOT_FOUND' },
        { status: 404 }
      ),
    } as const;
  }
  return {
    admin,
    row,
    stripe: createStripeServerClient(stripeConfiguration.secretKey),
  } as const;
}

/**
 * Changes the package of an existing subscription.
 * - Upgrade: charged now (prorated), a new monthly cycle starts and the new
 *   package credits are granted when the invoice is paid.
 * - Downgrade: the lower price applies from the next renewal; the credits of
 *   the current month are kept.
 * - Same package while a cancellation is scheduled: resumes the subscription.
 */
export async function POST(request: Request) {
  try {
    const context = await loadContext();
    if ('response' in context) return context.response;
    const { admin, row, stripe } = context;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const packageId =
      typeof body?.package_id === 'string' ? body.package_id : '';
    const target = getAiSubscriptionPackage(packageId);
    if (!target) {
      return NextResponse.json(
        { error: 'AI_CREDIT_PACKAGE_INVALID' },
        { status: 400 }
      );
    }

    if (target.id === row.package_id) {
      if (!row.cancel_at_period_end) {
        return NextResponse.json(
          { error: 'AI_SUBSCRIPTION_NO_CHANGE' },
          { status: 409 }
        );
      }
      await stripe.subscriptions.update(row.stripe_subscription_id, {
        cancel_at_period_end: false,
      });
      await admin
        .from('ai_credit_subscriptions')
        .update({ cancel_at_period_end: false })
        .eq('stripe_subscription_id', row.stripe_subscription_id);
      return NextResponse.json({ action: 'resumed' });
    }

    const subscription = await stripe.subscriptions.retrieve(
      row.stripe_subscription_id
    );
    const item = subscription.items.data[0];
    const product =
      typeof item?.price.product === 'string'
        ? item.price.product
        : item?.price.product.id;
    if (!item || !product) throw new Error('Subscription item is unavailable.');

    const fx = await loadBanxicoFix(admin);
    const price = calculateAiCreditCheckoutPrice(
      target.id,
      fx.mxnPerUsdMicro,
      'subscription'
    );
    const upgrade =
      aiSubscriptionPackageRank(target.id) >
      aiSubscriptionPackageRank(row.package_id);

    const params: Stripe.SubscriptionUpdateParams = {
      items: [
        {
          id: item.id,
          price_data: {
            currency: 'mxn',
            product,
            recurring: { interval: 'month' },
            unit_amount: Number(price.totalCentavos),
          },
        },
      ],
      metadata: { ...subscription.metadata, package_id: target.id },
      cancel_at_period_end: false,
      proration_behavior: upgrade ? 'create_prorations' : 'none',
    };
    if (upgrade) params.billing_cycle_anchor = { type: 'now' };
    await stripe.subscriptions.update(row.stripe_subscription_id, params);

    return NextResponse.json({
      action: upgrade ? 'upgraded' : 'downgrade_scheduled',
      package_id: target.id,
    });
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

/** Cancels at the end of the paid period; the month's credits stay usable. */
export async function DELETE() {
  try {
    const context = await loadContext();
    if ('response' in context) return context.response;
    const { admin, row, stripe } = context;

    await stripe.subscriptions.update(row.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
    await admin
      .from('ai_credit_subscriptions')
      .update({ cancel_at_period_end: true })
      .eq('stripe_subscription_id', row.stripe_subscription_id);
    return NextResponse.json({ action: 'cancel_scheduled' });
  } catch (error) {
    return toErrorResponse(error);
  }
}
