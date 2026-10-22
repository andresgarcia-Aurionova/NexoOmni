import { describe, expect, it } from 'vitest'
import { swapDayMonth } from './transcription-date-repair'

describe('swapDayMonth', () => {
  const now = Date.parse('2026-10-22T20:00:00.000Z')

  it('turns a future 10 Dec call back into 12 Oct', () => {
    expect(swapDayMonth('2026-12-10T19:10:00.000Z', now)?.toISOString()).toBe('2026-10-12T19:10:00.000Z')
  })
  it('leaves past dates and unswappable dates alone', () => {
    expect(swapDayMonth('2026-10-22T19:44:00.000Z', now)).toBeNull()
    expect(swapDayMonth('2026-12-25T19:10:00.000Z', now)).toBeNull()
  })
})
