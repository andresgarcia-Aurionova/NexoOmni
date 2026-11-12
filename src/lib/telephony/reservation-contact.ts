import type { SupabaseClient } from '@supabase/supabase-js'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { reservationPhoneVariants } from './reservation-phone'

type ContactRow = { id: string; alternate_phones: string[] | null }

export async function lookupReservationContact(db: SupabaseClient, accountId: string, phone: string) {
  const variants = reservationPhoneVariants(phone)
  const primary = await db.from('contacts').select('id').eq('account_id', accountId).in('phone_normalized', variants)
  if (primary.error) throw primary.error
  const matches = new Set((primary.data ?? []).map((row) => row.id as string))
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('contacts').select('id,alternate_phones')
      .eq('account_id', accountId).not('alternate_phones', 'eq', '{}')
      .order('id').range(offset, offset + pageSize - 1)
    if (error) throw error
    const rows = (data ?? []) as ContactRow[]
    for (const row of rows) {
      if (row.alternate_phones?.some((value) => variants.includes(normalizePhone(value)))) matches.add(row.id)
    }
    if (matches.size > 1 || rows.length < pageSize) break
  }
  if (matches.size > 1) return { status: 'ambiguous' as const }
  const id = matches.values().next().value
  return id ? { status: 'found' as const, id } : { status: 'missing' as const }
}

export async function findOrCreateReservationContact(
  db: SupabaseClient, accountId: string, userId: string, phone: string, name: string,
): Promise<{ id: string } | null> {
  const found = await lookupReservationContact(db, accountId, phone)
  if (found.status === 'ambiguous') {
    console.error('[reservations] ambiguous phone identity; contact not linked')
    return null
  }
  if (found.status === 'found') return { id: found.id }
  const { data, error } = await db.from('contacts').insert({
    account_id: accountId, user_id: userId, phone, name,
  }).select('id').single()
  if (!error && data) return { id: data.id as string }
  if (isUniqueViolation(error)) {
    const raced = await lookupReservationContact(db, accountId, phone)
    if (raced.status === 'found') return { id: raced.id }
    if (raced.status === 'ambiguous') {
      console.error('[reservations] ambiguous phone identity after concurrent insert; contact not linked')
      return null
    }
  }
  throw error ?? new Error('Could not create reservation contact')
}
