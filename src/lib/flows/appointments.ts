import type { SupabaseClient } from '@supabase/supabase-js'

import { findConflict, getAvailableSlots } from '@/lib/appointments/availability'
import { zonedDayInfo } from '@/lib/appointments/slots'
import { isCurrentOrFutureDate } from './date-input'
import { timeMinutes } from './time-input'
import { interpolateVars } from './interpolate-vars'
import type { BookAppointmentNodeConfig, OfferSlotsNodeConfig } from './types'

/**
 * Appointment steps for the flow runner.
 *
 * Kept out of `engine.ts` so the scheduling rules (which calendar, which
 * label, what happens when the slot is taken between the offer and the
 * confirmation) live next to each other instead of inside the node switch.
 */

export interface OfferedSlot {
  id: string
  title: string
  start: string
  end: string
  localDate?: string
  localTime?: string
}

/** Where the offered slots are parked while the run waits for the answer. */
export function slotsVarKey(nodeKey: string): string {
  return `__slots_${nodeKey}`
}

export function offerTokenVarKey(nodeKey: string): string {
  return `__offer_token_${nodeKey}`
}

export function offerClaimVarKey(nodeKey: string): string {
  return `__offer_claim_${nodeKey}`
}

export function offerPendingVarKey(nodeKey: string): string {
  return `__offer_pending_${nodeKey}`
}

export function offerConfirmationVarKey(nodeKey: string): string {
  return `__offer_confirmation_${nodeKey}`
}

export function matchOfferConfirmation(
  text: string,
  date: string,
  time: string,
): boolean {
  const match = /^(?:(?:confirmo|confirmar|sí|si|confirm|yes|확인)\s*[,.:]?\s*)?(\d{2}\/\d{2}\/\d{4})\s*(?:(?:a las|at)\s*)?(\d{2}:\d{2})[.!]?$/iu.exec(text.trim())
  return match?.[1] === date && match[2] === time
}

export function secureOfferCode(token: string): string {
  return token.replaceAll('-', '').slice(0, 12).toUpperCase()
}

export function matchSecureOffer(
  text: string,
  slots: OfferedSlot[],
  token: string,
): OfferedSlot | null {
  const match = /^(\d{1,2})\s+([0-9a-f]{12})$/i.exec(text.trim())
  if (!match || match[2].toUpperCase() !== secureOfferCode(token)) return null
  const index = Number(match[1]) - 1
  return slots[index] ?? null
}

