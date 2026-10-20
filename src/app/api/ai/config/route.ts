import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { MIN_DAILY_ANALYSES_PER_CONVERSATION } from '@/lib/ai/defaults'
import { supabaseAdmin } from '@/lib/ai/admin-client'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

const SAFE_CONFIG_COLUMNS =
  'system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, handoff_target, handoff_queue_id, channel_types, conversation_analysis_enabled, analysis_on_customer_message, analysis_on_transfer, analysis_on_close, analysis_daily_limit, analysis_monthly_limit, analysis_max_per_conversation, analysis_images_enabled, analysis_voice_notes_enabled, analysis_auto_route_enabled, media_analysis_daily_limit, qa_scoring_enabled, qa_scoring_criteria, timezone'

const LEGACY_SAFE_CONFIG_COLUMNS =
  'system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, conversation_analysis_enabled, analysis_on_customer_message, analysis_on_transfer, analysis_on_close, analysis_daily_limit, analysis_monthly_limit, analysis_max_per_conversation, analysis_images_enabled, analysis_voice_notes_enabled, media_analysis_daily_limit, qa_scoring_enabled, qa_scoring_criteria'

function isMissingModelColumn(error: { code?: string; message?: string }) {
  return error.code === '42703' || /(?:analysis_model|image_analysis_model|voice_transcription_model|handoff_target|handoff_queue_id|channel_types|analysis_auto_route_enabled|timezone)/i.test(error.message ?? '')
}

/**
 * GET /api/ai/config
 *
 * Any member may read tenant-editable behavior settings. Provider,
 * model, and credential data are deliberately excluded.
 */
