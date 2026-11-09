import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/lib/omnichannel/outbound-text', () => ({ sendOmnichannelText: mocks.send }))

import { getClosure, sendClosureNotice } from './inbound'

const connectorId = '20000000-0000-0000-0000-000000000001'
const args = {
  accountId: 'account-1',
  connectorId,
  conversationId: 'conversation-1',
  periodStart: '2026-11-07T20:00:00.000Z',
  message: 'Closed',
  isFirstInboundMessage: false,
}

function dbMock(options: { row?: unknown; insertError?: { code: string }; updateError?: Error } = {}) {
  const updates: unknown[] = []
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: options.row ?? null, error: null }),
    insert: vi.fn().mockResolvedValue({ error: options.insertError ?? null }),
    update: (payload: unknown) => {
      updates.push(payload)
      const chain = {
        eq: () => chain,
        then: (resolve: (value: { error: Error | null }) => void) => resolve({ error: options.updateError ?? null }),
      }
      return chain
    },
  }
  return { db: { from: () => query } as unknown as SupabaseClient, query, updates }
}

beforeEach(() => {
  mocks.send.mockReset()
  mocks.send.mockResolvedValue({ message_id: 'outbound-1' })
})

describe('connected WhatsApp business hours', () => {
  it('does not alter accounts without an enabled configuration', async () => {
    const { db } = dbMock({ row: { enabled: false } })
    expect(await getClosure(db, args.accountId, connectorId, new Date())).toBeNull()
  })

  it('rejects invalid enabled settings rather than treating them as open', async () => {
    const { db } = dbMock({ row: { enabled: true, timezone: 'invalid', windows: [], holidays: [], message: 'Closed' } })
    await expect(getClosure(db, args.accountId, connectorId, new Date())).rejects.toThrow()
  })

  it('claims once before sending and records the result', async () => {
    const { db, query, updates } = dbMock()
    expect(await sendClosureNotice(db, args)).toBe('sent')
    expect(query.insert).toHaveBeenCalledOnce()
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(updates).toContainEqual({ state: 'sent' })
  })

  it('does not send again for an already claimed period', async () => {
    const { db } = dbMock({ insertError: { code: '23505' } })
    expect(await sendClosureNotice(db, args)).toBe('already_claimed')
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('records an uncertain or failed send without silently retrying', async () => {
    const { db, updates } = dbMock()
    mocks.send.mockRejectedValue(new Error('send failed'))
    await expect(sendClosureNotice(db, args)).rejects.toThrow('send failed')
    expect(updates).toContainEqual({ state: 'failed' })
    expect(mocks.send).toHaveBeenCalledOnce()
  })
})