function labelFor(startIso: string, endIso: string, timeZone: string): string {
  const start = new Date(startIso)
  const day = new Intl.DateTimeFormat('es-MX', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(start)
  const time = new Intl.DateTimeFormat('es-MX', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(start)
  void endIso
  return `${day} ${time}`
}

/**
 * Free slots to offer, already labelled in the account's timezone and
 * capped to what the channel can render.
 */
export async function loadOfferedSlots(
  db: SupabaseClient,
  accountId: string,
  cfg: OfferSlotsNodeConfig,
  vars: Record<string, unknown> = {},
): Promise<{ slots: OfferedSlot[]; hasSchedule: boolean; invalidPreference?: boolean }> {
  const duration = Math.min(480, Math.max(5, cfg.duration_minutes ?? 30))
  const daysAhead = Math.min(60, Math.max(1, cfg.days_ahead ?? 7))
  let from = new Date()
  let to = new Date(from.getTime() + daysAhead * 86_400_000)
  let preferenceKey: string | null = null
  let timezone: string | null = null
  let preferredTime: number | null = null

  if (cfg.ai_assist === true && !cfg.date_var_key) {
    return { slots: [], hasSchedule: true, invalidPreference: true }
  }

  if (cfg.time_var_key) {
    const preference = vars[cfg.time_var_key]
    preferredTime = typeof preference === 'string' ? timeMinutes(preference) : null
    if (!cfg.date_var_key || preferredTime === null) {
      return { slots: [], hasSchedule: true, invalidPreference: true }
    }
  }

  if (cfg.date_var_key) {
    timezone = await preferenceScheduleTimezone(db, accountId, cfg.specialist_id ?? null)
    if (!timezone) return { slots: [], hasSchedule: false }
    const preference = vars[cfg.date_var_key]
    if (typeof preference !== 'string' || !isCurrentOrFutureDate(preference, timezone)) {
      return { slots: [], hasSchedule: true, invalidPreference: true }
    }
    const [day, month, year] = preference.split('/')
    preferenceKey = `${year}-${month}-${day}`
    const midnightUtc = new Date(`${preferenceKey}T00:00:00Z`).getTime()
    // Cover every possible IANA offset, then filter by local calendar day.
    from = new Date(midnightUtc - 86_400_000)
    to = new Date(midnightUtc + 2 * 86_400_000)
  }

  const { slots, hasSchedule } = await getAvailableSlots(db, {
    accountId,
    specialistId: cfg.specialist_id ?? null,
    from,
    to,
    durationMinutes: duration,
  })

  // Meta caps a list at 10 rows; more than a handful is unreadable on any
  // channel anyway.
  const max = Math.min(10, Math.max(1, cfg.max_options ?? 6))
  timezone ??= await scheduleTimezone(db, accountId, cfg.specialist_id ?? null)
  const eligible = preferenceKey
    ? slots.filter((slot) => zonedDayInfo(new Date(slot.start), timezone).key === preferenceKey)
    : slots

  if (preferredTime !== null) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
    const target = preferredTime
    eligible.sort((a, b) => {
      const aTime = timeMinutes(formatter.format(new Date(a.start)))
      const bTime = timeMinutes(formatter.format(new Date(b.start)))
      if (aTime === null || bTime === null) throw new Error('Could not format appointment time.')
      return Math.abs(aTime - target) - Math.abs(bTime - target)
        || new Date(a.start).getTime() - new Date(b.start).getTime()
    })
  }

  return {
    hasSchedule,
    slots: eligible.slice(0, max).map((slot, index) => ({
      id: `slot_${index + 1}`,
      title: labelFor(slot.start, slot.end, timezone),
      start: slot.start,
      end: slot.end,
      localDate: new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone, day: '2-digit', month: '2-digit', year: 'numeric',
      }).format(new Date(slot.start)),
      localTime: new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).format(new Date(slot.start)),
    })),
  }
}

async function preferenceScheduleTimezone(
  db: SupabaseClient,
  accountId: string,
  specialistId: string | null,
): Promise<string | null> {
  const { data, error } = await db
    .from('appointment_schedules')
    .select('timezone, specialist_id, agent_user_id')
    .eq('account_id', accountId)
    .eq('is_active', true)
  if (error) throw error
  const rows = data ?? []
  const own = specialistId ? rows.filter((row) => row.specialist_id === specialistId) : []
  const source = own.length ? own : rows.filter((row) => !row.specialist_id && !row.agent_user_id)
  if (!source.length) return null
  const zones = new Set(source.map((row) => typeof row.timezone === 'string' ? row.timezone : ''))
  if (zones.size !== 1 || zones.has('')) throw new Error('The appointment schedule has inconsistent time zones.')
  return [...zones][0]
}

async function scheduleTimezone(
  db: SupabaseClient,
  accountId: string,
  specialistId: string | null,
): Promise<string> {
  const { data } = await db
    .from('appointment_schedules')
    .select('timezone, specialist_id')
    .eq('account_id', accountId)
    .eq('is_active', true)
  const rows = data ?? []
  const own = rows.find((row) => specialistId && row.specialist_id === specialistId)
  return (own?.timezone as string) || (rows[0]?.timezone as string) || 'UTC'
}

export type BookResult =
  | { ok: true; appointmentId: string; startsAt: string }
  | { ok: false; reason: 'no_slot' | 'conflict' | 'failed' | 'stale' }

/**
 * Book the slot the customer chose. The window between the offer and the
 * confirmation is small but real, so the conflict check happens here and
 * not only when the options were built.
 */