export async function GET() {
  try {
    const { accountId } = await getCurrentAccount()
    const admin = supabaseAdmin()

    const [primary, credentials] = await Promise.all([
      admin
        .from('ai_configs')
        .select(SAFE_CONFIG_COLUMNS)
        .eq('account_id', accountId)
        .maybeSingle(),
      admin
        .from('ai_provider_credentials')
        .select('provider, credential_type')
        .eq('account_id', accountId),
    ])
    let data: Record<string, unknown> | null = primary.data
    let error = primary.error

    if (error && isMissingModelColumn(error)) {
      const fallback = await admin
        .from('ai_configs')
        .select(LEGACY_SAFE_CONFIG_COLUMNS)
        .eq('account_id', accountId)
        .maybeSingle()
      data = fallback.data
      error = fallback.error
    }

    if (error || credentials.error) {
      console.error('[ai/config GET] fetch error:', error ?? credentials.error)
      return NextResponse.json(
        { error: 'Failed to load AI configuration' },
        { status: 500 },
      )
    }

    const hasEmbeddingsKey = (credentials.data ?? []).some(
      (credential) => credential.provider === 'openai' && credential.credential_type === 'embeddings'
    )
    if (!data) {
      return NextResponse.json({
        configured: false,
        has_embeddings_key: hasEmbeddingsKey,
      })
    }
    return NextResponse.json({
      configured: true,
      has_embeddings_key: hasEmbeddingsKey,
      ...data,
      analysis_max_per_conversation: Math.max(
        MIN_DAILY_ANALYSES_PER_CONVERSATION,
        Number(data.analysis_max_per_conversation) || MIN_DAILY_ANALYSES_PER_CONVERSATION,
      ),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/config  (admin+)
 *
 * Updates only tenant-editable behavior settings. Credentials and model
 * selection are restricted to the platform operator.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    // IANA timezone for {{current_datetime}} / active-promotions date
    // filtering (see src/lib/ai/prompt-variables.ts). Intl throws on an
    // unrecognized zone — the cheapest validation without a hardcoded list.
    const timezoneRaw = typeof body.timezone === 'string' ? body.timezone.trim() : ''
    const timezone = timezoneRaw || 'America/Mexico_City'
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone })
    } catch {
      return bad(`"${timezone}" no es una zona horaria IANA válida (ej. America/Mexico_City).`)
    }

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null
    const isActive = body.is_active === true
    const autoReplyEnabled = body.auto_reply_enabled === true
    const analysisEnabled = body.conversation_analysis_enabled === true
    const analysisOnCustomerMessage = body.analysis_on_customer_message === true
    const analysisOnTransfer = body.analysis_on_transfer === true
    const analysisOnClose = body.analysis_on_close === true
    const boundedNumber = (value: unknown, fallback: number, max: number) => {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? Math.min(max, Math.max(1, Math.floor(parsed))) : fallback
    }
    const analysisDailyLimit = boundedNumber(body.analysis_daily_limit, 100, 10_000)
    const analysisMonthlyLimit = boundedNumber(body.analysis_monthly_limit, 1_000, 100_000)
    const analysisMaxPerConversation = Math.max(
      MIN_DAILY_ANALYSES_PER_CONVERSATION,
      boundedNumber(body.analysis_max_per_conversation, MIN_DAILY_ANALYSES_PER_CONVERSATION, 100),
    )
    const analysisImagesEnabled = body.analysis_images_enabled === true
    const analysisVoiceNotesEnabled = body.analysis_voice_notes_enabled === true
    const mediaAnalysisDailyLimit = boundedNumber(body.media_analysis_daily_limit, 100, 10_000)
    const qaScoringEnabled = body.qa_scoring_enabled === true
    const qaScoringCriteria =
      typeof body.qa_scoring_criteria === 'string' && body.qa_scoring_criteria.trim()
        ? body.qa_scoring_criteria.trim().slice(0, 5000)
        : null

    let maxPer = Number(body.auto_reply_max_per_conversation)
    if (!Number.isFinite(maxPer)) maxPer = 3
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)))

    // Handoff routing target for auto-reply. A non-empty string must be a
    // member of this account (else the conversation would be assigned to a
    // stranger); an empty string / null means "leave unassigned" (the
    // shared queue). Absent → left unchanged on update below.
    const rawHandoff =
      typeof body.handoff_agent_id === 'string' ? body.handoff_agent_id.trim() : ''
    const handoffProvided = 'handoff_agent_id' in body
    let handoffAgentId: string | null = null
    if (rawHandoff) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', rawHandoff)
        .maybeSingle()
      if (!member) return bad('handoff_agent_id must be a member of this account')
      handoffAgentId = rawHandoff
    }

    // Where a handoff lands: nobody, a fixed agent, a fixed queue, or the
    // queue the model itself picks from the conversation.
    const handoffTargetRaw =
      typeof body.handoff_target === 'string' ? body.handoff_target.trim() : ''
    const handoffTarget = ['unassigned', 'agent', 'queue', 'ai_queue'].includes(handoffTargetRaw)
      ? handoffTargetRaw
      : 'agent'
    const rawHandoffQueue =
      typeof body.handoff_queue_id === 'string' ? body.handoff_queue_id.trim() : ''
    let handoffQueueId: string | null = null
    if (rawHandoffQueue) {
      const { data: queue } = await supabase
        .from('conversation_queues')
        .select('id')
        .eq('account_id', accountId)
        .eq('id', rawHandoffQueue)
        .maybeSingle()
      if (!queue) return bad('handoff_queue_id must be a queue of this account')
      handoffQueueId = rawHandoffQueue
    }
    if (handoffTarget === 'queue' && !handoffQueueId) {
      return bad('handoff_queue_id is required when handoff_target is "queue"')
    }

    // Channels the agent answers on. An empty array (or every channel
    // selected) is stored as NULL, i.e. "all channels".
    const ALL_CHANNELS = [
      'whatsapp',
      'zernio_whatsapp',
      'zernio_facebook',
      'zernio_instagram',
      'facebook',
      'instagram',
      'tiktok',
      'yeastar_live_chat',
    ]
    const requestedChannels = Array.isArray(body.channel_types)
      ? ALL_CHANNELS.filter((c) => body.channel_types.includes(c))
      : []
    const channelTypes =
      requestedChannels.length === 0 || requestedChannels.length === ALL_CHANNELS.length
        ? null
        : requestedChannels

    const shared: Record<string, unknown> = {
      system_prompt: systemPrompt,
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_max_per_conversation: maxPer,
      conversation_analysis_enabled: analysisEnabled,
      analysis_on_customer_message: analysisOnCustomerMessage,
      analysis_on_transfer: analysisOnTransfer,
      analysis_on_close: analysisOnClose,
      analysis_daily_limit: analysisDailyLimit,
      analysis_monthly_limit: analysisMonthlyLimit,
      analysis_max_per_conversation: analysisMaxPerConversation,
      analysis_images_enabled: analysisImagesEnabled,
      analysis_voice_notes_enabled: analysisVoiceNotesEnabled,
      media_analysis_daily_limit: mediaAnalysisDailyLimit,
      qa_scoring_enabled: qaScoringEnabled,
      qa_scoring_criteria: qaScoringCriteria,
      handoff_target: handoffTarget,
      handoff_queue_id: handoffQueueId,
      channel_types: channelTypes,
      analysis_auto_route_enabled: body.analysis_auto_route_enabled === true,
      timezone,
    }
    // Only touch the handoff target when the form actually sent the field,
    // so a partial save (e.g. flipping a toggle) doesn't wipe it.
    if (handoffProvided) shared.handoff_agent_id = handoffAgentId
    const admin = supabaseAdmin()
    const { data: existing, error: existingError } = await admin
      .from('ai_configs')
      .select('account_id')
      .eq('account_id', accountId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) {
      return NextResponse.json(
        { error: 'La configuración de IA debe ser creada por el operador de la plataforma.' },
        { status: 409 },
      )
    }

    const legacyWriteValues = Object.fromEntries(
      Object.entries(shared).filter(([key]) => ![
        'handoff_target',
        'handoff_queue_id',
        'channel_types',
        'analysis_auto_route_enabled',
        'timezone',
      ].includes(key)),
    )
    let { error: upErr } = await admin
      .from('ai_configs')
      .update(shared)
      .eq('account_id', accountId)
    if (upErr && isMissingModelColumn(upErr)) {
      const fallback = await admin
        .from('ai_configs')
        .update(legacyWriteValues)
        .eq('account_id', accountId)
      upErr = fallback.error
    }
    if (upErr) {
      console.error('[ai/config POST] update error:', upErr)
      return NextResponse.json(
        { error: 'Failed to save AI configuration' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
