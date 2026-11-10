import { zonedDayInfo, zonedWallClockToUtc } from '@/lib/appointments/slots'
import { closurePeriodStart, type BusinessHours } from '@/lib/business-hours/schedule'

const TWELVE_HOURS = 12 * 60 * 60_000
const ONE_MINUTE = 60_000
const ONE_DAY = 86_400_000

/**
 * Returns an instant inside business hours and before the reservation, or
 * null when no such instant remains. Delivery must recheck the schedule.
 */
export function reservationReminderDueAt(schedule: BusinessHours, startsAt: Date, now: Date): string | null {
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(now.getTime())) {
    throw new Error('Invalid reservation or current date')
  }
  if (startsAt <= now) return null

  const desired = new Date(startsAt.getTime() - TWELVE_HOURS)
  const closedSince = closurePeriodStart(schedule, desired)
  const target = closedSince ? new Date(new Date(closedSince).getTime() - ONE_MINUTE) : desired
  if (target >= now) return target.toISOString()

  if (closurePeriodStart(schedule, now) === null) return now.toISOString()

  const today = zonedDayInfo(now, schedule.timezone)
  const anchor = new Date(`${today.key}T12:00:00Z`)
  const holidays = new Set(schedule.holidays)
  for (let days = 0; days <= 3660; days++) {
    const day = new Date(anchor.getTime() + days * ONE_DAY)
    const key = day.toISOString().slice(0, 10)
    const window = schedule.windows.find((item) => item.weekday === day.getUTCDay())
    if (!window || holidays.has(key)) continue
    const opening = zonedWallClockToUtc(key, window.start, schedule.timezone)
    if (opening > now) return opening < startsAt ? opening.toISOString() : null
  }
  throw new Error('No opening found in the next ten years')
}
