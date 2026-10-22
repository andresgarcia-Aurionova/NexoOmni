import { describe, expect, it } from 'vitest'
import { AssistantReportRequestSchema } from './report-types'
import {
  AssistantReportValidationError,
  resolveAssistantReportRange,
} from './build-report'

describe('assistant report request', () => {
  it('defaults to the most recent 30 UTC dates', () => {
    expect(resolveAssistantReportRange(
      undefined,
      undefined,
      new Date('2026-10-21T16:00:00.000Z')
    )).toMatchObject({
      from: '2026-09-22',
      to: '2026-10-21',
      fromTimestamp: '2026-09-22T00:00:00.000Z',
      toExclusiveTimestamp: '2026-10-22T00:00:00.000Z',
    })
  })

  it('accepts a maximum 365-day range and rejects invalid ranges', () => {
    expect(() => resolveAssistantReportRange('2025-10-22', '2026-10-21')).not.toThrow()
    expect(() => resolveAssistantReportRange('2025-10-21', '2026-10-21'))
      .toThrow(AssistantReportValidationError)
    expect(() => resolveAssistantReportRange('2026-02-30', '2026-03-01'))
      .toThrow(AssistantReportValidationError)
    expect(() => resolveAssistantReportRange('2026-10-22', '2026-10-21'))
      .toThrow(AssistantReportValidationError)
  })

  it('accepts only the declared aggregate report parameters', () => {
    expect(AssistantReportRequestSchema.safeParse({
      sections: ['conversations', 'credits'],
      from: '2026-10-01',
      to: '2026-10-21',
      channel: 'whatsapp',
    }).success).toBe(true)
    expect(AssistantReportRequestSchema.safeParse({
      sections: ['conversations'],
      account_id: 'another-account',
    }).success).toBe(false)
    expect(AssistantReportRequestSchema.safeParse({
      sections: ['conversations'],
      channel: 'unknown-channel',
    }).success).toBe(false)
  })
})
