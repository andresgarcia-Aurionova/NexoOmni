import { randomUUID } from 'node:crypto';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getLocale, getTranslations } from 'next-intl/server';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { requireEntitlement } from '@/lib/account/entitlements';
import { loadBanxicoFix } from '@/lib/billing/banxico-fx';
import {
  calculateAiCreditCheckoutPrice,
  getAiCreditPackage,
  type AiCreditPackageId,
} from '@/lib/billing/stripe-credit-pricing';
import { toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';
import {
  createStripeServerClient,
  getStripeAppUrl,
  isStripeCheckoutConfigured,
} from '@/lib/stripe/server';

const PACKAGE_NAME_KEYS: Record<
  AiCreditPackageId,
  | 'packageNames.entrepreneur'
  | 'packageNames.commercial_pro'
  | 'packageNames.corporate'
> = {
  entrepreneur: 'packageNames.entrepreneur',
  commercial_pro: 'packageNames.commercial_pro',
  corporate: 'packageNames.corporate',
};

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

function stripeAmount(value: string): number {
  const amount = BigInt(value);
  if (amount <= BigInt(0) || amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('The Stripe checkout amount is outside the supported range.');
  }
  return Number(amount);
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireEntitlement(
      'ai_conversation_intelligence',
      'supervisor'
    );
    const limit = checkRateLimit(
      `account:credit-checkout:${userId}`,
      RATE_LIMITS.creditCheckout
    );
    if (!limit.success) return rateLimitResponse(limit);

    if (!isStripeCheckoutConfigured()) {
      console.error(
        '[stripe checkout] Checkout is disabled until its credentials and canonical URL are configured.'
      );
      return NextResponse.json(
        { error: 'STRIPE_CHECKOUT_UNAVAILABLE' },
        { status: 503 }
      );
    }

    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    const packageId =
      typeof body?.package_id === 'string' ? body.package_id : '';
    const creditPackage = getAiCreditPackage(packageId);
    if (!creditPackage) {
      return NextResponse.json(
        { error: 'AI_CREDIT_PACKAGE_INVALID' },
        { status: 400 }
      );
    }

    const appUrl = getStripeAppUrl();
    const stripe = createStripeServerClient();
    const locale = await getLocale();
    const t = await getTranslations('AiCredits');
    const admin = adminClient();
    const fx = await loadBanxicoFix(admin);
    const price = calculateAiCreditCheckoutPrice(
      creditPackage.id,
      fx.mxnPerUsdMicro
    );
    const checkoutId = randomUUID();
    const { error: insertError } = await admin
      .from('stripe_ai_credit_checkouts')
      .insert({
        id: checkoutId,
        account_id: accountId,
        purchaser_user_id: userId,
        package_id: creditPackage.id,
        credits: creditPackage.credits,
        package_base_mxn_centavos: price.packageBaseCentavos,
        processing_cost_included_mxn_centavos:
          price.processingCostIncludedCentavos,
        vat_mxn_centavos: price.vatCentavos,
        amount_total_mxn_centavos: price.totalCentavos,
        fx_rate_micro: fx.mxnPerUsdMicro.toString(),
        fx_date: fx.date,
      });
    if (insertError) throw insertError;

    const packageName = t(PACKAGE_NAME_KEYS[creditPackage.id]);
    const metadata = {
      credit_checkout_id: checkoutId,
      package_id: creditPackage.id,
    };
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          allowed_payment_method_types: ['card'],
          locale: 'auto',
          client_reference_id: checkoutId,
          metadata,
          payment_intent_data: { metadata },
          invoice_creation: { enabled: false },
          line_items: [
            {
              price_data: {
                currency: 'mxn',
                product_data: {
                  name: t('checkout.packageLineItem', { packageName }),
                  description: t('checkout.packageDescription', {
                    credits: new Intl.NumberFormat(locale).format(
                      creditPackage.credits
                    ),
                  }),
                },
                unit_amount: stripeAmount(
                  price.taxablePackageBaseCentavos
                ),
              },
              quantity: 1,
            },
            {
              price_data: {
                currency: 'mxn',
                product_data: { name: t('checkout.vatLineItem') },
                unit_amount: stripeAmount(price.vatCentavos),
              },
              quantity: 1,
            },
          ],
          success_url: `${appUrl}/dashboard/credits?checkout=success`,
          cancel_url: `${appUrl}/dashboard/credits?checkout=cancelled`,
        },
        { idempotencyKey: `ai-credit-checkout:${checkoutId}` }
      );
    } catch (error) {
      const { error: updateError } = await admin
        .from('stripe_ai_credit_checkouts')
        .update({ status: 'failed' })
        .eq('id', checkoutId);
      if (updateError) {
        console.error(
          `[stripe checkout] Could not mark failed checkout ${checkoutId}:`,
          updateError
        );
      }
      throw error;
    }

    if (!session.url) {
      throw new Error('Stripe did not return a Checkout URL.');
    }
    const { error: sessionError } = await admin
      .from('stripe_ai_credit_checkouts')
      .update({ stripe_checkout_session_id: session.id })
      .eq('id', checkoutId);
    if (sessionError) throw sessionError;

    return NextResponse.json(
      {
        checkout_url: session.url,
        package_id: creditPackage.id,
        credits: creditPackage.credits,
        amount_total_mxn_centavos: price.totalCentavos,
        fx_date: fx.date,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
