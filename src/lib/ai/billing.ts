const NANO_USD_PER_MILLION = BigInt(1_000_000);
const DEFAULT_TARGET_MARGIN_BASIS_POINTS = BigInt(5_000);
const DEFAULT_NANO_USD_PER_CREDIT = BigInt(1_000_000);
const BASIS_POINTS = BigInt(10_000);

export interface AiModelPrice {
  inputNanoUsdPerMillionTokens: bigint;
  outputNanoUsdPerMillionTokens: bigint;
}

export interface AiUsageChargeInput {
  promptTokens: number;
  completionTokens: number;
  price: AiModelPrice;
  targetMarginBasisPoints?: bigint;
  nanoUsdPerCredit?: bigint;
}

export interface AiUsageCharge {
  costNanoUsd: bigint;
  priceNanoUsd: bigint;
  credits: bigint;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= BigInt(0)) {
    throw new RangeError('Denominator must be positive');
  }
  if (numerator <= BigInt(0)) return BigInt(0);
  return (numerator + denominator - BigInt(1)) / denominator;
}

function validateTokenCount(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return BigInt(value);
}

/**
 * Converts provider token usage to cost and sale credits using integer
 * nanodollars, rounding upward so fractional provider costs are not underbilled.
 */
export function calculateAiUsageCharge({
  promptTokens,
  completionTokens,
  price,
  targetMarginBasisPoints = DEFAULT_TARGET_MARGIN_BASIS_POINTS,
  nanoUsdPerCredit = DEFAULT_NANO_USD_PER_CREDIT,
}: AiUsageChargeInput): AiUsageCharge {
  const prompt = validateTokenCount(promptTokens, 'promptTokens');
  const completion = validateTokenCount(completionTokens, 'completionTokens');

  if (
    price.inputNanoUsdPerMillionTokens < BigInt(0) ||
    price.outputNanoUsdPerMillionTokens < BigInt(0)
  ) {
    throw new RangeError('Model token prices must not be negative');
  }
  if (
    targetMarginBasisPoints < BigInt(0) ||
    targetMarginBasisPoints >= BASIS_POINTS
  ) {
    throw new RangeError(
      'Target margin must be between 0 and 9999 basis points'
    );
  }
  if (nanoUsdPerCredit <= BigInt(0)) {
    throw new RangeError('nanoUsdPerCredit must be positive');
  }

  const costNumerator =
    prompt * price.inputNanoUsdPerMillionTokens +
    completion * price.outputNanoUsdPerMillionTokens;
  const costNanoUsd = ceilDiv(costNumerator, NANO_USD_PER_MILLION);
  const priceNanoUsd = ceilDiv(
    costNanoUsd * BASIS_POINTS,
    BASIS_POINTS - targetMarginBasisPoints
  );

  return {
    costNanoUsd,
    priceNanoUsd,
    credits: ceilDiv(priceNanoUsd, nanoUsdPerCredit),
  };
}
