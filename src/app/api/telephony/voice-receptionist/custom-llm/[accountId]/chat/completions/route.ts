import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { assertAiBillingReady } from '@/lib/ai/billing-config'
import { loadAiConfig } from '@/lib/ai/config'
import { resolveProviderKey } from '@/lib/ai/model-routing'
import { logAiUsage } from '@/lib/ai/usage'
import { parseStreamContent, transcriptFromCustomMessages } from '@/lib/telephony/voice-receptionist-custom-llm'
import {
  decryptSecret,
  loadVoiceReceptionistConfig,
  secretsMatch,
} from '@/lib/telephony/voice-receptionist'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'

type CustomExtraBody = {
  account_id?: unknown
  conversation_id?: unknown
  authorization_token?: unknown
}

type UpstreamUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

async function persistTranscript(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  conversationId: string,
  agentId: string,
  transcript: unknown[],
  status = 'in-progress',
) {
  const { error } = await db.from('voice_receptionist_calls').upsert({
    account_id: accountId,
    conversation_id: conversationId,
    agent_id: agentId,
    status,
    transcript,
    last_event_at: new Date().toISOString(),
  }, { onConflict: 'account_id,conversation_id' })
  if (error) throw error
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((part) => {
    if (!part || typeof part !== 'object') return []
    const row = part as Record<string, unknown>
    return row.type === 'text' && typeof row.text === 'string' ? [row.text] : []
  }).join('')
}

function normalizeOpenAiMessages(messages: unknown) {
  if (!Array.isArray(messages)) return []
  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object') return []
    const row = message as Record<string, unknown>
    if (!['system', 'assistant', 'user', 'tool'].includes(String(row.role))) return []
    const normalized: Record<string, unknown> = { ...row }
    normalized.content = messageText(row.content)
    return [normalized]
  })
}

export async function POST(request: Request, context: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await context.params
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON body.')
  const extra = body.elevenlabs_extra_body && typeof body.elevenlabs_extra_body === 'object'
    ? body.elevenlabs_extra_body as CustomExtraBody
    : {}
  if (extra.account_id !== accountId || typeof extra.conversation_id !== 'string') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = supabaseAdmin()
  try {
    const config = await loadVoiceReceptionistConfig(db, accountId)
    if (!config?.enabled || config.transcription_mode !== 'turns' || !config.elevenlabs_agent_id || !config.custom_llm_token_encrypted) {
      return NextResponse.json({ error: 'Custom LLM is not enabled.' }, { status: 409 })
    }
    const expectedToken = decryptSecret(config.custom_llm_token_encrypted, 'el token del LLM personalizado')
    const suppliedToken = typeof extra.authorization_token === 'string' ? extra.authorization_token : null
    if (!secretsMatch(suppliedToken, expectedToken)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const aiConfig = await loadAiConfig(db, accountId, { requireActive: false })
    const openAiKey = aiConfig ? resolveProviderKey(aiConfig, 'openai') : null
    if (!aiConfig || !openAiKey) {
      return NextResponse.json({ error: 'No OpenAI credential is available for live voice transcription.' }, { status: 503 })
    }
    const openAiModel = aiConfig.provider === 'openai'
      ? aiConfig.model
      : 'gpt-5.6-terra'
    await assertAiBillingReady(db, 'openai', openAiModel, accountId)
    const messages = normalizeOpenAiMessages(body.messages)
    const conversationId = extra.conversation_id
    const transcript = transcriptFromCustomMessages(messages)
    await persistTranscript(db, accountId, conversationId, config.elevenlabs_agent_id, transcript)

    const upstreamBody: Record<string, unknown> = {
      model: openAiModel,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    }
    if (Array.isArray(body.tools)) upstreamBody.tools = body.tools
    if (body.tool_choice !== undefined) upstreamBody.tool_choice = body.tool_choice
    if (body.parallel_tool_calls !== undefined) upstreamBody.parallel_tool_calls = body.parallel_tool_calls
    const requestedMaxTokens = Number(body.max_tokens)
    upstreamBody.max_completion_tokens = Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
      ? Math.min(requestedMaxTokens, 1024)
      : 768

    const upstream = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(25_000),
    })
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '')
      console.error('[voice receptionist custom llm] OpenAI request failed:', upstream.status, detail.slice(0, 500))
      return NextResponse.json({ error: 'Live voice generation failed.' }, { status: 502 })
    }

    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    let assistantText = ''
    let usage: UpstreamUsage | null = null
    let sawDone = false
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.body!.getReader()
        let pending = ''
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const text = decoder.decode(value, { stream: true })
            pending += text
            const completeLines = pending.split('\n\n')
            pending = completeLines.pop() ?? ''
            for (const line of completeLines) {
              if (line.replace(/^data:\s*/, '').trim() === '[DONE]') sawDone = true
              const parsed = parseStreamContent(line)
              if (parsed) {
                assistantText += parsed.content
                usage = parsed.usage ?? usage
              }
            }
            controller.enqueue(value)
          }
          if (pending) {
            if (pending.replace(/^data:\s*/, '').trim() === '[DONE]') sawDone = true
            const parsed = parseStreamContent(pending)
            if (parsed) {
              assistantText += parsed.content
              usage = parsed.usage ?? usage
            }
          }
          if (!sawDone) {
            controller.enqueue(encoder.encode('\n\ndata: [DONE]\n\n'))
          }
          controller.close()
          if (assistantText.trim()) {
            await persistTranscript(
              db,
              accountId,
              conversationId,
              config.elevenlabs_agent_id!,
              [
                ...transcript,
                { role: 'assistant', message: assistantText.trim(), at: new Date().toISOString() },
              ].slice(-500),
            )
          }
          if (usage?.prompt_tokens != null || usage?.completion_tokens != null || usage?.total_tokens != null) {
            const promptTokens = Number(usage.prompt_tokens ?? 0)
            const completionTokens = Number(usage.completion_tokens ?? 0)
            const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens)
            await logAiUsage(db, {
              accountId,
              conversationId: null,
              mode: 'assistant',
              provider: 'openai',
              model: openAiModel,
              usage: { promptTokens, completionTokens, totalTokens },
              latencyMs: undefined,
            }).catch((error) => {
              console.error('[voice receptionist custom llm] usage logging failed:', error)
            })
          }
        } catch (error) {
          controller.error(error)
          console.error('[voice receptionist custom llm] stream failed:', error)
        }
      },
    })
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('[voice receptionist custom llm] request failed:', error)
    return NextResponse.json({ error: 'Could not process voice turn.' }, { status: 500 })
  }
}
