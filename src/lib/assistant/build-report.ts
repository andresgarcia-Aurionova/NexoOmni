import type { SupabaseClient } from '@supabase/supabase-js'
import { hasMinRole, type AccountRole } from '@/lib/auth/roles'
import type { AccountEntitlements } from '@/lib/account/entitlements'
import {
  AssistantReportDataSchema,
  type AssistantReportData,
  type AssistantReportRequest,
  type AssistantReportSectionKey,
  type AssistantReportChannel,
} from './report-types'

const MAX_SOURCE_ROWS = 5000
const MAX_REPORT_ROWS = 1000
const DAY_MS = 24 * 60 * 60 * 1000

type ReportSection = AssistantReportData['sections'][number]
type ReportCell = string | number | null

type ReportRow = {
  status?: string | null
  channel_type?: string | null
  assigned_agent_id?: string | null
  source_channel?: string | null
  value?: string | number | null
  currency?: string | null
  starts_at?: string | null
  status_id?: number | null
  total_recipients?: number | null
  sent_count?: number | null
  delivered_count?: number | null
  read_count?: number | null
  replied_count?: number | null
  failed_count?: number | null
  direction?: string | null
  agent_user_id?: string | null
  duration_seconds?: number | null
  transcription_status?: string | null
  sentiment?: string | null
  sentiment_score?: number | null
  qa_score?: number | null
  risk_level?: string | null
  opportunity_score?: number | null
  created_at?: string | null
  mode?: string | null
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
  package_id?: string | null
  credits?: number | string | null
  package_base_mxn_centavos?: number | string | null
  processing_cost_included_mxn_centavos?: number | string | null
  vat_mxn_centavos?: number | string | null
  amount_total_mxn_centavos?: number | string | null
  paid_at?: string | null
  entry_type?: string | null
  operation_count?: string | null
  credits_delta?: string | null
  activity?: string | null
  available_credits?: number | string | null
}

type QueryRows<T> = {
  data: T[] | null
  error: { message: string } | null
  count: number | null
}

export class AssistantReportValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssistantReportValidationError'
  }
}

export function resolveAssistantReportRange(
  from: string | undefined,
  to: string | undefined,
  now = new Date()
) {
  const end = to ?? now.toISOString().slice(0, 10)
  if (!isValidDateKey(end)) {
    throw new AssistantReportValidationError('The report end date is invalid.')
  }

  const endDate = new Date(`${end}T00:00:00.000Z`)
  const start = from ?? new Date(endDate.getTime() - 29 * DAY_MS).toISOString().slice(0, 10)
  if (!isValidDateKey(start)) {
    throw new AssistantReportValidationError('The report start date is invalid.')
  }
  const startDate = new Date(`${start}T00:00:00.000Z`)
  const days = Math.floor((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1
  if (days < 1 || days > 365) {
    throw new AssistantReportValidationError('The report range must be between 1 and 365 days.')
  }

  return {
    from: start,
    to: end,
    fromTimestamp: startDate.toISOString(),
    toExclusiveTimestamp: new Date(endDate.getTime() + DAY_MS).toISOString(),
  }
}

function isValidDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function throwQueryError(name: string, error: { message: string }): never {
  console.error(`[assistant reports] ${name} query failed:`, error)
  throw new Error('Assistant report data is unavailable.')
}

async function readRows<T>(
  name: string,
  query: PromiseLike<QueryRows<T>>,
  warnings: Set<AssistantReportData['warnings'][number]>
) {
  const { data, error, count } = await query
  if (error) throwQueryError(name, error)
  const rows = data ?? []
  if ((count !== null && count > MAX_SOURCE_ROWS) || rows.length > MAX_SOURCE_ROWS) {
    warnings.add('partial_data')
  }
  return rows.slice(0, MAX_SOURCE_ROWS)
}

function safeBucket(value: unknown) {
  if (value === null || value === undefined || value === '') return 'unknown'
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(value)) return 'other'
  return value
}

function safeCount(value: unknown) {
  const count = Number(value ?? 0)
  return Number.isSafeInteger(count) && count >= 0 ? count : 0
}

function average(values: Array<number | null | undefined>) {
  const present = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (present.length === 0) return null
  return Math.round(present.reduce((sum, value) => sum + value, 0) / present.length * 100) / 100
}

function decimalToMinor(value: string | number | null | undefined) {
  const text = String(value ?? '0')
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) throw new Error('Invalid decimal value in report data.')
  const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) throw new Error('Report amount exceeds the supported range.')
  return match[1] === '-' ? -cents : cents
}

