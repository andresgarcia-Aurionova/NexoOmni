import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { unauthorized } from '@/lib/api/v1/respond'
import { POST } from './route'

const mocks = vi.hoisted(() => ({ key: vi.fn(), entitlement: vi.fn(), live: vi.fn(), contact: vi.fn(), memory: vi.fn(), alert: vi.fn() }))
vi.mock('@/lib/auth/api-context', () => ({ requireApiKey: mocks.key }))
vi.mock('@/lib/account/entitlements', () => ({ getAccountEntitlements: mocks.entitlement }))
vi.mock('@/lib/telephony/call-context', () => ({ findLiveCallerCall: mocks.live }))
vi.mock('@/lib/api/v1/contacts', () => ({ findOrCreateContact: mocks.contact, resolveAuditUserId: async () => 'owner-1' }))
vi.mock('@/lib/appointments/memory', () => ({ recordAppointmentMemoryEvent: mocks.memory }))
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
  mocks.alert.mockResolvedValue(true)
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
    expect(insert).toMatchObject({ account_id: 'account-from-key', status: 'confirmed', contact_id: 'contact-1' })
    expect(String(insert.notes)).toContain('Zona: Terraza')
    expect(mocks.contact).toHaveBeenCalledWith(expect.anything(), 'account-from-key', 'owner-1', { phone: '525512345678', name: 'Ana' })
    expect(await response.json()).toMatchObject({ data: { saved: true, appointment_id: 'appt-1', notified: true } })
    expect(mocks.alert.mock.calls[0][2]).toEqual([
      'Restaurante B', expect.stringContaining('2999'), 'Ana, 4 personas, Terraza, tel. +525512345678',
    ])
  })
  it('keeps the reservation saved and reports notified=false when the staff alert fails', async () => {
    mocks.alert.mockResolvedValue(false)
    const response = await POST(request(valid))
    expect(await response.json()).toMatchObject({ data: { saved: true, notified: false } })
  })
  it('still registers the reservation, without a contact, when the caller cannot be verified', async () => {
    mocks.live.mockResolvedValue(null)
    expect((await POST(request(valid))).status).toBe(200)
    expect(mocks.contact).not.toHaveBeenCalled()
    expect(writes.find((w) => w.url.includes('/appointments'))!.body.contact_id).toBeNull()
  })
  it('does not duplicate a reservation when the tool retries', async () => {
    existing = { id: 'appt-0' } as unknown as unknown[]
    const response = await POST(request(valid))
    expect(await response.json()).toMatchObject({ data: { saved: true, duplicate: true, appointment_id: 'appt-0' } })
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
