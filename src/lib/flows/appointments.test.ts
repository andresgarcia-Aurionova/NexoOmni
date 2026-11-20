import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findConflict, getAvailableSlots } from '@/lib/appointments/availability'
import { bookFlowAppointment, loadOfferedSlots, matchSecureOffer } from './appointments'

vi.mock('@/lib/appointments/availability', () => ({
  findConflict: vi.fn().mockResolvedValue(false),
  getAvailableSlots: vi.fn(),
}))

describe('requested date for flow appointments', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('only offers slots on the requested local day, including after UTC midnight', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-11-20T18:00:00Z'))
    const db = createClient('https://db.example.test', 'key', { global: {
      fetch: async () => Response.json([{ timezone: 'America/Mexico_City', specialist_id: 'poc', agent_user_id: null }]),
    } })
    vi.mocked(getAvailableSlots).mockResolvedValue({
      hasSchedule: true,
      slots: [
        { start: '2026-11-21T04:30:00Z', end: '2026-11-21T05:30:00Z' },
        { start: '2026-11-21T18:00:00Z', end: '2026-11-21T19:00:00Z' },
        { start: '2026-11-22T05:00:00Z', end: '2026-11-22T06:00:00Z' },
        { start: '2026-11-22T06:00:00Z', end: '2026-11-22T07:00:00Z' },
      ],
    })
    const result = await loadOfferedSlots(db, 'account', {
      text: 'Horarios', specialist_id: 'poc', var_key: 'slot', date_var_key: 'fecha', next_node_key: 'next',
    }, { fecha: '21/11/2026' })
    expect(result.slots.map((slot) => slot.start)).toEqual([
      '2026-11-21T18:00:00Z', '2026-11-22T05:00:00Z',
    ])
    expect(getAvailableSlots).toHaveBeenCalledWith(db, expect.objectContaining({
      from: new Date('2026-11-20T00:00:00Z'), to: new Date('2026-11-23T00:00:00Z'),
    }))
  })

  it('does not query availability for missing, invalid or past dates', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-11-20T18:00:00Z'))
    const db = createClient('https://db.example.test', 'key', { global: {
      fetch: async () => Response.json([{ timezone: 'America/Mexico_City', specialist_id: 'poc', agent_user_id: null }]),
    } })
    const cfg = { text: 'Horarios', specialist_id: 'poc', var_key: 'slot', date_var_key: 'fecha', next_node_key: 'next' }
    for (const fecha of [undefined, 'ayer', '19/11/2026']) {
      expect(await loadOfferedSlots(db, 'account', cfg, { fecha })).toMatchObject({ invalidPreference: true, slots: [] })
    }
    expect(getAvailableSlots).not.toHaveBeenCalled()
  })

  it('rejects schedules with conflicting time zones instead of choosing one', async () => {
    const db = createClient('https://db.example.test', 'key', { global: {
      fetch: async () => Response.json([
        { timezone: 'America/Mexico_City', specialist_id: 'poc', agent_user_id: null },
        { timezone: 'UTC', specialist_id: 'poc', agent_user_id: null },
      ]),
    } })
    await expect(loadOfferedSlots(db, 'account', {
      text: 'Horarios', specialist_id: 'poc', var_key: 'slot', date_var_key: 'fecha', next_node_key: 'next',
    }, { fecha: '21/11/2026' })).rejects.toThrow('inconsistent time zones')
    expect(getAvailableSlots).not.toHaveBeenCalled()
  })

  it('prioritizes the closest times on the requested local day, breaking ties earlier', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-11-20T18:00:00Z'))
    const db = createClient('https://db.example.test', 'key', { global: {
      fetch: async () => Response.json([{ timezone: 'America/Mexico_City', specialist_id: 'poc', agent_user_id: null }]),
    } })
    vi.mocked(getAvailableSlots).mockResolvedValue({
      hasSchedule: true,
      slots: [
        { start: '2026-11-21T18:00:00Z', end: '2026-11-21T19:00:00Z' },
        { start: '2026-11-22T00:00:00Z', end: '2026-11-22T01:00:00Z' },
        { start: '2026-11-22T02:00:00Z', end: '2026-11-22T03:00:00Z' },
        { start: '2026-11-22T07:00:00Z', end: '2026-11-22T08:00:00Z' },
      ],
    })
    const result = await loadOfferedSlots(db, 'account', {
      text: 'Horarios', specialist_id: 'poc', var_key: 'slot', date_var_key: 'fecha',
      time_var_key: 'hora', max_options: 2, next_node_key: 'next',
    }, { fecha: '21/11/2026', hora: '19:00' })
    expect(result.slots.map((slot) => slot.start)).toEqual([
      '2026-11-22T00:00:00Z', '2026-11-22T02:00:00Z',
    ])
    expect(result.slots.map((slot) => slot.id)).toEqual(['slot_1', 'slot_2'])
  })

  it('does not query availability for an invalid preferred time or missing date configuration', async () => {
    const db = createClient('https://db.example.test', 'key')
    const cfg = {
      text: 'Horarios', var_key: 'slot', date_var_key: 'fecha', time_var_key: 'hora', next_node_key: 'next',
    }
    for (const hora of [undefined, '19', '7:00', '24:00', '19:60', '7pm']) {
      expect(await loadOfferedSlots(db, 'account', cfg, { hora })).toMatchObject({ invalidPreference: true, slots: [] })
    }
    expect(await loadOfferedSlots(db, 'account', { ...cfg, date_var_key: undefined }, { hora: '19:00' }))
      .toMatchObject({ invalidPreference: true, slots: [] })
    expect(getAvailableSlots).not.toHaveBeenCalled()
  })
})

