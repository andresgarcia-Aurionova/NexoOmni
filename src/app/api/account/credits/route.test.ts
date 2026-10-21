import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireEntitlement: vi.fn(),
}));

vi.mock('@/lib/account/entitlements', () => ({
  requireEntitlement: mocks.requireEntitlement,
}));

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: () =>
    Response.json({ error: 'Forbidden' }, { status: 403 }),
}));

import { GET } from './route';

const ledgerEntry = {
  id: 'ledger-1',
  entry_type: 'usage',
  delta_credits: '-5',
  balance_after: '95',
  created_at: '2026-10-21T10:00:00.000Z',
  provider: 'openai',
  model: 'internal-model-name',
};

function scopedDatabase() {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
    async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/ai_credit_wallets')) {
        return Response.json([
          {
            available_credits: '95',
            updated_at: '2026-10-21T10:00:00.000Z',
          },
        ]);
      }
      if (url.pathname.endsWith('/ai_credit_ledger')) {
        return Response.json([ledgerEntry]);
      }
      throw new Error(`Unexpected database request: ${url.pathname}`);
    }
  );
  const supabase = createClient('https://supabase.example', 'test-key', {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  mocks.requireEntitlement.mockResolvedValue({
    accountId: 'account-1',
    supabase,
  });
  return fetch;
}

beforeEach(() => {
  mocks.requireEntitlement.mockReset();
});

describe('GET /api/account/credits', () => {
  it('returns only the authenticated tenant balance and safe ledger fields', async () => {
    const fetch = scopedDatabase();

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.requireEntitlement).toHaveBeenCalledWith(
      'ai_conversation_intelligence',
      'supervisor'
    );
    expect(await response.json()).toEqual({
      balance: '95',
      updated_at: '2026-10-21T10:00:00.000Z',
      movements: [
        {
          id: 'ledger-1',
          entry_type: 'usage',
          delta_credits: '-5',
          balance_after: '95',
          created_at: '2026-10-21T10:00:00.000Z',
        },
      ],
    });

    const urls = fetch.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url.searchParams.get('account_id')).toBe('eq.account-1');
    }
    expect(
      urls.find((url) => url.pathname.endsWith('/ai_credit_ledger'))?.searchParams.get(
        'select'
      )
    ).toBe('id,entry_type,delta_credits,balance_after,created_at');
  });

  it('does not query account data when the entitlement check rejects access', async () => {
    mocks.requireEntitlement.mockRejectedValue(new Error('Forbidden'));

    const response = await GET();

    expect(response.status).toBe(403);
  });
});
