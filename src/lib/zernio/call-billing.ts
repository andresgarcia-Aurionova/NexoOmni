const NANO_PER_USD = 1_000_000_000;
const BASIS_POINTS = BigInt(10_000);

export interface ParsedCallEnded {
  callId: string;
  zernioAccountId: string;
  phoneNumberId: string | null;
  direction: 'inbound' | 'outbound' | null;
  endReason: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  zernioCostNanoUsd: bigint;
  metaCostNanoUsd: bigint;
}

export interface CallBillingSettings {
  targetMarginBasisPoints: bigint;
  nanoUsdPerCredit: bigint;
  minutePriceMxnCentavos: bigint;
  mxnPerUsdMicro: bigint | null;
  /** Minimum connection price, applied even when Zernio bills zero. */
  connectionPriceFloorNanoUsd?: bigint;
}

export interface CallCharge {
  billableMinutes: number;
  connectionPriceNanoUsd: bigint;
  connectionCredits: bigint;
  minutePriceNanoUsd: bigint | null;
  minuteCredits: bigint | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function usdToNano(value: unknown): bigint | null {
  if (value === undefined || value === null) return BigInt(0);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return BigInt(Math.round(value * NANO_PER_USD));
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  if (numerator <= BigInt(0)) return BigInt(0);
  return (numerator + denominator - BigInt(1)) / denominator;
}

/**
 * Reads the documented `call.ended` payload
 * (https://docs.zernio.com/webhooks/calls). Returns null when the fields we
 * need to attribute and price the call are missing or malformed.
 */
export function parseCallEnded(event: unknown): ParsedCallEnded | null {
  if (!isRecord(event) || !isRecord(event.call)) return null;
  const call = event.call;
  const callId = optionalString(call.id);
  const zernioAccountId = optionalString(call.accountId);
  if (!callId || !zernioAccountId) return null;

  const duration = call.durationSeconds ?? 0;
  if (
    typeof duration !== 'number' ||
    !Number.isInteger(duration) ||
    duration < 0
  ) {
    return null;
  }

  const billing = isRecord(call.billing) ? call.billing : {};
  const zernioCost = usdToNano(billing.billableCostUSD);
  const metaCost = usdToNano(billing.metaCostUSD);
  if (zernioCost === null || metaCost === null) return null;

  const direction =
    call.direction === 'inbound' || call.direction === 'outbound'
      ? call.direction
      : null;

  return {
    callId,
    zernioAccountId,
    phoneNumberId: optionalString(call.phoneNumberId),
    direction,
    endReason: optionalString(call.endReason),
    startedAt: optionalString(call.startedAt),
    endedAt: optionalString(call.endedAt),
    durationSeconds: duration,
    zernioCostNanoUsd: zernioCost,
    metaCostNanoUsd: metaCost,
  };
}

/**
 * Connection = the greater of the fixed connection price and what Zernio
 * billed for the call plus the target margin.
 * Minutes = a flat MXN price per started minute, only for answered calls
 * (`hangup`), converted to credits with the configured exchange rate.
 * Meta's per-minute cost is billed to the WABA directly and is never charged.
 */
export function calculateCallCharge(
  call: Pick<ParsedCallEnded, 'durationSeconds' | 'endReason' | 'zernioCostNanoUsd'>,
  settings: CallBillingSettings
): CallCharge {
  if (
    settings.targetMarginBasisPoints < BigInt(0) ||
    settings.targetMarginBasisPoints >= BASIS_POINTS
  ) {
    throw new RangeError('Target margin must be between 0 and 9999 basis points');
  }
  if (settings.nanoUsdPerCredit <= BigInt(0)) {
    throw new RangeError('nanoUsdPerCredit must be positive');
  }

  const costPlusMargin = ceilDiv(
    call.zernioCostNanoUsd * BASIS_POINTS,
    BASIS_POINTS - settings.targetMarginBasisPoints
  );
  const floor = settings.connectionPriceFloorNanoUsd ?? BigInt(0);
  const connectionPriceNanoUsd = costPlusMargin > floor ? costPlusMargin : floor;
  const connectionCredits = ceilDiv(
    connectionPriceNanoUsd,
    settings.nanoUsdPerCredit
  );

  const answered = call.endReason === 'hangup';
  const billableMinutes = answered ? Math.ceil(call.durationSeconds / 60) : 0;

  let minuteCredits: bigint | null = null;
  let minutePriceNanoUsd: bigint | null = null;
  if (settings.mxnPerUsdMicro !== null) {
    if (settings.mxnPerUsdMicro <= BigInt(0)) {
      throw new RangeError('mxnPerUsdMicro must be positive');
    }
    // centavos / 100 = MXN; MXN / (micro / 1e6) = USD; USD * 1e9 = nano USD.
    minutePriceNanoUsd = ceilDiv(
      BigInt(billableMinutes) *
        settings.minutePriceMxnCentavos *
        BigInt(10_000_000_000_000),
      settings.mxnPerUsdMicro
    );
    minuteCredits = ceilDiv(minutePriceNanoUsd, settings.nanoUsdPerCredit);
  }

  return {
    billableMinutes,
    connectionPriceNanoUsd,
    connectionCredits,
    minutePriceNanoUsd,
    minuteCredits,
  };
}
