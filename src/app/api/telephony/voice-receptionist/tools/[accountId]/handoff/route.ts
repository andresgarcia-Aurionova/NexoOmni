import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import {
  decryptSecret,
  findActiveVoiceReceptionistCall,
  loadVoiceReceptionistConfig,
  secretsMatch,
} from '@/lib/telephony/voice-receptionist'

export const dynamic = 'force-dynamic'

function clean(value: unknown, max: number) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, max) : null
}

export async function POST(request: Request, context: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await context.params
  const db = supabaseAdmin()
  try {
    const config = await loadVoiceReceptionistConfig(db, accountId)
    if (!config?.enabled || !config.custom_llm_token_encrypted) {
      return NextResponse.json({ error: 'Voice receptionist tool is disabled.' }, { status: 404 })
    }
    const received = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null
    const expected = decryptSecret(config.custom_llm_token_encrypted, 'el token interno de herramientas')
    if (!secretsMatch(received, expected)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const conversationId = clean(body?.conversation_id, 120)
    const summary = clean(body?.summary, 800)
    if (!conversationId || !summary) {
      return NextResponse.json({ error: 'conversation_id and summary are required.' }, { status: 400 })
    }
    const call = await findActiveVoiceReceptionistCall(db, accountId, conversationId)
    if (!call) {
      return NextResponse.json({ error: 'No active voice conversation matches the request.' }, { status: 409 })
    }
    const { error } = await db.from('yeastar_call_handoffs').upsert({
      account_id: accountId,
      call_id: call.callId,
      customer_phone: call.phone,
      summary,
      customer_need: clean(body?.customer_need, 400),
      next_action: clean(body?.next_action, 400),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id,call_id' })
    if (error) throw error
    return NextResponse.json({ data: { saved: true, call_id: call.callId } })
  } catch (error) {
    console.error('[voice receptionist] handoff tool failed:', error)
    return NextResponse.json({ error: 'Could not save handoff context.' }, { status: 500 })
  }
}
