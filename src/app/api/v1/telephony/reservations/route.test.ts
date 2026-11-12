import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { unauthorized } from '@/lib/api/v1/respond'
import { POST } from './route'

const mocks = vi.hoisted(() => ({ key: vi.fn(), entitlement: vi.fn(), live: vi.fn(), contact: vi.fn(), memory: vi.fn(), alert: vi.fn() }))
vi.mock('@/lib/auth/api-context', () => ({ requireApiKey: mocks.key }))
vi.mock('@/lib/account/entitlements', () => ({ getAccountEntitlements: mocks.entitlement }))
vi.mock('@/lib/telephony/call-context', () => ({ findLiveCallerCall: mocks.live }))
vi.mock('@/lib/api/v1/contacts', () => ({ resolveAuditUserId: async () => 'owner-1' }))
vi.mock('@/lib/telephony/reservation-contact', () => ({ findOrCreateReservationContact: mocks.contact }))
vi.mock('@/lib/telephony/reservation-memory', () => ({ recordReservationMemory: mocks.memory }))
vi.mock('@/lib/telephony/reservation-alert', async (original) => ({ ...(await original<typeof import('@/lib/telephony/reservation-alert')>()), sendReservationAlert: mocks.alert }))

let writes: { url: string; body: Record<string, unknown> }[]
let existing: unknown[]
beforeEach(() => {
  vi.resetAllMocks()
  writes = []
  existing = []
  const db = createClient('https://db.example.test', 'test-key', { global: {
    fetch: async (input, init) => {
      const url = String(input)
      if (init?.method === 'POST') {
        writes.push({ url, body: JSON.parse(String(init.body)) })
        return Response.json(url.includes('/appointments') ? { id: 'appt-1' } : [], { status: 201 })
      }
      return Response.json(existing)
    },
  } })
  mocks.key.mockResolvedValue({ accountId: 'account-from-key', supabase: db })
  mocks.entitlement.mockResolvedValue({ features: { yeastar_telephony: true } })
  mocks.live.mockResolvedValue({ callId: 'pbx-call', phone: '525512345678' })
  mocks.contact.mockResolvedValue({ id: 'contact-1', created: true })
  mocks.memory.mockResolvedValue(undefined)
  mocks.alert.mockResolvedValue(2)
})

