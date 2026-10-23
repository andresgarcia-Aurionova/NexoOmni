import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { AccountEntitlements } from '@/lib/account/entitlements'
import type { AccountRole } from '@/lib/auth/roles'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import type { AiConfig } from '@/lib/ai/types'
import { searchPlatformManuals, type AssistantSource } from './manual-search'
import { buildAssistantReport, summarizeAssistantReport } from './build-report'
import {
  AssistantReportRequestSchema,
  type AssistantReportData,
} from './report-types'
import {
  AssistantActionPayloadSchema,
  type AssistantActionProposal,
  type AssistantActionPayload,
} from './action-types'

const AssistantToolCallSchema = z.discriminatedUnion('name', [
  AssistantReportRequestSchema.extend({
    name: z.literal('generate_custom_report'),
  }).strict(),
  z.object({
    name: z.literal('search_platform_manuals'),
    query: z.string().trim().min(2).max(160),
  }).strict(),
  z.object({ name: z.literal('get_account_overview') }).strict(),
  z.object({ name: z.literal('get_credit_balance') }).strict(),
  z.object({
    name: z.literal('search_contacts'),
    query: z.string().trim().min(2).max(100),
  }).strict(),
  z.object({ name: z.literal('get_sales_summary') }).strict(),
  z.object({
    name: z.literal('get_upcoming_appointments'),
    days: z.number().int().min(1).max(30),
  }).strict(),
  z.object({ name: z.literal('get_recent_broadcasts') }).strict(),
  z.object({
    name: z.literal('get_recent_call_transcriptions'),
    limit: z.number().int().min(1).max(5),
  }).strict(),
  z.object({ name: z.literal('get_agent_workload') }).strict(),
  z.object({
    name: z.literal('search_tenant_knowledge'),
    query: z.string().trim().min(2).max(160),
  }).strict(),
  z.object({
    name: z.literal('create_follow_up_task'),
    contact_id: z.string().uuid(),
    description: z.string().trim().min(1).max(300),
    due_at: z.string().datetime({ offset: true }),
  }).strict(),
  z.object({
    name: z.literal('schedule_appointment'),
    contact_id: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    notes: z.string().trim().max(2000).nullable().optional(),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    timezone: z.string().trim().min(1).max(80),
  }).strict(),
  z.object({
    name: z.literal('update_contact'),
    contact_id: z.string().uuid(),
    changes: z.object({
      name: z.string().trim().max(200).nullable().optional(),
      email: z.union([z.string().trim().email().max(320), z.null()]).optional(),
      company: z.string().trim().max(200).nullable().optional(),
    }).strict().refine((changes) => Object.keys(changes).length > 0),
  }).strict(),
  z.object({
    name: z.literal('send_whatsapp_text'),
    contact_id: z.string().uuid(),
    message_text: z.string().trim().min(1).max(4096),
  }).strict(),
])

export const AssistantDecisionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('answer'),
    answer: z.string().trim().min(1).max(12000),
  }).strict(),
  z.object({
    type: z.literal('tool_call'),
    tool: AssistantToolCallSchema,
  }).strict(),
])

export type AssistantToolCall = z.infer<typeof AssistantToolCallSchema>
export type AssistantDecision = z.infer<typeof AssistantDecisionSchema>

export interface AssistantToolResult {
  data: Record<string, unknown>
  sources: AssistantSource[]
  reportData?: AssistantReportData
  actionProposal?: AssistantActionProposal
}

export class InvalidAssistantDecisionError extends Error {
  constructor() {
    super('Assistant returned an invalid tool decision.')
    this.name = 'InvalidAssistantDecisionError'
  }
}

export function parseAssistantDecision(text: string): AssistantDecision {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new InvalidAssistantDecisionError()
  }

  const parsed = AssistantDecisionSchema.safeParse(value)
  if (!parsed.success) throw new InvalidAssistantDecisionError()
  return parsed.data
}

function dataSource(title: string, href: string): AssistantSource[] {
  return [{ kind: 'account_data', title, href }]
}

function throwQueryError(name: string, error: { message: string }): never {
  console.error(`[assistant tools] ${name} query failed:`, error)
  throw new Error('Assistant account data is unavailable.')
}

