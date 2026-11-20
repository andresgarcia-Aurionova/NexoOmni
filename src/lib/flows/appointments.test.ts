import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { bookFlowAppointment } from './appointments'

vi.mock('@/lib/appointments/availability', () => ({
  findConflict: vi.fn().mockResolvedValue(false),
  getAvailableSlots: vi.fn(),
}))

describe('flow appointment booking', () => {
  it('stores the captured reservation details in the appointment notes', async () => {
    let saved: Record<string, unknown> | undefined
    const db = createClient('https://db.example.test', 'key', { global: {
      fetch: async (input, init) => {
        const table = new URL(String(input)).pathname.split('/').pop()
        if (table === 'appointment_schedules') return Response.json([{ timezone: 'America/Mexico_City', specialist_id: null }])
        if (table === 'appointments') {
          saved = JSON.parse(String(init?.body))
          return Response.json({ id: 'appointment', starts_at: '2035-01-01T18:00:00.000Z' })
        }
        if (table === 'appointment_reminders') return Response.json(null)
        return new Response('Unexpected request', { status: 500 })
      },
    } })
    const result = await bookFlowAppointment(db, {
      accountId: 'account', userId: 'owner', contactId: 'contact', conversationId: 'conversation',
      cfg: {
        slot_var_key: 'slot', title: 'Reservación', next_node_key: 'next',
        notes: 'Sede: {{vars.sede}}\nPersonas: {{vars.personas}}\nZona: {{vars.zona}}',
      },
      vars: { slot: '2035-01-01T18:00:00.000Z', sede: 'Tabgha', personas: 4, zona: 'Terraza' },
    })
    expect(result.ok).toBe(true)
    expect(saved).toMatchObject({
      source_conversation_id: 'conversation',
      notes: 'Sede: Tabgha\nPersonas: 4\nZona: Terraza',
    })
  })
})
