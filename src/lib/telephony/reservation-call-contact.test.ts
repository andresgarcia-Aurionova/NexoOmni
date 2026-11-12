import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { reservationCallContact } from './reservation-call-contact'

function database(rows: { contact_id: string | null; reservation_call_phone: string | null }[]) {
  const requests: URL[] = []
  const db = createClient('https://db.example.test', 'key', { global: {
    fetch: async (input) => { requests.push(new URL(String(input))); return Response.json(rows) },
  } })
  return { db, requests }
}

describe('reservation call identity', () => {
  it('uses the account, exact PBX call id and full normalized phone', async () => {
    const { db, requests } = database([{ contact_id: 'caller', reservation_call_phone: '525512345678' }])
    expect(await reservationCallContact(db, 'account', 'pbx-call', '5512345678')).toEqual({ status: 'found', id: 'caller' })
    expect(requests[0].searchParams.get('account_id')).toBe('eq.account')
    expect(requests[0].searchParams.get('reservation_call_id')).toBe('eq.pbx-call')
  })

  it.each([
    { rows: [{ contact_id: 'caller', reservation_call_phone: '525512345679' }] },
    { rows: [{ contact_id: null, reservation_call_phone: '525512345678' }] },
    { rows: [{ contact_id: 'a', reservation_call_phone: '525512345678' }, { contact_id: 'b', reservation_call_phone: '525512345678' }] },
  ])('rejects uncertain identities: %j', async ({ rows }) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db } = database(rows)
    expect(await reservationCallContact(db, 'account', 'pbx-call', '5512345678')).toEqual({ status: 'ambiguous' })
    log.mockRestore()
  })

  it('does not query when the verified call id is missing', async () => {
    const { db, requests } = database([])
    expect(await reservationCallContact(db, 'account', null, '5512345678')).toEqual({ status: 'none' })
    expect(requests).toHaveLength(0)
  })
})
