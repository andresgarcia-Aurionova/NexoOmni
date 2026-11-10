import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { recordReservationMemory } from './reservation-memory'

describe('reservation memory persistence', () => {
  it('calls the account-scoped memory function and propagates database errors', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'database failure' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    }))
    const db = createClient('https://db.example.test', 'test-key', { global: { fetch } })
    await expect(recordReservationMemory(db, {
      accountId: 'account', appointmentId: 'appointment', contactId: 'contact',
      summary: 'Reservación en Restaurante B.',
    })).rejects.toMatchObject({ message: 'database failure' })
    const [url, options] = fetch.mock.calls[0]
    expect(String(url)).toContain('/rpc/record_voice_reservation_memory')
    expect(JSON.parse(String(options.body))).toMatchObject({
      p_account_id: 'account', p_appointment_id: 'appointment', p_contact_id: 'contact',
    })
  })
})
