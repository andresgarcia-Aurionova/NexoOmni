import type { VoiceReceptionistConfig } from './voice-receptionist'
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io'

// These identifiers are provider-internal. NexoOmni exposes capabilities and
// quality profiles, never model/provider names, in tenant-facing settings.
const RECEPTIONIST_LLM = 'gpt-5.6-luna'
const RECEPTIONIST_TTS_MODEL = 'eleven_v4_turbo'

type ElevenLabsVoice = {
  voice_id: string
  name: string
  category?: string
  labels?: Record<string, string>
}

async function elevenLabsRequest<T>(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${ELEVENLABS_API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      ...init?.headers,
    },
    signal: AbortSignal.timeout(25_000),
  })
  const body = await response.json().catch(() => ({})) as { detail?: unknown; message?: string } & T
  if (!response.ok) {
    const detail = typeof body.detail === 'string'
      ? body.detail
      : typeof body.message === 'string'
        ? body.message
        : body.detail
          ? JSON.stringify(body.detail)
          : `HTTP ${response.status}`
    throw new Error(`ElevenLabs rechazó la configuración: ${detail}`)
  }
  return body
}

export function receptionistPrompt(config: VoiceReceptionistConfig): string {
  const transfer = config.transfer_sip_uri || config.fallback_phone
    ? 'Cuando debas transferir, ejecuta primero la herramienta que guarda el contexto en NexoOmni y transfiere solo si esa herramienta confirma data.saved = true.'
    : 'No prometas transferencias. Si no puedes resolver, informa que pasarás la solicitud al equipo y usa la herramienta de handoff disponible.'
  return [
    `Eres ${config.display_name}, la recepcionista virtual de {{account_name}}.`,
    'Habla de forma breve, cálida y natural. Haz una pregunta a la vez.',
    'No inventes horarios, precios, disponibilidad, datos de clientes ni resultados de herramientas.',
    'Confirma datos importantes repitiendo únicamente lo que el cliente te indicó.',
    'Cuando una herramienta devuelva un error, no afirmes que la acción se completó. Explica que revisarás o que transferirás la llamada.',
    'Usa {{business_context}} como la fuente principal de información operativa.',
    'Contexto del cliente disponible: {{caller_name}}, {{memory_summary}}, {{next_best_action}}, {{pending_commitments}}.',
    transfer,
    'Escala inmediatamente a una persona ante una emergencia, amenaza, fraude, solicitud sensible, queja grave o cuando el cliente lo pida.',
    config.system_prompt?.trim() || '',
  ].filter(Boolean).join('\n')
}

