import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { ReservationReminderConfigError } from './reservation-reminder-config'
import { handleReservationConfirmationReply, processReservationConfirmationJobs } from './reservation-confirmation-worker'

const mocks = vi.hoisted(() => ({ config: vi.fn(), send: vi.fn(), memory: vi.fn(), reservationMemory: vi.fn() }))
vi.mock('./reservation-reminder-config', async (original) => ({
  ...(await original<typeof import('./reservation-reminder-config')>()), loadReservationReminderConfig: mocks.config,
}))
vi.mock('./reservation-confirmation-send', () => ({ sendReservationConfirmation: mocks.send }))
vi.mock('./reservation-memory', () => ({ recordReservationMemory: mocks.reservationMemory }))

type Job = { appointment_id: string; account_id: string; revision: number; state: string; response: string | null; [key: string]: unknown }
let jobs: Job[]
let appointment: Record<string, unknown>
let settings: Record<string, unknown>
let agenda: unknown[]
let notices: string[]
let pendingDeclines: { appointment_id: string; revision: number }[]

function db() {
  return createClient('https://db.example.test', 'test-key', {
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input))
        const table = url.pathname.split('/').pop()
        const method = init?.method ?? 'GET'
        if (table === 'notify_reservation_confirmation') {
          notices.push(JSON.parse(String(init?.body)).p_kind)
          return Response.json(true)
        }
        if (table === 'record_voice_reservation_response') {
          mocks.memory(JSON.parse(String(init?.body)))
          return Response.json(true)
        }
        if (table === 'accept_voice_reservation_response') {
          const args = JSON.parse(String(init?.body))
          const row = jobs.find((job) => job.appointment_id === args.p_appointment_id &&
            job.account_id === args.p_account_id && job.revision === args.p_revision &&
            job.state === 'sent' && job.response === null)
          if (!row) return Response.json(false)
          mocks.memory(args)
          row.response = args.p_response
          row.response_memory_at = new Date().toISOString()
          if (args.p_response === 'no') {
            pendingDeclines.push({ appointment_id: row.appointment_id, revision: row.revision })
            row.response_notice_at = new Date().toISOString()
          }
          return Response.json(true)
        }
        if (table === 'reservation_confirmation_decline_outbox') return Response.json(pendingDeclines)
        if (table === 'deliver_voice_reservation_decline') {
          const args = JSON.parse(String(init?.body))
          pendingDeclines = pendingDeclines.filter((row) =>
            row.appointment_id !== args.p_appointment_id || row.revision !== args.p_revision)
          notices.push('declined')
          return Response.json(true)
        }
        if (table === 'reservation_confirmation_jobs' && method === 'PATCH') {
          const row = jobs.find((job) =>
            url.searchParams.get('appointment_id') === `eq.${job.appointment_id}` &&
            url.searchParams.get('account_id') === `eq.${job.account_id}` &&
            url.searchParams.get('revision') === `eq.${job.revision}` &&
            url.searchParams.get('state') === `eq.${job.state}` &&
            (!url.searchParams.has('response') || job.response === null))
          if (!row) return Response.json(null)
          Object.assign(row, JSON.parse(String(init?.body)))
          return Response.json({ appointment_id: row.appointment_id })
        }
        if (table === 'reservation_confirmation_jobs') {
          if (url.searchParams.has('appointment_id')) {
            return Response.json(jobs.find((job) => url.searchParams.get('appointment_id') === `eq.${job.appointment_id}`) ?? null)
          }
          if (url.searchParams.has('updated_at')) return Response.json([])
          if (url.searchParams.has('failure_notice_at')) return Response.json(jobs.filter((job) => job.state === 'failed' && !job.failure_notice_at))
          if (url.searchParams.has('response_notice_at')) return Response.json(jobs.filter((job) => job.state === 'sent' && job.response === 'no' && !job.response_notice_at))
          if (url.searchParams.has('response_memory_at')) return Response.json(jobs.filter((job) => job.state === 'sent' && job.response !== null && !job.response_memory_at))
          if (url.searchParams.has('conversation_id')) return Response.json(jobs.filter((job) => job.state === 'sent' && job.response === null))
          return Response.json(jobs.filter((job) => job.state === 'queued' || job.state === 'scheduled'))
        }
        if (table === 'appointments') return Response.json(appointment)
        if (table === 'reservation_alert_settings') return Response.json(settings)
        if (table === 'contacts') return Response.json({ phone: '525512345678' })
        if (table === 'contact_memory_events') return Response.json({ id: 'existing-memory' })
        if (table === 'agendapro_bookings') return Response.json(agenda)
        return new Response(`Unexpected query ${method} ${table}`, { status: 500 })
      },
    },
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-10T16:00:00Z'))
  vi.clearAllMocks()
  jobs = [{ appointment_id: 'appointment', account_id: 'account', revision: 1, state: 'queued', response: null }]
  appointment = { id: 'appointment', contact_id: 'contact', created_by: 'owner', title: 'Reservación B', starts_at: '2026-11-10T20:00:00Z', status: 'confirmed', reservation_restaurant: 'B' }
  settings = { confirmation_enabled: true, confirmation_template_name: 'confirmacion_reservacion', confirmation_template_language: 'es_MX' }
  agenda = []
  notices = []
  pendingDeclines = []
  mocks.config.mockResolvedValue({
    connector: { id: 'connector', zernio_account_id: 'provider' },
    schedule: { timezone: 'America/Mexico_City', windows: [{ weekday: 2, start: '09:00', end: '18:00' }], holidays: [] },
  })
  afterEach(() => vi.useRealTimers())
  mocks.send.mockResolvedValue({ conversationId: 'conversation', messageId: 'message' })
  mocks.memory.mockResolvedValue(undefined)
  mocks.reservationMemory.mockResolvedValue(undefined)
})