const valid = { restaurant: 'B', zone: 'terraza', party_size: 4, date: '2999-01-10', time: '20:00', customer_name: 'Ana', ai_extension: '7001' }
const request = (body: unknown) => new Request('https://app.example.test/api/v1/telephony/reservations', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

describe('AI receptionist reservations API', () => {
  it('registers a confirmed reservation using the scope, account and caller verified by the PBX', async () => {
    const response = await POST(request({ ...valid, account_id: 'forged', customer_phone: '+10000000000' }))
    expect(response.status).toBe(200)
    expect(mocks.key).toHaveBeenCalledWith(expect.any(Request), 'reservations:write')
    const insert = writes.find((w) => w.url.includes('/appointments'))!.body
    expect(insert).toMatchObject({ account_id: 'account-from-key', status: 'confirmed', contact_id: 'contact-1', reservation_restaurant: 'B' })
    expect(String(insert.notes)).toContain('Zona: Terraza')
    expect(mocks.contact).toHaveBeenCalledWith(expect.anything(), 'account-from-key', 'owner-1', '525512345678', 'Ana')
    expect(mocks.memory).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      accountId: 'account-from-key', contactId: 'contact-1', appointmentId: 'appt-1',
      summary: expect.stringContaining('4 personas'),
    }))
    expect(await response.json()).toMatchObject({ data: { saved: true, appointment_id: 'appt-1', notified: true, notified_count: 2 } })
    expect(mocks.alert.mock.calls[0][2]).toEqual([
      'Restaurante B', expect.stringContaining('2999'), 'Ana, 4 personas, Terraza, tel. +525512345678',
    ])
  })
  it('keeps the reservation saved and reports notified=false when the staff alert fails', async () => {
    mocks.alert.mockResolvedValue(0)
    const response = await POST(request(valid))
    expect(await response.json()).toMatchObject({ data: { saved: true, notified: false } })
  })
  it('keeps WhatsApp unavailable for new reservations when the tool did not record a preference', async () => {
    const response = await POST(request(valid))
    expect(response.status).toBe(200)
    const insert = writes.find((w) => w.url.includes('/appointments'))!.body
    expect(insert).toMatchObject({ reservation_whatsapp_preference: 'unavailable', reservation_whatsapp_phone: null })
    expect(String(insert.notes)).toContain('WhatsApp: pendiente de confirmar')
  })
  it('keeps the reservation saved when the memory write fails', async () => {
    mocks.memory.mockRejectedValue(new Error('database unavailable'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await POST(request(valid))
    expect(await response.json()).toMatchObject({ data: { saved: true } })
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
  it('still registers the reservation, without a contact, when the caller cannot be verified', async () => {
    mocks.live.mockResolvedValue(null)
    expect((await POST(request(valid))).status).toBe(200)
    expect(mocks.contact).not.toHaveBeenCalled()
    expect(writes.find((w) => w.url.includes('/appointments'))!.body.contact_id).toBeNull()
    expect(mocks.alert.mock.calls[0][2][2]).toContain('teléfono no verificado; completar contacto')
  })
  it('creates the contact with a Mexican country code when the PBX reports ten digits', async () => {
    mocks.live.mockResolvedValue({ callId: 'pbx-call', phone: '5512345678' })
    expect((await POST(request(valid))).status).toBe(200)
    expect(mocks.contact).toHaveBeenCalledWith(expect.anything(), 'account-from-key', 'owner-1', '525512345678', 'Ana')
  })
  it('does not link an ambiguous contact and alerts the team', async () => {
    mocks.contact.mockResolvedValue(null)
    expect((await POST(request(valid))).status).toBe(200)
    expect(writes.find((w) => w.url.includes('/appointments'))!.body.contact_id).toBeNull()
    expect(mocks.alert.mock.calls[0][2][2]).toContain('contacto pendiente de revisión')
  })
  it('keeps the reservation if contact resolution fails', async () => {
    mocks.contact.mockRejectedValue(new Error('contact lookup failed'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await POST(request(valid))).status).toBe(200)
    expect(writes.find((w) => w.url.includes('/appointments'))!.body.contact_id).toBeNull()
    expect(mocks.alert.mock.calls[0][2][2]).toContain('contacto pendiente de revisión')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
  it('keeps the reservation without a contact for an unrecognized PBX number format', async () => {
    mocks.live.mockResolvedValue({ callId: 'pbx-call', phone: '14155550123' })
    expect((await POST(request(valid))).status).toBe(200)
    expect(mocks.contact).not.toHaveBeenCalled()
    expect(writes.find((w) => w.url.includes('/appointments'))!.body.contact_id).toBeNull()
    expect(mocks.alert.mock.calls[0][2][2]).toContain('teléfono no verificado; completar contacto')
  })
  it('does not duplicate a reservation when the tool retries', async () => {
    existing = { id: 'appt-0' } as unknown as unknown[]
    const response = await POST(request(valid))
    expect(await response.json()).toMatchObject({ data: { saved: true, duplicate: true, appointment_id: 'appt-0' } })
    expect(writes).toHaveLength(0)
  })
  it('stores the explicitly confirmed alternate number with the appointment', async () => {
    const response = await POST(request({
      ...valid, whatsapp_preference: 'other', whatsapp_phone: '55 1234 5678', whatsapp_phone_confirmed: true,
    }))
    expect(response.status).toBe(200)
    expect(writes.find((w) => w.url.includes('/appointments'))!.body).toMatchObject({
      reservation_whatsapp_preference: 'other', reservation_whatsapp_phone: '525512345678',
    })
  })
  it('does not pretend a changed preference was saved on a duplicate', async () => {
    existing = { id: 'appt-0', reservation_whatsapp_preference: 'caller', reservation_whatsapp_phone: null } as unknown as unknown[]
    const response = await POST(request({ ...valid, whatsapp_preference: 'declined' }))
    expect(response.status).toBe(400)
    expect(writes).toHaveLength(0)
  })
  it('stores a refusal without a WhatsApp number', async () => {
    const response = await POST(request({ ...valid, whatsapp_preference: 'declined' }))
    expect(response.status).toBe(200)
    expect(writes.find((w) => w.url.includes('/appointments'))!.body).toMatchObject({
      reservation_whatsapp_preference: 'declined', reservation_whatsapp_phone: null,
    })
  })
  it('stores the PBX caller number as the chosen destination', async () => {
    const response = await POST(request({ ...valid, whatsapp_preference: 'caller' }))
    expect(response.status).toBe(200)
    expect(writes.find((w) => w.url.includes('/appointments'))!.body).toMatchObject({
      reservation_whatsapp_preference: 'caller', reservation_whatsapp_phone: '525512345678',
    })
  })
  it('rejects an alternate number without explicit confirmation', async () => {
    const response = await POST(request({ ...valid, whatsapp_preference: 'other', whatsapp_phone: '5512345678' }))
    expect(response.status).toBe(400)
    expect(writes).toHaveLength(0)
  })
  it.each([
    { zone: 'piso uno', restaurant: 'C' },
    { zone: undefined },
    { party_size: 0 },
    { date: '2020-01-01' },
    { customer_name: '' },
  ])('rejects invalid reservation %j', async (override) => {
    expect((await POST(request({ ...valid, ...override }))).status).toBe(400)
    expect(writes).toHaveLength(0)
  })
  it('rejects unauthenticated requests and accounts without telephony', async () => {
    mocks.key.mockRejectedValueOnce(unauthorized())
    expect((await POST(request(valid))).status).toBe(401)
    mocks.entitlement.mockResolvedValue({ features: { yeastar_telephony: false } })
    expect((await POST(request(valid))).status).toBe(403)
  })
})
