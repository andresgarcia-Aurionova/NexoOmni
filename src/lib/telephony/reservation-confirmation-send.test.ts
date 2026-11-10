import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { sendReservationConfirmation } from './reservation-confirmation-send'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/lib/zernio/send-template-to-contact', () => ({ sendZernioTemplateToContact: mocks.send }))

describe('reservation confirmation message', () => {
  it('sends the restaurant and local date through only the template connector', async () => {
    mocks.send.mockResolvedValueOnce({ conversationId: 'conversation', messageId: 'message' })
    const db = createClient('https://db.example.test', 'test-key')
    const connector = { id: 'template-connector', zernio_account_id: 'provider-account' }
    const result = await sendReservationConfirmation(db, {
      accountId: 'account', contactId: 'contact', phone: '525512345678', ownerUserId: 'owner',
      restaurant: 'B', startsAt: '2026-11-11T02:00:00Z',
      templateName: 'confirmacion_reservacion', templateLanguage: 'es_MX', connector,
    })
    expect(result).toEqual({ conversationId: 'conversation', messageId: 'message' })
    expect(mocks.send).toHaveBeenCalledWith(db, expect.objectContaining({
      accountId: 'account', contactId: 'contact', templateName: 'confirmacion_reservacion',
      templateLanguage: 'es_MX', connectors: [connector],
      bodyParams: ['Restaurante B', expect.stringContaining('10 de noviembre')],
    }))
    expect(mocks.send.mock.calls[0][1].bodyParams[1]).toContain('20:00')
  })

  it('does not send an invalid reservation date', async () => {
    const db = createClient('https://db.example.test', 'test-key')
    mocks.send.mockClear()
    await expect(sendReservationConfirmation(db, {
      accountId: 'account', contactId: 'contact', phone: '525512345678', ownerUserId: 'owner',
      restaurant: 'A', startsAt: 'bad-date',
      templateName: 'confirmacion_reservacion', templateLanguage: 'es_MX',
      connector: { id: 'connector', zernio_account_id: 'provider' },
    })).rejects.toThrow('Invalid reservation date')
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