export async function syncVoiceReceptionistAgent(
  config: VoiceReceptionistConfig,
  apiKey: string,
  options: {
    customLlmUrl: string
    initiationWebhookUrl: string
    initiationWebhookSecret: string
    postCallWebhookId: string
    handoffToolUrl: string
    internalToolToken: string
  },
): Promise<string> {
  const usesCustomLlm = config.transcription_mode === 'turns'
  const transfers = [
    config.transfer_sip_uri ? {
      transfer_destination: { type: 'sip_uri', sip_uri: config.transfer_sip_uri },
      transfer_type: 'sip_refer',
      sip_refer_play_dialtone: true,
      condition: 'El cliente pide una persona o la solicitud supera los límites seguros de la recepcionista.',
    } : null,
    config.fallback_phone ? {
      transfer_destination: { type: 'phone', phone_number: config.fallback_phone },
      transfer_type: 'blind',
      condition: 'El destino SIP no está disponible o no existe una ruta SIP de transferencia.',
    } : null,
  ].filter(Boolean)
  const payload = {
    name: `NexoOmni · ${config.display_name}`,
    conversation_config: {
      asr: {
        provider: 'scribe_realtime',
        user_input_audio_format: 'ulaw_8000',
      },
      turn: {
        turn_eagerness: 'normal',
        spelling_patience: 'auto',
        silence_end_call_timeout: config.silence_end_call_seconds,
      },
      tts: {
        model_id: RECEPTIONIST_TTS_MODEL,
        ...(config.elevenlabs_voice_id ? { voice_id: config.elevenlabs_voice_id } : {}),
        agent_output_audio_format: 'ulaw_8000',
      },
      conversation: {
        max_duration_seconds: config.max_duration_seconds,
        monitoring_enabled: config.transcription_mode === 'enterprise',
        monitoring_events: [
          'user_transcript',
          'agent_response',
          'agent_response_correction',
          'agent_tool_request',
          'agent_tool_response',
        ],
        source_attribution: false,
      },
      agent: {
        first_message: config.first_message ?? '',
        language: config.language,
        dynamic_variables: {
          dynamic_variable_placeholders: {
            account_name: '',
            caller_name: '',
            caller_phone: '',
            memory_summary: '',
            next_best_action: '',
            pending_commitments: [],
            nexoomni_conversation_id: '',
            business_context: '',
            receptionist_extension: config.yeastar_extension,
            transfer_sip_uri: config.transfer_sip_uri ?? '',
            fallback_phone: config.fallback_phone ?? '',
            current_timezone: config.timezone,
          },
        },
        prompt: {
          prompt: receptionistPrompt(config),
          llm: usesCustomLlm ? 'custom-llm' : RECEPTIONIST_LLM,
          ...(usesCustomLlm ? {
            custom_llm: {
              url: options.customLlmUrl,
              model_id: 'nexoomni-voice',
              api_type: 'chat_completions',
            },
            backup_llm_config: {
              preference: 'override',
              order: ['claude-sonnet-5-5', 'gpt-5.6-luna'],
            },
            cascade_timeout_seconds: 5,
          } : {}),
          timezone: config.timezone,
          ...(transfers.length ? {
            built_in_tools: {
              transfer_to_number: {
                type: 'system',
                name: 'transfer_to_number',
                params: {
                  system_tool_type: 'transfer_to_number',
                  transfers,
                  enable_client_message: true,
                },
              },
              end_call: {
                type: 'system',
                name: 'end_call',
                params: { system_tool_type: 'end_call' },
              },
              skip_turn: {
                type: 'system',
                name: 'skip_turn',
                params: { system_tool_type: 'skip_turn' },
              },
            },
          } : {}),
          tools: [
            {
              type: 'webhook',
              name: 'nexoomni_guardar_contexto',
              description: 'Guarda el motivo de la llamada y la siguiente acción antes de transferir a una persona.',
              response_timeout_secs: 15,
              pre_tool_speech: 'force',
              api_schema: {
                url: options.handoffToolUrl,
                method: 'POST',
                request_headers: {
                  Authorization: `Bearer ${options.internalToolToken}`,
                },
                request_body_schema: {
                  type: 'object',
                  required: ['conversation_id', 'summary'],
                  properties: {
                    conversation_id: {
                      type: 'string',
                      dynamic_variable: 'nexoomni_conversation_id',
                    },
                    summary: {
                      type: 'string',
                      description: 'Resumen factual en dos o tres frases: necesidad, lo ya resuelto y lo pendiente.',
                    },
                    customer_need: {
                      type: 'string',
                      description: 'Necesidad concreta del cliente.',
                    },
                    next_action: {
                      type: 'string',
                      description: 'Acción que debe realizar la persona que recibe la llamada.',
                    },
                  },
                },
                response_body_schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: {
                      type: 'object',
                      required: ['saved'],
                      properties: {
                        saved: {
                          type: 'boolean',
                          description: 'Indica si NexoOmni guardó el contexto antes de transferir.',
                        },
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
    platform_settings: {
      overrides: {
        custom_llm_extra_body: usesCustomLlm,
        enable_conversation_initiation_client_data_from_webhook: true,
      },
      workspace_overrides: {
        conversation_initiation_client_data_webhook: {
          url: options.initiationWebhookUrl,
          request_headers: {
            'x-nexoomni-webhook-secret': options.initiationWebhookSecret,
          },
        },
        webhooks: {
          post_call_webhook_id: options.postCallWebhookId,
          events: ['transcript', 'call_initiation_failure'],
        },
      },
      privacy: {
        record_voice: false,
        retention_days: 30,
        delete_audio: true,
      },
    },
  }
  if (config.elevenlabs_agent_id) {
    const response = await elevenLabsRequest<{ agent_id: string }>(
      apiKey,
      `/v1/convai/agents/${encodeURIComponent(config.elevenlabs_agent_id)}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
    )
    return response.agent_id
  }
  const response = await elevenLabsRequest<{ agent_id: string }>(
    apiKey,
    '/v1/convai/agents/create',
    { method: 'POST', body: JSON.stringify(payload) },
  )
  return response.agent_id
}

export async function ensureVoiceReceptionistWebhook(
  apiKey: string,
  accountId: string,
  webhookUrl: string,
): Promise<{ webhookId: string; webhookSecret: string | null }> {
  const client = new ElevenLabsClient({ apiKey })
  const result = await client.webhooks.list({ includeUsages: false })
  const existing = result.webhooks.find((webhook) =>
    webhook.webhookUrl === webhookUrl && !webhook.isDisabled && !webhook.isAutoDisabled,
  )
  if (existing) return { webhookId: existing.webhookId, webhookSecret: null }
  const created = await client.webhooks.create({
    settings: {
      authType: 'hmac',
      name: `NexoOmni voice receptionist · ${accountId}`,
      webhookUrl,
      logRedactedFields: ['transcript', 'phone', 'caller', 'contact'],
    },
  })
  return {
    webhookId: created.webhookId,
    webhookSecret: created.webhookSecret ?? null,
  }
}

export async function listVoiceReceptionistVoices(apiKey: string) {
  const result = await elevenLabsRequest<{ voices?: ElevenLabsVoice[] }>(
    apiKey,
    '/v1/voices',
  )
  return (result.voices ?? []).map((voice) => ({
    voice_id: voice.voice_id,
    name: voice.name,
    category: voice.category ?? null,
    labels: voice.labels ?? {},
  }))
}
