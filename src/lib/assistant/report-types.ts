import { z } from 'zod'

export const ASSISTANT_REPORT_SECTIONS = [
  'conversations',
  'agents',
  'sales',
  'appointments',
  'agendapro',
  'broadcasts',
  'calls',
  'intelligence',
  'memory',
  'contacts',
  'credits',
  'billing',
  'ai_usage',
] as const

export const AssistantReportSectionSchema = z.enum(ASSISTANT_REPORT_SECTIONS)
export type AssistantReportSectionKey = z.infer<typeof AssistantReportSectionSchema>

export const AssistantReportChannelSchema = z.enum([
  'whatsapp',
  'facebook',
  'instagram',
  'tiktok',
  'yeastar_live_chat',
  'yeastar_voice',
])
export type AssistantReportChannel = z.infer<typeof AssistantReportChannelSchema>

export const AssistantReportRequestSchema = z.object({
  sections: z.array(AssistantReportSectionSchema).min(1).max(ASSISTANT_REPORT_SECTIONS.length),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  channel: AssistantReportChannelSchema.optional(),
  agent_name: z.string().trim().min(2).max(100).optional(),
}).strict()
export type AssistantReportRequest = z.infer<typeof AssistantReportRequestSchema>

export const ASSISTANT_REPORT_WARNINGS = [
  'partial_data',
  'admin_required',
  'feature_unavailable',
  'channel_filter_partial',
  'agent_filter_partial',
  'agent_not_found',
  'agent_ambiguous',
  'current_snapshot',
] as const

export const AssistantReportWarningSchema = z.enum(ASSISTANT_REPORT_WARNINGS)
export type AssistantReportWarning = z.infer<typeof AssistantReportWarningSchema>

const AssistantReportCellSchema = z.union([
  z.string().max(300),
  z.number().finite(),
  z.null(),
])

export const AssistantReportDataSchema = z.object({
  version: z.literal(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  filters: z.object({
    channel: AssistantReportChannelSchema.nullable(),
    agent_selected: z.boolean(),
  }).strict(),
  warnings: z.array(AssistantReportWarningSchema).max(ASSISTANT_REPORT_WARNINGS.length),
  sections: z.array(z.object({
    key: AssistantReportSectionSchema,
    columns: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1).max(12),
    rows: z.array(z.array(AssistantReportCellSchema).max(12)).max(1000),
  }).strict()).max(ASSISTANT_REPORT_SECTIONS.length),
}).strict()
export type AssistantReportData = z.infer<typeof AssistantReportDataSchema>
