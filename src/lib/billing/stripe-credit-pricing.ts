// One-time packs. `entrepreneur`, `commercial_pro` and `corporate` are legacy
// ids kept so historical checkouts keep resolving; only EXTRA packs are sold.
export const AI_CREDIT_PACKAGES = [
  { id: 'entrepreneur', usdAmount: 50, credits: 50_000 },
  { id: 'commercial_pro', usdAmount: 150, credits: 150_000 },
  { id: 'corporate', usdAmount: 300, credits: 300_000 },
  { id: 'extra_10k', usdAmount: 12, credits: 10_000 },
  { id: 'extra_25k', usdAmount: 30, credits: 25_000 },
] as const;

// Extra credits cost 20 % more per credit than any monthly package, so
// upgrading the package is always the better deal.
export const AI_EXTRA_CREDIT_PACKAGE_IDS = ['extra_10k', 'extra_25k'] as const;

export const AI_SUBSCRIPTION_PACKAGES = [
  { id: 'starter', usdAmount: 25, credits: 25_000 },
  { id: 'entrepreneur', usdAmount: 50, credits: 50_000 },
  { id: 'commercial_pro', usdAmount: 150, credits: 150_000 },
  { id: 'corporate', usdAmount: 300, credits: 300_000 },
] as const;

export type AiCreditPackageId = (typeof AI_CREDIT_PACKAGES)[number]['id'];
export type AiExtraCreditPackageId =
  (typeof AI_EXTRA_CREDIT_PACKAGE_IDS)[number];
export type AiSubscriptionPackageId =
  (typeof AI_SUBSCRIPTION_PACKAGES)[number]['id'];

export function isExtraCreditPackageId(
  value: string
): value is AiExtraCreditPackageId {
  return (AI_EXTRA_CREDIT_PACKAGE_IDS as readonly string[]).includes(value);
}

export function getAiSubscriptionPackage(packageId: string) {
  return AI_SUBSCRIPTION_PACKAGES.find((item) => item.id === packageId) ?? null;
}

export function aiSubscriptionPackageRank(packageId: string): number {
  return AI_SUBSCRIPTION_PACKAGES.findIndex((item) => item.id === packageId);
}

const MXN_MICRO_PER_USD = BigInt(1_000_000);
const BASIS_POINTS = BigInt(10_000);
const PRODUCT_VAT_BPS = BigInt(1_600);
const STRIPE_FEE_VAT_BPS = BigInt(1_600);
const CARD_FEE_BPS = BigInt(410);
const FIXED_CARD_FEE_CENTAVOS = BigInt(300);
const MAX_INCLUDED_PROCESSING_COST_CENTAVOS = BigInt(100_000_000);

export type AiCreditCheckoutPrice = {
  packageId: AiCreditPackageId | AiSubscriptionPackageId;
  credits: number;
  fxRateMicro: string;
  packageBaseCentavos: string;
  processingCostIncludedCentavos: string;
  taxablePackageBaseCentavos: string;
  vatCentavos: string;
  totalCentavos: string;
};

function roundRatio(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / BigInt(2)) / denominator;
}

function ceilRatio(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - BigInt(1)) / denominator;
}

function checkoutTax(baseCentavos: bigint): bigint {
  return roundRatio(baseCentavos * PRODUCT_VAT_BPS, BASIS_POINTS);
}

function stripeFeeIncludingVat(totalCentavos: bigint): bigint {
  const feeBase =
    ceilRatio(totalCentavos * CARD_FEE_BPS, BASIS_POINTS) +
    FIXED_CARD_FEE_CENTAVOS;
  const feeVat = ceilRatio(feeBase * STRIPE_FEE_VAT_BPS, BASIS_POINTS);
  return feeBase + feeVat;
}

function clearsStripeFees(
  packageBaseCentavos: bigint,
  processingCostIncludedCentavos: bigint
): boolean {
  const taxablePackageBase =
    packageBaseCentavos + processingCostIncludedCentavos;
  const total = taxablePackageBase + checkoutTax(taxablePackageBase);
  return processingCostIncludedCentavos >= stripeFeeIncludingVat(total);
}

export function getAiCreditPackage(packageId: string) {
  return AI_CREDIT_PACKAGES.find((item) => item.id === packageId) ?? null;
}

export function calculateAiCreditCheckoutPrice(
  packageId: string,
  mxnPerUsdMicro: bigint,
  kind: 'one_time' | 'subscription' = 'one_time'
): AiCreditCheckoutPrice {
  const creditPackage =
    kind === 'subscription'
      ? getAiSubscriptionPackage(packageId)
      : getAiCreditPackage(packageId);
  if (!creditPackage) throw new Error('Unsupported AI credit package.');
  if (mxnPerUsdMicro <= BigInt(0)) {
    throw new Error('A positive Banxico FIX is required for checkout.');
  }

  const packageBaseCentavos = roundRatio(
    BigInt(creditPackage.usdAmount) *
      mxnPerUsdMicro *
      BigInt(100),
    MXN_MICRO_PER_USD
  );
  if (packageBaseCentavos <= BigInt(0)) {
    throw new Error('The AI credit package price is invalid.');
  }

  let lower = BigInt(0);
  let upper = BigInt(1);
  while (!clearsStripeFees(packageBaseCentavos, upper)) {
    upper *= BigInt(2);
    if (upper > MAX_INCLUDED_PROCESSING_COST_CENTAVOS) {
      throw new Error(
        'The included processing cost could not be calculated safely.'
      );
    }
  }

  while (lower < upper) {
    const middle = (lower + upper) / BigInt(2);
    if (clearsStripeFees(packageBaseCentavos, middle)) {
      upper = middle;
    } else {
      lower = middle + BigInt(1);
    }
  }

  const taxablePackageBaseCentavos = packageBaseCentavos + lower;
  const vatCentavos = checkoutTax(taxablePackageBaseCentavos);
  const totalCentavos = taxablePackageBaseCentavos + vatCentavos;
  if (lower < stripeFeeIncludingVat(totalCentavos)) {
    throw new Error(
      'The included processing cost calculation did not cover the Stripe fee.'
    );
  }

  return {
    packageId: creditPackage.id,
    credits: creditPackage.credits,
    fxRateMicro: mxnPerUsdMicro.toString(),
    packageBaseCentavos: packageBaseCentavos.toString(),
    processingCostIncludedCentavos: lower.toString(),
    taxablePackageBaseCentavos: taxablePackageBaseCentavos.toString(),
    vatCentavos: vatCentavos.toString(),
    totalCentavos: totalCentavos.toString(),
  };
}
