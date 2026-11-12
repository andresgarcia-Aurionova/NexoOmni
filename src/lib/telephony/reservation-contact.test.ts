import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { findOrCreateReservationContact } from './reservation-contact'

type Contact = { id: string; phone_normalized: string; alternate_phones: string[] }

function database(rows: Contact[], insertError = false) {
  const writes: unknown[] = []
  const db = createClient('https://db.example.test', 'key', { global: {
    fetch: async (input, init) => {
      const url = new URL(String(input))
      if (init?.method === 'POST') {
        writes.push(JSON.parse(String(init.body)))
        return insertError
          ? Response.json({ code: '23505', message: 'duplicate' }, { status: 409 })
          : Response.json({ id: 'new' }, { status: 201 })
      }
      const filter = url.searchParams.get('phone_normalized')
      if (filter) {
        const values = filter.replace(/^in\.\(/, '').replace(/\)$/, '').split(',')
        return Response.json(rows.filter((row) => values.includes(row.phone_normalized)))
      }
      return Response.json(rows.filter((row) => row.alternate_phones.length > 0))
    },
  } })
  return { db, writes }
}

describe('reservation contact identity', () => {
  const phone = '525512345678'
  const resolve = (db: ReturnType<typeof database>['db']) =>
    findOrCreateReservationContact(db, 'account', 'user', phone, 'Ana')

  it('creates a normalized new contact', async () => {
    const { db, writes } = database([])
    expect(await resolve(db)).toEqual({ id: 'new' })
    expect(writes).toEqual([{ account_id: 'account', user_id: 'user', phone, name: 'Ana' }])
  })

  it.each(['5512345678', '525512345678', '5215512345678'])('finds the complete Mexican number variant %s', async (value) => {
    const { db, writes } = database([{ id: 'existing', phone_normalized: value, alternate_phones: [] }])
    expect(await resolve(db)).toEqual({ id: 'existing' })
    expect(writes).toHaveLength(0)
  })

  it('does not use a last-eight-digit match', async () => {
    const { db } = database([{ id: 'other', phone_normalized: '52559912345678', alternate_phones: [] }])
    expect(await resolve(db)).toEqual({ id: 'new' })
  })

  it('finds exact alternate numbers without merging contacts', async () => {
    const { db } = database([{ id: 'existing', phone_normalized: '14155550123', alternate_phones: ['+52 55 1234 5678'] }])
    expect(await resolve(db)).toEqual({ id: 'existing' })
  })

  it('does not choose when multiple contacts match variants', async () => {
    const { db, writes } = database([
      { id: 'one', phone_normalized: '5512345678', alternate_phones: [] },
      { id: 'two', phone_normalized: '5215512345678', alternate_phones: [] },
    ])
    expect(await resolve(db)).toBeNull()
    expect(writes).toHaveLength(0)
  })

  it('surfaces a failed insert rather than returning an invented contact', async () => {
    const { db } = database([], true)
    await expect(resolve(db)).rejects.toMatchObject({ code: '23505' })
  })
})
