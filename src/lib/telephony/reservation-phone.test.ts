import { describe, expect, it } from 'vitest'
import { reservationPbxPhone, reservationPhone, reservationPhoneVariants } from './reservation-phone'

describe('reservation phone parsing', () => {
  it('uses the agreed Mexico country code for a ten-digit national number', () => {
    expect(reservationPhone('55 1234 5678')).toBe('525512345678')
    expect(reservationPhone('(55) 1234-5678')).toBe('525512345678')
  })

  describe('PBX numbers and contact lookup variants', () => {
    it('accepts national, current and historical Mexican PBX formats', () => {
      expect(reservationPbxPhone('5512345678')).toBe('525512345678')
      expect(reservationPbxPhone('525512345678')).toBe('525512345678')
      expect(reservationPbxPhone('5215512345678')).toBe('525512345678')
      expect(reservationPhoneVariants('525512345678')).toEqual(['525512345678', '5512345678', '5215512345678'])
    })

    it('does not infer an international country code for other unprefixed inputs', () => {
      expect(reservationPbxPhone('14155550123')).toBeNull()
      expect(reservationPbxPhone('+14155550123')).toBe('14155550123')
    })
  })

  it('preserves explicit international numbers', () => {
    expect(reservationPhone('+52 55 1234 5678')).toBe('525512345678')
    expect(reservationPhone('+1 (415) 555-0123')).toBe('14155550123')
    expect(reservationPhone('+44 20 1234 5678')).toBe('442012345678')
  })

  it.each([
    null, '', 'abc', '55 1234 5678 ext 9', '001 415 555 0123',
    '525512345678', '0551234567', '+01234567890', '+1234567890123456',
  ])('does not guess or silently strip invalid input: %s', (value) => {
    expect(reservationPhone(value)).toBeNull()
  })
})
