CREATE OR REPLACE FUNCTION public.account_ai_credit_monthly_usage_summary(
  p_account_id uuid,
  p_month_start timestamptz
)
RETURNS TABLE (
  activity text,
  operation_count text,
  credits_used text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  -- Invoker security preserves the account-scoped ledger RLS policy.
  SELECT
    CASE
      WHEN ledger.metadata->>'source' = 'zernio_whatsapp_call'
        THEN 'whatsapp_call'
      WHEN ledger.metadata->>'mode' IN (
        'auto_reply',
        'draft',
        'analysis',
        'report',
        'call_summary',
        'voice_transcription',
        'image_description',
        'embeddings',
        'credential_test'
      )
        THEN ledger.metadata->>'mode'
      ELSE 'other'
    END AS activity,
    count(*)::text AS operation_count,
    sum(-ledger.delta_credits::numeric)::text AS credits_used
  FROM public.ai_credit_ledger AS ledger
  WHERE ledger.account_id = p_account_id
    AND ledger.entry_type = 'usage'
    AND ledger.delta_credits < 0
    AND p_month_start = (
      date_trunc('month', p_month_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    )
    AND ledger.created_at >= p_month_start
    AND ledger.created_at < (
      ((p_month_start AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC'
    )
  GROUP BY 1
  ORDER BY 1;
$$;

ALTER FUNCTION public.account_ai_credit_monthly_usage_summary(uuid, timestamptz)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.account_ai_credit_monthly_usage_summary(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_ai_credit_monthly_usage_summary(uuid, timestamptz)
  TO authenticated;
