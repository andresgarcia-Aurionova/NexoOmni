import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadBanxicoFix, parseBanxicoFix, parseMxnRate } from './banxico-fx';

function fakeDb(data: unknown) {
  const updates: unknown[] = [];
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  chain.update = vi.fn((value: unknown) => {
    updates.push(value);
    return chain;
  });
  chain.then = vi.fn((resolve: (value: unknown) => void) =>
    resolve({ error: null })
  );
  const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
  return { db, chain, updates };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('parseBanxicoFix', () => {
  it('parses the official FIX series value without floating-point rounding', () => {
    expect(
      parseBanxicoFix({
        bmx: {
          series: [
            {
              idSerie: 'SF43718',
              datos: [{ fecha: '2026-10-20', dato: '18.123456' }],
            },
          ],
        },
      })
    ).toEqual({
      date: '2026-10-20',
      mxnPerUsdMicro: BigInt(18_123_456),
    });
  });

  it('rejects malformed, zero, and missing data', () => {
    expect(parseBanxicoFix({})).toBeNull();
    expect(
      parseBanxicoFix({
        bmx: {
          series: [{ datos: [{ fecha: '2026-10-20', dato: '0' }] }],
        },
      })
    ).toBeNull();
    expect(
      parseBanxicoFix({
        bmx: {
          series: [{ datos: [{ fecha: '31/02/2026', dato: '18.2' }] }],
        },
      })
    ).toBeNull();
  });

  it('parses the real Banxico DD/MM/YYYY date format', () => {
    expect(
      parseBanxicoFix({
        bmx: {
          series: [{ datos: [{ fecha: '20/10/2026', dato: '18.4200' }] }],
        },
      })
    ).toEqual({ date: '2026-10-20', mxnPerUsdMicro: BigInt(18_420_000) });
  });
});

describe('loadBanxicoFix', () => {
  it('refreshes a missing rate from the official SIE endpoint and saves it', async () => {
    vi.stubEnv('BANXICO_API_TOKEN', 'server-token');
    const { db, chain, updates } = fakeDb({
      mxn_per_usd_micro: null,
      mxn_fx_date: null,
      mxn_fx_fetched_at: null,
      mxn_fx_source: null,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          bmx: {
            series: [
              {
                idSerie: 'SF43718',
                datos: [{ fecha: '2026-10-20', dato: '18.1234' }],
              },
            ],
          },
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const rate = await loadBanxicoFix(db, Date.parse('2026-10-20T18:00:00Z'));

    expect(rate.mxnPerUsdMicro).toBe(BigInt(18_123_400));
    expect(rate.date).toBe('2026-10-20');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/oportuno',
      expect.objectContaining({
        headers: { Accept: 'application/json', 'Bmx-Token': 'server-token' },
      })
    );
    expect(chain.update).toHaveBeenCalledOnce();
    expect(updates[0]).toMatchObject({
      mxn_per_usd_micro: '18123400',
      mxn_fx_date: '2026-10-20',
      mxn_fx_source: 'Banxico SIE SF43718',
    });
  });

  it('uses a recent cached official rate if Banxico is temporarily unavailable', async () => {
    vi.stubEnv('BANXICO_API_TOKEN', 'server-token');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = fakeDb({
      mxn_per_usd_micro: '18123400',
      mxn_fx_date: '2026-10-19',
      mxn_fx_fetched_at: '2026-10-19T10:00:00.000Z',
      mxn_fx_source: 'Banxico SIE SF43718',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    );

    const rate = await loadBanxicoFix(db, Date.parse('2026-10-20T18:00:00Z'));
    expect(rate.mxnPerUsdMicro).toBe(BigInt(18_123_400));
    expect(rate.date).toBe('2026-10-19');
  });

  it('fails explicitly when no usable rate exists and the server token is missing', async () => {
    const { db } = fakeDb({
      mxn_per_usd_micro: null,
      mxn_fx_date: null,
      mxn_fx_fetched_at: null,
      mxn_fx_source: null,
    });
    await expect(
      loadBanxicoFix(db, Date.parse('2026-10-20T18:00:00Z'))
    ).rejects.toThrow('BANXICO_API_TOKEN is required');
  });

  it('fails explicitly when the stored token cannot be decrypted', async () => {
    vi.stubEnv('BANXICO_API_TOKEN', 'env-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = fakeDb({
      mxn_per_usd_micro: null,
      mxn_fx_date: null,
      mxn_fx_fetched_at: null,
      mxn_fx_source: null,
      banxico_token_encrypted: 'not-valid-ciphertext',
    });
    await expect(
      loadBanxicoFix(db, Date.parse('2026-10-20T18:00:00Z'))
    ).rejects.toThrow('could not be decrypted');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honors a manual rate for 24 hours without calling Banxico', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { db } = fakeDb({
      mxn_per_usd_micro: '19000000',
      mxn_fx_date: '2026-10-20',
      mxn_fx_fetched_at: '2026-10-20T00:00:00.000Z',
      mxn_fx_source: 'manual',
    });
    const rate = await loadBanxicoFix(db, Date.parse('2026-10-20T20:00:00Z'));
    expect(rate.mxnPerUsdMicro).toBe(BigInt(19_000_000));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forces a Banxico query and fails when it is unavailable', async () => {
    const { db } = fakeDb({
      mxn_per_usd_micro: '18123400',
      mxn_fx_date: '2026-10-20',
      mxn_fx_fetched_at: '2026-10-20T17:00:00.000Z',
      mxn_fx_source: 'Banxico SIE SF43718',
    });
    await expect(
      loadBanxicoFix(db, Date.parse('2026-10-20T18:00:00Z'), { force: true })
    ).rejects.toThrow('BANXICO_API_TOKEN is not configured');
  });
});

describe('parseMxnRate', () => {
  it('accepts sane rates and rejects out-of-range values', () => {
    expect(parseMxnRate('18.25')).toBe(BigInt(18_250_000));
    expect(parseMxnRate(18.25)).toBe(BigInt(18_250_000));
    expect(parseMxnRate('0.5')).toBeNull();
    expect(parseMxnRate('abc')).toBeNull();
  });
});
