import type { SupabaseClient } from '@supabase/supabase-js'
import { lookupReservationContact } from '@/lib/telephony/reservation-contact'
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

export async function findExactZernioWhatsAppContact(db: SupabaseClient, accountId: string, value: string) {
  if (!/^\+?[\d ()-]+$/.test(value)) return null
  const phone = sanitizePhoneForMeta(value)
  if (!isValidE164(phone)) return null
  const canonical = /^521[1-9]\d{9}$/.test(phone) ? `52${phone.slice(3)}` : phone
  const match = await lookupReservationContact(db, accountId, canonical)
  if (match.status === 'ambiguous') throw new Error('La identidad de WhatsApp coincide con varios contactos.')
  if (match.status === 'missing') return null
  const { data, error } = await db.from('contacts').select('id, name, email, phone, avatar_url')
    .eq('account_id', accountId).eq('id', match.id).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('El contacto de WhatsApp ya no está disponible.')
  return data
}
