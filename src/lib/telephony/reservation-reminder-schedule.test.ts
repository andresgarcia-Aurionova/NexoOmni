import { describe, expect, it } from 'vitest'
import type { BusinessHours } from '@/lib/business-hours/schedule'
import { reservationReminderDueAt } from './reservation-reminder-schedule'

const schedule: BusinessHours = {
  timezone: 'America/Mexico_City',
  windows: [
    ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '18:00' })),
    { weekday: 6, start: '09:00', end: '14:00' },
  ],
  holidays: [],
}

describe('reservation reminder scheduling', () => {
  it('uses exactly 12 hours before when that instant is in business hours', () => {
    expect(reservationReminderDueAt(schedule, new Date('2026-11-11T04:00:00Z'), new Date('2026-11-09T15:00:00Z')))
      .toBe('2026-11-10T16:00:00.000Z')
  })

  it('moves a closed-hours target to one minute before the last closing', () => {
    expect(reservationReminderDueAt(schedule, new Date('2026-11-10T14:00:00Z'), new Date('2026-11-09T15:00:00Z')))
      .toBe('2026-11-09T23:59:00.000Z')
  })

  it('moves back across a weekend and holidays', () => {
    const withHoliday = { ...schedule, holidays: ['2026-11-09'] }
    expect(reservationReminderDueAt(withHoliday, new Date('2026-11-10T14:00:00Z'), new Date('2026-11-06T15:00:00Z')))
      .toBe('2026-11-07T19:59:00.000Z')
  })

  it('sends as soon as possible during business hours if the original time passed', () => {
    const now = new Date('2026-11-10T16:00:00Z')
    expect(reservationReminderDueAt(schedule, new Date('2026-11-10T20:00:00Z'), now)).toBe(now.toISOString())
  })

  it('waits for the next opening for late bookings created outside hours', () => {
    expect(reservationReminderDueAt(schedule, new Date('2026-11-10T20:00:00Z'), new Date('2026-11-10T08:00:00Z')))
      .toBe('2026-11-10T15:00:00.000Z')
  })

  it('skips holidays when finding the next opening', () => {
    const withHoliday = { ...schedule, holidays: ['2026-11-10'] }
    expect(reservationReminderDueAt(withHoliday, new Date('2026-11-11T20:00:00Z'), new Date('2026-11-10T20:00:00Z')))
      .toBe('2026-11-11T15:00:00.000Z')
  })

  it('uses the actual timezone offset across daylight saving changes', () => {
    const eastern = {
      timezone: 'America/New_York',
      windows: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '18:00' })),
      holidays: [],
    }
    expect(reservationReminderDueAt(eastern, new Date('2026-03-09T15:00:00Z'), new Date('2026-03-06T15:00:00Z')))
      .toBe('2026-03-07T22:59:00.000Z')
  })

  it('returns null when the next opening is not before the reservation', () => {
    expect(reservationReminderDueAt(schedule, new Date('2026-11-10T15:00:00Z'), new Date('2026-11-10T08:00:00Z')))
      .toBeNull()
    expect(reservationReminderDueAt(schedule, new Date('2026-11-10T08:00:00Z'), new Date('2026-11-10T08:00:00Z')))
      .toBeNull()
  })

  it('rejects invalid schedules and dates', () => {
    expect(() => reservationReminderDueAt({ ...schedule, windows: [] }, new Date('2026-11-10T20:00:00Z'), new Date('2026-11-10T08:00:00Z'))).toThrow()
    expect(() => reservationReminderDueAt(schedule, new Date('invalid'), new Date())).toThrow()
  })
})
