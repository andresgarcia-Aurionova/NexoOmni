import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateAiUsageCharge, type AiModelPrice } from './billing';
import type { AiProvider, AiUsage } from './types';

export type AiBillingMode = 'off' | 'shadow' | 'enforced';

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
  mode: 'shadow';
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
const warnedUnpriced = new Set<string>();

export function resetBillingConfigCache(): void {
  settingsCache = null;
  pricesCache.clear();
  warnedUnpriced.clear();
}

async function loadSettings(
  db: SupabaseClient
): Promise<AiBillingSettings | null> {
  const now = Date.now();
  if (settingsCache && settingsCache.expiresAt > now) {
    return settingsCache.value;
  }

  let value: AiBillingSettings | null = null;
  const { data, error } = await db
    .from('ai_billing_settings')
    .select('billing_mode,target_margin_basis_points,nano_usd_per_credit')
    .eq('id', true)
    .maybeSingle();

  if (!error && data) {
    value = {
      mode: data.billing_mode as AiBillingMode,
      targetMarginBasisPoints: BigInt(String(data.target_margin_basis_points)),
      nanoUsdPerCredit: BigInt(String(data.nano_usd_per_credit)),
    };
  }
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

  if (!error && data) {
    value = data.map((row) => ({
      model: row.model as string,
      effectiveAt: Date.parse(row.effective_at as string),
      inputNanoUsdPerMillionTokens: BigInt(
        String(row.input_nano_usd_per_million_tokens)
      ),
      outputNanoUsdPerMillionTokens: BigInt(
        String(row.output_nano_usd_per_million_tokens)
      ),
    }));
  }
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

/**
 * Shadow billing: computes what a call would cost and charge without touching
 * any wallet. Returns null (and never throws) when billing is off, the model
 * has no configured price, or the configuration cannot be read, so usage
 * logging always continues. Debiting in `enforced` mode is not implemented
 * yet, so that mode is also treated as "record nothing" rather than claiming
 * a charge that never happened.
 */
export async function resolveUsageBilling(
  db: SupabaseClient,
  args: { provider: AiProvider; model: string; usage: AiUsage }
): Promise<UsageBilling | null> {
  try {
    const settings = await loadSettings(db);
    if (!settings || settings.mode === 'off') return null;
    if (settings.mode === 'enforced') {
      console.warn(
        '[ai billing] enforced mode is not implemented yet; recording nothing.'
      );
      return null;
    }

    const prices = await loadPrices(db, args.provider);
    const price = pickModelPrice(prices, args.model);
    if (!price) {
      const key = `${args.provider}/${args.model}`;
      if (!warnedUnpriced.has(key)) {
        warnedUnpriced.add(key);
        console.warn(
          `[ai billing] no price configured for ${key}; add it to ai_model_prices.`
        );
      }
      return null;
    }

    const charge = calculateAiUsageCharge({
      promptTokens: args.usage.promptTokens,
      completionTokens: args.usage.completionTokens,
      price,
      targetMarginBasisPoints: settings.targetMarginBasisPoints,
      nanoUsdPerCredit: settings.nanoUsdPerCredit,
    });
    return {
      mode: 'shadow',
      costNanoUsd: charge.costNanoUsd,
      priceNanoUsd: charge.priceNanoUsd,
      creditsCharged: charge.credits,
    };
  } catch (err) {
    console.error('[ai billing] could not compute shadow charge:', err);
    return null;
  }
}
