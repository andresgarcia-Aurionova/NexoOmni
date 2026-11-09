import { describe, expect, it } from 'vitest'
import { AlertSettingsError, parseAlertSettings, parseRecipientPhones, reservationAlertParams } from './reservation-alert'

describe('reservation staff alert settings', () => {
  it('normalizes, de-duplicates and validates recipient phones', () => {
    expect(parseRecipientPhones('+52 55 1234 5678, 525512345678\n+52 33 1111 2222')).toEqual(['525512345678', '523311112222'])
    expect(() => parseRecipientPhones(['abc'])).toThrow(AlertSettingsError)
    expect(() => parseRecipientPhones(['5211111111111', '5222222222222', '5233333333333', '5244444444444', '5255555555555', '5266666666666'])).toThrow(AlertSettingsError)
  })
  it('requires a number before enabling and validates the template', () => {
    const base = { templateName: 'aviso_reservacion_restaurante', templateLanguage: 'es_MX' }
    expect(parseAlertSettings({ ...base, enabled: true, recipientPhones: ['+525512345678'] })).toEqual({
      ...base, enabled: true, recipientPhones: ['525512345678'],
    })
    expect(() => parseAlertSettings({ ...base, enabled: true, recipientPhones: [] })).toThrow(AlertSettingsError)
    expect(() => parseAlertSettings({ ...base, templateName: 'Bad Name', recipientPhones: [] })).toThrow(AlertSettingsError)
    expect(() => parseAlertSettings({ ...base, templateLanguage: 'spanish', recipientPhones: [] })).toThrow(AlertSettingsError)
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
