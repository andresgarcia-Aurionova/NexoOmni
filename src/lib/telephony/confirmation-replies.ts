import type { SupabaseClient } from '@supabase/supabase-js'
import { handleAgendaProConfirmationReply } from '@/lib/agendapro/confirmation'
import { handleReservationConfirmationReply } from '@/lib/telephony/reservation-confirmation-worker'

export async function handleWhatsAppConfirmationReplies(
  db: SupabaseClient, accountId: string, contactId: string, conversationId: string,
  text: string, flowHandled: boolean, senderPhone?: string,
) {
  const reservationReply = await handleReservationConfirmationReply(
    db, accountId, contactId, conversationId, text, senderPhone, flowHandled,
  )
  await handleAgendaProConfirmationReply(
    db, accountId, contactId, conversationId, text, flowHandled || reservationReply !== 'none',
  )
}
