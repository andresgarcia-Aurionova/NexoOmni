ALTER TABLE public.voice_receptionist_configs
  ADD COLUMN IF NOT EXISTS transcription_mode text NOT NULL DEFAULT 'turns'
    CHECK (transcription_mode IN ('post_call', 'turns', 'enterprise')),
  ADD COLUMN IF NOT EXISTS custom_llm_token_encrypted text,
  ADD COLUMN IF NOT EXISTS post_call_webhook_id text;

COMMENT ON COLUMN public.voice_receptionist_configs.transcription_mode IS
  'post_call waits for the final ElevenLabs webhook; turns persists committed speech through the NexoOmni custom LLM; enterprise enables ElevenLabs live monitoring.';

-- Existing receptions start on the committed-turn path. It does not require
-- ElevenLabs Enterprise and retains post-call HMAC as the durable fallback.
UPDATE public.voice_receptionist_configs
SET transcription_mode = 'turns'
WHERE transcription_mode = 'post_call';
