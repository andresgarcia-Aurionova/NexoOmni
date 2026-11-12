import { describe, expect, it } from 'vitest'
import { reservationReplySenderPhone } from './reservation-reply-sender'

describe('reservation reply sender', () => {
  it('accepts the documented WhatsApp phoneNumber with an opaque sender id', () => {
    expect(reservationReplySenderPhone('+52 55 1234 5678', 'bsuid:abc')).toBe('525512345678')
  })

  it('accepts agreeing sender identifiers in different formats', () => {
    expect(reservationReplySenderPhone('+525512345678', '525512345678')).toBe('525512345678')
  })

  it('rejects conflicting numeric sender identifiers', () => {
    expect(reservationReplySenderPhone('+525512345678', '525599999999')).toBeUndefined()
  })

  it('does not infer a phone number from an opaque identifier', () => {
    expect(reservationReplySenderPhone('bsuid:525512345678')).toBeUndefined()
  })
})
