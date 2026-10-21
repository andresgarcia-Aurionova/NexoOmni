import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';

const BANXICO_FIX_URL =
  'https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/oportuno';
const FETCH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MAX_RATE_AGE_MS = 5 * 24 * 60 * 60 * 1000;

export interface BanxicoRate {
  mxnPerUsdMicro: bigint;
  date: string;
  fetchedAt: string;
  source: string;
}

interface RateRow {
  mxn_per_usd_micro: string | number | null;
  mxn_fx_date: string | null;
  mxn_fx_fetched_at: string | null;
  mxn_fx_source: string | null;
  banxico_token_encrypted?: string | null;
}

function decryptToken(value: string): string | undefined {
  try {
    return decrypt(value);
  } catch {
    console.error('[billing] The stored Banxico token could not be decrypted.');
    return process.env.BANXICO_API_TOKEN;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseRate(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(value)) {
    return null;
  }
  const [whole, fractional = ''] = value.split('.');
  const rate =
    BigInt(whole) * BigInt(1_000_000) +
    BigInt(fractional.padEnd(6, '0'));
  return rate > BigInt(0) ? rate : null;
}

export function parseBanxicoFix(payload: unknown): {
  date: string;
  mxnPerUsdMicro: bigint;
} | null {
  const root = record(payload);
  const bmx = record(root?.bmx);
  const series = Array.isArray(bmx?.series) ? bmx.series : [];
  const firstSeries = record(series[0]);
  const data = Array.isArray(firstSeries?.datos) ? firstSeries.datos : [];
  const latest = record(data[0]);
  const date = latest?.fecha;
  const rate = parseRate(latest?.dato);
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    !rate
  ) {
    return null;
  }
  return { date, mxnPerUsdMicro: rate };
}

export const MANUAL_FX_SOURCE = 'manual';
const MANUAL_FETCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function parseMxnRate(value: unknown): bigint | null {
  const rate = parseRate(typeof value === 'number' ? String(value) : value);
  // Rango de sensatez para evitar capturas erróneas (MXN por USD).
  return rate && rate >= BigInt(5_000_000) && rate <= BigInt(100_000_000)
    ? rate
    : null;
}

export async function saveManualFix(
  db: SupabaseClient,
  mxnPerUsdMicro: bigint,
  now = Date.now()
): Promise<BanxicoRate> {
  const iso = new Date(now).toISOString();
  const { error } = await db
    .from('ai_billing_settings')
    .update({
      mxn_per_usd_micro: mxnPerUsdMicro.toString(),
      mxn_fx_date: iso.slice(0, 10),
      mxn_fx_fetched_at: iso,
      mxn_fx_source: MANUAL_FX_SOURCE,
      updated_at: iso,
    })
    .eq('id', true);
  if (error) throw new Error('The manual exchange rate could not be saved.');
  return {
    mxnPerUsdMicro,
    date: iso.slice(0, 10),
    fetchedAt: iso,
    source: MANUAL_FX_SOURCE,
  };
}

export async function loadBanxicoFix(
  db: SupabaseClient,
  now = Date.now(),
  options: { force?: boolean } = {}
): Promise<BanxicoRate> {
  const { data, error } = await db
    .from('ai_billing_settings')
    .select(
      'mxn_per_usd_micro,mxn_fx_date,mxn_fx_fetched_at,mxn_fx_source,banxico_token_encrypted'
    )
    .eq('id', true)
    .maybeSingle();
  if (error || !data) {
    throw new Error('Banxico exchange-rate settings could not be loaded.');
  }

  const row = data as RateRow;
  const cachedRate =
    row.mxn_per_usd_micro === null
      ? null
      : BigInt(String(row.mxn_per_usd_micro));
  const cachedDate = row.mxn_fx_date;
  const fetchedAt = row.mxn_fx_fetched_at;
  const fetchedAge = fetchedAt ? now - Date.parse(fetchedAt) : Infinity;
  const rateAge = cachedDate
    ? now - Date.parse(`${cachedDate}T00:00:00Z`)
    : Infinity;

  const cacheWindow =
    row.mxn_fx_source === MANUAL_FX_SOURCE
      ? MANUAL_FETCH_INTERVAL_MS
      : FETCH_INTERVAL_MS;
  if (
    !options.force &&
    cachedRate &&
    cachedDate &&
    fetchedAt &&
    fetchedAge >= 0 &&
    fetchedAge < cacheWindow
  ) {
    return {
      mxnPerUsdMicro: cachedRate,
      date: cachedDate,
      fetchedAt,
      source: row.mxn_fx_source ?? 'Banxico SIE SF43718',
    };
  }

  const token = row.banxico_token_encrypted
    ? decryptToken(row.banxico_token_encrypted)
    : process.env.BANXICO_API_TOKEN;
  let freshRate: ReturnType<typeof parseBanxicoFix> = null;
  if (token) {
    try {
      const response = await fetch(BANXICO_FIX_URL, {
        headers: { Accept: 'application/json', 'Bmx-Token': token },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        throw new Error(`Banxico API returned HTTP ${response.status}.`);
      }
      freshRate = parseBanxicoFix(await response.json());
    } catch (fetchError) {
      console.error('[billing] Banxico FIX refresh failed:', fetchError);
    }
  }

  if (freshRate) {
    const fetchedNow = new Date(now).toISOString();
    const source = 'Banxico SIE SF43718';
    const { error: updateError } = await db
      .from('ai_billing_settings')
      .update({
        mxn_per_usd_micro: freshRate.mxnPerUsdMicro.toString(),
        mxn_fx_date: freshRate.date,
        mxn_fx_fetched_at: fetchedNow,
        mxn_fx_source: source,
        updated_at: fetchedNow,
      })
      .eq('id', true);
    if (updateError) {
      throw new Error('Banxico FIX could not be saved for billing.');
    }
    return { ...freshRate, fetchedAt: fetchedNow, source };
  }

  if (options.force) {
    throw new Error(
      token
        ? 'Banxico did not return a usable FIX rate.'
        : 'BANXICO_API_TOKEN is not configured.'
    );
  }

  if (
    cachedRate &&
    cachedDate &&
    rateAge >= 0 &&
    rateAge <= MAX_RATE_AGE_MS
  ) {
    console.warn(
      `[billing] using the latest cached Banxico FIX (${cachedDate}) because a fresh rate is unavailable.`
    );
    return {
      mxnPerUsdMicro: cachedRate,
      date: cachedDate,
      fetchedAt: fetchedAt ?? new Date(now).toISOString(),
      source: row.mxn_fx_source ?? 'Banxico SIE SF43718',
    };
  }

  if (!token) {
    throw new Error(
      'BANXICO_API_TOKEN is required to obtain an exchange rate for call billing.'
    );
  }
  throw new Error(
    'Banxico has no usable FIX rate; the call cannot be billed safely.'
  );
}
