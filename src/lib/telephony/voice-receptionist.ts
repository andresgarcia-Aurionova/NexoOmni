import type { SupabaseClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'

import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { findExistingContact, normalizeKey } from '@/lib/contacts/dedupe'

export const DEFAULT_RECEPTIONIST_LANGUAGE = 'es'
export const DEFAULT_RECEPTIONIST_TIMEZONE = 'America/Mexico_City'

export type VoiceReceptionistCall = {
  id: string
  conversation_id: string
  caller_number: string | null
  called_number: string | null
  contact_id: string | null
  status: string
  transcript: unknown[]
  summary: string | null
  source_metadata: Record<string, unknown>
  started_at: string | null
  ended_at: string | null
  last_event_at: string
}

export type VoiceReceptionistConfig = {
  account_id: string
  enabled: boolean
  display_name: string
  yeastar_extension: string
  elevenlabs_agent_id: string | null
  elevenlabs_voice_id: string | null
  elevenlabs_api_key_encrypted: string | null
  initiation_secret_encrypted: string | null
  post_call_secret_encrypted: string | null
  language: string
  timezone: string
  first_message: string | null
  system_prompt: string | null
  use_nexo_knowledge: boolean
  transfer_sip_uri: string | null
  fallback_phone: string | null
  max_duration_seconds: number
  silence_end_call_seconds: number
  transcription_mode: 'post_call' | 'turns' | 'enterprise'
  custom_llm_token_encrypted: string | null
  post_call_webhook_id: string | null
  realtime_monitoring_enabled: boolean
  last_provider_sync_at: string | null
  last_provider_error: string | null
}

export type VoiceReceptionistPublicConfig = Omit<
  VoiceReceptionistConfig,
'elevenlabs_api_key_encrypted' | 'initiation_secret_encrypted' | 'post_call_secret_encrypted' | 'custom_llm_token_encrypted' | 'post_call_webhook_id' | 'account_id'
> & {
  api_key_configured: boolean
  initiation_secret_configured: boolean
  post_call_secret_configured: boolean
  custom_llm_configured: boolean
}

const SAFE_CONFIG_COLUMNS = [
  'account_id',
  'enabled',
  'display_name',
  'yeastar_extension',
  'elevenlabs_agent_id',
  'elevenlabs_voice_id',
  'elevenlabs_api_key_encrypted',
  'initiation_secret_encrypted',
  'post_call_secret_encrypted',
  'language',
  'timezone',
  'first_message',
  'system_prompt',
  'use_nexo_knowledge',
  'transfer_sip_uri',
  'fallback_phone',
  'max_duration_seconds',
  'silence_end_call_seconds',
  'transcription_mode',
  'custom_llm_token_encrypted',
  'post_call_webhook_id',
  'realtime_monitoring_enabled',
  'last_provider_sync_at',
  'last_provider_error',
].join(', ')

export async function loadVoiceReceptionistConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<VoiceReceptionistConfig | null> {
  const { data, error } = await db
    .from('voice_receptionist_configs')
    .select(SAFE_CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return data as VoiceReceptionistConfig | null
}

export function publicVoiceReceptionistConfig(
  config: VoiceReceptionistConfig | null,
): VoiceReceptionistPublicConfig {
  if (!config) {
    return {
      enabled: false,
      display_name: 'Recepcionista virtual',
      yeastar_extension: '',
      elevenlabs_agent_id: null,
      elevenlabs_voice_id: null,
      language: DEFAULT_RECEPTIONIST_LANGUAGE,
      timezone: DEFAULT_RECEPTIONIST_TIMEZONE,
      first_message: null,
      system_prompt: null,
      use_nexo_knowledge: true,
      transfer_sip_uri: null,
      fallback_phone: null,
      max_duration_seconds: 900,
      silence_end_call_seconds: 20,
      transcription_mode: 'turns',
      realtime_monitoring_enabled: false,
      last_provider_sync_at: null,
      last_provider_error: null,
      api_key_configured: false,
      initiation_secret_configured: false,
      post_call_secret_configured: false,
      custom_llm_configured: false,
    }
  }
  const {
    account_id: accountId,
    elevenlabs_api_key_encrypted,
    initiation_secret_encrypted,
    post_call_secret_encrypted,
    custom_llm_token_encrypted,
    post_call_webhook_id: _postCallWebhookId,
    ...safe
  } = config
  void accountId
  void _postCallWebhookId
  return {
    ...safe,
    api_key_configured: Boolean(elevenlabs_api_key_encrypted),
    initiation_secret_configured: Boolean(initiation_secret_encrypted),
    post_call_secret_configured: Boolean(post_call_secret_encrypted),
    custom_llm_configured: Boolean(custom_llm_token_encrypted),
  }
}

export function encryptedReplacement(
  incoming: unknown,
  existing: string | null,
  fieldName: string,
): string | null {
  if (typeof incoming !== 'string') return existing
  if (!incoming.trim()) return existing
  if (incoming.length > 4096) throw new Error(`${fieldName} excede el tamaño permitido.`)
  return encrypt(incoming.trim())
}

export function decryptSecret(value: string | null, name: string): string {
  if (!value) throw new Error(`Falta configurar ${name}.`)
  try {
    return decrypt(value)
  } catch (error) {
    throw new Error(`No se pudo descifrar ${name}. Verifica ENCRYPTION_KEY.`, { cause: error })
  }
}

export function secretsMatch(received: string | null, expected: string): boolean {
  if (!received) return false
  const actual = Buffer.from(received)
  const reference = Buffer.from(expected)
  return actual.length === reference.length && timingSafeEqual(actual, reference)
}

export function normalizePhoneForCall(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const trimmed = String(value).trim()
  return /^\+?\d{7,16}$/.test(trimmed) ? trimmed : null
}

export async function findActiveVoiceReceptionistCall(
  db: SupabaseClient,
  accountId: string,
  conversationId: string | null,
) {
  if (!conversationId) return null
  const { data, error } = await db.from('voice_receptionist_calls')
    .select('conversation_id, caller_number, started_at, last_event_at')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .in('status', ['initiated', 'in-progress'])
    .maybeSingle()
  if (error) throw error
  if (!data?.caller_number) return null
  const phone = normalizeKey(data.caller_number)
  return phone ? { callId: `voice:${data.conversation_id}`, phone } : null
}

export function transcriptText(transcript: unknown): string | null {
  if (!Array.isArray(transcript)) return null
  const lines = transcript.flatMap((turn) => {
    if (!turn || typeof turn !== 'object') return []
    const row = turn as Record<string, unknown>
    const message = typeof row.message === 'string'
      ? row.message
      : typeof row.text === 'string'
        ? row.text
        : null
    if (!message?.trim()) return []
    const role = row.role === 'agent' || row.role === 'assistant'
      ? 'Recepcionista'
      : row.role === 'user'
        ? 'Cliente'
        : 'Sistema'
    return [`${role}: ${message.trim()}`]
  })
  return lines.length ? lines.join('\n') : null
}

export async function loadCallPersonalization(
  db: SupabaseClient,
  accountId: string,
  callerNumber: string | null,
  config: VoiceReceptionistConfig,
) {
  const contact = callerNumber ? await findExistingContact(db, accountId, callerNumber) : null
  const [accountResult, memoryResult, commitmentsResult, knowledgeResult] = await Promise.all([
    db.from('accounts').select('name').eq('id', accountId).maybeSingle(),
    contact
      ? db.from('contact_memory').select('current_summary, next_best_action')
        .eq('account_id', accountId).eq('contact_id', contact.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    contact
      ? db.from('contact_commitments').select('description').eq('account_id', accountId)
        .eq('contact_id', contact.id).eq('status', 'pending')
        .order('due_date', { ascending: true, nullsFirst: false }).limit(3)
      : Promise.resolve({ data: [], error: null }),
    config.use_nexo_knowledge
      ? db.from('ai_knowledge_documents').select('title, content').eq('account_id', accountId)
        .order('updated_at', { ascending: false }).limit(40)
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const result of [accountResult, memoryResult, commitmentsResult, knowledgeResult]) {
    if (result.error) throw result.error
  }
  const { data: account } = accountResult
  const { data: memory } = memoryResult
  const { data: commitments } = commitmentsResult
  const { data: knowledge } = knowledgeResult
  const businessContext = (knowledge ?? [])
    .map((doc) => `${doc.title}\n${doc.content}`)
    .join('\n\n')
    .slice(0, 120_000)

  return {
    contactId: contact?.id ?? null,
    variables: {
      account_name: account?.name ?? '',
      caller_name: contact?.name ?? '',
      caller_phone: callerNumber ?? '',
      memory_summary: memory?.current_summary ?? '',
      next_best_action: memory?.next_best_action ?? '',
      pending_commitments: (commitments ?? []).map((item) => item.description),
      business_context: businessContext,
      receptionist_extension: config.yeastar_extension,
      nexoomni_conversation_id: '',
      transfer_sip_uri: config.transfer_sip_uri ?? '',
      fallback_phone: config.fallback_phone ?? '',
      current_timezone: config.timezone,
    },
  }
}

export function appendTranscriptEvent(transcript: unknown[], event: unknown): unknown[] {
  if (!event || typeof event !== 'object') return transcript
  const row = event as Record<string, unknown>
  let turn: Record<string, unknown> | null = null
  if (row.type === 'user_transcript' || row.type === 'tentative_user_transcript') {
    const body = row.user_transcription_event as Record<string, unknown> | undefined
    const text = typeof body?.user_transcript === 'string' ? body.user_transcript.trim() : ''
    if (text && row.type === 'user_transcript') turn = { role: 'user', message: text, at: new Date().toISOString() }
  }
  if (row.type === 'agent_response') {
    const body = row.agent_response_event as Record<string, unknown> | undefined
    const text = typeof body?.agent_response === 'string' ? body.agent_response.trim() : ''
    if (text) turn = { role: 'agent', message: text, at: new Date().toISOString() }
  }
  if (!turn) return transcript
  const last = transcript.at(-1)
  if (last && typeof last === 'object') {
    const previous = last as Record<string, unknown>
    if (previous.role === turn.role && previous.message === turn.message) return transcript
  }
  return [...transcript, turn].slice(-500)
}
