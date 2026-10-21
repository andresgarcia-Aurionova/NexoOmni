import { describe, expect, it } from 'vitest';

import { calculateCallCharge, parseCallEnded } from './call-billing';

const event = {
  event: 'call.ended',
  call: {
    id: 'call-1',
    accountId: 'acc-1',
    phoneNumberId: 'num-1',
    direction: 'inbound',
    startedAt: '2026-10-20T10:00:00Z',
    endedAt: '2026-10-20T10:02:05Z',
    durationSeconds: 125,
    endReason: 'hangup',
    billing: {
      metaCostUSD: 0.02,
      billableCostUSD: 0.05,
      totalCostUSD: 0.07,
    },
  },
};

const settings = {
  targetMarginBasisPoints: BigInt(5000),
  nanoUsdPerCredit: BigInt(1_000_000),
  minutePriceMxnCentavos: BigInt(50),
  mxnPerUsdMicro: BigInt(20_000_000),
};

describe('parseCallEnded', () => {
  it('reads the documented call.ended fields', () => {
    const parsed = parseCallEnded(event);
    expect(parsed).toMatchObject({
      callId: 'call-1',
      zernioAccountId: 'acc-1',
      durationSeconds: 125,
      endReason: 'hangup',
    });
    expect(parsed?.zernioCostNanoUsd).toBe(BigInt(50_000_000));
    expect(parsed?.metaCostNanoUsd).toBe(BigInt(20_000_000));
  });

  it('rejects payloads without an id or with invalid amounts', () => {
    expect(parseCallEnded({ call: { accountId: 'a' } })).toBeNull();
    expect(
      parseCallEnded({
        call: { id: 'c', accountId: 'a', billing: { billableCostUSD: -1 } },
      })
    ).toBeNull();
    expect(parseCallEnded(null)).toBeNull();
  });
});

describe('calculateCallCharge', () => {
  it('charges Zernio cost plus margin and per-started-minute MXN price', () => {
    const parsed = parseCallEnded(event)!;
    const charge = calculateCallCharge(parsed, settings);
    // 0.05 USD / (1 - 0.5) = 0.10 USD = 100,000,000 nano => 100 credits.
    expect(charge.connectionPriceNanoUsd).toBe(BigInt(100_000_000));
    expect(charge.connectionCredits).toBe(BigInt(100));
    // 125 s => 3 started minutes x 0.50 MXN = 1.50 MXN / 20 = 0.075 USD.
    expect(charge.billableMinutes).toBe(3);
    expect(charge.minuteCredits).toBe(BigInt(75));
  });

  it('does not charge minutes for unanswered calls', () => {
    const parsed = { ...parseCallEnded(event)!, endReason: 'no_answer' };
    expect(calculateCallCharge(parsed, settings).billableMinutes).toBe(0);
    expect(calculateCallCharge(parsed, settings).minuteCredits).toBe(
      BigInt(0)
    );
  });

  it('leaves minute credits empty until the exchange rate is configured', () => {
    const charge = calculateCallCharge(parseCallEnded(event)!, {
      ...settings,
      mxnPerUsdMicro: null,
    });
    expect(charge.minuteCredits).toBeNull();
    expect(charge.connectionCredits).toBe(BigInt(100));
  });
});
