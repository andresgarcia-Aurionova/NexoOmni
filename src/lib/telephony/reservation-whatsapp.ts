import { reservationPhone } from './reservation-phone'

export type ReservationWhatsAppPreference =
  | { kind: 'caller' | 'declined' | 'unavailable'; phone: null }
  | { kind: 'other'; phone: string }

export class ReservationWhatsAppError extends Error {}

export function parseReservationWhatsAppPreference(body: Record<string, unknown>): ReservationWhatsAppPreference | null {
  const choice = body.whatsapp_preference
  if (choice == null) {
    if (body.whatsapp_phone != null || body.whatsapp_phone_confirmed != null) {
      throw new ReservationWhatsAppError('whatsapp_preference is required when a WhatsApp number is provided')
    }
    return null
  }
  if (choice === 'other') {
    const phone = reservationPhone(body.whatsapp_phone)
    if (!phone || body.whatsapp_phone_confirmed !== true) {
      throw new ReservationWhatsAppError('An alternate WhatsApp number and explicit confirmation are required')
    }
    return { kind: 'other', phone }
  }
  if (choice !== 'caller' && choice !== 'declined' && choice !== 'unavailable') {
    throw new ReservationWhatsAppError('Invalid WhatsApp preference')
  }
  if (body.whatsapp_phone != null || body.whatsapp_phone_confirmed != null) {
    throw new ReservationWhatsAppError('whatsapp_phone is only accepted for an alternate number')
  }
  return { kind: choice, phone: null }
}