describe('reservation confirmation worker', () => {
  it('sends a due confirmation and records the conversation', async () => {
    expect(await processReservationConfirmationJobs(db())).toMatchObject({ sent: 1, failed: 0 })
    expect(jobs[0]).toMatchObject({ state: 'sent', conversation_id: 'conversation' })
    expect(notices).toEqual(['due'])
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.reservationMemory).toHaveBeenCalledOnce()
  })

  it('waits until business hours and does not send prematurely', async () => {
    appointment.starts_at = '2026-11-11T05:00:00Z'
    expect(await processReservationConfirmationJobs(db())).toMatchObject({ scheduled: 1, sent: 0 })
    expect(jobs[0]).toMatchObject({ state: 'scheduled', due_at: '2026-11-10T17:00:00.000Z' })
  })

  it('alerts the team and retries configuration when the schedule is unavailable', async () => {
    mocks.config.mockRejectedValue(new ReservationReminderConfigError('hours_unavailable', 'Configura el horario.'))
    expect(await processReservationConfirmationJobs(db())).toMatchObject({ scheduled: 1, sent: 0 })
    expect(notices).toEqual(['config_hours_unavailable'])
    expect(jobs[0].state).toBe('scheduled')
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('alerts the team instead of messaging when the contact is missing', async () => {
    appointment.contact_id = null
    await processReservationConfirmationJobs(db())
    expect(notices).toEqual(['missing_contact'])
    expect(jobs[0].state).toBe('skipped')
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('does not send if the reservation is cancelled', async () => {
    appointment.status = 'cancelled'
    await processReservationConfirmationJobs(db())
    expect(jobs[0].state).toBe('skipped')
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('does not send after a configuration change invalidates the claim', async () => {
    mocks.config.mockImplementationOnce(async () => {
      jobs[0].revision = 2
      jobs[0].state = 'queued'
      return {
        connector: { id: 'connector', zernio_account_id: 'provider' },
        schedule: { timezone: 'America/Mexico_City', windows: [{ weekday: 2, start: '09:00', end: '18:00' }], holidays: [] },
      }
    })
    await processReservationConfirmationJobs(db())
    expect(jobs[0]).toMatchObject({ state: 'queued', revision: 2 })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('records an affirmative reply in memory', async () => {
    jobs[0].state = 'sent'
    expect(await handleReservationConfirmationReply(db(), 'account', 'contact', 'conversation', 'Sí')).toBe('handled')
    expect(jobs[0].response).toBe('yes')
    expect(mocks.memory).toHaveBeenCalledOnce()
    expect(notices).toEqual([])
  })

  it('alerts the team if the reservation changed before accepting the reply', async () => {
    jobs[0].state = 'sent'
    agenda = []
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.memory.mockImplementationOnce(() => { throw new Error('unexpected acceptance') })
    const database = db()
    const rpc = vi.spyOn(database, 'rpc')
    rpc.mockResolvedValueOnce({ data: false, error: null, count: null, status: 200, statusText: 'OK', success: true })
    expect(await handleReservationConfirmationReply(database, 'account', 'contact', 'conversation', 'Sí')).toBe('ambiguous')
    expect(notices).toEqual(['ambiguous_reply'])
    log.mockRestore()
  })

  it('retries recording an affirmative reply even when no decline notices are pending', async () => {
    jobs[0].state = 'sent'
    jobs[0].response = 'yes'
    await processReservationConfirmationJobs(db())
    expect(mocks.memory).toHaveBeenCalledOnce()
    expect(notices).toEqual([])
  })

  it('never retries a send with an uncertain result', async () => {
    mocks.send.mockRejectedValue(new Error('timeout'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await processReservationConfirmationJobs(db())
    expect(jobs[0]).toMatchObject({ state: 'failed' })
    await processReservationConfirmationJobs(db())
    expect(notices).toContain('send_failed')
    expect(mocks.send).toHaveBeenCalledOnce()
    log.mockRestore()
  })

  it('records a negative reply and alerts without cancelling the appointment', async () => {
    jobs[0].state = 'sent'
    expect(await handleReservationConfirmationReply(db(), 'account', 'contact', 'conversation', 'NO')).toBe('handled')
    expect(jobs[0].response).toBe('no')
    jobs[0].revision = 2
    jobs[0].state = 'queued'
    await processReservationConfirmationJobs(db())
    expect(notices).toContain('declined')
    expect(appointment.status).toBe('confirmed')
    expect(mocks.memory).toHaveBeenCalledOnce()
  })

  it('does not confirm any booking when several confirmations are pending', async () => {
    jobs[0].state = 'sent'
    jobs.push({ appointment_id: 'second', account_id: 'account', revision: 1, state: 'sent', response: null })
    expect(await handleReservationConfirmationReply(db(), 'account', 'contact', 'conversation', 'Sí')).toBe('ambiguous')
    expect(jobs.map((job) => job.response)).toEqual([null, null])
    expect(notices).toEqual(['ambiguous_reply', 'ambiguous_reply'])
    expect(mocks.memory).not.toHaveBeenCalled()
  })

  it('does not misattribute a reply when AgendaPro is also waiting', async () => {
    jobs[0].state = 'sent'
    agenda = [{ id: 'booking' }]
    expect(await handleReservationConfirmationReply(db(), 'account', 'contact', 'conversation', 'SI')).toBe('ambiguous')
    expect(jobs[0].response).toBeNull()
  })
})
