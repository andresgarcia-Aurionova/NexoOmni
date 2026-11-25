import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import {
  decryptSecret,
  loadCallPersonalization,
  loadVoiceReceptionistConfig,
  normalizePhoneForCall,
  secretsMatch,
} from '@/lib/telephony/voice-receptionist'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ accountId: string }> }

export async function POST(request: Request, context: Params) {
  const { accountId } = await context.params
  const db = supabaseAdmin()
  try {
    const config = await loadVoiceReceptionistConfig(db, accountId)
    if (!config?.enabled || !config.initiation_secret_encrypted) {
      return NextResponse.json({ error: 'Voice receptionist is not configured.' }, { status: 404 })
    }
    const secret = decryptSecret(config.initiation_secret_encrypted, 'el secreto de inicio')
    const authorization = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null
    const supplied = request.headers.get('x-nexoomni-webhook-secret') || authorization
    if (!secretsMatch(supplied, secret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body || typeof body.agent_id !== 'string' || typeof body.conversation_id !== 'string') {
      return NextResponse.json({ error: 'Invalid initiation payload.' }, { status: 400 })
    }
    if (body.agent_id !== config.elevenlabs_agent_id) {
      return NextResponse.json({ error: 'Agent does not belong to this account.' }, { status: 403 })
    }
    const callerNumber = normalizePhoneForCall(body.caller_id)
    const calledNumber = normalizePhoneForCall(body.called_number)
    const personalization = await loadCallPersonalization(db, accountId, callerNumber, config)
    const sipHeaders = body.sip_headers && typeof body.sip_headers === 'object'
      ? body.sip_headers as Record<string, unknown>
      : {}
    const callSid = typeof body.call_sid === 'string' ? body.call_sid : null
    const { error } = await db.from('voice_receptionist_calls').upsert({
      account_id: accountId,
      conversation_id: body.conversation_id,
      agent_id: body.agent_id,
      call_sid: callSid,
      caller_number: callerNumber,
      called_number: calledNumber,
      contact_id: personalization.contactId,
      status: 'initiated',
      source_metadata: { sip_headers: sipHeaders },
      started_at: new Date().toISOString(),
      last_event_at: new Date().toISOString(),
    }, { onConflict: 'account_id,conversation_id' })
    if (error) throw error
    return NextResponse.json({
      type: 'conversation_initiation_client_data',
        ...(config.transcription_mode === 'turns' && config.custom_llm_token_encrypted ? {
          custom_llm_extra_body: {
            account_id: accountId,
            conversation_id: body.conversation_id,
            authorization_token: decryptSecret(config.custom_llm_token_encrypted, 'el token del LLM personalizado'),
          },
        } : {}),
      dynamic_variables: {
        ...personalization.variables,
        nexoomni_conversation_id: body.conversation_id,
      },
      user_id: personalization.contactId ?? undefined,
    })
  } catch (error) {
    console.error('[voice receptionist] initiation webhook failed:', error)
    return NextResponse.json({ error: 'Could not initialize call context.' }, { status: 500 })
  }
}