export async function bookFlowAppointment(
  db: SupabaseClient,
  args: {
    accountId: string
    userId: string
    contactId: string
    conversationId: string
    flowRunId?: string
    nodeKey?: string
    expectedNodeKey?: string | null
    expectedOfferToken?: string
    cfg: BookAppointmentNodeConfig
    vars: Record<string, unknown>
  },
): Promise<BookResult> {
  const startIso = String(args.vars[args.cfg.slot_var_key] ?? '')
  const start = new Date(startIso)
  if (!startIso || Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) {
    return { ok: false, reason: 'no_slot' }
  }

  const duration = Math.min(480, Math.max(5, args.cfg.duration_minutes ?? 30))
  const end = new Date(start.getTime() + duration * 60_000)
  const specialistId = args.cfg.specialist_id ?? null

  const conflictFound = await findConflict(db, args.accountId, { specialistId }, start, end)
  if (conflictFound && args.cfg.idempotent_booking !== true) {
    return { ok: false, reason: 'conflict' }
  }
  const title = args.cfg.title ? interpolateVars(args.cfg.title, args.vars).trim().slice(0, 160) || 'Cita agendada' : 'Cita agendada'
  const notes = args.cfg.notes ? interpolateVars(args.cfg.notes, args.vars).trim().slice(0, 2000) || null : null
  const timezone = args.cfg.idempotent_booking === true
    ? await preferenceScheduleTimezone(db, args.accountId, specialistId)
    : await scheduleTimezone(db, args.accountId, specialistId)

  if (args.cfg.idempotent_booking === true) {
    if (!args.flowRunId || !args.nodeKey || !args.expectedNodeKey || !args.expectedOfferToken || !timezone) {
      console.error('[flows] idempotent appointment is missing its run, offer, node or schedule')
      return { ok: false, reason: 'failed' }
    }
    const { data, error } = await db.rpc('book_flow_appointment_once', {
      p_account_id: args.accountId,
      p_run_id: args.flowRunId,
      p_node_key: args.nodeKey,
      p_starts_at: start.toISOString(),
      p_ends_at: end.toISOString(),
      p_specialist_id: specialistId,
      p_title: title,
      p_notes: notes,
      p_timezone: timezone,
      p_has_conflict: conflictFound,
      p_expected_node_key: args.expectedNodeKey,
      p_expected_offer_token: args.expectedOfferToken,
    })
    if (error) {
      console.error('[flows] idempotent appointment booking failed:', error.message)
      return { ok: false, reason: 'failed' }
    }
    const row = Array.isArray(data) ? data[0] : null
    if ((row?.result === 'booked' || row?.result === 'already_booked')
        && typeof row.appointment_id === 'string' && typeof row.starts_at === 'string') {
      return { ok: true, appointmentId: row.appointment_id, startsAt: row.starts_at }
    }
    if (row?.result === 'conflict' || row?.result === 'stale') {
      return { ok: false, reason: row.result }
    }
    console.error('[flows] idempotent appointment returned an invalid result')
    return { ok: false, reason: 'failed' }
  }

  const { data, error } = await db
    .from('appointments')
    .insert({
      account_id: args.accountId,
      created_by: args.userId,
      contact_id: args.contactId,
      source_conversation_id: args.conversationId,
      specialist_id: specialistId,
      title,
      notes,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      timezone,
    })
    .select('id, starts_at')
    .single()

  if (error) {
    // 23P01 is the exclusion constraint: somebody booked it first.
    const conflict = (error as { code?: string }).code === '23P01'
    console.error('[flows] could not book the appointment:', error.message)
    return { ok: false, reason: conflict ? 'conflict' : 'failed' }
  }

  const dueAt = new Date(new Date(data.starts_at as string).getTime() - 60 * 60_000)
  if (dueAt > new Date()) {
    const { error: reminderError } = await db.from('appointment_reminders').insert({
      account_id: args.accountId,
      appointment_id: data.id,
      due_at: dueAt.toISOString(),
    })
    if (reminderError) {
      console.error('[flows] could not schedule the appointment reminder:', reminderError.message)
    }
  }

  return { ok: true, appointmentId: data.id as string, startsAt: data.starts_at as string }
}
