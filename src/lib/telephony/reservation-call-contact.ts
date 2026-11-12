import type { SupabaseClient } from '@supabase/supabase-js'
import { reservationPbxPhone } from './reservation-phone'

export async function reservationCallContact(db: SupabaseClient, accountId: string, callId: string | null, callerPhone: string | null) {
  if (!callId) return { status: 'none' as const }
  const { data, error } = await db.from('appointments')
    .select('contact_id,reservation_call_phone')
    .eq('account_id', accountId).eq('reservation_call_id', callId)
    .limit(100)
  if (error) throw error
  if (!data?.length) return { status: 'none' as const }
  const phone = callerPhone && reservationPbxPhone(callerPhone)
  const contacts = new Set(data.map((row) => row.contact_id).filter((value): value is string => typeof value === 'string'))
  if (data.length === 100 || !phone || contacts.size !== 1
    || data.some((row) => !row.contact_id || row.reservation_call_phone !== phone)) {
    console.error('[reservations] call identity is ambiguous; transcription not linked')
    return { status: 'ambiguous' as const }
  }
  return { status: 'found' as const, id: [...contacts][0] }
}
