import { beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loadReservationReminderConfig, ReservationReminderConfigError } from './reservation-reminder-config'

const connectorId = 'c3c4d93b-59d1-4018-ad92-64efee6e8f91'
const otherId = 'c3c4d93b-59d1-4018-ad92-64efee6e8f92'
const template: {
  connector_id: string; status: string; body_text: string; header_type: string | null; buttons: unknown[] | null
} = {
  connector_id: connectorId, status: 'APPROVED',
  body_text: 'Hola, tu reserva en {{1}} para el {{2}}. Responde SÍ o NO.',
  header_type: null, buttons: null,
}
const businessHours = {
  enabled: true, timezone: 'America/Mexico_City', windows: [{ weekday: 1, start: '09:00', end: '18:00' }],
  holidays: [], message: 'Cerrado',
}
let templates: typeof template[]
let connectors: { id: string; zernio_account_id: string }[]
let hours: typeof businessHours | null
let queries: string[]

function db() {
  return createClient('https://db.example.test', 'test-key', {
    global: {
      fetch: async (input) => {
        const url = String(input)
        queries.push(url)
        if (url.includes('/message_templates')) return Response.json(templates)
        if (url.includes('/omnichannel_connectors')) return Response.json(connectors)
        if (url.includes('/connected_whatsapp_business_hours')) return Response.json(hours)
        return new Response('Unexpected query', { status: 500 })
      },
    },
  })
}

beforeEach(() => {
  templates = [{ ...template }]
  connectors = [{ id: otherId, zernio_account_id: 'other' }, { id: connectorId, zernio_account_id: 'correct' }]
  hours = { ...businessHours }
  queries = []
})

describe('reservation reminder configuration', () => {
  it('uses the approved template connector and that exact connector’s business hours', async () => {
    const config = await loadReservationReminderConfig(db(), 'account', 'confirmacion_reservacion', 'es_MX')
    expect(config.connector).toEqual({ id: connectorId, zernio_account_id: 'correct' })
    expect(config.schedule.timezone).toBe('America/Mexico_City')
    expect(queries.find((url) => url.includes('/connected_whatsapp_business_hours')))
      .toContain(`connector_id=eq.${connectorId}`)
    expect(queries.every((url) => url.includes('account_id=eq.account'))).toBe(true)
  })

  it('rejects pending and ambiguous templates', async () => {
    templates = [{ ...template, status: 'PENDING' }]
    await expect(loadReservationReminderConfig(db(), 'account', 'confirmacion_reservacion', 'es_MX'))
      .rejects.toMatchObject({ code: 'template_unavailable' })
    templates = [{ ...template }, { ...template, connector_id: otherId }]
    await expect(loadReservationReminderConfig(db(), 'account', 'confirmacion_reservacion', 'es_MX'))
      .rejects.toMatchObject({ code: 'template_unavailable' })
  })

  it('rejects unexpected template variables and headers', async () => {
    templates = [{ ...template, body_text: 'Hola {{1}}' }]
    await expect(loadReservationReminderConfig(db(), 'account', 'confirmacion_reservacion', 'es_MX'))
      .rejects.toMatchObject({ code: 'template_format' })
    templates = [{ ...template, header_type: 'text' }]
    await expect(loadReservationReminderConfig(db(), 'account', 'confirmacion_reservacion', 'es_MX'))
      .rejects.toBeInstanceOf(ReservationReminderConfigError)
  })

  it('rejects disconnected channels and missing or disabled hours', async () => {
    connectors = [{ id: otherId, zernio_account_id: 'other' }]
    await expect(loadReservationReminderConfig(db(), 'account', 'confirmacion_reservacion', 'es_MX'))
      .rejects.toMatchObject({ code: 'connector_unavailable' })
    connectors = [{ id: connectorId, zernio_account_id: 'correct' }]
    hours = null
    await expect(loadReservationReminderConfig(db(), 'account', 'confirmacion_reservacion', 'es_MX'))
      .rejects.toMatchObject({ code: 'hours_unavailable' })
    hours = { ...businessHours, enabled: false }
    await expect(loadReservationReminderConfig(db(), 'account', 'confirmacion_reservacion', 'es_MX'))
      .rejects.toMatchObject({ code: 'hours_unavailable' })
  })

  it('rejects invalid business hours', async () => {
    hours = { ...businessHours, timezone: 'invalid' }
    await expect(loadReservationReminderConfig(db(), 'account', 'confirmacion_reservacion', 'es_MX'))
      .rejects.toMatchObject({ code: 'hours_invalid' })
  })
})
