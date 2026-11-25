CREATE TABLE IF NOT EXISTS public.voice_receptionist_configs (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  display_name text NOT NULL DEFAULT 'Recepcionista virtual',
  yeastar_extension text NOT NULL DEFAULT '',
  elevenlabs_agent_id text,
  elevenlabs_voice_id text,
  elevenlabs_api_key_encrypted text,
  initiation_secret_encrypted text,
  post_call_secret_encrypted text,
  language text NOT NULL DEFAULT 'es',
  timezone text NOT NULL DEFAULT 'America/Mexico_City',
  first_message text,
  system_prompt text,
  use_nexo_knowledge boolean NOT NULL DEFAULT true,
  transfer_sip_uri text,
  fallback_phone text,
  max_duration_seconds integer NOT NULL DEFAULT 900
    CHECK (max_duration_seconds BETWEEN 60 AND 7200),
  silence_end_call_seconds integer NOT NULL DEFAULT 20
    CHECK (silence_end_call_seconds BETWEEN 5 AND 300),
  realtime_monitoring_enabled boolean NOT NULL DEFAULT false,
  last_provider_sync_at timestamptz,
  last_provider_error text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.voice_receptionist_configs ENABLE ROW LEVEL SECURITY;
-- Configuration contains encrypted provider credentials. All access goes
-- through account-scoped server routes; browser RLS never exposes this table.
REVOKE ALL ON TABLE public.voice_receptionist_configs
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.voice_receptionist_configs TO service_role;

CREATE TABLE IF NOT EXISTS public.voice_receptionist_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  agent_id text NOT NULL,
  call_sid text,
  caller_number text,
  called_number text,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated', 'in-progress', 'processing', 'done', 'failed')),
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  last_event_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS voice_receptionist_calls_account_recent_idx
  ON public.voice_receptionist_calls(account_id, last_event_at DESC);
CREATE INDEX IF NOT EXISTS voice_receptionist_calls_active_idx
  ON public.voice_receptionist_calls(status, last_event_at DESC)
  WHERE status IN ('initiated', 'in-progress');
CREATE INDEX IF NOT EXISTS voice_receptionist_calls_contact_idx
  ON public.voice_receptionist_calls(contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

ALTER TABLE public.voice_receptionist_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voice_receptionist_calls_select
  ON public.voice_receptionist_calls;
CREATE POLICY voice_receptionist_calls_select
  ON public.voice_receptionist_calls FOR SELECT
  USING (public.is_account_member(account_id));

DROP TRIGGER IF EXISTS voice_receptionist_configs_updated_at
  ON public.voice_receptionist_configs;
CREATE TRIGGER voice_receptionist_configs_updated_at
  BEFORE UPDATE ON public.voice_receptionist_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS voice_receptionist_calls_updated_at
  ON public.voice_receptionist_calls;
CREATE TRIGGER voice_receptionist_calls_updated_at
  BEFORE UPDATE ON public.voice_receptionist_calls
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
