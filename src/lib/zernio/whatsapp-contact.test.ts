import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { findExactZernioWhatsAppContact } from './whatsapp-contact'

type Contact = { id: string; phone_normalized: string; alternate_phones: string[]; phone: string }

function database(rows: Contact[]) {
  let calls = 0
  const db = createClient('https://db.example.test', 'key', { global: {
    fetch: async (input) => {
      calls++
      const url = new URL(String(input))
      const id = url.searchParams.get('id')
      if (id) return Response.json(rows.find((row) => id === `eq.${row.id}`) ?? null)
      const filter = url.searchParams.get('phone_normalized')
      if (filter) {
        const values = filter.replace(/^in\.\(/, '').replace(/\)$/, '').split(',')
        return Response.json(rows.filter((row) => values.includes(row.phone_normalized)))
      }
      return Response.json(rows.filter((row) => row.alternate_phones.length > 0))
    },
  } })
  return { db, calls: () => calls }
}

describe('Zernio WhatsApp contact identity', () => {
  const row = (id: string, phone: string): Contact => ({ id, phone, phone_normalized: phone, alternate_phones: [] })

  it('matches the complete number, not an eight-digit suffix', async () => {
    const { db } = database([row('wrong', '52559912345678'), row('correct', '525512345678')])
    expect(await findExactZernioWhatsAppContact(db, 'account', '+52 55 1234 5678')).toMatchObject({ id: 'correct' })
  })

  it('rejects ambiguous historical Mexican variants', async () => {
    const { db } = database([row('one', '525512345678'), row('two', '5215512345678')])
    await expect(findExactZernioWhatsAppContact(db, 'account', '525512345678')).rejects.toThrow('varios contactos')
  })

  it('matches an incoming legacy Mexican prefix against a canonical contact', async () => {
    const { db } = database([row('correct', '525512345678')])
    expect(await findExactZernioWhatsAppContact(db, 'account', '5215512345678')).toMatchObject({ id: 'correct' })
  })

  it('never interprets an opaque participant ID as a phone', async () => {
    const { db, calls } = database([])
    expect(await findExactZernioWhatsAppContact(db, 'account', 'user:525512345678')).toBeNull()
    expect(calls()).toBe(0)
  })
})