describe('flow appointment booking', () => {
  afterEach(() => vi.clearAllMocks())

  it('does not book a slot that has already passed', async () => {
    const fetch = vi.fn()
    const db = createClient('https://db.example.test', 'key', { global: { fetch } })
    const result = await bookFlowAppointment(db, {
      accountId: 'account', userId: 'owner', contactId: 'contact', conversationId: 'conversation',
      cfg: { slot_var_key: 'slot', title: 'Reservación', next_node_key: 'next' },
      vars: { slot: '2000-01-01T18:00:00.000Z' },
    })

    expect(result).toEqual({ ok: false, reason: 'no_slot' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stores the captured reservation details in the appointment notes', async () => {
    let saved: Record<string, unknown> | undefined
    const db = createClient('https://db.example.test', 'key', { global: {
      fetch: async (input, init) => {
        const table = new URL(String(input)).pathname.split('/').pop()
        if (table === 'appointment_schedules') return Response.json([{ timezone: 'America/Mexico_City', specialist_id: null }])
        if (table === 'appointments') {
          saved = JSON.parse(String(init?.body))
          return Response.json({ id: 'appointment', starts_at: '2035-01-01T18:00:00.000Z' })
        }
        if (table === 'appointment_reminders') return Response.json(null)
        return new Response('Unexpected request', { status: 500 })
      },
    } })
    const result = await bookFlowAppointment(db, {
      accountId: 'account', userId: 'owner', contactId: 'contact', conversationId: 'conversation',
      cfg: {
        slot_var_key: 'slot', title: 'Reservación - {{vars.sede}}', next_node_key: 'next',
        notes: 'Sede: {{vars.sede}}\nPersonas: {{vars.personas}}\nZona: {{vars.zona}}',
      },
      vars: { slot: '2035-01-01T18:00:00.000Z', sede: 'Tabgha', personas: 4, zona: 'Terraza' },
    })
    expect(result.ok).toBe(true)
    expect(saved).toMatchObject({
      source_conversation_id: 'conversation',
      title: 'Reservación - Tabgha',
      notes: 'Sede: Tabgha\nPersonas: 4\nZona: Terraza',
    })
  })

  it('uses the atomic booking operation even when a prior attempt now conflicts', async () => {
    vi.mocked(findConflict).mockResolvedValueOnce(true)
    const calls: { path: string; body: Record<string, unknown> }[] = []
    const db = createClient('https://db.example.test', 'key', { global: {
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname
        if (path.endsWith('/appointment_schedules')) {
          return Response.json([{ timezone: 'America/Mexico_City', specialist_id: 'poc', agent_user_id: null }])
        }
        calls.push({ path, body: JSON.parse(String(init?.body)) })
        if (path.endsWith('/rpc/book_flow_appointment_once')) {
          return Response.json([{ result: 'already_booked', appointment_id: 'appointment', starts_at: '2035-01-01T18:00:00Z' }])
        }
        return new Response('Unexpected request', { status: 500 })
      },
    } })
    const result = await bookFlowAppointment(db, {
      accountId: 'account', userId: 'owner', contactId: 'contact', conversationId: 'conversation',
      flowRunId: 'run', nodeKey: 'book', expectedNodeKey: 'offer', expectedOfferToken: 'token',
      cfg: { slot_var_key: 'slot', title: 'Reserva', specialist_id: 'poc', idempotent_booking: true, next_node_key: 'next' },
      vars: { slot: '2035-01-01T18:00:00Z' },
    })
    expect(result).toEqual({ ok: true, appointmentId: 'appointment', startsAt: '2035-01-01T18:00:00Z' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      path: '/rest/v1/rpc/book_flow_appointment_once',
      body: { p_run_id: 'run', p_node_key: 'book', p_has_conflict: true },
    })
  })

  it('fails closed when the atomic booking result is invalid', async () => {
    const db = createClient('https://db.example.test', 'key', { global: {
      fetch: async (input) => new URL(String(input)).pathname.endsWith('/appointment_schedules')
        ? Response.json([{ timezone: 'America/Mexico_City', specialist_id: 'poc', agent_user_id: null }])
        : Response.json([{ result: 'booked' }]),
    } })
    const result = await bookFlowAppointment(db, {
      accountId: 'account', userId: 'owner', contactId: 'contact', conversationId: 'conversation',
      flowRunId: 'run', nodeKey: 'book', expectedNodeKey: 'offer', expectedOfferToken: 'token',
      cfg: { slot_var_key: 'slot', title: 'Reserva', specialist_id: 'poc', idempotent_booking: true, next_node_key: 'next' },
      vars: { slot: '2035-01-01T18:00:00Z' },
    })
    expect(result).toEqual({ ok: false, reason: 'failed' })
  })
})

describe('protected slot selection', () => {
  const slots = [{ id: 'slot_1', title: '18:00', start: '2035-01-01T18:00:00Z', end: '2035-01-01T18:30:00Z' }]

  it('only accepts the option number with the current offer code', () => {
    const token = 'abcdef12-3456-7890-abcd-ef1234567890'
    expect(matchSecureOffer('1 ABCDEF123456', slots, token)).toEqual(slots[0])
    for (const text of ['1', '1 ABCDEF123457', '2 ABCDEF123456', '1 ABCDEF123456 extra']) {
      expect(matchSecureOffer(text, slots, token)).toBeNull()
    }
  })
})
