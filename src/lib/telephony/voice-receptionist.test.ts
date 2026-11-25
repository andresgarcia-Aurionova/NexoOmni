import { describe, expect, it } from 'vitest'

import {
  appendTranscriptEvent,
  normalizePhoneForCall,
  publicVoiceReceptionistConfig,
  transcriptText,
} from './voice-receptionist'

describe('voice receptionist helpers', () => {
  it('normalizes only plausible phone identifiers', () => {
    expect(normalizePhoneForCall('+525512345678')).toBe('+525512345678')
    expect(normalizePhoneForCall('55512345678')).toBe('55512345678')
    expect(normalizePhoneForCall('sip:1000@pbx.example.test')).toBeNull()
    expect(normalizePhoneForCall('anonymous')).toBeNull()
  })

  it('appends stable committed live turns and suppresses duplicates', () => {
    const userEvent = {
      type: 'user_transcript',
      user_transcription_event: { user_transcript: 'Necesito una cita.' },
    }
    const tentative = {
      type: 'tentative_user_transcript',
      user_transcription_event: { user_transcript: 'Necesito una...' },
    }
    const first = appendTranscriptEvent([], userEvent)
    const second = appendTranscriptEvent(first, tentative)
    const third = appendTranscriptEvent(second, userEvent)
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(third).toHaveLength(1)
    expect(transcriptText(third)).toContain('Cliente: Necesito una cita.')
  })

  it('does not expose encrypted provider credentials', () => {
    const publicConfig = publicVoiceReceptionistConfig({
      account_id: 'account-1',
      enabled: false,
      display_name: 'Recepción',
      yeastar_extension: '7001',
      elevenlabs_agent_id: 'agent-1',
      elevenlabs_voice_id: 'voice-1',
      elevenlabs_api_key_encrypted: 'encrypted-key',
      initiation_secret_encrypted: 'encrypted-initiation',
      post_call_secret_encrypted: 'encrypted-post',
      language: 'es',
      timezone: 'America/Mexico_City',
      first_message: null,
      system_prompt: null,
      use_nexo_knowledge: true,
      transfer_sip_uri: null,
      fallback_phone: null,
      max_duration_seconds: 900,
      silence_end_call_seconds: 20,
      transcription_mode: 'turns',
      custom_llm_token_encrypted: 'encrypted-custom-token',
      post_call_webhook_id: 'webhook-1',
      realtime_monitoring_enabled: true,
      last_provider_sync_at: null,
      last_provider_error: null,
    })
    expect(publicConfig.api_key_configured).toBe(true)
    expect(publicConfig).not.toHaveProperty('elevenlabs_api_key_encrypted')
    expect(publicConfig).not.toHaveProperty('account_id')
  })
})
