import { describe, expect, it } from 'vitest'
import { AssistantActionPayloadSchema } from './action-types'

describe('assistant action payload validation', () => {
  it('accepts only a constrained contact update', () => {
    expect(AssistantActionPayloadSchema.safeParse({
      action_type: 'update_contact',
      contact_id: '4f6f90a3-9e73-4c59-b0b5-15ee4f7bc17e',
      changes: { company: 'Aurionova' },
    }).success).toBe(true)
  })

  it('rejects attempts to change protected fields or scope', () => {
    expect(AssistantActionPayloadSchema.safeParse({
      action_type: 'update_contact',
      contact_id: '4f6f90a3-9e73-4c59-b0b5-15ee4f7bc17e',
      account_id: 'other-tenant',
      changes: { phone: '+525500000000' },
    }).success).toBe(false)
  })

  it('rejects malformed, expired-in-past, or oversized action parameters', () => {
    expect(AssistantActionPayloadSchema.safeParse({
      action_type: 'create_follow_up_task',
      contact_id: 'not-a-uuid',
      description: 'Follow up',
      due_at: 'next week',
    }).success).toBe(false)
    expect(AssistantActionPayloadSchema.safeParse({
      action_type: 'send_whatsapp_text',
      contact_id: '4f6f90a3-9e73-4c59-b0b5-15ee4f7bc17e',
      message_text: 'x'.repeat(4097),
    }).success).toBe(false)
  })

  it('rejects invalid appointment time zones', () => {
    expect(AssistantActionPayloadSchema.safeParse({
      action_type: 'schedule_appointment',
      contact_id: '4f6f90a3-9e73-4c59-b0b5-15ee4f7bc17e',
      title: 'Demo',
      starts_at: '2026-10-23T15:00:00-06:00',
      ends_at: '2026-10-23T15:30:00-06:00',
      timezone: 'Not/A_Time_Zone',
    }).success).toBe(false)
  })
})
