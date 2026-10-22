import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { loadAiConfig } from '@/lib/ai/config'
import { generateText } from '@/lib/ai/generate'
import { AiCreditsExhaustedError, resolveUsageBilling } from '@/lib/ai/billing-config'
import { logAiUsage } from '@/lib/ai/usage'
import { AiError, type AiUsage, type ChatMessage } from '@/lib/ai/types'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  buildAssistantFinalPrompt,
  buildAssistantPlannerPrompt,
  buildFinalMessages,
} from '@/lib/assistant/prompts'
import { parseAssistantDecision, runAssistantTool } from '@/lib/assistant/tools'
import { AssistantReportValidationError } from '@/lib/assistant/build-report'
import type { AssistantReportData } from '@/lib/assistant/report-types'

const ThreadIdSchema = z.string().uuid()
const TurnSchema = z.object({
  thread_id: ThreadIdSchema.optional(),
  client_message_id: z.string().uuid(),
  content: z.string().trim().min(1).max(4000),
}).strict()

const HISTORY_LIMIT = 20

type AssistantThread = {
  id: string
  title: string
  created_at: string
  updated_at: string
}

type AssistantMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources: unknown
  report_data: AssistantReportData | null
  created_at: string
}

function rateLimit(userId: string, accountId: string) {
  const userLimit = checkRateLimit(`ai-assistant:${userId}`, RATE_LIMITS.aiAssistant)
  if (!userLimit.success) return rateLimitResponse(userLimit)
  const accountLimit = checkRateLimit(`ai-assistant-acct:${accountId}`, RATE_LIMITS.aiAssistantAccount)
  if (!accountLimit.success) return rateLimitResponse(accountLimit)
  return null
}

function publicAiError(err: AiError): NextResponse {
  const code = err instanceof AiCreditsExhaustedError
    ? 'credits_exhausted'
    : err.code === 'ai_not_configured'
      ? 'ai_not_configured'
      : err.code === 'timeout'
        ? 'timeout'
        : err.code === 'rate_limited'
          ? 'rate_limited'
          : 'assistant_failed'
  return NextResponse.json(
    { error: code, code },
    { status: err.status },
  )
}

async function getAssistantResponse(
  db: ReturnType<typeof supabaseAdmin>,
  messageId: string
): Promise<AssistantMessage | null> {
  const { data, error } = await db
    .from('assistant_messages')
    .select('id, role, content, sources, report_data, created_at')
    .eq('reply_to_message_id', messageId)
    .eq('role', 'assistant')
    .maybeSingle()
  if (error) {
    console.error('[ai/assistant] stored response lookup failed:', error)
    throw new Error('Assistant response could not be loaded.')
  }
  return data as AssistantMessage | null
}

