import { describe, expect, it } from 'vitest';
import { calculateAiUsageCharge } from './billing';

describe('calculateAiUsageCharge', () => {
  it('applies a 50% gross margin and converts the price to credits', () => {
    const charge = calculateAiUsageCharge({
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      price: {
        inputNanoUsdPerMillionTokens: BigInt(100_000_000),
        outputNanoUsdPerMillionTokens: BigInt(500_000_000),
      },
    });

    expect(charge).toEqual({
      costNanoUsd: BigInt(600_000_000),
      priceNanoUsd: BigInt(1_200_000_000),
      credits: BigInt(1_200),
    });
  });

  it('rounds fractional provider cost and credit usage upward', () => {
    const charge = calculateAiUsageCharge({
      promptTokens: 1,
      completionTokens: 0,
      price: {
        inputNanoUsdPerMillionTokens: BigInt(1),
        outputNanoUsdPerMillionTokens: BigInt(0),
      },
    });

    expect(charge).toEqual({
      costNanoUsd: BigInt(1),
      priceNanoUsd: BigInt(2),
      credits: BigInt(1),
    });
  });

  it('supports a different configured margin and credit denomination', () => {
    const charge = calculateAiUsageCharge({
      promptTokens: 1_000_000,
      completionTokens: 0,
      price: {
        inputNanoUsdPerMillionTokens: BigInt(100_000_000),
        outputNanoUsdPerMillionTokens: BigInt(0),
      },
      targetMarginBasisPoints: BigInt(0),
      nanoUsdPerCredit: BigInt(100_000_000),
    });

    expect(charge).toEqual({
      costNanoUsd: BigInt(100_000_000),
      priceNanoUsd: BigInt(100_000_000),
      credits: BigInt(1),
    });
  });

  it.each([
    { promptTokens: -1, completionTokens: 0 },
    { promptTokens: 1.5, completionTokens: 0 },
    { promptTokens: Number.MAX_SAFE_INTEGER + 1, completionTokens: 0 },
  ])('rejects invalid token counts: $promptTokens', (tokens) => {
    expect(() =>
      calculateAiUsageCharge({
        ...tokens,
        price: {
          inputNanoUsdPerMillionTokens: BigInt(1),
          outputNanoUsdPerMillionTokens: BigInt(1),
        },
      })
    ).toThrow(RangeError);
  });

  it('rejects invalid rates and billing settings', () => {
    expect(() =>
      calculateAiUsageCharge({
        promptTokens: 1,
        completionTokens: 1,
        price: {
          inputNanoUsdPerMillionTokens: BigInt(-1),
          outputNanoUsdPerMillionTokens: BigInt(0),
        },
      })
    ).toThrow(RangeError);
    expect(() =>
      calculateAiUsageCharge({
        promptTokens: 1,
        completionTokens: 1,
        price: {
          inputNanoUsdPerMillionTokens: BigInt(1),
          outputNanoUsdPerMillionTokens: BigInt(1),
        },
        targetMarginBasisPoints: BigInt(10_000),
      })
    ).toThrow(RangeError);
    expect(() =>
      calculateAiUsageCharge({
        promptTokens: 1,
        completionTokens: 1,
        price: {
          inputNanoUsdPerMillionTokens: BigInt(1),
          outputNanoUsdPerMillionTokens: BigInt(1),
        },
        nanoUsdPerCredit: BigInt(0),
      })
    ).toThrow(RangeError);
  });
});
