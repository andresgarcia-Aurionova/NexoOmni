import { z } from 'zod'

const ContactId = z.string().uuid()
const DateTime = z.string().datetime({ offset: true })
const TimeZone = z.string().trim().min(1).max(80).refine((timeZone) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch (error) {
    if (error instanceof RangeError) return false
    throw error
  }
})

export const AssistantActionPayloadSchema = z.union([
  z.object({
    action_type: z.literal('create_follow_up_task'),
    contact_id: ContactId,
    description: z.string().trim().min(1).max(300),
    due_at: DateTime,
  }).strict(),
  z.object({
    action_type: z.literal('schedule_appointment'),
    contact_id: ContactId,
    title: z.string().trim().min(1).max(160),
    notes: z.string().trim().max(2000).nullable().optional(),
    starts_at: DateTime,
    ends_at: DateTime,
    timezone: TimeZone,
  }).strict().refine((value) => {
    const duration = Date.parse(value.ends_at) - Date.parse(value.starts_at)
    return duration >= 15 * 60_000 && duration <= 8 * 60 * 60_000
  }),
  z.object({
    action_type: z.literal('update_contact'),
    contact_id: ContactId,
    changes: z.object({
      name: z.string().trim().max(200).nullable().optional(),
      email: z.union([z.string().trim().email().max(320), z.null()]).optional(),
      company: z.string().trim().max(200).nullable().optional(),
    }).strict().refine((changes) => Object.keys(changes).length > 0),
  }).strict(),
  z.object({
    action_type: z.literal('send_whatsapp_text'),
    contact_id: ContactId,
    message_text: z.string().trim().min(1).max(4096),
  }).strict(),
])

export type AssistantActionPayload = z.infer<typeof AssistantActionPayloadSchema>

export const AssistantActionProposalSchema = z.object({
  action: AssistantActionPayloadSchema,
  contact: z.object({
    name: z.string().nullable(),
    phone: z.string().nullable(),
  }).strict(),
}).strict()

export type AssistantActionProposal = z.infer<typeof AssistantActionProposalSchema>

export interface AssistantActionRequest {
  id: string
  action_type: AssistantActionPayload['action_type']
  payload: AssistantActionProposal
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled' | 'expired' | 'needs_review'
  expires_at: string
  result: Record<string, unknown> | null
}
