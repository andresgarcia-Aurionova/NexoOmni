import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { AlertSettingsError, parseAlertSettings, parseRecipientPhones, reservationAlertParams, sendReservationAlert } from './reservation-alert'

const mocks = vi.hoisted(() => ({ sendZernio: vi.fn(), sendMeta: vi.fn(), decrypt: vi.fn() }))
vi.mock('@/lib/zernio/server', () => ({ sendZernioTemplateMessage: mocks.sendZernio }))
vi.mock('@/lib/whatsapp/meta-api', () => ({ sendTemplateMessage: mocks.sendMeta }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }))

describe('reservation staff alert settings', () => {
  it('normalizes, de-duplicates and validates recipient phones', () => {
    expect(parseRecipientPhones('+52 55 1234 5678, 525512345678\n+52 33 1111 2222')).toEqual(['525512345678', '523311112222'])
    expect(() => parseRecipientPhones(['abc'])).toThrow(AlertSettingsError)
    expect(() => parseRecipientPhones(['5211111111111', '5222222222222', '5233333333333', '5244444444444', '5255555555555', '5266666666666'])).toThrow(AlertSettingsError)
  })

  describe('reservation alert sender', () => {
    const settings = { enabled: true, template_name: 'aviso_reservacion_restaurante', template_language: 'es_MX', recipient_phones: ['525512345678', '525511112222'] }
    const connectors = [
      { id: 'old', zernio_account_id: 'old-provider' },
      { id: 'right', zernio_account_id: 'right-provider' },
    ]
    const params = ['Restaurante B', 'fecha', 'detalle']
    let templates: { connector_id: string | null; status: string }[]
    let meta: { phone_number_id: string; access_token: string } | null
    let sentQueries: string[]

    beforeEach(() => {
      vi.resetAllMocks()
      mocks.sendZernio.mockResolvedValue({ messageId: 'message' })
      mocks.sendMeta.mockResolvedValue({ messageId: 'message' })
      mocks.decrypt.mockReturnValue('decrypted')
      templates = [{ connector_id: 'right', status: 'APPROVED' }]
      meta = null
      sentQueries = []
    })

    function db() {
      return createClient('https://db.example.test', 'test-key', { global: {
        fetch: async (input) => {
          const url = String(input)
          sentQueries.push(url)
          if (url.includes('/reservation_alert_settings')) return Response.json(settings)
          if (url.includes('/message_templates')) return Response.json(templates)
          if (url.includes('/omnichannel_connectors')) return Response.json(connectors)
          if (url.includes('/whatsapp_config')) return Response.json(meta)
          return new Response('Unexpected query', { status: 500 })
        },
      } })
    }

    it('uses the channel belonging to the approved account template, not the oldest channel', async () => {
      expect(await sendReservationAlert(db(), 'account', params)).toBe(2)
      expect(mocks.sendZernio).toHaveBeenCalledTimes(2)
      expect(mocks.sendZernio).toHaveBeenCalledWith(expect.objectContaining({
        zernioAccountId: 'right-provider', templateName: settings.template_name, templateLanguage: 'es_MX', templateParams: params,
      }))
      expect(sentQueries.find((url) => url.includes('/message_templates'))).toContain('account_id=eq.account')
      expect(mocks.sendMeta).not.toHaveBeenCalled()
    })

    it('uses direct Meta when the approved template belongs to direct WhatsApp', async () => {
      templates = [{ connector_id: null, status: 'Approved' }]
      meta = { phone_number_id: 'direct', access_token: 'encrypted' }
      expect(await sendReservationAlert(db(), 'account', params)).toBe(2)
      expect(mocks.sendMeta).toHaveBeenCalledWith(expect.objectContaining({ phoneNumberId: 'direct', accessToken: 'decrypted' }))
      expect(mocks.sendZernio).not.toHaveBeenCalled()
    })

    it.each([
      ['no approved template', []],
      ['pending template', [{ connector_id: 'right', status: 'PENDING' }]],
      ['ambiguous template', [{ connector_id: 'right', status: 'APPROVED' }, { connector_id: 'old', status: 'APPROVED' }]],
      ['disconnected template channel', [{ connector_id: 'missing', status: 'APPROVED' }]],
    ])('does not send for %s', async (_label, rows) => {
      templates = rows
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(await sendReservationAlert(db(), 'account', params)).toBe(0)
      expect(log).toHaveBeenCalled()
      expect(mocks.sendZernio).not.toHaveBeenCalled()
      expect(mocks.sendMeta).not.toHaveBeenCalled()
      log.mockRestore()
    })

    it('reports partial failures without losing successful sends', async () => {
      mocks.sendZernio.mockResolvedValueOnce({ messageId: 'message' }).mockRejectedValueOnce(new Error('provider failed'))
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(await sendReservationAlert(db(), 'account', params)).toBe(1)
      expect(log).toHaveBeenCalled()
      log.mockRestore()
    })
  })
  it('requires a number before enabling and validates the template', () => {
    const base = { templateName: 'aviso_reservacion_restaurante', templateLanguage: 'es_MX' }
    expect(parseAlertSettings({ ...base, enabled: true, recipientPhones: ['+525512345678'] })).toEqual({
      ...base, enabled: true, recipientPhones: ['525512345678'],
      confirmationEnabled: false, confirmationTemplateName: 'confirmacion_reservacion', confirmationTemplateLanguage: 'es_MX',
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
