import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateAiUsageCharge, type AiModelPrice } from './billing';
import type { AiProvider, AiUsage } from './types';
import { AiError } from './types';

export type AiBillingMode = 'enforced';

export interface AiBillingSettings {
  mode: AiBillingMode;
  targetMarginBasisPoints: bigint;
  nanoUsdPerCredit: bigint;
}

interface PriceEntry extends AiModelPrice {
  model: string;
  effectiveAt: number;
}

export interface UsageBilling {
  mode: 'enforced';
  costNanoUsd: bigint;
  priceNanoUsd: bigint;
  creditsCharged: bigint;
}

const CACHE_TTL_MS = 60_000;

let settingsCache: {
  expiresAt: number;
  value: AiBillingSettings | null;
} | null = null;
const pricesCache = new Map<
  AiProvider,
  { expiresAt: number; value: PriceEntry[] }
>();

export class AiBillingError extends AiError {
  constructor(message: string) {
    super(message, { code: 'ai_billing_unavailable', status: 503 });
    this.name = 'AiBillingError';
  }
}

export class AiCreditsExhaustedError extends AiError {
  constructor() {
    super('La cuenta no tiene créditos disponibles. Registra una recarga para reanudar la IA.', {
      code: 'credits_exhausted',
      status: 402,
    });
    this.name = 'AiCreditsExhaustedError';
  }
}

export function resetBillingConfigCache(): void {
  settingsCache = null;
  pricesCache.clear();
}

async function loadSettings(
  db: SupabaseClient
): Promise<AiBillingSettings> {
  const now = Date.now();
  if (settingsCache && settingsCache.expiresAt > now) {
    if (!settingsCache.value) throw new AiBillingError('AI usage billing is not enabled.');
    return settingsCache.value;
  }

  let value: AiBillingSettings | null = null;
  const { data, error } = await db
    .from('ai_billing_settings')
    .select('billing_mode,target_margin_basis_points,nano_usd_per_credit')
    .eq('id', true)
    .maybeSingle();

  if (error || !data) {
    settingsCache = { expiresAt: now + CACHE_TTL_MS, value: null };
    throw new AiBillingError('AI billing settings could not be loaded.');
  }
  if (data.billing_mode !== 'enforced') {
    settingsCache = { expiresAt: now + CACHE_TTL_MS, value: null };
    throw new AiBillingError('AI usage billing is not enabled.');
  }
  value = {
    mode: 'enforced',
    targetMarginBasisPoints: BigInt(String(data.target_margin_basis_points)),
    nanoUsdPerCredit: BigInt(String(data.nano_usd_per_credit)),
  };
  settingsCache = { expiresAt: now + CACHE_TTL_MS, value };
  return value;
}

async function loadPrices(
  db: SupabaseClient,
  provider: AiProvider
): Promise<PriceEntry[]> {
  const now = Date.now();
  const cached = pricesCache.get(provider);
  if (cached && cached.expiresAt > now) return cached.value;

  let value: PriceEntry[] = [];
  const { data, error } = await db
    .from('ai_model_prices')
    .select(
      'model,input_nano_usd_per_million_tokens,output_nano_usd_per_million_tokens,effective_at'
    )
    .eq('provider', provider)
    .lte('effective_at', new Date(now).toISOString());

  if (error) {
    throw new AiBillingError('AI model prices could not be loaded.');
  }
  value = (data ?? []).map((row) => ({
    model: row.model as string,
    effectiveAt: Date.parse(row.effective_at as string),
    inputNanoUsdPerMillionTokens: BigInt(
      String(row.input_nano_usd_per_million_tokens)
    ),
    outputNanoUsdPerMillionTokens: BigInt(
      String(row.output_nano_usd_per_million_tokens)
    ),
  }));
  pricesCache.set(provider, { expiresAt: now + CACHE_TTL_MS, value });
  return value;
}

/**
 * Finds the most recent price that applies to a model. Providers sometimes
 * return a dated snapshot (`gpt-5.4-mini-2026-03-01`) for the alias that was
 * requested, so after an exact match we accept the longest alias that is a
 * dash-delimited prefix.
 */
export function pickModelPrice(
  prices: PriceEntry[],
  model: string
): PriceEntry | null {
  const candidates = prices.filter(
    (p) => p.model === model || model.startsWith(`${p.model}-`)
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, next) => {
    if (next.model.length !== best.model.length) {
      return next.model.length > best.model.length ? next : best;
    }
    return next.effectiveAt > best.effectiveAt ? next : best;
  });
}

export async function assertAiBillingReady(
  db: SupabaseClient,
  provider: AiProvider,
  model: string,
  accountId: string
): Promise<void> {
  await loadSettings(db);
  const prices = await loadPrices(db, provider);
  if (!pickModelPrice(prices, model)) {
    throw new AiBillingError(
      `No price is configured for ${provider}/${model}; the provider request was blocked.`
    );
  }

  const { data, error } = await db
    .from('ai_credit_wallets')
    .select('available_credits')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    throw new AiBillingError('AI credit balance could not be loaded.');
  }
  const availableCredits = BigInt(String(data?.available_credits ?? 0));
  if (availableCredits <= BigInt(0)) {
    throw new AiCreditsExhaustedError();
  }
}

export async function resolveUsageBilling(
  db: SupabaseClient,
  args: { provider: AiProvider; model: string; usage: AiUsage }
): Promise<UsageBilling> {
  const settings = await loadSettings(db);
  const prices = await loadPrices(db, args.provider);
  const price = pickModelPrice(prices, args.model);
  if (!price) {
    throw new AiBillingError(
      `No price is configured for ${args.provider}/${args.model}.`
    );
  }

  const charge = calculateAiUsageCharge({
    promptTokens: args.usage.promptTokens,
    completionTokens: args.usage.completionTokens,
    price,
    targetMarginBasisPoints: settings.targetMarginBasisPoints,
    nanoUsdPerCredit: settings.nanoUsdPerCredit,
  });
  return {
    mode: 'enforced',
    costNanoUsd: charge.costNanoUsd,
    priceNanoUsd: charge.priceNanoUsd,
    creditsCharged: charge.credits,
  };
}
