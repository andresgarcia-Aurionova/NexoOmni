import { requireApiKey } from '@/lib/auth/api-context'
import { badRequest, forbidden, ok, toApiErrorResponse } from '@/lib/api/v1/respond'
import { getAccountEntitlements } from '@/lib/account/entitlements'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { findLiveCallerCall } from '@/lib/telephony/call-context'
import { findOrCreateReservationContact } from '@/lib/telephony/reservation-contact'
import { reservationPbxPhone } from '@/lib/telephony/reservation-phone'
import { parseReservationWhatsAppPreference, ReservationWhatsAppError } from '@/lib/telephony/reservation-whatsapp'
import { reservationAlertParams, sendReservationAlert } from '@/lib/telephony/reservation-alert'
import { recordReservationMemory } from '@/lib/telephony/reservation-memory'
import {
  ReservationError, ZONE_LABELS, cleanText, parsePartySize, parseReservationWindow, parseRestaurant, reservationMemorySummary, resolveZone,
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
        whatsapp: parseReservationWhatsAppPreference(body),
      }
    } catch (error) {
      if (error instanceof ReservationError || error instanceof ReservationWhatsAppError) throw badRequest(error.message)
      throw error
    }
    if (!parsed.name) throw badRequest('customer_name is required')

    // The caller's number comes only from the PBX, never from model-supplied text.
    const call = parsed.callId || parsed.aiExtension
      ? await findLiveCallerCall(ctx.supabase, ctx.accountId, undefined, parsed.callId ?? undefined, parsed.aiExtension ?? undefined).catch((error) => {
        console.error('[telephony/reservations] caller verification failed:', error)
        return null
      })
      : null

    const zone = ZONE_LABELS[parsed.zone]
    const title = `Reservación Restaurante ${parsed.restaurant} · ${parsed.partySize} ${parsed.partySize === 1 ? 'persona' : 'personas'} · ${parsed.name}`
    // Tool retries must not create the same reservation twice.
    const { data: existing, error: lookupError } = await ctx.supabase.from('appointments')
      .select('id,reservation_whatsapp_preference,reservation_whatsapp_phone')
      .eq('account_id', ctx.accountId).eq('starts_at', parsed.window.startsAt).eq('title', title)
      .neq('status', 'cancelled').maybeSingle()
    if (lookupError) throw lookupError
    if (existing) {
      if (parsed.whatsapp && (
        existing.reservation_whatsapp_preference !== parsed.whatsapp.kind
        || (parsed.whatsapp.kind !== 'caller' && existing.reservation_whatsapp_phone !== parsed.whatsapp.phone)
      )) throw badRequest('Reservation already exists with a different WhatsApp preference; review it before retrying')
      return ok({ saved: true, duplicate: true, appointment_id: existing.id })
    }

    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId)
    const callerPhone = call ? reservationPbxPhone(call.phone) : null
    const contact = callerPhone
      ? await findOrCreateReservationContact(ctx.supabase, ctx.accountId, auditUserId, callerPhone, parsed.name)
        .catch((error) => {
          console.error('[telephony/reservations] contact resolution failed:', error)
          return null
        })
      : null
    const notes = [
      `Restaurante: ${parsed.restaurant}`, `Zona: ${zone}`, `Personas: ${parsed.partySize}`,
      `Ocasión: ${parsed.occasion ?? 'Ninguna'}`, `Nombre: ${parsed.name}`,
      call ? `Teléfono: ${call.phone}` : 'Teléfono: no verificado en la llamada',
      parsed.whatsapp ? `WhatsApp: ${parsed.whatsapp.kind}${parsed.whatsapp.phone ? ` +${parsed.whatsapp.phone}` : ''}` : 'WhatsApp: pendiente de confirmar',
      contact ? null : 'Contacto: pendiente de revisión', 'Origen: recepcionista de IA por teléfono',
    ].filter(Boolean).join('\n')

    const { data: created, error } = await ctx.supabase.from('appointments').insert({
      account_id: ctx.accountId, created_by: auditUserId, assigned_agent_id: auditUserId, title,
      starts_at: parsed.window.startsAt, ends_at: parsed.window.endsAt, contact_id: contact?.id ?? null,
      status: 'confirmed', notes, timezone: 'America/Mexico_City', reservation_restaurant: parsed.restaurant,
      reservation_whatsapp_preference: parsed.whatsapp?.kind ?? 'unavailable',
      reservation_whatsapp_phone: parsed.whatsapp?.kind === 'caller' ? callerPhone : parsed.whatsapp?.phone ?? null,
      reservation_call_id: callerPhone ? call?.callId ?? null : null,
      reservation_call_phone: callerPhone,
    }).select('id').single()
    if (error || !created) throw error ?? new Error('Reservation insert failed')

    await ctx.supabase.from('appointment_audit_log').insert({
      account_id: ctx.accountId, appointment_id: created.id, actor_user_id: auditUserId, source: 'nexoomni', action: 'created',
      after_data: { title, starts_at: parsed.window.startsAt, ends_at: parsed.window.endsAt, status: 'confirmed', channel: 'voice_ai' },
    })
    if (contact) {
      await recordReservationMemory(ctx.supabase, {
        accountId: ctx.accountId, contactId: contact.id, appointmentId: created.id,
        summary: reservationMemorySummary({
          restaurant: parsed.restaurant, zone: parsed.zone, partySize: parsed.partySize,
          startsAt: parsed.window.startsAt, name: parsed.name, occasion: parsed.occasion,
        }),
      }).catch((memoryError) => console.error('[telephony/reservations] memory error:', memoryError))
    }
    const alertedCount = await sendReservationAlert(ctx.supabase, ctx.accountId, reservationAlertParams({
      restaurant: parsed.restaurant, startsAt: parsed.window.startsAt, name: parsed.name, partySize: parsed.partySize,
      zone, occasion: parsed.occasion, phone: callerPhone, contactUnresolved: !contact,
    }))
    return ok({ saved: true, duplicate: false, appointment_id: created.id, notified: alertedCount > 0, notified_count: alertedCount })
  } catch (error) { return toApiErrorResponse(error) }
}
