import { describe, expect, it } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'

import { channelAddOnEntitlement, getAccountEntitlements } from './entitlements'

function dbWithOverrides(feature_overrides: Record<string, unknown>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              plan_code: 'ai',
              seat_limit: 5,
              status: 'active',
              ends_at: null,
              grace_days: 0,
              feature_overrides,
            },
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

describe('channel add-on entitlements', () => {
  it('maps each supported connection channel to its billable entitlement', () => {
    expect(channelAddOnEntitlement('whatsapp')).toBe('channel_whatsapp')
    expect(channelAddOnEntitlement('email')).toBe('channel_email')
    expect(channelAddOnEntitlement('hubspot')).toBe('channel_hubspot')
    expect(channelAddOnEntitlement('unknown')).toBeNull()
  })

  it('keeps channel add-ons disabled by default', async () => {
    const entitlements = await getAccountEntitlements(dbWithOverrides({}), 'account-1')
    expect(entitlements?.features.channel_whatsapp).toBe(false)
    expect(entitlements?.features.channel_facebook).toBe(false)
  })

  it('enables only channels explicitly selected by the platform operator', async () => {
    const entitlements = await getAccountEntitlements(
      dbWithOverrides({ channel_whatsapp: true, channel_telegram: true }),
      'account-1',
    )
    expect(entitlements?.features.channel_whatsapp).toBe(true)
    expect(entitlements?.features.channel_telegram).toBe(true)
    expect(entitlements?.features.channel_facebook).toBe(false)
  })
})
