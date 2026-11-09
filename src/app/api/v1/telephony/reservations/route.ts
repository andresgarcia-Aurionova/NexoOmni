import { requireApiKey } from '@/lib/auth/api-context'
import { badRequest, forbidden, ok, toApiErrorResponse } from '@/lib/api/v1/respond'
import { getAccountEntitlements } from '@/lib/account/entitlements'
import { findOrCreateContact, resolveAuditUserId } from '@/lib/api/v1/contacts'
import { findLiveCallerCall } from '@/lib/telephony/call-context'
import { recordAppointmentMemoryEvent } from '@/lib/appointments/memory'
import {
  ReservationError, ZONE_LABELS, cleanText, parsePartySize, parseReservationWindow, parseRestaurant, resolveZone,
} from '@/lib/telephony/reservations'

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'reservations:write')
    const entitlements = await getAccountEntitlements(ctx.supabase, ctx.accountId)
    if (!entitlements?.features.yeastar_telephony) throw forbidden('Telephony is not enabled for this account')
    const raw = await request.json().catch(() => { throw badRequest('Invalid JSON body') })
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('Expected a JSON object')
    const body = raw as Record<string, unknown>

    let parsed
    try {
      const restaurant = parseRestaurant(body.restaurant)
      parsed = {
        restaurant,
        zone: resolveZone(restaurant, body.zone),
        partySize: parsePartySize(body.party_size),
        window: parseReservationWindow(body.date, body.time),
        occasion: cleanText(body.occasion, 120),
        name: cleanText(body.customer_name, 100),
        callId: cleanText(body.call_id, 120),
        aiExtension: cleanText(body.ai_extension, 20),
      }
    } catch (error) {
      if (error instanceof ReservationError) throw badRequest(error.message)
      throw error
    }
    if (!parsed.name) throw badRequest('customer_name is required')

    // The caller's number comes only from the PBX, never from model-supplied text.
    const call = parsed.callId || parsed.aiExtension
      ? await findLiveCallerCall(ctx.supabase, ctx.accountId, undefined, parsed.callId ?? undefined, parsed.aiExtension ?? undefined).catch(() => null)
      : null

    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId)
    const contact = call
      ? await findOrCreateContact(ctx.supabase, ctx.accountId, auditUserId, { phone: call.phone, name: parsed.name })
      : null

    const zone = ZONE_LABELS[parsed.zone]
    const title = `Reservación Restaurante ${parsed.restaurant} · ${parsed.partySize} ${parsed.partySize === 1 ? 'persona' : 'personas'} · ${parsed.name}`
    const notes = [
      `Restaurante: ${parsed.restaurant}`, `Zona: ${zone}`, `Personas: ${parsed.partySize}`,
      `Ocasión: ${parsed.occasion ?? 'Ninguna'}`, `Nombre: ${parsed.name}`,
      call ? `Teléfono: ${call.phone}` : 'Teléfono: no verificado en la llamada', 'Origen: recepcionista de IA por teléfono',
    ].join('\n')

    // Tool retries must not create the same reservation twice.
    const { data: existing, error: lookupError } = await ctx.supabase.from('appointments').select('id')
      .eq('account_id', ctx.accountId).eq('starts_at', parsed.window.startsAt).eq('title', title)
      .neq('status', 'cancelled').maybeSingle()
    if (lookupError) throw lookupError
    if (existing) return ok({ saved: true, duplicate: true, appointment_id: existing.id })

    const { data: created, error } = await ctx.supabase.from('appointments').insert({
      account_id: ctx.accountId, created_by: auditUserId, assigned_agent_id: auditUserId, title,
      starts_at: parsed.window.startsAt, ends_at: parsed.window.endsAt, contact_id: contact?.id ?? null,
      status: 'confirmed', notes, timezone: 'America/Mexico_City',
    }).select('id').single()
    if (error || !created) throw error ?? new Error('Reservation insert failed')

    await ctx.supabase.from('appointment_audit_log').insert({
      account_id: ctx.accountId, appointment_id: created.id, actor_user_id: auditUserId, source: 'nexoomni', action: 'created',
      after_data: { title, starts_at: parsed.window.startsAt, ends_at: parsed.window.endsAt, status: 'confirmed', channel: 'voice_ai' },
    })
    if (contact) {
      await recordAppointmentMemoryEvent({
        accountId: ctx.accountId, contactId: contact.id, appointmentId: created.id,
        summary: `Reservación en Restaurante ${parsed.restaurant} (${zone}) para ${parsed.partySize} personas.`,
      }).catch((memoryError) => console.error('[telephony/reservations] memory error:', memoryError))
    }
    return ok({ saved: true, duplicate: false, appointment_id: created.id })
  } catch (error) { return toApiErrorResponse(error) }
}
