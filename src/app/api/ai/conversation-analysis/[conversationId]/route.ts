import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { MIN_DAILY_ANALYSES_PER_CONVERSATION } from '@/lib/ai/defaults'

const ANALYSIS_COLUMNS =
  'summary, sentiment, sentiment_score, next_best_action, reasons, qa_score, qa_empathy_score, qa_objection_handling_score, qa_script_adherence_score, qa_summary, qa_findings, insights, intent, urgency, lead_temperature, handoff_required, recommended_department, status, analyzed_message_count, analyzed_at'

type AccountSupabase = Awaited<ReturnType<typeof requireRole>>['supabase']

function startOfDay() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.toISOString()
}

async function assertConversation(accountId: string, conversationId: string, supabase: Awaited<ReturnType<typeof requireRole>>['supabase']) {
  const { data, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

async function findManualJob(
  db: AccountSupabase,
  accountId: string,
  conversationId: string,
) {
  const { data, error } = await db
    .from('ai_analysis_jobs')
    .select('id, status')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .eq('trigger', 'manual')
    .maybeSingle()
  if (error) throw error
  return data
}

async function enqueueManualJob(
  db: AccountSupabase,
  accountId: string,
  conversationId: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await findManualJob(db, accountId, conversationId)
    if (existing?.status === 'queued' || existing?.status === 'processing') return existing

    if (existing) {
      const { data, error } = await db
        .from('ai_analysis_jobs')
        .update({ status: 'queued', scheduled_at: new Date().toISOString(), attempts: 0, error_message: null })
        .eq('id', existing.id)
        .eq('status', existing.status)
        .select('id, status')
        .maybeSingle()
      if (error) throw error
      if (data) return data
      continue
    }

    const { data, error } = await db
      .from('ai_analysis_jobs')
      .insert({
        account_id: accountId,
        conversation_id: conversationId,
        trigger: 'manual',
        status: 'queued',
        scheduled_at: new Date().toISOString(),
        attempts: 0,
        error_message: null,
      })
      .select('id, status')
      .maybeSingle()
    if (!error && data) return data
    if (error?.code !== '23505') {
      if (error) throw error
      throw new Error('No se pudo agregar el análisis a la cola.')
    }
  }

  const latest = await findManualJob(db, accountId, conversationId)
  if (latest?.status === 'queued' || latest?.status === 'processing') return latest
  throw new Error('No se pudo agregar el análisis a la cola.')
}

export async function GET(_: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { conversationId } = await params
    if (!await assertConversation(accountId, conversationId, supabase)) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    const [analysisResult, job] = await Promise.all([
      supabase
        .from('ai_conversation_analyses')
        .select(ANALYSIS_COLUMNS)
        .eq('conversation_id', conversationId)
        .eq('source', 'whatsapp')
        .maybeSingle(),
      findManualJob(supabase, accountId, conversationId),
    ])
    if (analysisResult.error) throw analysisResult.error
    return NextResponse.json({ analysis: analysisResult.data ?? null, job })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(_: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const admin = supabaseAdmin()
    const { conversationId } = await params
    const limit = checkRateLimit(`ai-analysis:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)
    if (!await assertConversation(accountId, conversationId, supabase)) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const config = await loadAiConfig(supabase, accountId)
    if (!config) {
      return NextResponse.json({ error: 'Configura y activa la IA antes de analizar conversaciones.' }, { status: 400 })
    }
    const { count: pendingMediaCount, error: pendingMediaError } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .not('media_url', 'is', null)
      .in('media_analysis_status', ['queued', 'processing'])
    if (pendingMediaError) throw pendingMediaError
    if ((pendingMediaCount ?? 0) > 0) {
      return NextResponse.json({
        error: 'Hay una imagen o nota de voz aún en análisis. Espera a que termine para tener el contexto completo.',
        code: 'media_analysis_pending',
      }, { status: 409 })
    }

    const messages = await buildConversationContext(supabase, conversationId)
    if (!messages.length) {
      return NextResponse.json({ error: 'No hay mensajes de texto para analizar.' }, { status: 400 })
    }

    const { data: policy, error: policyError } = await admin
      .from('ai_configs')
      .select('analysis_max_per_conversation')
      .eq('account_id', accountId)
      .maybeSingle()
    if (policyError) throw policyError
    const conversationLimit = Math.max(
      MIN_DAILY_ANALYSES_PER_CONVERSATION,
      Number(policy?.analysis_max_per_conversation) || MIN_DAILY_ANALYSES_PER_CONVERSATION,
    )
    const { count: conversationCount, error: usageError } = await admin
      .from('ai_usage_log')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('conversation_id', conversationId)
      .eq('mode', 'analysis')
      .gte('created_at', startOfDay())
    if (usageError) throw usageError
    if ((conversationCount ?? 0) >= conversationLimit) {
      return NextResponse.json({
        error: `El límite diario de análisis para esta conversación fue alcanzado (${Math.min(conversationCount ?? 0, conversationLimit)}/${conversationLimit}).`,
        code: 'analysis_conversation_limit',
      }, { status: 429 })
    }

    const job = await enqueueManualJob(supabase, accountId, conversationId)
    return NextResponse.json({ job }, { status: 202 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
