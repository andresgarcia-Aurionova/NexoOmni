import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireEntitlement: vi.fn(),
  loadBanxicoFix: vi.fn(),
}));

vi.mock('@/lib/account/entitlements', () => ({
  requireEntitlement: mocks.requireEntitlement,
}));

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: () =>
    Response.json({ error: 'Forbidden' }, { status: 403 }),
}));

vi.mock('@/lib/billing/banxico-fx', () => ({
  loadBanxicoFix: mocks.loadBanxicoFix,
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
      if (
        url.pathname.endsWith(
          '/rpc/account_ai_credit_monthly_usage_summary'
        )
      ) {
        return Response.json([
          {
            activity: 'auto_reply',
            operation_count: '2',
            credits_used: '10',
          },
          {
            activity: 'whatsapp_call',
            operation_count: '1',
            credits_used: '5',
          },
          {
            activity: 'internal-model-name',
            operation_count: '1',
            credits_used: '2',
          },
        ]);
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

function adminDatabase() {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
    async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/ai_billing_settings')) {
        return Response.json([{ nano_usd_per_credit: '1000000' }]);
      }
      throw new Error(`Unexpected admin database request: ${url.pathname}`);
    }
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => {
  mocks.requireEntitlement.mockReset();
  mocks.loadBanxicoFix.mockReset().mockResolvedValue({
    mxnPerUsdMicro: BigInt(18_420_000),
    date: '2026-10-21',
    fetchedAt: '2026-10-21T12:00:00.000Z',
    source: 'Banxico SIE SF43718',
  });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/account/credits', () => {
  it('returns only the authenticated tenant balance and safe ledger fields', async () => {
    const fetch = scopedDatabase();
    adminDatabase();

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
      checkout_available: false,
      monthly_usage: {
        month_start: expect.any(String),
        total_credits_used: '17',
        activities: [
          {
            activity: 'auto_reply',
            operation_count: '2',
            credits_used: '10',
          },
          {
            activity: 'whatsapp_call',
            operation_count: '1',
            credits_used: '5',
          },
          {
            activity: 'other',
            operation_count: '1',
            credits_used: '2',
          },
        ],
      },
      monthly_usage_error: false,
      balance_mxn_estimate: {
        centavos: '175',
        fx_date: '2026-10-21',
      },
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
    expect(urls).toHaveLength(3);
    for (const url of urls.filter(
      (value) => !value.pathname.endsWith('/rpc/account_ai_credit_monthly_usage_summary')
    )) {
      expect(url.searchParams.get('account_id')).toBe('eq.account-1');
    }
    expect(
      urls.find((url) => url.pathname.endsWith('/ai_credit_ledger'))?.searchParams.get(
        'select'
      )
    ).toBe('id,entry_type,delta_credits,balance_after,created_at');
    const rpcCall = fetch.mock.calls.find(([input]) =>
      new URL(String(input)).pathname.endsWith(
        '/rpc/account_ai_credit_monthly_usage_summary'
      )
    );
    expect(JSON.parse(String(rpcCall?.[1]?.body))).toMatchObject({
      p_account_id: 'account-1',
    });
  });

  it('keeps the balance available and reports an unavailable MXN estimate', async () => {
    scopedDatabase();
    adminDatabase();
    mocks.loadBanxicoFix.mockRejectedValue(
      new Error('No recent cached Banxico FIX is available.')
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.balance).toBe('95');
    expect(payload.balance_mxn_estimate).toBeNull();
    expect(payload.monthly_usage_error).toBe(false);
    expect(log).toHaveBeenCalledWith(
      '[account credits] MXN balance estimate is unavailable:',
      expect.any(Error)
    );
  });

  it('reports a monthly-summary error without hiding the balance or history', async () => {
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
        if (
          url.pathname.endsWith(
            '/rpc/account_ai_credit_monthly_usage_summary'
          )
        ) {
          return Response.json(
            { message: 'function not found' },
            { status: 404 }
          );
        }
        throw new Error(`Unexpected database request: ${url.pathname}`);
      }
    );
    mocks.requireEntitlement.mockResolvedValue({
      accountId: 'account-1',
      supabase: createClient('https://supabase.example', 'test-key', {
        global: { fetch },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    });
    adminDatabase();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.balance).toBe('95');
    expect(payload.movements).toHaveLength(1);
    expect(payload.monthly_usage).toBeNull();
    expect(payload.monthly_usage_error).toBe(true);
    expect(log).toHaveBeenCalledWith(
      '[account credits] monthly usage summary failed:',
      expect.objectContaining({ message: 'function not found' })
    );
  });

  it('does not query account data when the entitlement check rejects access', async () => {
    mocks.requireEntitlement.mockRejectedValue(new Error('Forbidden'));

    const response = await GET();

    expect(response.status).toBe(403);
  });
});