function sanitizeContactSearch(value: string): string {
  return value
    .replace(/[^\p{L}\p{N} +@.\-_]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

export async function runAssistantTool(args: {
  db: SupabaseClient
  accountId: string
  role: AccountRole
  config: Pick<AiConfig, 'embeddingsApiKey'>
  features: Pick<AccountEntitlements['features'], 'social_messaging' | 'yeastar_telephony' | 'ai_conversation_intelligence'>
  tool: AssistantToolCall
}): Promise<AssistantToolResult> {
  const { db, accountId, role, config, features, tool } = args

  switch (tool.name) {
    case 'create_follow_up_task':
    case 'schedule_appointment':
    case 'update_contact':
    case 'send_whatsapp_text': {
      const { name, ...actionFields } = tool
      const action = AssistantActionPayloadSchema.parse({
        action_type: name,
        ...actionFields,
      })
      const { data: contact, error: contactError } = await db.from('contacts')
        .select('id, name, phone, email, company')
        .eq('id', action.contact_id).eq('account_id', accountId)
        .is('deleted_at', null).maybeSingle()
      if (contactError) throwQueryError('assistant action contact', contactError)
      if (!contact) throw new Error('The selected contact is unavailable.')

      if (action.action_type === 'create_follow_up_task' && Date.parse(action.due_at) <= Date.now()) {
        throw new Error('The follow-up time must be in the future.')
      }
      if (action.action_type === 'schedule_appointment') {
        const duration = Date.parse(action.ends_at) - Date.parse(action.starts_at)
        if (Date.parse(action.starts_at) <= Date.now() || duration < 15 * 60_000 || duration > 8 * 60 * 60_000) {
          throw new Error('The appointment time is invalid.')
        }
        const { data: account, error } = await db.from('accounts').select('enabled_modules').eq('id', accountId).single()
        if (error) throwQueryError('appointment module', error)
        if (!Array.isArray(account.enabled_modules) || !account.enabled_modules.includes('appointments')) {
          throw new Error('The appointments module is not enabled for this account.')
        }
      }
      if (action.action_type === 'send_whatsapp_text') {
        const { data: conversation, error } = await db.from('conversations')
          .select('id, channel_type').eq('account_id', accountId)
          .eq('contact_id', action.contact_id).maybeSingle()
        if (error) throwQueryError('assistant action conversation', error)
        if (!conversation || conversation.channel_type !== 'whatsapp') {
          throw new Error('A native WhatsApp conversation for this contact is required.')
        }
      }
      const actionProposal: AssistantActionProposal = {
        action,
        contact: { name: contact.name, phone: contact.phone },
      }
      return {
        data: {
          action_type: action.action_type,
          contact: { name: contact.name, phone: contact.phone, email: contact.email, company: contact.company },
          details: action,
        },
        actionProposal,
        sources: dataSource('Acciones de la cuenta', '/contacts'),
      }
    }
    case 'generate_custom_report': {
      const reportData = await buildAssistantReport({
        db,
        accountId,
        role,
        features,
        request: tool,
      })
      return {
        data: { report: summarizeAssistantReport(reportData) },
        reportData,
        sources: dataSource('Reportes agregados de la cuenta', '/reports'),
      }
    }
    case 'search_platform_manuals': {
      const result = await searchPlatformManuals(tool.query)
      return {
        data: { excerpts: result.excerpts },
        sources: result.sources,
      }
    }
    case 'search_tenant_knowledge': {
      const excerpts = await retrieveKnowledge(
        db,
        accountId,
        config,
        tool.query,
        4
      )
      return {
        data: { excerpts },
        sources: excerpts.length > 0
          ? dataSource('Base de conocimiento de la cuenta', '/settings')
          : [],
      }
    }
    case 'get_account_overview': {
      const [contacts, deals, appointments] = await Promise.all([
          db.from('contacts').select('id', { count: 'exact', head: true })
            .eq('account_id', accountId).is('deleted_at', null),
          db.from('deals').select('id', { count: 'exact', head: true })
            .eq('account_id', accountId),
          db.from('appointments').select('id', { count: 'exact', head: true })
            .eq('account_id', accountId),
        ])
      const results = [['contacts', contacts], ['deals', deals], ['appointments', appointments]] as const
      for (const [name, result] of results) {
        if (result.error) throwQueryError(name, result.error)
      }

      const overview: Record<string, unknown> = {
        contacts: contacts.count ?? 0,
        deals: deals.count ?? 0,
        appointments: appointments.count ?? 0,
      }
      if (features.social_messaging) {
        const [conversations, broadcasts] = await Promise.all([
          db.from('conversations').select('id', { count: 'exact', head: true })
            .eq('account_id', accountId),
          db.from('broadcasts').select('id', { count: 'exact', head: true })
            .eq('account_id', accountId),
        ])
        if (conversations.error) throwQueryError('conversations', conversations.error)
        if (broadcasts.error) throwQueryError('broadcasts', broadcasts.error)
        overview.conversations = conversations.count ?? 0
        overview.broadcasts = broadcasts.count ?? 0
      }
      if (features.yeastar_telephony) {
        const { count, error } = await db
          .from('yeastar_call_transcriptions')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId)
        if (error) throwQueryError('call transcriptions', error)
        overview.yeastar_call_transcriptions = count ?? 0
      }

      return {
        data: overview,
        sources: dataSource('Resumen de la cuenta', '/dashboard'),
      }
    }
    case 'get_credit_balance': {
      const { data, error } = await db
        .from('ai_credit_wallets')
        .select('available_credits,updated_at')
        .eq('account_id', accountId)
        .maybeSingle()
      if (error) throwQueryError('credits', error)
      if (!data) throw new Error('AI credit wallet is missing for the account.')
      return {
        data: {
          available_credits: String(data.available_credits),
          updated_at: data.updated_at,
        },
        sources: dataSource('Créditos de IA', '/credits'),
      }
    }
    case 'search_contacts': {
      const query = sanitizeContactSearch(tool.query)
      if (query.length < 2) {
        return { data: { contacts: [] }, sources: dataSource('Contactos', '/contacts') }
      }
      const { data, error } = await db
        .from('contacts')
        .select('id,name,phone,company')
        .eq('account_id', accountId)
        .is('deleted_at', null)
        .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
        .order('name', { ascending: true })
        .limit(10)
      if (error) throwQueryError('contacts', error)
      return {
        data: { contacts: data ?? [] },
        sources: dataSource('Contactos', '/contacts'),
      }
    }
    case 'get_sales_summary': {
      const { data, error, count } = await db
        .from('deals')
        .select('id,title,status,value,currency,expected_close_date,created_at', { count: 'exact' })
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throwQueryError('sales', error)
      return {
        data: { total_deals: count ?? 0, recent_deals: data ?? [], sample_limit: 20 },
        sources: dataSource('Pipelines y oportunidades', '/pipelines'),
      }
    }
    case 'get_upcoming_appointments': {
      const now = new Date()
      const end = new Date(now.getTime() + tool.days * 24 * 60 * 60 * 1000)
      const { data, error } = await db
        .from('appointments')
        .select('id,title,starts_at,ends_at,status,contact:contacts(name)')
        .eq('account_id', accountId)
        .gte('starts_at', now.toISOString())
        .lte('starts_at', end.toISOString())
        .neq('status', 'cancelled')
        .order('starts_at', { ascending: true })
        .limit(10)
      if (error) throwQueryError('appointments', error)
      return {
        data: { days: tool.days, appointments: data ?? [] },
        sources: dataSource('Agenda de citas', '/appointments'),
      }
    }
    case 'get_recent_broadcasts': {
      if (!features.social_messaging) {
        return { data: { available: false }, sources: [] }
      }
      const { data, error } = await db
        .from('broadcasts')
        .select('id,name,status,total_recipients,sent_count,delivered_count,read_count,replied_count,failed_count,created_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) throwQueryError('broadcasts', error)
      return {
        data: { broadcasts: data ?? [] },
        sources: dataSource('Difusiones', '/broadcasts'),
      }
    }
    case 'get_recent_call_transcriptions': {
      if (!features.yeastar_telephony) {
        return { data: { available: false }, sources: [] }
      }
      const { data, error } = await db
        .from('yeastar_call_transcriptions')
        .select('id,direction,started_at,duration_seconds,transcription_status,summary,agent_extension')
        .eq('account_id', accountId)
        .order('started_at', { ascending: false, nullsFirst: false })
        .limit(tool.limit)
      if (error) throwQueryError('call transcriptions', error)
      return {
        data: { calls: data ?? [], source: 'Yeastar call transcriptions' },
        sources: dataSource('Transcripciones Yeastar', '/call-transcriptions'),
      }
    }
    case 'get_agent_workload': {
      if (!features.social_messaging) {
        return { data: { available: false }, sources: [] }
      }
      const [profiles, conversations] = await Promise.all([
        db.from('profiles').select('user_id,full_name,account_role')
          .eq('account_id', accountId)
          .order('full_name', { ascending: true })
          .limit(100),
        db.from('conversations').select('assigned_agent_id,status', { count: 'exact' })
          .eq('account_id', accountId)
          .not('assigned_agent_id', 'is', null)
          .limit(500),
      ])
      if (profiles.error) throwQueryError('team members', profiles.error)
      if (conversations.error) throwQueryError('agent workload', conversations.error)

      const counts = new Map<string, { open: number; pending: number; closed: number }>()
      for (const row of conversations.data ?? []) {
        if (!row.assigned_agent_id) continue
        const count = counts.get(row.assigned_agent_id) ?? { open: 0, pending: 0, closed: 0 }
        if (row.status === 'open') count.open += 1
        else if (row.status === 'pending') count.pending += 1
        else if (row.status === 'closed') count.closed += 1
        counts.set(row.assigned_agent_id, count)
      }

      return {
        data: {
          assigned_conversations_sample: conversations.data?.length ?? 0,
          assigned_conversations_total: conversations.count ?? 0,
          workload: (profiles.data ?? []).map((profile) => ({
            name: profile.full_name ?? 'Sin nombre',
            role: profile.account_role,
            ...(counts.get(profile.user_id) ?? { open: 0, pending: 0, closed: 0 }),
          })),
          sample_limit: 500,
        },
        sources: dataSource('Supervisión', '/supervision'),
      }
    }
  }
}
