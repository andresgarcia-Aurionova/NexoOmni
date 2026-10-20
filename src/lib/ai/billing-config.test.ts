import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  pickModelPrice,
  resetBillingConfigCache,
  resolveUsageBilling,
} from './billing-config';
import { logAiUsage } from './usage';

const { mockSupabaseAdmin } = vi.hoisted(() => ({
  mockSupabaseAdmin: vi.fn(),
}));

vi.mock('./admin-client', () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));

type Result = { data: unknown; error: unknown };

function fakeDb(opts: {
  settings?: Result;
  prices?: Result;
  insert?: ReturnType<typeof vi.fn>;
}) {
  const insert = opts.insert ?? vi.fn().mockResolvedValue({ error: null });
  const builder = (result: Result) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.lte = () => Promise.resolve(result);
    chain.maybeSingle = () => Promise.resolve(result);
    return chain;
  };
  const from = vi.fn((table: string) => {
    if (table === 'ai_billing_settings') {
      return builder(
        opts.settings ?? { data: null, error: { message: 'missing' } }
      );
    }
    if (table === 'ai_model_prices') {
      return builder(opts.prices ?? { data: [], error: null });
    }
    return { insert };
  });
  const db = { from } as unknown as SupabaseClient;
  mockSupabaseAdmin.mockReturnValue(db);
  return { db, insert, from };
}

const shadowSettings: Result = {
  data: {
    billing_mode: 'shadow',
    target_margin_basis_points: 5000,
    nano_usd_per_credit: 1000000,
  },
  error: null,
};

const lunaPrice = {
  model: 'gpt-6-luna',
  input_nano_usd_per_million_tokens: 100000000,
  output_nano_usd_per_million_tokens: 500000000,
  effective_at: '2026-10-01T00:00:00Z',
};

const usage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 };

describe('resolveUsageBilling', () => {
  beforeEach(() => {
    resetBillingConfigCache();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('computes cost, price and credits in shadow mode', async () => {
    const { db } = fakeDb({
      settings: shadowSettings,
      prices: { data: [lunaPrice], error: null },
    });
    // cost = (1000*0.10 + 500*0.50)/1M USD = 350,000 nanoUSD; price = x2
    await expect(
      resolveUsageBilling(db, {
        provider: 'openai',
        model: 'gpt-6-luna',
        usage,
      })
    ).resolves.toEqual({
      mode: 'shadow',
      costNanoUsd: BigInt(350000),
      priceNanoUsd: BigInt(700000),
      creditsCharged: BigInt(1),
    });
  });

  it('records nothing when billing is off', async () => {
    const { db } = fakeDb({
      settings: {
        data: { ...(shadowSettings.data as object), billing_mode: 'off' },
        error: null,
      },
      prices: { data: [lunaPrice], error: null },
    });
    await expect(
      resolveUsageBilling(db, {
        provider: 'openai',
        model: 'gpt-6-luna',
        usage,
      })
    ).resolves.toBeNull();
  });

  it('does not claim charges in enforced mode until debiting exists', async () => {
    const { db } = fakeDb({
      settings: {
        data: { ...(shadowSettings.data as object), billing_mode: 'enforced' },
        error: null,
      },
      prices: { data: [lunaPrice], error: null },
    });
    await expect(
      resolveUsageBilling(db, {
        provider: 'openai',
        model: 'gpt-6-luna',
        usage,
      })
    ).resolves.toBeNull();
  });

  it('skips models without a configured price', async () => {
    const { db } = fakeDb({
      settings: shadowSettings,
      prices: { data: [lunaPrice], error: null },
    });
    await expect(
      resolveUsageBilling(db, { provider: 'openai', model: 'unknown', usage })
    ).resolves.toBeNull();
  });

  it('returns null instead of throwing when configuration cannot be read', async () => {
    const db = {
      from: vi.fn(() => {
        throw new Error('db down');
      }),
    } as unknown as SupabaseClient;
    await expect(
      resolveUsageBilling(db, {
        provider: 'openai',
        model: 'gpt-6-luna',
        usage,
      })
    ).resolves.toBeNull();
  });
});

describe('pickModelPrice', () => {
  const entry = (model: string, effectiveAt: number) => ({
    model,
    effectiveAt,
    inputNanoUsdPerMillionTokens: BigInt(1),
    outputNanoUsdPerMillionTokens: BigInt(1),
  });

  it('matches dated snapshots by alias prefix, preferring the longest alias', () => {
    const prices = [entry('gpt-5', 1), entry('gpt-5-mini', 1)];
    expect(pickModelPrice(prices, 'gpt-5-mini-2026-03-01')?.model).toBe(
      'gpt-5-mini'
    );
  });

  it('does not match an unrelated model that merely shares a prefix', () => {
    expect(pickModelPrice([entry('gpt-5', 1)], 'gpt-5mini')).toBeNull();
  });

  it('uses the newest price for the same model', () => {
    const newer = entry('gpt-6-luna', 20);
    expect(pickModelPrice([entry('gpt-6-luna', 10), newer], 'gpt-6-luna')).toBe(
      newer
    );
  });
});

describe('logAiUsage with shadow billing', () => {
  beforeEach(() => {
    resetBillingConfigCache();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('stores the computed estimate on the usage row', async () => {
    const { db, insert } = fakeDb({
      settings: shadowSettings,
      prices: { data: [lunaPrice], error: null },
    });
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: null,
      mode: 'analysis',
      provider: 'openai',
      model: 'gpt-6-luna',
      usage,
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        cost_nano_usd: '350000',
        price_nano_usd: '700000',
        credits_charged: '1',
        billing_mode: 'shadow',
      })
    );
  });

  it('still logs tokens when billing configuration is unavailable', async () => {
    const { db, insert } = fakeDb({});
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: null,
      mode: 'analysis',
      provider: 'openai',
      model: 'gpt-6-luna',
      usage,
    });
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({ prompt_tokens: 1000, completion_tokens: 500 });
    expect(row).not.toHaveProperty('billing_mode');
  });
});
