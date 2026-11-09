import { describe, expect, it } from 'vitest'
import { closurePeriodStart, type BusinessHours } from './schedule'

const schedule: BusinessHours = {
  timezone: 'America/Mexico_City',
  windows: [
    ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '18:00' })),
    { weekday: 6, start: '09:00', end: '14:00' },
  ],
  holidays: [],
}

describe('closurePeriodStart', () => {
  it('uses Mexico City time independently of the server timezone', () => {
    expect(closurePeriodStart(schedule, new Date('2026-11-09T06:01:00Z'))).toBe('2026-11-07T20:00:00.000Z')
    expect(closurePeriodStart(schedule, new Date('2026-11-09T15:00:00Z'))).toBeNull()
    expect(closurePeriodStart(schedule, new Date('2026-11-10T00:00:00Z'))).toBe('2026-11-10T00:00:00.000Z')
  })

  it('handles Saturday closing, Sunday, and the next Monday opening', () => {
    expect(closurePeriodStart(schedule, new Date('2026-11-07T15:00:00Z'))).toBeNull()
    expect(closurePeriodStart(schedule, new Date('2026-11-07T20:00:00Z'))).toBe('2026-11-07T20:00:00.000Z')
    expect(closurePeriodStart(schedule, new Date('2026-11-08T19:00:00Z'))).toBe('2026-11-07T20:00:00.000Z')
    expect(closurePeriodStart(schedule, new Date('2026-11-09T14:59:59Z'))).toBe('2026-11-07T20:00:00.000Z')
  })

  it('extends the same closure over consecutive manually registered holidays', () => {
    const holidays = { ...schedule, holidays: ['2026-11-09', '2026-11-10'] }
    expect(closurePeriodStart(holidays, new Date('2026-11-10T20:00:00Z'))).toBe('2026-11-07T20:00:00.000Z')
    expect(closurePeriodStart(holidays, new Date('2026-11-11T15:00:00Z'))).toBeNull()
  })

  it('rejects invalid schedules, holidays and timezones', () => {
    expect(() => closurePeriodStart({ ...schedule, windows: [] }, new Date())).toThrow()
    expect(() => closurePeriodStart({ ...schedule, holidays: ['2026-02-30'] }, new Date())).toThrow()
    expect(() => closurePeriodStart({ ...schedule, timezone: 'invalid' }, new Date())).toThrow()
  })
})
