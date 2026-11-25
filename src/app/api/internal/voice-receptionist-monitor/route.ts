import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import {
  appendTranscriptEvent,
  decryptSecret,
  loadVoiceReceptionistConfig,
} from '@/lib/telephony/voice-receptionist'

export const dynamic = 'force-dynamic'

function authorized(request: Request) {
  const expected = process.env.AI_ANALYSIS_WORKER_SECRET
  return Boolean(expected) && request.headers.get('x-ai-worker-secret') === expected
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const db = supabaseAdmin()
    const { data: calls, error: callError } = await db.from('voice_receptionist_calls')
      .select('account_id, conversation_id')
      .in('status', ['initiated', 'in-progress'])
      .gte('last_event_at', new Date(Date.now() - 30 * 60_000).toISOString())
      .limit(100)
    if (callError) throw callError
    const accountIds = [...new Set((calls ?? []).map((call) => call.account_id))]
    if (!accountIds.length) return NextResponse.json({ jobs: [] })
    const { data: configs, error: configError } = await db.from('voice_receptionist_configs')
      .select('account_id, elevenlabs_api_key_encrypted')
      .in('account_id', accountIds)
      .eq('enabled', true)
      .eq('realtime_monitoring_enabled', true)
      .not('elevenlabs_api_key_encrypted', 'is', null)
    if (configError) throw configError
    const byAccount = new Map((configs ?? []).map((config) => [
      config.account_id,
      decryptSecret(config.elevenlabs_api_key_encrypted, 'la llave de ElevenLabs'),
    ]))
    const jobs = (calls ?? []).flatMap((call) => {
      const apiKey = byAccount.get(call.account_id)
      return apiKey ? [{
        account_id: call.account_id,
        conversation_id: call.conversation_id,
        api_key: apiKey,
      }] : []
    })
    return NextResponse.json({ jobs })
  } catch (error) {
    console.error('[voice receptionist] monitor job query failed:', error)
    return NextResponse.json({ error: 'Could not load monitor jobs.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json().catch(() => null) as {
      account_id?: unknown
      conversation_id?: unknown
      event?: unknown
    } | null
    if (!body || typeof body.account_id !== 'string' || typeof body.conversation_id !== 'string') {
      return NextResponse.json({ error: 'Invalid monitor event.' }, { status: 400 })
    }
    const db = supabaseAdmin()
    const config = await loadVoiceReceptionistConfig(db, body.account_id)
    if (!config?.enabled || !config.realtime_monitoring_enabled) {
      return NextResponse.json({ error: 'Monitoring is disabled.' }, { status: 409 })
    }
    const { data: call, error } = await db.from('voice_receptionist_calls')
      .select('id, transcript')
      .eq('account_id', body.account_id)
      .eq('conversation_id', body.conversation_id)
      .maybeSingle()
    if (error) throw error
    if (!call) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    const event = body.event as Record<string, unknown> | null
    const transcript = Array.isArray(call.transcript) ? call.transcript : []
    const update = {
      transcript: appendTranscriptEvent(transcript, event),
      status: 'in-progress',
      last_event_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const { error: updateError } = await db.from('voice_receptionist_calls')
      .update(update)
      .eq('id', call.id)
      .eq('account_id', body.account_id)
    if (updateError) throw updateError
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[voice receptionist] monitor event failed:', error)
    return NextResponse.json({ error: 'Could not persist monitor event.' }, { status: 500 })
  }
}
