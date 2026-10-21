import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  availableCreditBalance,
  assertAiBillingReady,
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
  wallet?: Result;
  batches?: Result;
  rpc?: ReturnType<typeof vi.fn>;
}) {
  const rpc =
    opts.rpc ??
    vi.fn().mockResolvedValue({
      data: [{ result: 'debited', available_credits: '10' }],
      error: null,
    });
  const builder = (result: Result) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.gt = () => chain;
    chain.lte = () => chain;
    chain.maybeSingle = () => Promise.resolve(result);
    chain.then = (
      resolve: (value: Result) => unknown,
      reject: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject);
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
    if (table === 'ai_credit_batches') {
      return builder(
        opts.batches ?? {
          data: [{ remaining_credits: '100', expires_at: null }],
          error: null,
        }
      );
    }
    return {};
  });
  const db = { from, rpc } as unknown as SupabaseClient;
  mockSupabaseAdmin.mockReturnValue(db);
  return { db, rpc, from };
}

const enforcedSettings: Result = {
  data: {
    billing_mode: 'enforced',
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

  it('computes cost, price and credits in enforced mode', async () => {
    const { db } = fakeDb({
      settings: enforcedSettings,
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
      mode: 'enforced',
      costNanoUsd: BigInt(350000),
      priceNanoUsd: BigInt(700000),
      creditsCharged: BigInt(1),
    });
  });

  it('blocks provider usage when billing is off', async () => {
    const { db } = fakeDb({
      settings: {
        data: { ...(enforcedSettings.data as object), billing_mode: 'off' },
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
    ).rejects.toThrow('AI usage billing is not enabled.');
  });

  it('blocks requests for models without configured prices', async () => {
    const { db } = fakeDb({
      settings: enforcedSettings,
      prices: { data: [], error: null },
    });
    await expect(
      assertAiBillingReady(db, 'openai', 'unpriced-model', 'acct-1')
    ).rejects.toThrow('No price is configured');
  });

  it('does not fall through when billing configuration cannot be read', async () => {
    const { db } = fakeDb({
      settings: { data: null, error: { message: 'missing settings' } },
    });
    await expect(
      assertAiBillingReady(db, 'openai', 'gpt-6-luna', 'acct-1')
    ).rejects.toThrow('AI billing settings could not be loaded.');
  });

  it('blocks provider usage when the available credit balance is zero', async () => {
    const { db } = fakeDb({
      settings: enforcedSettings,
      prices: { data: [lunaPrice], error: null },
      batches: {
        data: [],
        error: null,
      },
    });
    await expect(
      assertAiBillingReady(db, 'openai', 'gpt-6-luna', 'acct-1')
    ).rejects.toMatchObject({
      code: 'credits_exhausted',
      status: 402,
    });
  });

  it('blocks requests when only expired credit batches remain', async () => {
    const { db } = fakeDb({
      settings: enforcedSettings,
      prices: { data: [lunaPrice], error: null },
      batches: {
        data: [
          {
            remaining_credits: '25',
            expires_at: '2026-10-20T00:00:00.000Z',
          },
        ],
        error: null,
      },
    });
    await expect(
      assertAiBillingReady(db, 'openai', 'gpt-6-luna', 'acct-1')
    ).rejects.toMatchObject({
      code: 'credits_exhausted',
      status: 402,
    });
  });

  describe('availableCreditBalance', () => {
    it('counts non-expiring and unexpired batches only', () => {
      expect(
        availableCreditBalance(
          [
            { remaining_credits: '10', expires_at: null },
            { remaining_credits: '20', expires_at: '2026-10-21T12:00:00Z' },
            { remaining_credits: '40', expires_at: '2026-10-21T10:00:00Z' },
          ],
          Date.parse('2026-10-21T11:00:00Z')
        )
      ).toBe(BigInt(30));
    });
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

describe('logAiUsage with enforced billing', () => {
  beforeEach(() => {
    resetBillingConfigCache();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('atomically records usage and debits the calculated credits', async () => {
    const { db, rpc } = fakeDb({
      settings: enforcedSettings,
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
    expect(rpc).toHaveBeenCalledWith(
      'record_ai_usage_and_debit',
      expect.objectContaining({
        p_account_id: 'acct-1',
        p_prompt_tokens: 1000,
        p_completion_tokens: 500,
        p_cost_nano_usd: '350000',
        p_price_nano_usd: '700000',
        p_credits: '1',
        p_idempotency_key: expect.any(String),
      })
    );
  });
});
