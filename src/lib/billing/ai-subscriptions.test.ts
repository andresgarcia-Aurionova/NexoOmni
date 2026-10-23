import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/zernio/call-credit-pause', () => ({
  syncZernioCallsWithCreditBalance: vi.fn(),
}));

import {
  adjustRenewalInvoiceForFx,
  mapStripeSubscriptionStatus,
} from './ai-subscriptions';

function invoice(overrides: Partial<Stripe.Invoice> = {}) {
  return {
    id: 'in_1',
    customer: 'cus_1',
    currency: 'mxn',
    status: 'draft',
    billing_reason: 'subscription_cycle',
    total: 50000,
    ...overrides,
  } as Stripe.Invoice;
}

function stripeMock() {
  const create = vi.fn().mockResolvedValue({});
  return { stripe: { invoiceItems: { create } } as unknown as Stripe, create };
}

describe('adjustRenewalInvoiceForFx', () => {
  it('adds a positive adjustment when the dollar went up', async () => {
    const { stripe, create } = stripeMock();
    const diff = await adjustRenewalInvoiceForFx(
      invoice(),
      stripe,
      51500,
      'starter'
    );
    expect(diff).toBe(1500);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ invoice: 'in_1', amount: 1500, currency: 'mxn' }),
      { idempotencyKey: 'nexo:fx-adjust:in_1' }
    );
  });

  it('adds a negative adjustment when the dollar went down', async () => {
    const { stripe, create } = stripeMock();
    expect(
      await adjustRenewalInvoiceForFx(invoice(), stripe, 49000, 'starter')
    ).toBe(-1000);
    expect(create).toHaveBeenCalledOnce();
  });

  it('does nothing when the amount already matches', async () => {
    const { stripe, create } = stripeMock();
    await adjustRenewalInvoiceForFx(invoice(), stripe, 50000, 'starter');
    expect(create).not.toHaveBeenCalled();
  });

  it('ignores non-renewal and non-draft invoices', async () => {
    const { stripe, create } = stripeMock();
    await adjustRenewalInvoiceForFx(
      invoice({ billing_reason: 'subscription_create' }),
      stripe,
      60000,
      'starter'
    );
    await adjustRenewalInvoiceForFx(
      invoice({ status: 'open' }),
      stripe,
      60000,
      'starter'
    );
    expect(create).not.toHaveBeenCalled();
  });
});

describe('mapStripeSubscriptionStatus', () => {
  it('maps Stripe statuses to local ones', () => {
    expect(mapStripeSubscriptionStatus('active')).toBe('active');
    expect(mapStripeSubscriptionStatus('canceled')).toBe('canceled');
    expect(mapStripeSubscriptionStatus('past_due')).toBe('past_due');
  });
});
