import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';

import { toErrorResponse } from '@/lib/auth/account';
import { getAiCreditPackage } from '@/lib/billing/stripe-credit-pricing';
import { getStripeWebhookSecrets } from '@/lib/stripe/server';
import {
  StripeSettingsMigrationPendingError,
  type StripeMode,
} from '@/lib/stripe/platform-settings';
import { syncZernioCallsWithCreditBalance } from '@/lib/zernio/call-credit-pause';

const CHECKOUT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const runtime = 'nodejs';

type StripeCreditCheckout = {
  id: string;
  account_id: string;
  package_id: string;
  stripe_mode: StripeMode | null;
  credits: number | string;
  amount_total_mxn_centavos: number | string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  credit_ledger_entry_id: string | null;
  status: 'pending' | 'credited' | 'failed';
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

function stripePaymentIntentId(
  value: string | Stripe.PaymentIntent | null
): string | null {
  return typeof value === 'string' ? value : (value?.id ?? null);
}

async function fulfillPaidCheckout(
  session: Stripe.Checkout.Session,
  admin: ReturnType<typeof adminClient>,
  mode: StripeMode
): Promise<void> {
  const checkoutId = session.metadata?.credit_checkout_id;
  if (!checkoutId || !CHECKOUT_ID_RE.test(checkoutId)) return;

  const { data, error } = await admin
    .from('stripe_ai_credit_checkouts')
    .select(
      'id,account_id,package_id,stripe_mode,credits,amount_total_mxn_centavos,stripe_checkout_session_id,stripe_payment_intent_id,credit_ledger_entry_id,status'
    )
    .eq('id', checkoutId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(
      `Stripe checkout record ${checkoutId} is not available yet.`
    );
  }

  const checkout = data as StripeCreditCheckout;
  const creditPackage = getAiCreditPackage(checkout.package_id);
  const paymentIntentId = stripePaymentIntentId(session.payment_intent);
  if (
    checkout.status === 'failed' ||
    !creditPackage ||
    Number(checkout.credits) !== creditPackage.credits ||
    session.mode !== 'payment' ||
    session.status !== 'complete' ||
    session.payment_status !== 'paid' ||
    session.livemode !== (mode === 'live') ||
    (checkout.stripe_mode !== null && checkout.stripe_mode !== mode) ||
    session.currency !== 'mxn' ||
    session.client_reference_id !== checkout.id ||
    session.metadata?.package_id !== checkout.package_id ||
    session.amount_total === null ||
    String(session.amount_total) !==
      String(checkout.amount_total_mxn_centavos) ||
    !paymentIntentId ||
    (checkout.stripe_checkout_session_id !== null &&
      checkout.stripe_checkout_session_id !== session.id) ||
    (checkout.stripe_payment_intent_id !== null &&
      checkout.stripe_payment_intent_id !== paymentIntentId)
  ) {
    throw new Error(`Stripe checkout ${checkoutId} failed payment validation.`);
  }

  if (checkout.status === 'credited') return;

  const { error: paymentError } = await admin
    .from('stripe_ai_credit_checkouts')
    .update({
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      paid_at: new Date().toISOString(),
    })
    .eq('id', checkoutId);
  if (paymentError) throw paymentError;

  const { data: grantData, error: grantError } = await admin.rpc(
    'platform_ai_credit_grant',
    {
      p_account_id: checkout.account_id,
      p_credits: Number(checkout.credits),
      p_idempotency_key: `stripe:payment:${paymentIntentId}`,
      p_entry_type: 'purchase',
      p_reason: `Stripe Checkout package ${checkout.package_id}`,
      p_actor_user_id: null,
      p_source: 'stripe_checkout',
    }
  );
  if (grantError) throw grantError;

  const grant = Array.isArray(grantData) ? grantData[0] : null;
  if (
    !grant ||
    !['granted', 'duplicate'].includes(grant.result) ||
    typeof grant.ledger_entry_id !== 'string' ||
    !/^\d+$/.test(String(grant.available_credits))
  ) {
    throw new Error('The database did not confirm the Stripe credit grant.');
  }

  const { error: creditedError } = await admin
    .from('stripe_ai_credit_checkouts')
    .update({
      status: 'credited',
      credit_ledger_entry_id: grant.ledger_entry_id,
      credited_at: new Date().toISOString(),
    })
    .eq('id', checkoutId);
  if (creditedError) throw creditedError;

  try {
    await syncZernioCallsWithCreditBalance(
      admin,
      checkout.account_id,
      BigInt(String(grant.available_credits))
    );
  } catch (error) {
    console.error(
      `[stripe checkout] Credits were granted, but Zernio calls remain pending for account ${checkout.account_id}:`,
      error
    );
  }
}

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    console.error('[stripe webhook] The Stripe signature header is missing.');
    return NextResponse.json(
      { error: 'Invalid Stripe webhook signature.' },
      { status: 400 }
    );
  }

  const payload = await request.text();
  let hintedMode: StripeMode;
  try {
    const unverifiedPayload: unknown = JSON.parse(payload);
    if (
      !unverifiedPayload ||
      typeof unverifiedPayload !== 'object' ||
      !('livemode' in unverifiedPayload) ||
      typeof unverifiedPayload.livemode !== 'boolean'
    ) {
      return NextResponse.json(
        { error: 'Invalid Stripe webhook event.' },
        { status: 400 }
      );
    }
    hintedMode = unverifiedPayload.livemode ? 'live' : 'test';
  } catch (error) {
    console.error('[stripe webhook] Event payload is not valid JSON:', error);
    return NextResponse.json(
      { error: 'Invalid Stripe webhook event.' },
      { status: 400 }
    );
  }

  let webhookSecrets: Record<StripeMode, string | null>;
  try {
    webhookSecrets = await getStripeWebhookSecrets();
  } catch (error) {
    if (error instanceof StripeSettingsMigrationPendingError) {
      return NextResponse.json(
        { error: 'Stripe webhook settings are not available.' },
        { status: 503 }
      );
    }
    return toErrorResponse(error);
  }
  const webhookSecret = webhookSecrets[hintedMode];
  if (!webhookSecret) {
    console.error(
      `[stripe webhook] The ${hintedMode} signing secret is not configured or cannot be decrypted.`
    );
    return NextResponse.json(
      { error: 'Stripe webhook is not configured for this mode.' },
      { status: 503 }
    );
  }

  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error) {
    console.error('[stripe webhook] Signature verification failed:', error);
    return NextResponse.json(
      { error: 'Invalid Stripe webhook signature.' },
      { status: 400 }
    );
  }
  if (event.livemode !== (hintedMode === 'live')) {
    console.error(
      '[stripe webhook] Verified event mode does not match its payload.'
    );
    return NextResponse.json(
      { error: 'Invalid Stripe webhook mode.' },
      { status: 400 }
    );
  }

  try {
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === 'paid') {
        await fulfillPaidCheckout(session, adminClient(), hintedMode);
      }
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
