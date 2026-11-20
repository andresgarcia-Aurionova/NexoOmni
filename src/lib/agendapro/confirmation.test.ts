import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { handleAgendaProConfirmationReply } from './confirmation'

describe('AgendaPro confirmation replies', () => {
  it('passes the originating conversation and notifies the team for review', async () => {
    const calls: { name: string; body: Record<string, unknown> }[] = []
    const db = createClient('https://db.example.test', 'key', { global: {
      fetch: async (input, init) => {
        const name = new URL(String(input)).pathname.split('/').pop() ?? ''
        calls.push({ name, body: JSON.parse(String(init?.body)) })
        if (name === 'handle_agendapro_confirmation_reply') {
          return Response.json({ outcome: 'review', booking_ids: ['booking'] })
        }
        if (name === 'notify_agendapro_confirmation_review') return Response.json(true)
        return new Response('Unexpected request', { status: 500 })
      },
    } })
    await handleAgendaProConfirmationReply(db, 'account', 'contact', 'line-b', 'Sí')
    expect(calls[0]).toMatchObject({
      name: 'handle_agendapro_confirmation_reply',
      body: { p_account_id: 'account', p_contact_id: 'contact', p_conversation_id: 'line-b', p_response: 'yes' },
    })
    expect(calls[1]).toMatchObject({
      name: 'notify_agendapro_confirmation_review', body: { p_account_id: 'account', p_booking_id: 'booking' },
    })
  })

  it('does not treat unrelated messages as confirmations', async () => {
    let calls = 0
    const db = createClient('https://db.example.test', 'key', { global: {
      fetch: async () => { calls++; return Response.json(null) },
    } })
    await handleAgendaProConfirmationReply(db, 'account', 'contact', 'line-b', 'horarios')
    expect(calls).toBe(0)
  })
})
