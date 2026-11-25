import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { findExistingContact } from '@/lib/contacts/dedupe'
import {
  decryptSecret,
  loadVoiceReceptionistConfig,
  normalizePhoneForCall,
  type VoiceReceptionistCall,
} from '@/lib/telephony/voice-receptionist'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ accountId: string }> }
type ElevenEvent = {
  type: string
  event_timestamp?: number
  data?: Record<string, unknown>
}

function nestedNumber(value: unknown, ...keys: string[]): number | null {
  if (!value || typeof value !== 'object') return null
  const object = value as Record<string, unknown>
  for (const key of keys) {
    const direct = object[key]
    if (typeof direct === 'number' && Number.isFinite(direct)) return direct
  }
  for (const child of Object.values(object)) {
    const found: number | null = nestedNumber(child, ...keys)
    if (found !== null) return found
  }
  return null
}

function transcriptFromEvent(data: Record<string, unknown>) {
  if (!Array.isArray(data.transcript)) return []
  return data.transcript.flatMap((turn) => {
    if (!turn || typeof turn !== 'object') return []
    const row = turn as Record<string, unknown>
    const role = row.role === 'agent' || row.role === 'assistant' ? 'agent' : row.role === 'user' ? 'user' : 'system'
    const message = typeof row.message === 'string'
      ? row.message
      : typeof row.text === 'string'
        ? row.text
        : ''
    if (!message.trim()) return []
    return [{
      role,
      message: message.trim(),
      time_in_call_secs: typeof row.time_in_call_secs === 'number' ? row.time_in_call_secs : null,
    }]
  })
}

export async function POST(request: Request, context: Params) {
  const { accountId } = await context.params
  const rawBody = await request.text()
  const db = supabaseAdmin()
  try {
    const config = await loadVoiceReceptionistConfig(db, accountId)
    if (!config?.enabled || !config.post_call_secret_encrypted || !config.elevenlabs_api_key_encrypted) {
      return NextResponse.json({ error: 'Voice receptionist is not configured.' }, { status: 404 })
    }
    const signature = request.headers.get('elevenlabs-signature')
    const secret = decryptSecret(config.post_call_secret_encrypted, 'el secreto post-call')
    const apiKey = decryptSecret(config.elevenlabs_api_key_encrypted, 'la llave de ElevenLabs')
    const client = new ElevenLabsClient({ apiKey })
    let event: ElevenEvent
    try {
      event = await client.webhooks.constructEvent(rawBody, signature ?? '', secret) as ElevenEvent
    } catch {
      return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
    }
    const data = event.data
    if (!data || typeof data.conversation_id !== 'string') {
      return NextResponse.json({ error: 'Invalid event.' }, { status: 400 })
    }
    if (data.agent_id !== config.elevenlabs_agent_id) {
      return NextResponse.json({ error: 'Agent does not belong to this account.' }, { status: 403 })
    }

    const existingResult = await db.from('voice_receptionist_calls')
      .select('caller_number, called_number, contact_id, source_metadata, started_at')
      .eq('account_id', accountId).eq('conversation_id', data.conversation_id).maybeSingle()
    if (existingResult.error) throw existingResult.error
    const existing = existingResult.data
    const metadata = data.metadata && typeof data.metadata === 'object'
      ? data.metadata as Record<string, unknown>
      : {}
    const analysis = data.analysis && typeof data.analysis === 'object'
      ? data.analysis as Record<string, unknown>
      : {}
    const callerNumber = normalizePhoneForCall(metadata.from_number)
      ?? normalizePhoneForCall(metadata.caller_number)
      ?? existing?.caller_number
      ?? null
    const calledNumber = normalizePhoneForCall(metadata.to_number)
      ?? normalizePhoneForCall(metadata.called_number)
      ?? existing?.called_number
      ?? null
    const contact = existing?.contact_id
      ? null
      : callerNumber
        ? await findExistingContact(db, accountId, callerNumber)
        : null
    const startedSeconds = nestedNumber(metadata, 'start_time_unix_secs')
    const durationSeconds = nestedNumber(metadata, 'call_duration_secs')
    const summary = typeof analysis.transcript_summary === 'string'
      ? analysis.transcript_summary.trim().slice(0, 4000)
      : null
    const update: Partial<VoiceReceptionistCall> & Record<string, unknown> = {
      account_id: accountId,
      conversation_id: data.conversation_id,
      agent_id: String(data.agent_id),
      caller_number: callerNumber,
      called_number: calledNumber,
      contact_id: existing?.contact_id ?? contact?.id ?? null,
      status: event.type === 'call_initiation_failure'
        ? 'failed'
        : event.type === 'post_call_transcription'
          ? 'done'
          : 'processing',
      transcript: transcriptFromEvent(data),
      summary,
      analysis,
      source_metadata: {
        ...(existing?.source_metadata ?? {}),
        ...(metadata ? { provider: metadata } : {}),
        event_type: event.type,
      },
      started_at: startedSeconds
        ? new Date(startedSeconds * 1000).toISOString()
        : existing?.started_at ?? null,
      ended_at: startedSeconds && durationSeconds
        ? new Date((startedSeconds + durationSeconds) * 1000).toISOString()
        : null,
      last_event_at: new Date().toISOString(),
    }
    const { error } = await db.from('voice_receptionist_calls')
      .upsert(update, { onConflict: 'account_id,conversation_id' })
    if (error) throw error
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[voice receptionist] post-call webhook failed:', error)
    return NextResponse.json({ error: 'Could not persist post-call data.' }, { status: 500 })
  }
}
