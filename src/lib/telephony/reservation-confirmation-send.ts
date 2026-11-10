import type { SupabaseClient } from '@supabase/supabase-js'
import { sendZernioTemplateToContact, type ZernioWhatsAppConnector } from '@/lib/zernio/send-template-to-contact'
import { reservationDateLabel } from './reservation-alert'
import type { RestaurantCode } from './reservations'

export async function sendReservationConfirmation(db: SupabaseClient, args: {
  accountId: string
  contactId: string
  phone: string
  ownerUserId: string
  restaurant: RestaurantCode
  startsAt: string
  templateName: string
  templateLanguage: string
  connector: ZernioWhatsAppConnector
}) {
  return sendZernioTemplateToContact(db, {
    accountId: args.accountId,
    contactId: args.contactId,
    phone: args.phone,
    ownerUserId: args.ownerUserId,
    templateName: args.templateName,
    templateLanguage: args.templateLanguage,
    bodyParams: [`Restaurante ${args.restaurant}`, reservationDateLabel(args.startsAt)],
    connectors: [args.connector],
  })
}
