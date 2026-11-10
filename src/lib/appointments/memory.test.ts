import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordAppointmentMemoryEvent } from './memory'

const mocks = vi.hoisted(() => ({ insert: vi.fn(), from: vi.fn(), createClient: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))

describe('appointment memory event', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.createClient.mockReturnValue({ from: mocks.from })
    mocks.from.mockReturnValue({ insert: mocks.insert })
  })

  it('records the event for the account and contact', async () => {
    mocks.insert.mockResolvedValue({ error: null })
    await recordAppointmentMemoryEvent({
      accountId: 'account', contactId: 'contact', appointmentId: 'appointment', summary: 'Reservación',
    })
    expect(mocks.from).toHaveBeenCalledWith('contact_memory_events')
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      account_id: 'account', contact_id: 'contact', source_id: 'appointment', summary: 'Reservación',
    }))
  })

  it('propagates database errors to the caller', async () => {
    const error = new Error('insert failed')
    mocks.insert.mockResolvedValue({ error })
    await expect(recordAppointmentMemoryEvent({
      accountId: 'account', contactId: 'contact', appointmentId: 'appointment', summary: 'Reservación',
    })).rejects.toBe(error)
  })
})
