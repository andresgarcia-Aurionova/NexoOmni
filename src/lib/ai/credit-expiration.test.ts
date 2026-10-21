import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { processAiCreditExpirations } from './credit-expiration';

describe('processAiCreditExpirations', () => {
  it('returns the database-confirmed batch and credit totals', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ processed_batches: 2, expired_credits: '1500' }],
      error: null,
    });
    const db = { rpc } as unknown as SupabaseClient;

    await expect(processAiCreditExpirations(db)).resolves.toEqual({
      processed_batches: 2,
      expired_credits: '1500',
    });
    expect(rpc).toHaveBeenCalledWith('expire_ai_credit_batches', {
      p_account_id: null,
      p_limit: 100,
    });
  });

  it('surfaces database failures and malformed confirmations', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error('db unavailable') })
      .mockResolvedValueOnce({ data: [], error: null });
    const db = { rpc } as unknown as SupabaseClient;

    await expect(processAiCreditExpirations(db)).rejects.toThrow(
      'db unavailable'
    );
    await expect(processAiCreditExpirations(db)).rejects.toThrow(
      'did not confirm credit expiration'
    );
  });
});
