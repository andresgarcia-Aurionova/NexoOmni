import { createClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/agendapro/confirmation', () => ({ handleAgendaProConfirmationReply: vi.fn() }))
vi.mock('@/lib/telephony/reservation-confirmation-worker', () => ({ handleReservationConfirmationReply: vi.fn() }))

import { handleAgendaProConfirmationReply } from '@/lib/agendapro/confirmation'
import { handleReservationConfirmationReply } from '@/lib/telephony/reservation-confirmation-worker'
import { handleWhatsAppConfirmationReplies } from './confirmation-replies'

const db = createClient('https://db.example.test', 'key')

describe('WhatsApp confirmation replies', () => {
  beforeEach(() => vi.resetAllMocks())

  it('flags both systems for review when a voice confirmation is ambiguous', async () => {
    vi.mocked(handleReservationConfirmationReply).mockResolvedValue('ambiguous')
    await handleWhatsAppConfirmationReplies(db, 'account', 'contact', 'line', 'sí', false, 'phone')
    expect(handleReservationConfirmationReply).toHaveBeenCalledWith(db, 'account', 'contact', 'line', 'sí', 'phone', false)
    expect(handleAgendaProConfirmationReply).toHaveBeenCalledWith(db, 'account', 'contact', 'line', 'sí', true)
  })

  it('preserves flow priority even when there is no voice confirmation', async () => {
    vi.mocked(handleReservationConfirmationReply).mockResolvedValue('none')
    await handleWhatsAppConfirmationReplies(db, 'account', 'contact', 'line', 'no', true)
    expect(handleAgendaProConfirmationReply).toHaveBeenCalledWith(db, 'account', 'contact', 'line', 'no', true)
  })

  it('allows an unambiguous other confirmation when no flow or voice reply matched', async () => {
    vi.mocked(handleReservationConfirmationReply).mockResolvedValue('none')
    await handleWhatsAppConfirmationReplies(db, 'account', 'contact', 'line', 'sí', false)
    expect(handleAgendaProConfirmationReply).toHaveBeenCalledWith(db, 'account', 'contact', 'line', 'sí', false)
  })
})
