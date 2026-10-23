import { describe, expect, it } from 'vitest';

import {
  AI_CREDIT_PACKAGES,
  AI_EXTRA_CREDIT_PACKAGE_IDS,
  AI_SUBSCRIPTION_PACKAGES,
  aiSubscriptionPackageRank,
  calculateAiCreditCheckoutPrice,
  getAiCreditPackage,
} from './stripe-credit-pricing';

const FIX = BigInt(18_420_000);

function ceilRatio(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - BigInt(1)) / denominator;
}

function estimatedStripeFee(totalCentavos: bigint): bigint {
  const feeBase =
    ceilRatio(totalCentavos * BigInt(410), BigInt(10_000)) + BigInt(300);
  return feeBase + ceilRatio(feeBase * BigInt(1_600), BigInt(10_000));
}

describe('monthly packages and extra credits', () => {
  it('prices extra credits 20% above the cheapest monthly package rate', () => {
    const rate = (usd: number, credits: number) => usd / credits;
    const monthly = AI_SUBSCRIPTION_PACKAGES.map((p) =>
      rate(p.usdAmount, p.credits)
    );
    for (const id of AI_EXTRA_CREDIT_PACKAGE_IDS) {
      const extra = getAiCreditPackage(id)!;
      expect(rate(extra.usdAmount, extra.credits)).toBeCloseTo(0.0012, 6);
      expect(rate(extra.usdAmount, extra.credits)).toBeGreaterThan(
        Math.max(...monthly)
      );
    }
  });

  it('prices subscriptions from the subscription catalog only', () => {
    const price = calculateAiCreditCheckoutPrice('starter', FIX, 'subscription');
    expect(price.credits).toBe(25_000);
    expect(price.packageBaseCentavos).toBe('46050');
    expect(() => calculateAiCreditCheckoutPrice('starter', FIX)).toThrow();
    expect(aiSubscriptionPackageRank('corporate')).toBeGreaterThan(
      aiSubscriptionPackageRank('starter')
    );
  });
});

describe('AI credit Stripe pricing', () => {
  it('calculates the package base using the supplied Banxico FIX', () => {
    expect(
      calculateAiCreditCheckoutPrice('entrepreneur', FIX).packageBaseCentavos
    ).toBe('92100');
  });

  it.each(AI_CREDIT_PACKAGES)(
    'includes enough processing cost in the package price for $usdAmount',
    (creditPackage) => {
      const price = calculateAiCreditCheckoutPrice(creditPackage.id, FIX);
      const packageBase = BigInt(price.packageBaseCentavos);
      const processingCost = BigInt(price.processingCostIncludedCentavos);
      const tax = BigInt(price.vatCentavos);
      const total = BigInt(price.totalCentavos);
      const roundedVat = (amount: bigint) =>
        (amount * BigInt(1_600) + BigInt(5_000)) / BigInt(10_000);

      expect(price.taxablePackageBaseCentavos).toBe(
        (packageBase + processingCost).toString()
      );
      expect(tax).toBe(roundedVat(packageBase + processingCost));
      expect(processingCost).toBeGreaterThanOrEqual(
        estimatedStripeFee(total)
      );
      if (processingCost > BigInt(0)) {
        const previousCost = processingCost - BigInt(1);
        const previousTotal =
          packageBase +
          previousCost +
          roundedVat(packageBase + previousCost);
        expect(previousCost).toBeLessThan(estimatedStripeFee(previousTotal));
      }
      expect(price.credits).toBe(creditPackage.credits);
    }
  );

  it.each([
    ['entrepreneur', '92100', '5747', '97847', '15656', '113503'],
    ['commercial_pro', '276300', '16503', '292803', '46848', '339651'],
    ['corporate', '552600', '32636', '585236', '93638', '678874'],
  ] as const)(
    'matches the documented cent-accurate example for %s',
    (packageId, base, processingCost, taxableBase, vat, total) => {
      expect(calculateAiCreditCheckoutPrice(packageId, FIX)).toMatchObject({
        packageBaseCentavos: base,
        processingCostIncludedCentavos: processingCost,
        taxablePackageBaseCentavos: taxableBase,
        vatCentavos: vat,
        totalCentavos: total,
      });
    }
  );

  it('rejects unknown packages and invalid exchange rates', () => {
    expect(() => calculateAiCreditCheckoutPrice('unknown', FIX)).toThrow(
      'Unsupported AI credit package.'
    );
    expect(() => calculateAiCreditCheckoutPrice('entrepreneur', BigInt(0))).toThrow(
      'A positive Banxico FIX is required for checkout.'
    );
    expect(getAiCreditPackage('commercial_pro')?.credits).toBe(150_000);
    expect(getAiCreditPackage('missing')).toBeNull();
  });
});
