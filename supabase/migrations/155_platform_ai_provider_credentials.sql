-- Store provider credentials separately from tenant-editable AI settings.
-- Existing encrypted keys are copied without decrypting or changing them.
CREATE TABLE IF NOT EXISTS public.ai_provider_credentials (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  credential_type text NOT NULL DEFAULT 'chat'
    CHECK (credential_type IN ('chat', 'embeddings')),
  encrypted_api_key text NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, provider, credential_type),
  CHECK (credential_type <> 'embeddings' OR provider = 'openai')
);

ALTER TABLE public.ai_provider_credentials ENABLE ROW LEVEL SECURITY;
-- Intentionally no user policies: only authenticated server routes using
-- service_role may access provider credentials after platform authorization.
REVOKE ALL ON TABLE public.ai_provider_credentials
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_provider_credentials TO service_role;

INSERT INTO public.ai_provider_credentials (
  account_id,
  provider,
  credential_type,
  encrypted_api_key,
  updated_by,
  updated_at
)
SELECT
  account_id,
  provider,
  'chat',
  api_key,
  created_by,
  updated_at
FROM public.ai_configs
WHERE NULLIF(api_key, '') IS NOT NULL
ON CONFLICT (account_id, provider, credential_type) DO NOTHING;

INSERT INTO public.ai_provider_credentials (
  account_id,
  provider,
  credential_type,
  encrypted_api_key,
  updated_by,
  updated_at
)
SELECT
  account_id,
  'openai',
  'embeddings',
  embeddings_api_key,
  created_by,
  updated_at
FROM public.ai_configs
WHERE NULLIF(embeddings_api_key, '') IS NOT NULL
ON CONFLICT (account_id, provider, credential_type) DO NOTHING;

-- Config is now server-only. Tenant settings are read and written through
-- /api/ai/config after its account membership/role checks.
REVOKE ALL ON TABLE public.ai_configs
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_configs TO service_role;

-- Usage rows contain provider/model identifiers. All reporting is served
-- through authenticated server routes, with customer responses aggregated
-- without those identifiers.
REVOKE ALL ON TABLE public.ai_usage_log
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_usage_log TO service_role;

-- Keep conversation analysis readable for existing tenant workflows, but
-- do not expose its model column via direct PostgREST queries or Realtime.
REVOKE ALL ON TABLE public.ai_conversation_analyses
  FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  account_id,
  conversation_id,
  source,
  status,
  summary,
  sentiment,
  sentiment_score,
  next_best_action,
  reasons,
  analyzed_message_count,
  analyzed_at,
  error_message,
  created_at,
  updated_at,
  negative_alerted_at,
  qa_score,
  qa_empathy_score,
  qa_objection_handling_score,
  qa_script_adherence_score,
  qa_summary,
  qa_findings,
  insights,
  intent,
  urgency,
  lead_temperature,
  handoff_required,
  recommended_department,
  recommended_queue_id
) ON TABLE public.ai_conversation_analyses TO authenticated;
GRANT ALL ON TABLE public.ai_conversation_analyses TO service_role;
