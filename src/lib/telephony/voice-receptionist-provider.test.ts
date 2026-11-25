import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  syncVoiceReceptionistAgent,
} from '@/lib/telephony/voice-receptionist-provider'
import type { VoiceReceptionistConfig } from '@/lib/telephony/voice-receptionist'

const config: VoiceReceptionistConfig = {
  account_id: 'account-1',
  enabled: false,
  display_name: 'Nexo Recepción',
  yeastar_extension: '2005',
  elevenlabs_agent_id: null,
  elevenlabs_voice_id: null,
  elevenlabs_api_key_encrypted: 'encrypted',
  initiation_secret_encrypted: 'encrypted',
  post_call_secret_encrypted: 'encrypted',
  language: 'es',
  timezone: 'America/Mexico_City',
  first_message: 'Hola.',
  system_prompt: 'Sé breve.',
  use_nexo_knowledge: true,
  transfer_sip_uri: 'sip:2004@pbx.example.com',
  fallback_phone: null,
  max_duration_seconds: 900,
  silence_end_call_seconds: 20,
  transcription_mode: 'turns',
  custom_llm_token_encrypted: 'encrypted',
  post_call_webhook_id: 'webhook-1',
  realtime_monitoring_enabled: false,
  last_provider_sync_at: null,
  last_provider_error: null,
}

const options = {
  customLlmUrl: 'https://nexoomni.example/custom-llm',
  initiationWebhookUrl: 'https://nexoomni.example/initiation',
  initiationWebhookSecret: 'initiation-secret',
  postCallWebhookId: 'webhook-1',
  handoffToolUrl: 'https://nexoomni.example/handoff',
  internalToolToken: 'internal-token',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('voice receptionist provider', () => {
  it('describes the boolean result returned by the handoff webhook tool', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ agent_id: 'agent-1' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await syncVoiceReceptionistAgent(config, 'api-key', options)

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const saved = body.conversation_config.agent.prompt.tools[0]
      .api_schema.response_body_schema.properties.data.properties.saved
    expect(saved).toEqual({
      type: 'boolean',
      description: 'Indica si NexoOmni guardó el contexto antes de transferir.',
    })
    expect(body.conversation_config.turn).not.toHaveProperty('noisy_environment_detection')
    expect(body.conversation_config.agent.prompt.custom_llm.url)
      .toBe('https://nexoomni.example/custom-llm')
    expect(body.conversation_config.agent.prompt.built_in_tools.transfer_to_number.params)
      .toMatchObject({
        system_tool_type: 'transfer_to_number',
        transfers: [],
        transfer_rules: [{
          provider_configs: [{
            type: 'sip_trunk',
            config: {
              type: 'sip_cold_conference_transfer',
              transfer_destination: {
                type: 'phone',
                destination: '2004',
              },
            },
          }],
        }],
      })
  })

  it('preserves structured validation details from ElevenLabs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      Response.json({ detail: [{ loc: ['body', 'tools'], msg: 'Campo inválido' }] }, {
        status: 422,
      }),
    ))

    await expect(
      syncVoiceReceptionistAgent(config, 'api-key', options),
    ).rejects.toThrow('Campo inválido')
  })
})
