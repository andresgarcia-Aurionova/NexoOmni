import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { recordCallEnded } from './call-events';

const { mockLoadBanxicoFix } = vi.hoisted(() => ({
  mockLoadBanxicoFix: vi.fn(),
}));

const { mockPauseZernioCallsForAccount } = vi.hoisted(() => ({
  mockPauseZernioCallsForAccount: vi.fn(),
}));

vi.mock('@/lib/billing/banxico-fx', () => ({
  loadBanxicoFix: mockLoadBanxicoFix,
}));

vi.mock('./call-credit-pause', () => ({
  pauseZernioCallsForAccount: mockPauseZernioCallsForAccount,
}));

const callEvent = {
  event: 'call.ended',
  id: 'event-1',
  call: {
    id: 'call-1',
    accountId: 'zernio-account-1',
    phoneNumberId: 'phone-1',
    direction: 'inbound',
    startedAt: '2026-10-20T10:00:00Z',
    endedAt: '2026-10-20T10:02:05Z',
    durationSeconds: 125,
    endReason: 'hangup',
    billing: {
      billableCostUSD: 0.05,
      metaCostUSD: 0.02,
    },
  },
};

function fakeDb(connector: unknown = { id: 'connector-1', account_id: 'acct-1' }) {
  const queryResult = (table: string) => {
    const result =
      table === 'omnichannel_connectors'
        ? { data: connector, error: null }
        : {
            data: {
              billing_mode: 'enforced',
              target_margin_basis_points: 5000,
              nano_usd_per_credit: 1000000,
              call_minute_price_mxn_centavos: 50,
            },
            error: null,
          };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue(result);
    return chain;
  };
  const rpc = vi.fn().mockResolvedValue({
    data: [{ result: 'debited', available_credits: '0' }],
    error: null,
  });
  const db = {
    from: vi.fn((table: string) => queryResult(table)),
    rpc,
  } as unknown as SupabaseClient;
  return { db, rpc };
}

describe('recordCallEnded', () => {
  beforeEach(() => {
    mockLoadBanxicoFix.mockResolvedValue({
      mxnPerUsdMicro: BigInt(20_000_000),
      date: '2026-10-20',
      fetchedAt: '2026-10-20T12:00:00Z',
      source: 'Banxico SIE SF43718',
    });
    mockPauseZernioCallsForAccount.mockClear();
    mockPauseZernioCallsForAccount.mockResolvedValue(undefined);
  });

  it('atomically bills the Zernio connection and started call minutes', async () => {
    const { db, rpc } = fakeDb();
    await recordCallEnded(db, callEvent, 'event-header');

    expect(rpc).toHaveBeenCalledWith(
      'record_whatsapp_call_and_debit',
      expect.objectContaining({
        p_account_id: 'acct-1',
        p_call_id: 'call-1',
        p_event_id: 'event-header',
        p_zernio_cost_nano_usd: '50000000',
        p_meta_cost_nano_usd: '20000000',
        p_connection_price_nano_usd: '100000000',
        p_connection_credits: '100',
        p_billable_minutes: 3,
        p_minute_price_nano_usd: '75000000',
        p_minute_credits: '75',
        p_total_credits: '175',
        p_total_price_nano_usd: '175000000',
      })
    );
  });

  it('does not bill an account that does not own a Zernio WhatsApp connector', async () => {
    const { db, rpc } = fakeDb(null);
    await recordCallEnded(db, callEvent, 'event-header');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects malformed call events instead of silently dropping them', async () => {
    const { db, rpc } = fakeDb();
    await expect(recordCallEnded(db, { event: 'call.ended' }, null)).rejects.toThrow(
      'missing required billing fields'
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces a failed atomic debit to the webhook for retry', async () => {
    const { db, rpc } = fakeDb();
    rpc.mockResolvedValue({ data: null, error: new Error('database unavailable') });
    await expect(recordCallEnded(db, callEvent, 'event-header')).rejects.toThrow(
      'database unavailable'
    );
  });

  it('records an insufficient call as unbilled without overdrawing the wallet', async () => {
    const { db, rpc } = fakeDb();
    rpc.mockResolvedValue({
      data: [{ result: 'insufficient_credits', available_credits: '20' }],
      error: null,
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await recordCallEnded(db, callEvent, 'event-header');

    expect(mockPauseZernioCallsForAccount).toHaveBeenCalledWith(
      db,
      'acct-1',
      BigInt(20)
    );
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('was recorded without a debit')
    );
    errorLog.mockRestore();
  });
});
