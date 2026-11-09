import { describe, expect, it } from 'vitest'
import { reservationAlertConfig, reservationAlertParams } from './reservation-alert'

describe('reservation staff alert', () => {
  it('reads the destination only from server settings and validates it', () => {
    expect(reservationAlertConfig({})).toBeNull()
    expect(reservationAlertConfig({ RESERVATION_ALERT_PHONE: 'abc' })).toBeNull()
    expect(reservationAlertConfig({ RESERVATION_ALERT_PHONE: '+52 55 1234 5678' })).toEqual({
      phone: '525512345678', templateName: 'aviso_reservacion_restaurante', language: 'es_MX',
    })
  })
  it('builds three single-line template variables in Mexico City time', () => {
    const [restaurant, when, detail] = reservationAlertParams({
      restaurant: 'B', startsAt: '2026-11-16T02:00:00.000Z', name: 'Ana\nLópez', partySize: 1, zone: 'Terraza', occasion: 'Cumpleaños', phone: '525512345678',
    })
    expect(restaurant).toBe('Restaurante B')
    expect(when).toContain('15 de noviembre')
    expect(when).toContain('20:00')
    expect(detail).toBe('Ana López, 1 persona, Terraza, ocasión: Cumpleaños, tel. +525512345678')
    expect([restaurant, when, detail].some((v) => v.includes('\n'))).toBe(false)
  })
})
