import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  decryptSecret,
  encryptedReplacement,
  loadVoiceReceptionistConfig,
  publicVoiceReceptionistConfig,
  type VoiceReceptionistConfig,
} from '@/lib/telephony/voice-receptionist'
import {
  ensureVoiceReceptionistWebhook,
  listVoiceReceptionistVoices,
  syncVoiceReceptionistAgent,
} from '@/lib/telephony/voice-receptionist-provider'

export const dynamic = 'force-dynamic'

function publicOrigin(request: Request) {
  const host = request.headers.get('x-forwarded-host')?.split(',', 1)[0]?.trim()
  const protocol = request.headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim() || 'https'
  return host ? `${protocol}://${host}` : new URL(request.url).origin
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function boundedText(value: unknown, fallback: string | null, max: number, field: string) {
  if (value == null) return fallback
  if (typeof value !== 'string') throw new Error(`${field} debe ser texto.`)
  const text = value.trim()
  if (text.length > max) throw new Error(`${field} supera ${max} caracteres.`)
  return text || null
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number, field: string) {
  if (value == null) return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${field} debe ser un entero entre ${min} y ${max}.`)
  }
  return number
}

export async function GET(request: Request) {
  try {
    const { accountId } = await requireEntitlement('yeastar_telephony', 'admin')
    const db = supabaseAdmin()
    const config = await loadVoiceReceptionistConfig(db, accountId)
    const { data: calls, error } = await db.from('voice_receptionist_calls')
      .select('id, conversation_id, caller_number, called_number, contact_id, status, transcript, summary, source_metadata, started_at, ended_at, last_event_at')
      .eq('account_id', accountId)
      .order('last_event_at', { ascending: false })
      .limit(20)
    if (error) throw error
    const origin = publicOrigin(request)
    return NextResponse.json({
      config: publicVoiceReceptionistConfig(config),
      calls: calls ?? [],
      webhook_urls: {
        initiation: `${origin}/api/telephony/voice-receptionist/webhooks/${accountId}/initiation`,
        post_call: `${origin}/api/telephony/voice-receptionist/webhooks/${accountId}/post-call`,
        custom_llm: `${origin}/api/telephony/voice-receptionist/custom-llm/${accountId}/chat/completions`,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  try {
    const { accountId, userId } = await requireEntitlement('yeastar_telephony', 'admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return badRequest('Se esperaba un objeto JSON.')
    const db = supabaseAdmin()
    const current = await loadVoiceReceptionistConfig(db, accountId)

    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : current?.display_name ?? 'Recepcionista virtual'
    if (!displayName || displayName.length > 120) return badRequest('display_name debe tener entre 1 y 120 caracteres.')
    const extension = typeof body.yeastar_extension === 'string'
      ? body.yeastar_extension.trim()
      : current?.yeastar_extension ?? ''
    if (extension && !/^\d{2,12}$/.test(extension)) return badRequest('yeastar_extension debe contener únicamente de 2 a 12 dígitos.')
    const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : current?.timezone ?? 'America/Mexico_City'
    try { Intl.DateTimeFormat(undefined, { timeZone: timezone }) } catch { return badRequest('timezone no es una zona IANA válida.') }
    const language = typeof body.language === 'string' ? body.language.trim().toLowerCase() : current?.language ?? 'es'
    if (!['es', 'en', 'ko'].includes(language)) return badRequest('language debe ser es, en o ko.')

    const transferSipUri = boundedText(body.transfer_sip_uri, current?.transfer_sip_uri ?? null, 240, 'transfer_sip_uri')
    if (transferSipUri && !/^sip:[^\s@]+@[^\s]+$/i.test(transferSipUri)) return badRequest('transfer_sip_uri debe ser un SIP URI válido.')
    const fallbackPhone = boundedText(body.fallback_phone, current?.fallback_phone ?? null, 32, 'fallback_phone')
    if (fallbackPhone && !/^\+?\d{7,16}$/.test(fallbackPhone)) return badRequest('fallback_phone debe ser un teléfono internacional.')
    const firstMessage = boundedText(body.first_message, current?.first_message ?? null, 1200, 'first_message')
    const systemPrompt = boundedText(body.system_prompt, current?.system_prompt ?? null, 12_000, 'system_prompt')
    const voiceId = boundedText(body.elevenlabs_voice_id, current?.elevenlabs_voice_id ?? null, 160, 'elevenlabs_voice_id')
    const apiKeyEncrypted = encryptedReplacement(body.elevenlabs_api_key, current?.elevenlabs_api_key_encrypted ?? null, 'elevenlabs_api_key')
    const initiationSecretEncrypted = encryptedReplacement(body.initiation_secret, current?.initiation_secret_encrypted ?? null, 'initiation_secret')
      ?? encrypt(randomBytes(32).toString('base64url'))
    let postCallSecretEncrypted = encryptedReplacement(body.post_call_secret, current?.post_call_secret_encrypted ?? null, 'post_call_secret')
    const transcriptionMode = ['post_call', 'turns', 'enterprise'].includes(String(body.transcription_mode))
      ? body.transcription_mode as VoiceReceptionistConfig['transcription_mode']
      : current?.transcription_mode ?? 'turns'
    const customLlmTokenEncrypted = current?.custom_llm_token_encrypted
      ?? encrypt(randomBytes(32).toString('base64url'))
    const enabled = body.enabled === true
    const realtimeMonitoringEnabled = transcriptionMode === 'enterprise'
    if (enabled && (!extension || !apiKeyEncrypted)) {
      return badRequest('Para activar la recepcionista necesitas extensión y llave de ElevenLabs.')
    }

    const next: VoiceReceptionistConfig = {
      account_id: accountId,
      enabled,
      display_name: displayName,
      yeastar_extension: extension,
      elevenlabs_agent_id: current?.elevenlabs_agent_id ?? null,
      elevenlabs_voice_id: voiceId,
      elevenlabs_api_key_encrypted: apiKeyEncrypted,
      initiation_secret_encrypted: initiationSecretEncrypted,
      post_call_secret_encrypted: postCallSecretEncrypted,
      language,
      timezone,
      first_message: firstMessage,
      system_prompt: systemPrompt,
      use_nexo_knowledge: body.use_nexo_knowledge !== false,
      transfer_sip_uri: transferSipUri,
      fallback_phone: fallbackPhone,
      max_duration_seconds: boundedNumber(body.max_duration_seconds, current?.max_duration_seconds ?? 900, 60, 7200, 'max_duration_seconds'),
      silence_end_call_seconds: boundedNumber(body.silence_end_call_seconds, current?.silence_end_call_seconds ?? 20, 5, 300, 'silence_end_call_seconds'),
      transcription_mode: transcriptionMode,
      custom_llm_token_encrypted: customLlmTokenEncrypted,
      post_call_webhook_id: current?.post_call_webhook_id ?? null,
      realtime_monitoring_enabled: realtimeMonitoringEnabled,
      last_provider_sync_at: current?.last_provider_sync_at ?? null,
      last_provider_error: current?.last_provider_error ?? null,
    }

    let providerAgentId = next.elevenlabs_agent_id
    const isEmergencyDisable = current?.enabled === true && !enabled
    if (body.sync_provider !== false && !isEmergencyDisable && apiKeyEncrypted) {
      try {
        const providerKey = decryptSecret(apiKeyEncrypted, 'la llave de ElevenLabs')
        const origin = publicOrigin(request)
        const webhook = await ensureVoiceReceptionistWebhook(
          providerKey,
          accountId,
          `${origin}/api/telephony/voice-receptionist/webhooks/${accountId}/post-call`,
        )
        next.post_call_webhook_id = webhook.webhookId
        if (webhook.webhookSecret) postCallSecretEncrypted = encrypt(webhook.webhookSecret)
        next.post_call_secret_encrypted = postCallSecretEncrypted
        if (!next.post_call_webhook_id || !next.post_call_secret_encrypted) {
          return badRequest('No se pudo obtener el webhook post-llamada. Si ya existe en ElevenLabs, pega su secreto para validar sus entregas.')
        }
        const { error: webhookCheckpointError } = await db.from('voice_receptionist_configs').upsert({
          account_id: accountId,
          initiation_secret_encrypted: initiationSecretEncrypted,
          custom_llm_token_encrypted: customLlmTokenEncrypted,
          post_call_webhook_id: next.post_call_webhook_id,
          post_call_secret_encrypted: next.post_call_secret_encrypted,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'account_id' })
        if (webhookCheckpointError) throw webhookCheckpointError
        providerAgentId = await syncVoiceReceptionistAgent(
          next,
          providerKey,
          {
            customLlmUrl: `${origin}/api/telephony/voice-receptionist/custom-llm/${accountId}/chat/completions`,
            initiationWebhookUrl: `${origin}/api/telephony/voice-receptionist/webhooks/${accountId}/initiation`,
            initiationWebhookSecret: decryptSecret(initiationSecretEncrypted, 'el secreto de inicio'),
            postCallWebhookId: next.post_call_webhook_id,
            handoffToolUrl: `${origin}/api/telephony/voice-receptionist/tools/${accountId}/handoff`,
            internalToolToken: decryptSecret(customLlmTokenEncrypted, 'el token interno de herramientas'),
          },
        )
        next.elevenlabs_agent_id = providerAgentId
        next.last_provider_sync_at = new Date().toISOString()
        next.last_provider_error = null
        const { error: agentCheckpointError } = await db.from('voice_receptionist_configs').upsert({
          account_id: accountId,
          elevenlabs_agent_id: next.elevenlabs_agent_id,
          last_provider_sync_at: next.last_provider_sync_at,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'account_id' })
        if (agentCheckpointError) throw agentCheckpointError
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo sincronizar el agente.'
        return NextResponse.json({ error: message }, { status: 422 })
      }
    }
    if (enabled && (!providerAgentId || !postCallSecretEncrypted || !next.post_call_webhook_id)) {
      return badRequest('Sincroniza el agente y su webhook de ElevenLabs antes de activarlo.')
    }

    const { error } = await db.from('voice_receptionist_configs').upsert({
      ...next,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id' })
    if (error) throw error
    return NextResponse.json({ success: true, agent_id: providerAgentId })
  } catch (error) {
    if (error instanceof Error && /debe ser|supera|descifrar|zona IANA/.test(error.message)) {
      return badRequest(error.message)
    }
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireEntitlement('yeastar_telephony', 'admin')
    const config = await loadVoiceReceptionistConfig(supabaseAdmin(), accountId)
    if (!config?.elevenlabs_api_key_encrypted) {
      return badRequest('Guarda primero la llave de ElevenLabs.')
    }
    const body = await request.json().catch(() => null)
    if (body?.action !== 'list_voices') return badRequest('Acción no compatible.')
    const voices = await listVoiceReceptionistVoices(decryptSecret(config.elevenlabs_api_key_encrypted, 'la llave de ElevenLabs'))
    return NextResponse.json({ voices })
  } catch (error) {
    return toErrorResponse(error)
  }
}
