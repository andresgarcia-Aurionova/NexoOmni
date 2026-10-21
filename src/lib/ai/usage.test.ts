import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logAiUsage } from './usage';
import { resolveUsageBilling } from './billing-config';

const { mockSupabaseAdmin } = vi.hoisted(() => ({
  mockSupabaseAdmin: vi.fn(),
}));

vi.mock('./admin-client', () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));

vi.mock('./billing-config', () => ({
  AiBillingError: class extends Error {},
  resolveUsageBilling: vi.fn(),
}));

function fakeDb(
  rpcResult: { data: unknown; error: unknown } = {
    data: [{ result: 'debited', available_credits: '10' }],
    error: null,
  }
) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const db = { rpc } as unknown as SupabaseClient;
  mockSupabaseAdmin.mockReturnValue(db);
  return { db, rpc };
}

describe('logAiUsage', () => {
  beforeEach(() => {
    vi.mocked(resolveUsageBilling).mockResolvedValue({
      mode: 'enforced',
      costNanoUsd: BigInt(100),
      priceNanoUsd: BigInt(200),
      creditsCharged: BigInt(1),
    });
  });

  it('atomically records normalized provider usage and the charge', async () => {
    const { db, rpc } = fakeDb();
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'auto_reply',
      provider: 'anthropic',
      model: 'claude-x',
      latencyMs: 250,
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
      billingIdempotencyKey: 'request-1',
    });

    expect(resolveUsageBilling).toHaveBeenCalledWith(db, {
      provider: 'anthropic',
      model: 'claude-x',
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    });
    expect(rpc).toHaveBeenCalledWith('record_ai_usage_and_debit', {
      p_account_id: 'acct-1',
      p_conversation_id: 'conv-1',
      p_mode: 'auto_reply',
      p_provider: 'anthropic',
      p_model: 'claude-x',
      p_prompt_tokens: 30,
      p_completion_tokens: 6,
      p_total_tokens: 36,
      p_latency_ms: 250,
      p_cost_nano_usd: '100',
      p_price_nano_usd: '200',
      p_credits: '1',
      p_idempotency_key: 'request-1',
    });
  });

  it('does not claim success when the provider omitted usage', async () => {
    const { db, rpc } = fakeDb();
    await expect(
      logAiUsage(db, {
        accountId: 'acct-1',
        conversationId: null,
        mode: 'draft',
        provider: 'openai',
        model: 'gpt-x',
        usage: null,
      })
    ).rejects.toThrow('did not include billable usage');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces database failures instead of swallowing unbilled usage', async () => {
    const { db } = fakeDb({ data: null, error: new Error('database unavailable') });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      logAiUsage(db, {
        accountId: 'acct-1',
        conversationId: null,
        mode: 'analysis',
        provider: 'openai',
        model: 'gpt-x',
        usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
      })
    ).rejects.toThrow('AI usage could not be charged');
    errorLog.mockRestore();
  });
});
