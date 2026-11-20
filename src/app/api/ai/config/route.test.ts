import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  connector: { id: '12345678-1234-1234-1234-123456789012' } as { id: string } | null,
  filters: [] as Array<[string, string]>,
  update: null as Record<string, unknown> | null,
  existingError: false,
  existingColumns: '',
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(async () => ({
    accountId: 'account', userId: 'user',
    supabase: {
      from: () => {
        const chain = {
          select: () => chain,
          eq: (column: string, value: string) => { state.filters.push([column, value]); return chain },
          maybeSingle: async () => ({ data: state.connector, error: null }),
        }
        return chain
      },
    },
  })),
  toErrorResponse: () => Response.json({ error: 'Internal server error' }, { status: 500 }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { adminAction: {} },
}))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const read = {
        select: (columns: string) => { state.existingColumns = columns; return read },
        eq: () => read,
        maybeSingle: async () => state.existingError
          ? { data: null, error: { code: '42703', message: 'scope column missing' } }
          : { data: { account_id: 'account', auto_reply_connector_id: null }, error: null },
      }
      return {
        select: read.select,
        update: (payload: Record<string, unknown>) => {
          state.update = payload
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  }),
}))

import { POST } from './route'

beforeEach(() => {
  state.connector = { id: '12345678-1234-1234-1234-123456789012' }
  state.filters = []
  state.update = null
  state.existingError = false
  state.existingColumns = ''
})

async function save(body: Record<string, unknown>) {
  return POST(new Request('https://example.test/api/ai/config', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ timezone: 'UTC', ...body }),
  }))
}

describe('AI reply connected-line configuration', () => {
  it('accepts a WhatsApp connector belonging to the account', async () => {
    const id = '12345678-1234-1234-1234-123456789012'
    expect((await save({ auto_reply_connector_id: id })).status).toBe(200)
    expect(state.filters).toEqual(expect.arrayContaining([
      ['account_id', 'account'], ['id', id], ['provider', 'zernio_whatsapp'],
    ]))
    expect(state.update).toMatchObject({ auto_reply_connector_id: id })
  })

  it('rejects invalid or inaccessible connectors without updating settings', async () => {
    expect((await save({ auto_reply_connector_id: 'invalid' })).status).toBe(400)
    state.connector = null
    expect((await save({ auto_reply_connector_id: '12345678-1234-1234-1234-123456789012' })).status).toBe(400)
    expect(state.update).toBeNull()
  })

  it('preserves the existing scope if omitted and clears it only when explicitly requested', async () => {
    expect((await save({})).status).toBe(200)
    expect(state.update).not.toHaveProperty('auto_reply_connector_id')
    expect((await save({ auto_reply_connector_id: null })).status).toBe(200)
    expect(state.update).toHaveProperty('auto_reply_connector_id', null)
  })

  it('does not save settings when the connector-scope migration is missing', async () => {
    state.existingError = true
    expect((await save({ auto_reply_enabled: true })).status).toBe(500)
    expect(state.update).toBeNull()
    expect(state.existingColumns).toContain('auto_reply_connector_id')
  })
})
