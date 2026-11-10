import type { SupabaseClient } from '@supabase/supabase-js'

export async function recordReservationMemory(db: SupabaseClient, args: {
  accountId: string; appointmentId: string; contactId: string; summary: string
}) {
  const { error } = await db.rpc('record_voice_reservation_memory', {
    p_account_id: args.accountId, p_appointment_id: args.appointmentId,
    p_contact_id: args.contactId, p_summary: args.summary,
  })
  if (error) throw error
}
