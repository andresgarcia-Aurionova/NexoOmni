import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { findOrCreateZernioConversation } from './webhook-conversation'

type Row = { id: string; account_id: string; connector_id: string; contact_id: string; channel_type: string; external_session_id: string | null; unread_count: number; status: string }
const connector = { id: 'connector', account_id: 'account', provider: 'zernio_whatsapp', display_name: 'WhatsApp', queue_id: null }
const row = (contact: string, thread: string | null): Row => ({
  id: 'conversation', account_id: 'account', connector_id: 'connector', contact_id: contact,
  channel_type: 'zernio_whatsapp', external_session_id: thread, unread_count: 0, status: 'open',
})

function database(rows: Row[], race?: Row) {
  const methods: string[] = []
  const db = createClient('https://db.example.test', 'key', { global: {
    fetch: async (input, init) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      methods.push(method)
      const matches = (entry: Row) => ['account_id', 'connector_id', 'contact_id', 'channel_type', 'external_session_id']
        .every((key) => {
          const filter = url.searchParams.get(key)
          if (!filter) return true
          const value = entry[key as keyof Row]
          return filter === 'is.null' ? value === null : filter === `eq.${value}`
        })
      if (method === 'GET') return Response.json(rows.filter(matches))
      if (method === 'PATCH') {
        const found = rows.find(matches)
        if (!found) return Response.json(null)
        if (race) {
          rows.push(race)
          return Response.json({ code: '23505', message: 'duplicate' }, { status: 409 })
        }
        found.external_session_id = JSON.parse(String(init?.body)).external_session_id
        return Response.json(found)
      }
      if (race) {
        rows.push(race)
        return Response.json({ code: '23505', message: 'duplicate' }, { status: 409 })
      }
      const created = { ...row('recipient', 'thread'), ...JSON.parse(String(init?.body)) }
      rows.push(created)
      return Response.json(created)
    },
  } })
  return { db, methods }
}

describe('Zernio webhook conversation reconciliation', () => {
  it('attaches a previously local conversation for the same recipient', async () => {
    const rows = [row('recipient', null)]
    const { db } = database(rows)
    expect(await findOrCreateZernioConversation(db, connector, 'recipient', 'owner', 'thread'))
      .toMatchObject({ row: { id: 'conversation' }, created: false })
    expect(rows[0].external_session_id).toBe('thread')
  })

  it('rejects a thread belonging to another contact before recording a message', async () => {
    const { db, methods } = database([row('other', 'thread')])
    await expect(findOrCreateZernioConversation(db, connector, 'recipient', 'owner', 'thread')).rejects.toThrow('otro contacto')
    expect(methods).toEqual(['GET'])
  })

  it('reuses the exact recipient when another webhook wins the insert race', async () => {
    const { db } = database([], row('recipient', 'thread'))
    expect(await findOrCreateZernioConversation(db, connector, 'recipient', 'owner', 'thread'))
      .toMatchObject({ row: { id: 'conversation' }, created: false })
  })

  it('rejects a raced thread assigned to a different contact', async () => {
    const { db } = database([], row('other', 'thread'))
    await expect(findOrCreateZernioConversation(db, connector, 'recipient', 'owner', 'thread')).rejects.toThrow('otro contacto')
  })

  it('leaves non-WhatsApp reconciliation unchanged', async () => {
    const { db, methods } = database([row('other', 'thread')])
    expect(await findOrCreateZernioConversation(db, { ...connector, provider: 'zernio_facebook' }, 'recipient', 'owner', 'thread'))
      .toMatchObject({ created: false })
    expect(methods).toEqual(['GET'])
  })
})
