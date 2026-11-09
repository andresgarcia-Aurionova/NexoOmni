import { zonedDayInfo, zonedWallClockToUtc } from '@/lib/appointments/slots'

export interface BusinessHours {
  timezone: string
  windows: { weekday: number; start: string; end: string }[]
  holidays: string[]
}

/**
 * One period of closure extends from the last actual closing until the next
 * opening, including consecutive weekends and manually configured holidays.
 */
export function closurePeriodStart(schedule: BusinessHours, now: Date): string | null {
  if (!Number.isFinite(now.getTime()) || schedule.windows.length === 0) {
    throw new Error('Invalid business-hours schedule or date')
  }
  const weekdays = new Set<number>()
  for (const window of schedule.windows) {
    if (
      !Number.isInteger(window.weekday) || window.weekday < 0 || window.weekday > 6 ||
      weekdays.has(window.weekday) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(window.start) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(window.end) ||
      window.start >= window.end
    ) throw new Error('Invalid business-hours window')
    weekdays.add(window.weekday)
  }
  for (const holiday of schedule.holidays) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday)) throw new Error('Invalid holiday')
    const date = new Date(`${holiday}T00:00:00Z`)
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== holiday) {
      throw new Error('Invalid holiday')
    }
  }
  const holidays = new Set(schedule.holidays)
  const today = zonedDayInfo(now, schedule.timezone)
  const todayWindow = schedule.windows.find((w) => w.weekday === today.weekday)
  if (todayWindow && !holidays.has(today.key)) {
    const start = zonedWallClockToUtc(today.key, todayWindow.start, schedule.timezone)
    const end = zonedWallClockToUtc(today.key, todayWindow.end, schedule.timezone)
    if (now >= start && now < end) return null
    if (now >= end) return end.toISOString()
  }

  const anchor = new Date(`${today.key}T12:00:00Z`)
  for (let days = 1; days <= 3660; days++) {
    const day = new Date(anchor.getTime() - days * 86_400_000)
    const key = day.toISOString().slice(0, 10)
    const weekday = day.getUTCDay()
    const window = schedule.windows.find((w) => w.weekday === weekday)
    if (window && !holidays.has(key)) {
      return zonedWallClockToUtc(key, window.end, schedule.timezone).toISOString()
    }
  }
  throw new Error('No opening found in the last ten years')
}
