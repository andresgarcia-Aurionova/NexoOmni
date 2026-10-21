import { describe, expect, it } from 'vitest';

import { mapZernioCallUsage } from './call-usage';

const metrics = {
  calls: 5,
  answered: 3,
  minutes: 12.5,
  billableUSD: 1.25,
  metaUSD: 0.4,
};

describe('mapZernioCallUsage', () => {
  it('maps grouped phone usage through the Zernio profile to its tenant', () => {
    const result = mapZernioCallUsage(
      {
        totals: {
          ...metrics,
          calls: 10,
          answered: 6,
          minutes: 25,
          billableUSD: 2.5,
          metaUSD: 0.8,
        },
        groups: [
          { key: '+1 (555) 123-4567', ...metrics },
          { key: '+15550000000', ...metrics },
        ],
      },
      {
        numbers: [
          {
            phoneNumber: '+15551234567',
            profileId: { _id: 'zernio-profile-1' },
          },
        ],
        connected: [
          {
            phoneNumber: '+15550000000',
            profileId: 'zernio-profile-1',
          },
        ],
      },
      [{ profile_id: 'zernio-profile-1', account_id: 'tenant-1' }]
    );

    expect(result.accounts).toEqual([
      {
        account_id: 'tenant-1',
        calls: 10,
        answered: 6,
        minutes: 25,
        billable_usd: 2.5,
        meta_usd: 0.8,
      },
    ]);
    expect(result.unassigned.calls).toBe(0);
    expect(result.totals.billable_usd).toBe(2.5);
  });

  it('does not guess when a number is unknown or linked to multiple tenants', () => {
    const result = mapZernioCallUsage(
      {
        totals: { ...metrics, calls: 10 },
        groups: [
          { key: '+15550000001', ...metrics },
          { key: '+15550000002', ...metrics },
        ],
      },
      {
        numbers: [
          { phoneNumber: '+15550000001', profileId: { _id: 'profile-1' } },
          { phoneNumber: '+15550000001', profileId: 'profile-2' },
        ],
        connected: [],
      },
      [
        { profile_id: 'profile-1', account_id: 'tenant-1' },
        { profile_id: 'profile-2', account_id: 'tenant-2' },
      ]
    );

    expect(result.accounts).toEqual([]);
    expect(result.unassigned.calls).toBe(10);
    expect(result.unassigned.billable_usd).toBe(2.5);
  });

  it('rejects an unexpected provider response shape', () => {
    expect(() =>
      mapZernioCallUsage(
        { totals: metrics, groups: [{ key: '+15551234567', calls: '5' }] },
        { numbers: [], connected: [] },
        []
      )
    ).toThrow('Zernio returned invalid groups[0].calls.');
  });
});
