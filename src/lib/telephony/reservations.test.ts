import { describe, expect, it } from 'vitest'
import { parsePartySize, parseReservationWindow, parseRestaurant, reservationMemorySummary, resolveZone } from './reservations'

describe('reservation rules', () => {
  it('accepts restaurant names in several spoken forms', () => {
    expect(parseRestaurant('Restaurante b')).toBe('B')
    expect(parseRestaurant('c')).toBe('C')
    expect(() => parseRestaurant('Z')).toThrow()
  })
  it('only offers the zones each restaurant has', () => {
    expect(resolveZone('A', undefined)).toBe('piso_uno')
    expect(resolveZone('C', 'cualquiera')).toBe('terraza')
    expect(resolveZone('B', 'Terraza')).toBe('terraza')
    expect(resolveZone('B', 'interior')).toBe('piso_uno')
    expect(() => resolveZone('B', undefined)).toThrow(/zone is required/)
    expect(() => resolveZone('A', 'terraza')).toThrow(/only has Piso uno/)
    expect(() => resolveZone('C', 'piso uno')).toThrow(/only has Terraza/)
  })
  it('validates party size', () => {
    expect(parsePartySize('4')).toBe(4)
    for (const bad of [0, 51, 2.5, 'abc', null]) expect(() => parsePartySize(bad)).toThrow()
  })
  it('includes the reservation details and local date in the memory event', () => {
    const summary = reservationMemorySummary({
      restaurant: 'B', zone: 'terraza', partySize: 4, name: 'Ana',
      startsAt: '2026-11-11T02:00:00.000Z', occasion: 'Cumpleaños',
    })
    expect(summary).toContain('Restaurante B')
    expect(summary).toContain('Terraza')
    expect(summary).toContain('4 personas')
    expect(summary).toContain('10 de noviembre de 2026')
    expect(summary).toContain('20:00')
    expect(summary).toContain('Ana')
    expect(summary).toContain('Cumpleaños')
    expect(reservationMemorySummary({
      restaurant: 'A', zone: 'piso_uno', partySize: 1, name: 'Ana',
      startsAt: '2026-11-11T02:00:00.000Z', occasion: null,
    })).toContain('1 persona,')
  })
  it('builds a 90 minute window in Mexico City time and rejects past or impossible dates', () => {
    const now = new Date('2026-11-09T12:00:00Z')
    expect(parseReservationWindow('2026-11-10', '20:00', now)).toEqual({
      startsAt: '2026-11-11T02:00:00.000Z', endsAt: '2026-11-11T03:30:00.000Z',
    })
    expect(() => parseReservationWindow('2026-11-08', '20:00', now)).toThrow(/future/)
    expect(() => parseReservationWindow('2026-02-30', '20:00', now)).toThrow(/calendar/)
    expect(() => parseReservationWindow('2026-11-10', '8pm', now)).toThrow()
  })
})
