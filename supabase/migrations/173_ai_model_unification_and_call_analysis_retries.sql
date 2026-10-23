-- 1) Unify AI models: every account on a plan with AI drops its per-account
--    model overrides so the platform routing policy (src/lib/ai/model-routing.ts)
--    decides the model per task. Accounts on the 'basic' plan (no AI) are left
--    untouched and are unified when they upgrade (run this block again).
UPDATE public.ai_configs c
SET analysis_model = NULL,
    image_analysis_model = NULL,
    voice_transcription_model = NULL,
    model = CASE c.provider
      WHEN 'anthropic' THEN 'claude-sonnet-5-5'
      ELSE 'gpt-5.6-terra'
    END,
    updated_at = now()
WHERE NOT EXISTS (
  SELECT 1
  FROM public.account_subscriptions s
  WHERE s.account_id = c.account_id
    AND s.plan_code = 'basic'
);

-- 2) Cap call-analysis retries. Without a cap a failing analysis was retried
--    every 5 minutes forever and each attempt could be billed.
ALTER TABLE public.yeastar_call_transcriptions
  ADD COLUMN IF NOT EXISTS analysis_attempts integer NOT NULL DEFAULT 0;