async function fetchThreads(
  supabase: Awaited<ReturnType<typeof requireEntitlement>>['supabase'],
  accountId: string,
  userId: string
) {
  const { data, error } = await supabase
    .from('assistant_threads')
    .select('id, title, created_at, updated_at')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) {
    console.error('[ai/assistant GET] thread lookup failed:', error)
    throw new Error('Assistant conversations could not be loaded.')
  }
  return (data ?? []) as AssistantThread[]
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireEntitlement(
      'ai_assistant',
      'supervisor'
    )

    const threadId = new URL(request.url).searchParams.get('thread_id')
    const threads = await fetchThreads(supabase, accountId, userId)
    if (!threadId) return NextResponse.json({ threads })
    if (!ThreadIdSchema.safeParse(threadId).success) {
      return NextResponse.json({ error: 'invalid_thread_id' }, { status: 400 })
    }

    const thread = threads.find((item) => item.id === threadId)
    if (!thread) {
      return NextResponse.json({ error: 'thread_not_found' }, { status: 404 })
    }
    const { data, error } = await supabase
      .from('assistant_messages')
      .select('id, role, content, sources, report_data, created_at')
      .eq('thread_id', threadId)
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
    if (error) {
      console.error('[ai/assistant GET] messages lookup failed:', error)
      throw new Error('Assistant messages could not be loaded.')
    }

    return NextResponse.json({
      threads,
      thread,
      messages: (data ?? []) as AssistantMessage[],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId, role, entitlements } = await requireEntitlement(
      'ai_assistant',
      'supervisor'
    )
    const limited = rateLimit(userId, accountId)
    if (limited) return limited

    const body = await request.json().catch(() => null)
    const parsed = TurnSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }
    const { content, client_message_id: clientMessageId } = parsed.data
    const admin = supabaseAdmin()
    let threadId = parsed.data.thread_id
    let createdThread = false

    if (threadId) {
      const { data: thread, error } = await supabase
        .from('assistant_threads')
        .select('id')
        .eq('id', threadId)
        .eq('account_id', accountId)
        .eq('user_id', userId)
        .maybeSingle()
      if (error) {
        console.error('[ai/assistant POST] thread validation failed:', error)
        throw new Error('Assistant conversation could not be loaded.')
      }
      if (!thread) {
        return NextResponse.json({ error: 'thread_not_found' }, { status: 404 })
      }
    } else {
      const title = content.replace(/\s+/g, ' ').trim().slice(0, 120)
      const { data: thread, error } = await admin
        .from('assistant_threads')
        .insert({ account_id: accountId, user_id: userId, title })
        .select('id')
        .single()
      if (error || !thread) {
        console.error('[ai/assistant POST] thread creation failed:', error)
        throw new Error('Assistant conversation could not be created.')
      }
      threadId = thread.id
      createdThread = true
    }

    const { data: existingMessage, error: existingError } = await admin
      .from('assistant_messages')
      .select('id')
      .eq('thread_id', threadId)
      .eq('client_message_id', clientMessageId)
      .eq('role', 'user')
      .maybeSingle()
    if (existingError) {
      console.error('[ai/assistant POST] idempotency lookup failed:', existingError)
      throw new Error('Assistant message could not be loaded.')
    }

    if (existingMessage) {
      const response = await getAssistantResponse(admin, existingMessage.id)
      if (!response) {
        return NextResponse.json(
          { error: 'turn_pending', thread_id: threadId },
          { status: 409 }
        )
      }
      return NextResponse.json({ thread_id: threadId, message: response })
    }

    const { data: userMessage, error: insertError } = await admin
      .from('assistant_messages')
      .insert({
        thread_id: threadId,
        account_id: accountId,
        user_id: userId,
        role: 'user',
        content,
        client_message_id: clientMessageId,
      })
      .select('id')
      .single()
    if (insertError || !userMessage) {
      if (insertError?.code === '23505') {
        return NextResponse.json(
          { error: 'turn_pending', thread_id: threadId },
          { status: 409 }
        )
      }
      console.error('[ai/assistant POST] user message save failed:', insertError)
      if (createdThread && threadId) {
        const { error: cleanupError } = await admin
          .from('assistant_threads')
          .delete()
          .eq('id', threadId)
          .eq('account_id', accountId)
          .eq('user_id', userId)
        if (cleanupError) {
          console.error('[ai/assistant POST] empty thread cleanup failed:', cleanupError)
        }
      }
      throw new Error('Assistant message could not be saved.')
    }

    const { data: historyRows, error: historyError } = await supabase
      .from('assistant_messages')
      .select('role, content')
      .eq('thread_id', threadId)
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)
    if (historyError) {
      console.error('[ai/assistant POST] message history lookup failed:', historyError)
      throw new Error('Assistant history could not be loaded.')
    }
    const history = (historyRows ?? []).reverse() as ChatMessage[]

    const config = await loadAiConfig(supabase, accountId)
    if (!config) {
      throw new AiError('Assistant is not configured.', {
        code: 'ai_not_configured',
        status: 503,
      })
    }

    const plan = await generateText({
      config,
      task: 'assistant_router',
      systemPrompt: buildAssistantPlannerPrompt(),
      messages: history,
      maxOutputTokens: 600,
    })
    let decision: ReturnType<typeof parseAssistantDecision>
    try {
      decision = parseAssistantDecision(plan.text)
    } catch (err) {
      console.error('[ai/assistant POST] invalid model decision:', err)
      if (plan.usage) {
        await logAiUsage(admin, {
          accountId,
          conversationId: null,
          mode: 'assistant',
          provider: plan.provider,
          model: plan.model,
          latencyMs: plan.latencyMs,
          usage: plan.usage,
          billingIdempotencyKey: `assistant:invalid-plan:${userMessage.id}`,
        })
      }
      throw new AiError('Assistant returned an invalid response.', {
        code: 'assistant_invalid_response',
        status: 502,
      })
    }

    let answer: string
    let sources: Awaited<ReturnType<typeof runAssistantTool>>['sources'] = []
    let reportData: AssistantReportData | null = null
    let billableUsage: AiUsage
    let provider = plan.provider
    let model = plan.model
    let latencyMs = plan.latencyMs

    if (decision.type === 'answer') {
      answer = decision.answer
      if (!plan.usage) {
        throw new AiError('Assistant usage was not reported.', {
          code: 'usage_missing',
          status: 503,
        })
      }
      billableUsage = plan.usage
    } else {
      if (!plan.usage) {
        throw new AiError('Assistant usage was not reported.', {
          code: 'usage_missing',
          status: 503,
        })
      }
      await logAiUsage(admin, {
        accountId,
        conversationId: null,
        mode: 'assistant',
        provider: plan.provider,
        model: plan.model,
        latencyMs: plan.latencyMs,
        usage: plan.usage,
        billingIdempotencyKey: `assistant:planner:${userMessage.id}`,
      })

      const toolResult = await runAssistantTool({
        db: supabase,
        accountId,
        role,
        config,
        features: entitlements.features,
        tool: decision.tool,
      })
      const final = await generateText({
        config,
        task: 'assistant_data',
        systemPrompt: buildAssistantFinalPrompt(),
        messages: buildFinalMessages(history, toolResult),
        maxOutputTokens: 800,
      })
      answer = final.text.trim()
      sources = toolResult.sources
      reportData = toolResult.reportData ?? null
      if (!final.usage || !answer) {
        throw new AiError('Assistant usage was not reported.', {
          code: 'usage_missing',
          status: 503,
        })
      }
      billableUsage = final.usage
      provider = final.provider
      model = final.model
      latencyMs += final.latencyMs
    }

    const billing = await resolveUsageBilling(supabaseAdmin(), {
      provider,
      model,
      usage: billableUsage,
    })
    const { data: recorded, error: billingError } = await admin.rpc(
      'record_ai_assistant_turn_with_report',
      {
        p_account_id: accountId,
        p_user_id: userId,
        p_thread_id: threadId,
        p_user_message_id: userMessage.id,
        p_content: answer,
        p_sources: sources,
        p_provider: provider,
        p_model: model,
        p_prompt_tokens: billableUsage.promptTokens,
        p_completion_tokens: billableUsage.completionTokens,
        p_total_tokens: billableUsage.totalTokens,
        p_latency_ms: latencyMs,
        p_cost_nano_usd: billing.costNanoUsd.toString(),
        p_price_nano_usd: billing.priceNanoUsd.toString(),
        p_credits: billing.creditsCharged.toString(),
        p_idempotency_key: `assistant:response:${userMessage.id}`,
        p_report_data: reportData,
      }
    )
    if (billingError) {
      console.error('[ai/assistant POST] atomic billing failed:', billingError)
      throw new AiError('Assistant response could not be confirmed.', {
        code: 'ai_billing_unavailable',
        status: 503,
      })
    }

    const result = Array.isArray(recorded) ? recorded[0] : null
    if (result?.result === 'insufficient_credits') {
      throw new AiCreditsExhaustedError()
    }
    if (
      !result ||
      !['debited', 'duplicate', 'recorded'].includes(result.result) ||
      !result.assistant_message_id
    ) {
      throw new AiError('Assistant response could not be confirmed.', {
        code: 'ai_billing_unavailable',
        status: 503,
      })
    }

    const response = await admin
      .from('assistant_messages')
      .select('id, role, content, sources, report_data, created_at')
      .eq('id', result.assistant_message_id)
      .single()
    if (response.error || !response.data) {
      console.error('[ai/assistant POST] confirmed response lookup failed:', response.error)
      throw new Error('Assistant response could not be loaded.')
    }

    return NextResponse.json({
      thread_id: threadId,
      message: response.data,
      available_credits: String(result.available_credits),
    })
  } catch (err) {
    if (err instanceof AssistantReportValidationError) {
      return NextResponse.json(
        { error: 'invalid_report_request', code: 'invalid_report_request' },
        { status: 422 }
      )
    }
    if (err instanceof AiError) return publicAiError(err)
    return toErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireEntitlement(
      'ai_assistant',
      'supervisor'
    )

    const threadId = new URL(request.url).searchParams.get('thread_id')
    if (!threadId || !ThreadIdSchema.safeParse(threadId).success) {
      return NextResponse.json({ error: 'invalid_thread_id' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('assistant_threads')
      .delete()
      .eq('id', threadId)
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[ai/assistant DELETE] thread deletion failed:', error)
      throw new Error('Assistant conversation could not be deleted.')
    }
    if (!data) {
      return NextResponse.json({ error: 'thread_not_found' }, { status: 404 })
    }
    return NextResponse.json({ success: true, thread_id: threadId })
  } catch (err) {
    return toErrorResponse(err)
  }
}
