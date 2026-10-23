import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

import { getAiSubscriptionPackage } from '@/lib/billing/stripe-credit-pricing';
import type { StripeMode } from '@/lib/stripe/platform-settings';
import { syncZernioCallsWithCreditBalance } from '@/lib/zernio/call-credit-pause';

// Paid-period grace so a slightly late renewal does not strand a customer
// without the credits they already paid for.
const GRACE_MS = 2 * 24 * 60 * 60 * 1000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SubscriptionStatus = 'active' | 'past_due' | 'canceled';

export function mapStripeSubscriptionStatus(
  status: Stripe.Subscription.Status
): SubscriptionStatus {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'canceled' || status === 'incomplete_expired') {
    return 'canceled';
  }
  return 'past_due';
}

function stripeId(value: string | { id: string } | null | undefined) {
  return typeof value === 'string' ? value : (value?.id ?? null);
}

function toIso(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;
}

/** Creates the local subscription row once Checkout completes. */
export async function recordSubscriptionCheckout(
  session: Stripe.Checkout.Session,
  admin: SupabaseClient,
  mode: StripeMode
): Promise<void> {
  const accountId = session.metadata?.account_id;
  const packageId = session.metadata?.package_id;
  const subscriptionId = stripeId(session.subscription);
  const customerId = stripeId(session.customer);
  if (
    session.mode !== 'subscription' ||
    !accountId ||
    !UUID_RE.test(accountId) ||
    !packageId ||
    !getAiSubscriptionPackage(packageId) ||
    !subscriptionId ||
    !customerId ||
    session.livemode !== (mode === 'live')
  ) {
    throw new Error('Stripe subscription checkout failed validation.');
  }

  const { error } = await admin.from('ai_credit_subscriptions').upsert(
    {
      account_id: accountId,
      package_id: packageId,
      status: 'active',
      stripe_mode: mode,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      monthly_total_mxn_centavos: session.amount_total,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id' }
  );
  if (error) throw error;
}

/**
 * Package prices are USD-based: each renewal draft invoice is adjusted to the
 * price at today's FX with an invoice item (positive or negative) so the
 * customer is charged the current MXN amount instead of the signup amount.
 * Stripe keeps renewal invoices in draft for about an hour, which is the window
 * this relies on.
 */
export async function adjustRenewalInvoiceForFx(
  invoice: Stripe.Invoice,
  stripe: Stripe,
  expectedTotalCentavos: number | string,
  packageId: string
): Promise<number> {
  if (
    invoice.billing_reason !== 'subscription_cycle' ||
    invoice.status !== 'draft' ||
    !invoice.id ||
    invoice.currency !== 'mxn'
  ) {
    return 0;
  }
  const customerId = stripeId(invoice.customer);
  if (!customerId) return 0;

  const difference = Number(expectedTotalCentavos) - invoice.total;
  if (difference === 0) return 0;

  await stripe.invoiceItems.create(
    {
      customer: customerId,
      invoice: invoice.id,
      currency: 'mxn',
      amount: difference,
      description: `Ajuste por tipo de cambio (${packageId})`,
    },
    { idempotencyKey: `nexo:fx-adjust:${invoice.id}` }
  );
  return difference;
}

/** Grants one month of package credits for a paid subscription invoice. */
export async function fulfillSubscriptionInvoice(
  invoice: Stripe.Invoice,
  admin: SupabaseClient,
  mode: StripeMode
): Promise<void> {
  const subscriptionId = stripeId(invoice.parent?.subscription_details?.subscription);
  if (!subscriptionId) return;
  if (invoice.livemode !== (mode === 'live') || invoice.currency !== 'mxn') {
    throw new Error(`Stripe invoice ${invoice.id} failed validation.`);
  }
  if (invoice.status !== 'paid' || !invoice.id) return;

  const { data: row, error } = await admin
    .from('ai_credit_subscriptions')
    .select('account_id,stripe_mode')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (error) throw error;
  if (!row) {
    throw new Error(
      `Subscription ${subscriptionId} is not recorded yet; Stripe will retry.`
    );
  }
  if (row.stripe_mode !== mode) {
    throw new Error(`Subscription ${subscriptionId} mode mismatch.`);
  }

  const packageId = invoice.parent?.subscription_details?.metadata?.package_id;
  const creditPackage = packageId ? getAiSubscriptionPackage(packageId) : null;
  if (!creditPackage) {
    throw new Error(`Invoice ${invoice.id} has no valid package metadata.`);
  }

  const periodEndSeconds = Math.max(
    0,
    ...invoice.lines.data.map((line) => line.period?.end ?? 0)
  );
  if (!periodEndSeconds) {
    throw new Error(`Invoice ${invoice.id} has no billing period.`);
  }
  const expiresAt = new Date(periodEndSeconds * 1000 + GRACE_MS);

  const { data: grantData, error: grantError } = await admin.rpc(
    'platform_ai_subscription_grant',
    {
      p_account_id: row.account_id,
      p_credits: creditPackage.credits,
      p_idempotency_key: `stripe:invoice:${invoice.id}`,
      p_reason: `Stripe subscription package ${creditPackage.id}`,
      p_expires_at: expiresAt.toISOString(),
      p_expire_previous: invoice.billing_reason === 'subscription_cycle',
    }
  );
  if (grantError) throw grantError;

  const grant = Array.isArray(grantData) ? grantData[0] : null;
  if (
    !grant ||
    !['granted', 'duplicate'].includes(grant.result) ||
    !/^\d+$/.test(String(grant.available_credits))
  ) {
    throw new Error('The database did not confirm the subscription grant.');
  }

  const { error: updateError } = await admin
    .from('ai_credit_subscriptions')
    .update({
      package_id: creditPackage.id,
      status: 'active',
      monthly_total_mxn_centavos: invoice.total > 0 ? invoice.total : undefined,
      current_period_end: toIso(periodEndSeconds),
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscriptionId);
  if (updateError) throw updateError;

  try {
    await syncZernioCallsWithCreditBalance(
      admin,
      row.account_id,
      BigInt(String(grant.available_credits))
    );
  } catch (syncError) {
    console.error(
      `[stripe subscription] Credits granted, but Zernio calls remain pending for account ${row.account_id}:`,
      syncError
    );
  }
}

/** Mirrors Stripe subscription status/cancellation into the local row. */
export async function syncSubscriptionState(
  subscription: Stripe.Subscription,
  admin: SupabaseClient,
  mode: StripeMode
): Promise<void> {
  if (subscription.livemode !== (mode === 'live')) return;
  const update: Record<string, unknown> = {
    status: mapStripeSubscriptionStatus(subscription.status),
    cancel_at_period_end:
      subscription.cancel_at_period_end || subscription.cancel_at !== null,
    current_period_end: toIso(subscription.items.data[0]?.current_period_end),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from('ai_credit_subscriptions')
    .update(update)
    .eq('stripe_subscription_id', subscription.id)
    .eq('stripe_mode', mode);
  if (error) throw error;
}