function integerUnits(value: string | number | null | undefined) {
  const text = String(value ?? '0')
  if (!/^-?\d+$/.test(text)) throw new Error('Invalid integer value in report data.')
  const amount = Number(text)
  if (!Number.isSafeInteger(amount)) throw new Error('Report amount exceeds the supported range.')
  return amount
}

function formatMinorUnits(value: number) {
  if (!Number.isSafeInteger(value)) throw new Error('Report amount exceeds the supported range.')
  const sign = value < 0 ? '-' : ''
  const absolute = Math.abs(value)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

function monthKey(value: string | null | undefined) {
  if (!value) return 'unknown'
  return value.slice(0, 7)
}

function section(
  key: AssistantReportSectionKey,
  columns: string[],
  rows: ReportCell[][]
): ReportSection {
  return { key, columns, rows }
}

const AGENT_FILTERABLE_SECTIONS = new Set<AssistantReportSectionKey>([
  'conversations',
  'agents',
  'appointments',
  'calls',
])
const CHANNEL_FILTERABLE_SECTIONS = new Set<AssistantReportSectionKey>([
  'conversations',
  'sales',
  'calls',
])

export async function buildAssistantReport(args: {
  db: SupabaseClient
  accountId: string
  role: AccountRole
  features: Pick<AccountEntitlements['features'], 'social_messaging' | 'yeastar_telephony' | 'ai_conversation_intelligence'>
  request: AssistantReportRequest
}): Promise<AssistantReportData> {
  const { db, accountId, role, features, request } = args
  const range = resolveAssistantReportRange(request.from, request.to)
  const warnings = new Set<AssistantReportData['warnings'][number]>()

  if (request.channel && request.sections.some((key) => !CHANNEL_FILTERABLE_SECTIONS.has(key))) {
    warnings.add('channel_filter_partial')
  }
  if (request.agent_name && request.sections.some((key) => !AGENT_FILTERABLE_SECTIONS.has(key))) {
    warnings.add('agent_filter_partial')
  }

  let agentId: string | null = null
  let agentFilterInvalid = false
  const needsAgentLabels = request.sections.some((key) => AGENT_FILTERABLE_SECTIONS.has(key))
  const profileRows: Array<{ user_id: string; full_name: string | null }> = []
  let agentLabels = new Map<string, string>()
  if (needsAgentLabels) {
    const { data, error, count } = await db
      .from('profiles')
      .select('user_id,full_name')
      .eq('account_id', accountId)
      .order('user_id', { ascending: true })
      .limit(501)
    if (error) throwQueryError('profiles', error)
    profileRows.push(...(data ?? []))
    agentLabels = new Map(profileRows.map((profile, index) => [profile.user_id, `agent_${index + 1}`]))
    const profilesArePartial = (count ?? profileRows.length) > 500
    if (profilesArePartial) {
      warnings.add('partial_data')
      if (request.agent_name) {
        warnings.add('agent_ambiguous')
        agentFilterInvalid = true
      }
    }
  }
  if (request.agent_name && needsAgentLabels && !agentFilterInvalid) {
    const normalizedName = request.agent_name.normalize('NFKC').trim().toLocaleLowerCase()
    const matches = profileRows.filter((profile) =>
      typeof profile.full_name === 'string' &&
      profile.full_name.normalize('NFKC').trim().toLocaleLowerCase() === normalizedName
    )
    if (matches.length === 0) {
      warnings.add('agent_not_found')
      agentFilterInvalid = true
    } else if (matches.length > 1) {
      warnings.add('agent_ambiguous')
      agentFilterInvalid = true
    } else {
      agentId = matches[0].user_id
    }
  }

  const sourceRows = async <T extends ReportRow>(
    name: string,
    query: PromiseLike<QueryRows<T>>
  ) => readRows(name, query, warnings)

  const reportSections = await Promise.all(request.sections.map(async (key): Promise<ReportSection> => {
    switch (key) {
      case 'conversations':
      case 'agents': {
        if (!features.social_messaging) {
          warnings.add('feature_unavailable')
          return section(key, key === 'agents'
            ? ['agent', 'status', 'conversations']
            : ['channel', 'status', 'agent', 'conversations'], [])
        }
        if (agentFilterInvalid) {
          return section(key, key === 'agents'
            ? ['agent', 'status', 'conversations']
            : ['channel', 'status', 'agent', 'conversations'], [])
        }
        let query = db.from('conversations')
          .select('status,channel_type,assigned_agent_id')
          .eq('account_id', accountId)
          .gte('created_at', range.fromTimestamp)
          .lt('created_at', range.toExclusiveTimestamp)
        if (request.channel && request.channel !== 'yeastar_voice') {
          query = query.eq('channel_type', request.channel)
        } else if (request.channel === 'yeastar_voice') {
          return section(key, key === 'agents'
            ? ['agent', 'status', 'conversations']
            : ['channel', 'status', 'agent', 'conversations'], [])
        }
        if (agentId) query = query.eq('assigned_agent_id', agentId)
        const rows = await sourceRows('conversations', query.limit(MAX_SOURCE_ROWS + 1))
        const counts = new Map<string, { channel: string; status: string; agent: string; count: number }>()
        for (const row of rows) {
          const channel = safeBucket(row.channel_type)
          const status = safeBucket(row.status)
          const agent = row.assigned_agent_id ? agentLabels.get(row.assigned_agent_id) ?? 'assigned' : 'unassigned'
          const groupKey = key === 'agents' ? `${agent}|${status}` : `${channel}|${status}|${agent}`
          const current = counts.get(groupKey) ?? { channel, status, agent, count: 0 }
          current.count += 1
          counts.set(groupKey, current)
        }
        const grouped = [...counts.values()].sort((a, b) =>
          key === 'agents' ? a.agent.localeCompare(b.agent) : a.channel.localeCompare(b.channel)
        )
        return key === 'agents'
          ? section(key, ['agent', 'status', 'conversations'], grouped.map((row) => [row.agent, row.status, row.count]))
          : section(key, ['channel', 'status', 'agent', 'conversations'], grouped.map((row) => [row.channel, row.status, row.agent, row.count]))
      }
      case 'sales': {
        const columns = ['status', 'channel', 'currency', 'deals', 'value']
        let query = db.from('deals')
          .select('status,value,currency,source_channel')
          .eq('account_id', accountId)
          .gte('created_at', range.fromTimestamp)
          .lt('created_at', range.toExclusiveTimestamp)
        if (request.channel) query = query.eq('source_channel', request.channel)
        const rows = await sourceRows('deals', query.limit(MAX_SOURCE_ROWS + 1))
        const grouped = new Map<string, { status: string; channel: string; currency: string; deals: number; value: number }>()
        for (const row of rows) {
          const status = safeBucket(row.status)
          const channel = safeBucket(row.source_channel)
          const currency = ['MXN', 'USD', 'CAD', 'EUR'].includes(String(row.currency).toUpperCase())
            ? String(row.currency).toUpperCase()
            : 'other'
          const groupKey = `${status}|${channel}|${currency}`
          const current = grouped.get(groupKey) ?? { status, channel, currency, deals: 0, value: 0 }
          current.deals += 1
          current.value += decimalToMinor(row.value)
          if (!Number.isSafeInteger(current.value)) throw new Error('Report amount exceeds the supported range.')
          grouped.set(groupKey, current)
        }
        return section(key, columns, [...grouped.values()].map((row) => [
          row.status, row.channel, row.currency, row.deals, formatMinorUnits(row.value),
        ]))
      }
      case 'appointments': {
        const columns = ['status', 'agent', 'appointments']
        if (agentFilterInvalid) return section(key, columns, [])
        let query = db.from('appointments')
          .select('status,assigned_agent_id')
          .eq('account_id', accountId)
          .gte('starts_at', range.fromTimestamp)
          .lt('starts_at', range.toExclusiveTimestamp)
        if (agentId) query = query.eq('assigned_agent_id', agentId)
        const rows = await sourceRows('appointments', query.limit(MAX_SOURCE_ROWS + 1))
        const counts = new Map<string, { status: string; agent: string; count: number }>()
        for (const row of rows) {
          const status = safeBucket(row.status)
          const agent = row.assigned_agent_id ? agentLabels.get(row.assigned_agent_id) ?? 'assigned' : 'unassigned'
          const groupKey = `${status}|${agent}`
          const current = counts.get(groupKey) ?? { status, agent, count: 0 }
          current.count += 1
          counts.set(groupKey, current)
        }
        return section(key, columns, [...counts.values()].map((row) => [row.status, row.agent, row.count]))
      }
      case 'agendapro': {
        const rows = await sourceRows('AgendaPro bookings', db.from('agendapro_bookings')
          .select('status_id')
          .eq('account_id', accountId)
          .gte('start_time', range.fromTimestamp)
          .lt('start_time', range.toExclusiveTimestamp)
          .limit(MAX_SOURCE_ROWS + 1))
        const counts = new Map<string, number>()
        for (const row of rows) {
          const status = row.status_id === null || row.status_id === undefined ? 'unknown' : String(row.status_id)
          counts.set(status, (counts.get(status) ?? 0) + 1)
        }
        return section(key, ['status_id', 'bookings'], [...counts].map(([status, count]) => [status, count]))
      }
      case 'broadcasts': {
        if (!features.social_messaging) {
          warnings.add('feature_unavailable')
          return section(key, ['status', 'broadcasts', 'recipients', 'sent', 'delivered', 'read', 'replied', 'failed'], [])
        }
        const rows = await sourceRows('broadcasts', db.from('broadcasts')
          .select('status,total_recipients,sent_count,delivered_count,read_count,replied_count,failed_count')
          .eq('account_id', accountId)
          .gte('created_at', range.fromTimestamp)
          .lt('created_at', range.toExclusiveTimestamp)
          .limit(MAX_SOURCE_ROWS + 1))
        const grouped = new Map<string, { count: number; recipients: number; sent: number; delivered: number; read: number; replied: number; failed: number }>()
        for (const row of rows) {
          const status = safeBucket(row.status)
          const current = grouped.get(status) ?? { count: 0, recipients: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 }
          current.count += 1
          current.recipients += safeCount(row.total_recipients)
          current.sent += safeCount(row.sent_count)
          current.delivered += safeCount(row.delivered_count)
          current.read += safeCount(row.read_count)
          current.replied += safeCount(row.replied_count)
          current.failed += safeCount(row.failed_count)
          grouped.set(status, current)
        }
        return section(key, ['status', 'broadcasts', 'recipients', 'sent', 'delivered', 'read', 'replied', 'failed'],
          [...grouped].map(([status, value]) => [status, value.count, value.recipients, value.sent, value.delivered, value.read, value.replied, value.failed]))
      }
      case 'calls': {
        const columns = ['direction', 'transcription_status', 'agent', 'calls', 'duration_seconds']
        if (!features.yeastar_telephony) {
          warnings.add('feature_unavailable')
          return section(key, columns, [])
        }
        if (request.channel && request.channel !== 'yeastar_voice') return section(key, columns, [])
        if (agentFilterInvalid) return section(key, columns, [])
        let query = db.from('yeastar_call_transcriptions')
          .select('direction,duration_seconds,transcription_status,agent_user_id')
          .eq('account_id', accountId)
          .gte('started_at', range.fromTimestamp)
          .lt('started_at', range.toExclusiveTimestamp)
        if (agentId) query = query.eq('agent_user_id', agentId)
        const rows = await sourceRows('call transcriptions', query.limit(MAX_SOURCE_ROWS + 1))
        const grouped = new Map<string, { direction: string; status: string; agent: string; calls: number; seconds: number }>()
        for (const row of rows) {
          const direction = safeBucket(row.direction)
          const status = safeBucket(row.transcription_status)
          const agent = row.agent_user_id ? agentLabels.get(row.agent_user_id) ?? 'assigned' : 'unassigned'
          const groupKey = `${direction}|${status}|${agent}`
          const current = grouped.get(groupKey) ?? { direction, status, agent, calls: 0, seconds: 0 }
          current.calls += 1
          current.seconds += safeCount(row.duration_seconds)
          grouped.set(groupKey, current)
        }
        return section(key, columns, [...grouped.values()].map((row) => [
          row.direction, row.status, row.agent, row.calls, row.seconds,
        ]))
      }
      case 'intelligence': {
        if (!features.ai_conversation_intelligence) {
          warnings.add('feature_unavailable')
          return section(key, ['sentiment', 'analyses', 'average_sentiment_score', 'average_qa_score'], [])
        }
        const rows = await sourceRows('conversation intelligence', db.from('ai_conversation_analyses')
          .select('sentiment,sentiment_score,qa_score')
          .eq('account_id', accountId)
          .eq('status', 'completed')
          .gte('analyzed_at', range.fromTimestamp)
          .lt('analyzed_at', range.toExclusiveTimestamp)
          .limit(MAX_SOURCE_ROWS + 1))
        const grouped = new Map<string, { count: number; sentiments: number[]; qaScores: number[] }>()
        for (const row of rows) {
          const sentiment = safeBucket(row.sentiment)
          const current = grouped.get(sentiment) ?? { count: 0, sentiments: [], qaScores: [] }
          current.count += 1
          if (typeof row.sentiment_score === 'number') current.sentiments.push(row.sentiment_score)
          if (typeof row.qa_score === 'number') current.qaScores.push(row.qa_score)
          grouped.set(sentiment, current)
        }
        return section(key, ['sentiment', 'analyses', 'average_sentiment_score', 'average_qa_score'],
          [...grouped].map(([sentiment, value]) => [
            sentiment, value.count, average(value.sentiments), average(value.qaScores),
          ]))
      }
      case 'memory': {
        const [memoryRows, commitments] = await Promise.all([
          sourceRows('contact memory', db.from('contact_memory')
            .select('risk_level,opportunity_score')
            .eq('account_id', accountId)
            .limit(MAX_SOURCE_ROWS + 1)),
          sourceRows('contact commitments', db.from('contact_commitments')
            .select('status')
            .eq('account_id', accountId)
            .eq('status', 'overdue')
            .limit(MAX_SOURCE_ROWS + 1)),
        ])
        warnings.add('current_snapshot')
        const grouped = new Map<string, { count: number; scores: number[] }>()
        for (const row of memoryRows) {
          const risk = safeBucket(row.risk_level)
          const current = grouped.get(risk) ?? { count: 0, scores: [] }
          current.count += 1
          if (typeof row.opportunity_score === 'number') current.scores.push(row.opportunity_score)
          grouped.set(risk, current)
        }
        const rows: ReportCell[][] = [...grouped].map(([risk, value]) => [risk, value.count, average(value.scores)])
        rows.push(['overdue_commitments', commitments.length, null])
        return section(key, ['metric', 'count', 'average_opportunity_score'], rows)
      }
      case 'contacts': {
        const rows = await sourceRows('contacts', db.from('contacts')
          .select('created_at')
          .eq('account_id', accountId)
          .is('deleted_at', null)
          .gte('created_at', range.fromTimestamp)
          .lt('created_at', range.toExclusiveTimestamp)
          .limit(MAX_SOURCE_ROWS + 1))
        const counts = new Map<string, number>()
        for (const row of rows) {
          const month = monthKey(row.created_at)
          counts.set(month, (counts.get(month) ?? 0) + 1)
        }
        return section(key, ['month', 'new_contacts'], [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => [month, count]))
      }
      case 'credits': {
        const [wallet, usage] = await Promise.all([
          db.from('ai_credit_wallets')
            .select('available_credits')
            .eq('account_id', accountId)
            .maybeSingle(),
          db.rpc('account_ai_credit_report_summary', {
            p_account_id: accountId,
            p_from: range.from,
            p_to: range.to,
          }),
        ])
        if (wallet.error) throwQueryError('credit wallet', wallet.error)
        if (usage.error) throwQueryError('credit history', usage.error)
        const rows: ReportCell[][] = []
        if (wallet.data) rows.push(['current_balance', 'balance', '1', String(wallet.data.available_credits)])
        for (const row of usage.data ?? []) {
          rows.push([
            safeBucket(row.activity),
            safeBucket(row.entry_type),
            String(row.operation_count),
            String(row.credits_delta),
          ])
        }
        return section(key, ['activity', 'entry_type', 'operations', 'credits'], rows)
      }
      case 'billing': {
        if (!hasMinRole(role, 'admin')) {
          warnings.add('admin_required')
          return section(key, ['package', 'paid_checkouts', 'credits', 'total_mxn', 'pending', 'failed'], [])
        }
        const [paid, unpaid] = await Promise.all([
          sourceRows('paid credit checkouts', db.from('stripe_ai_credit_checkouts')
            .select('package_id,credits,amount_total_mxn_centavos')
            .eq('account_id', accountId)
            .eq('status', 'credited')
            .gte('paid_at', range.fromTimestamp)
            .lt('paid_at', range.toExclusiveTimestamp)
            .limit(MAX_SOURCE_ROWS + 1)),
          sourceRows('unpaid credit checkouts', db.from('stripe_ai_credit_checkouts')
            .select('package_id,status')
            .eq('account_id', accountId)
            .in('status', ['pending', 'failed'])
            .gte('created_at', range.fromTimestamp)
            .lt('created_at', range.toExclusiveTimestamp)
            .limit(MAX_SOURCE_ROWS + 1)),
        ])
        const grouped = new Map<string, { count: number; credits: number; total: number; pending: number; failed: number }>()
        const getGroup = (packageId: unknown) => {
          const key = safeBucket(packageId)
          const current = grouped.get(key) ?? { count: 0, credits: 0, total: 0, pending: 0, failed: 0 }
          grouped.set(key, current)
          return { key, current }
        }
        for (const row of paid) {
          const { current } = getGroup(row.package_id)
          current.count += 1
          current.credits += integerUnits(row.credits)
          current.total += integerUnits(row.amount_total_mxn_centavos)
          if (!Number.isSafeInteger(current.credits) || !Number.isSafeInteger(current.total)) {
            throw new Error('Report amount exceeds the supported range.')
          }
        }
        for (const row of unpaid) {
          const { current } = getGroup(row.package_id)
          if (row.status === 'pending') current.pending += 1
          if (row.status === 'failed') current.failed += 1
        }
        return section(key, ['package', 'paid_checkouts', 'credits', 'total_mxn', 'pending', 'failed'],
          [...grouped].map(([packageId, value]) => [
            packageId, value.count, String(value.credits), formatMinorUnits(value.total), value.pending, value.failed,
          ]))
      }
      case 'ai_usage': {
        if (!hasMinRole(role, 'admin')) {
          warnings.add('admin_required')
          return section(key, ['activity', 'operations', 'prompt_tokens', 'completion_tokens', 'total_tokens'], [])
        }
        const { data, error } = await db.rpc('account_ai_usage_report_summary', {
          p_account_id: accountId,
          p_from: range.from,
          p_to: range.to,
        })
        if (error) throwQueryError('AI usage report', error)
        return section(key, ['activity', 'operations', 'prompt_tokens', 'completion_tokens', 'total_tokens'],
          (data ?? []).map((row: {
            activity: string
            operation_count: string
            prompt_tokens: string
            completion_tokens: string
            total_tokens: string
          }) => [
            safeBucket(row.activity),
            String(row.operation_count),
            String(row.prompt_tokens),
            String(row.completion_tokens),
            String(row.total_tokens),
          ]))
      }
    }
  }))
  for (const item of reportSections) {
    if (item.rows.length > MAX_REPORT_ROWS) {
      warnings.add('partial_data')
      item.rows = item.rows.slice(0, MAX_REPORT_ROWS)
    }
  }

  const report = {
    version: 1 as const,
    from: range.from,
    to: range.to,
    filters: {
      channel: request.channel ?? null as AssistantReportChannel | null,
      agent_selected: Boolean(request.agent_name),
    },
    warnings: [...warnings],
    sections: reportSections,
  }
  const maxReportBytes = 240_000
  while (new TextEncoder().encode(JSON.stringify(report)).length > maxReportBytes) {
    const largest = report.sections.reduce<ReportSection | null>(
      (current, item) => !current || item.rows.length > current.rows.length ? item : current,
      null
    )
    if (!largest || largest.rows.length === 0) {
      throw new Error('Assistant report exceeds the storage limit.')
    }
    largest.rows.pop()
    warnings.add('partial_data')
    report.warnings = [...warnings]
  }
  return AssistantReportDataSchema.parse(report)
}

export function summarizeAssistantReport(report: AssistantReportData) {
  return {
    from: report.from,
    to: report.to,
    filters: report.filters,
    warnings: report.warnings,
    sections: report.sections.map(({ key, rows }) => ({ key, row_count: rows.length })),
  }
}
