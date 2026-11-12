import { describe, expect, it } from 'vitest'
import { parseReservationWhatsAppPreference } from './reservation-whatsapp'

describe('reservation WhatsApp preference', () => {
  it('preserves the legacy behavior only when the preference is omitted', () => {
    expect(parseReservationWhatsAppPreference({})).toBeNull()
  })

  it.each(['caller', 'declined', 'unavailable'])('records the %s choice without a number', (kind) => {
    expect(parseReservationWhatsAppPreference({ whatsapp_preference: kind })).toEqual({ kind, phone: null })
  })

  it('accepts a confirmed alternate number and normalizes it', () => {
    expect(parseReservationWhatsAppPreference({
      whatsapp_preference: 'other', whatsapp_phone: '55 1234 5678', whatsapp_phone_confirmed: true,
    })).toEqual({ kind: 'other', phone: '525512345678' })
  })

  it.each([
    { whatsapp_preference: 'other', whatsapp_phone: '5512345678' },
    { whatsapp_preference: 'other', whatsapp_phone: '5512345678', whatsapp_phone_confirmed: 'true' },
    { whatsapp_preference: 'other', whatsapp_phone: 'invalid', whatsapp_phone_confirmed: true },
    { whatsapp_preference: 'declined', whatsapp_phone: '5512345678' },
    { whatsapp_preference: 'unknown' },
    { whatsapp_phone: '5512345678' },
  ])('rejects inconsistent or unconfirmed input: %j', (body) => {
    expect(() => parseReservationWhatsAppPreference(body)).toThrow()
  })
})
