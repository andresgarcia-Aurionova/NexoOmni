import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const { mockZernioFetch } = vi.hoisted(() => ({
  mockZernioFetch: vi.fn(),
}));

vi.mock('./server', () => ({
  zernioFetch: mockZernioFetch,
}));

import {
  buildZernioCallingEnableRequest,
  syncZernioCallsWithCreditBalance,
} from './call-credit-pause';

function fakeDb(pausedNumbers: unknown[] = []) {
  const from = vi.fn((table: string) => {
    const result = {
      data: table === 'ai_credit_call_pause_numbers' ? pausedNumbers : null,
      error: null,
    };
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.eq = () => query;
    query.delete = () => query;
    query.then = (
      resolve: (value: typeof result) => unknown,
      reject: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject);
    return query;
  });
  return { from, db: { from } as unknown as SupabaseClient };
}

function fakePauseDb() {
  const writes: Array<{ table: string; value: unknown }> = [];
  const from = vi.fn((table: string) => {
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.eq = () => query;
    query.not = () => query;
    query.maybeSingle = () =>
      Promise.resolve({
        data:
          table === 'zernio_profiles'
            ? { profile_id: 'profile-1' }
            : null,
        error: null,
      });
    query.upsert = (value: unknown) => {
      writes.push({ table, value });
      return Promise.resolve({ error: null });
    };
    query.then = (
      resolve: (value: { data: unknown; error: null }) => unknown,
      reject: (reason: unknown) => unknown
    ) =>
      Promise.resolve({
        data:
          table === 'omnichannel_connectors'
            ? [{ zernio_account_id: 'zernio-account-1' }]
            : [],
        error: null,
      }).then(resolve, reject);
    return query;
  });
  return {
    db: { from } as unknown as SupabaseClient,
    writes,
  };
}

describe('syncZernioCallsWithCreditBalance', () => {
  beforeEach(() => {
    mockZernioFetch.mockReset();
  });

  it('does not reactivate a number that NexoOmni did not pause', async () => {
    const { db } = fakeDb();

    await syncZernioCallsWithCreditBalance(db, 'account-1', BigInt(100));

    expect(mockZernioFetch).not.toHaveBeenCalled();
  });

  it('restores only saved settings for numbers paused by NexoOmni', async () => {
    const { db } = fakeDb([
      {
        account_id: 'account-1',
        phone_number_id: 'phone-1',
        zernio_account_id: 'zernio-account-1',
      },
    ]);
    mockZernioFetch
      .mockResolvedValueOnce({
        callingEnabled: false,
        forwardTo: 'sip:agent@example.test',
        recordingEnabled: true,
      })
      .mockResolvedValueOnce({});

    await syncZernioCallsWithCreditBalance(db, 'account-1', BigInt(100));

    expect(mockZernioFetch).toHaveBeenNthCalledWith(
      2,
      '/phone-numbers/phone-1/whatsapp/calling',
      {
        method: 'POST',
        body: JSON.stringify({
          accountId: 'zernio-account-1',
          forwardTo: 'sip:agent@example.test',
          recordingEnabled: true,
        }),
      }
    );
  });

  it('pauses only numbers that were enabled before the balance ran out', async () => {
    const { db, writes } = fakePauseDb();
    mockZernioFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/phone-numbers') {
        return {
          numbers: [
            { id: 'enabled-phone', profileId: 'profile-1' },
            { id: 'already-disabled-phone', profileId: 'profile-1' },
          ],
          connected: [],
        };
      }
      if (init?.method === 'DELETE') return {};
      return { callingEnabled: path.includes('enabled-phone') };
    });

    await syncZernioCallsWithCreditBalance(db, 'account-1', BigInt(0));

    expect(mockZernioFetch).toHaveBeenCalledWith(
      '/phone-numbers/enabled-phone/whatsapp/calling?accountId=zernio-account-1',
      { method: 'DELETE' }
    );
    expect(writes).toContainEqual({
      table: 'ai_credit_call_pause_numbers',
      value: expect.objectContaining({
        phone_number_id: 'enabled-phone',
        pause_reason: 'balance_exhausted',
      }),
    });
    expect(
      writes.some(
        ({ table, value }) =>
          table === 'ai_credit_call_pause_numbers' &&
          (value as { phone_number_id: string }).phone_number_id ===
            'already-disabled-phone'
      )
    ).toBe(false);
  });
});

describe('buildZernioCallingEnableRequest', () => {
  it('preserves the saved call destination and supported options', () => {
    expect(
      buildZernioCallingEnableRequest(
        {
          forwardTo: 'sip:agent@example.test',
          recordingEnabled: true,
          sipAuthUsername: 'agent',
          callIconCountries: ['MX', 'US'],
          maxCallDurationSeconds: 3600,
          forwardCallerId: 'caller',
        },
        'zernio-account-1'
      )
    ).toEqual({
      accountId: 'zernio-account-1',
      forwardTo: 'sip:agent@example.test',
      recordingEnabled: true,
      sipAuthUsername: 'agent',
      callIconCountries: ['MX', 'US'],
      maxCallDurationSeconds: 3600,
      forwardCallerId: 'caller',
    });
  });

  it('requires the destination Zernio preserves while calling is disabled', () => {
    expect(() =>
      buildZernioCallingEnableRequest({}, 'zernio-account-1')
    ).toThrow('saved call destination');
  });
});
