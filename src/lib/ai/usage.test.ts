import { describe, it, expect, vi } from 'vitest';
import { logAiUsage } from './usage';
import type { SupabaseClient } from '@supabase/supabase-js';

function fakeDb() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const db = { from: vi.fn(() => ({ insert })) };
  return { db: db as unknown as SupabaseClient, insert, from: db.from };
}

describe('logAiUsage', () => {
  it('inserts a row mapping normalized usage to the log columns', async () => {
    const { db, insert, from } = fakeDb();
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'auto_reply',
      provider: 'anthropic',
      model: 'claude-x',
      latencyMs: 250,
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    });
    expect(from).toHaveBeenCalledWith('ai_usage_log');
    expect(insert).toHaveBeenCalledWith({
      account_id: 'acct-1',
      conversation_id: 'conv-1',
      mode: 'auto_reply',
      provider: 'anthropic',
      model: 'claude-x',
      latency_ms: 250,
      prompt_tokens: 30,
      completion_tokens: 6,
      total_tokens: 36,
    });
  });

  it('is a no-op when the provider reported no usage', async () => {
    const { db, from } = fakeDb();
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: null,
      mode: 'draft',
      provider: 'openai',
      model: 'gpt-x',
      usage: null,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('preserves token logging if migration 150 is not applied', async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce({
        error: {
          code: 'PGRST204',
          message: "Could not find the 'latency_ms' column in the schema cache",
        },
      })
      .mockResolvedValueOnce({ error: null });
    const db = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: null,
      mode: 'analysis',
      provider: 'openai',
      model: 'gpt-x',
      latencyMs: 250,
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    });

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0][0]).toHaveProperty('latency_ms', 250);
    expect(insert.mock.calls[1][0]).not.toHaveProperty('latency_ms');
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it('never throws when the insert errors', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'boom' } });
    const db = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient;
    await expect(
      logAiUsage(db, {
        accountId: 'acct-1',
        conversationId: 'conv-1',
        mode: 'draft',
        provider: 'openai',
        model: 'gpt-x',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      })
    ).resolves.toBeUndefined();
  });
});
