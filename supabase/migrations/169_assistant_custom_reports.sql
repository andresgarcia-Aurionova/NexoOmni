ALTER TABLE public.assistant_messages
  ADD COLUMN report_data jsonb,
  ADD CONSTRAINT assistant_messages_report_data_check
    CHECK (
      report_data IS NULL
      OR (
        jsonb_typeof(report_data) = 'object'
        AND pg_column_size(report_data) <= 262144
      )
    );
COMMENT ON COLUMN public.assistant_messages.report_data IS
  'Anonymized aggregate report attached to an assistant reply; persisted atomically with its credit debit.';

-- Keep account-visible ledger reads limited to the fields used by the
-- balance history. Aggregation functions below retain controlled access to
-- metadata without exposing provider, model, costs, or grant reasons.
REVOKE SELECT ON TABLE public.ai_credit_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  account_id,
  entry_type,
  delta_credits,
  balance_after,
  created_at
) ON TABLE public.ai_credit_ledger TO authenticated;

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
SECURITY DEFINER
SET search_path = public
AS $$
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
        'credential_test',
        'assistant'
      )
        THEN ledger.metadata->>'mode'
      ELSE 'other'
    END AS activity,
    count(*)::text AS operation_count,
    sum(-ledger.delta_credits::numeric)::text AS credits_used
  FROM public.ai_credit_ledger AS ledger
  WHERE ledger.account_id = p_account_id
    AND public.is_account_member(p_account_id, 'supervisor')
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

CREATE OR REPLACE FUNCTION public.account_ai_credit_report_summary(
  p_account_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  activity text,
  entry_type text,
  operation_count text,
  credits_delta text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_account_id IS NULL
     OR p_from IS NULL
     OR p_to IS NULL
     OR p_to < p_from
     OR p_to - p_from > 364 THEN
    RAISE EXCEPTION 'Invalid AI credit report range' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_account_member(p_account_id, 'supervisor') THEN
    RAISE EXCEPTION 'Account membership required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN ledger.entry_type = 'usage'
        AND ledger.metadata->>'source' = 'zernio_whatsapp_call'
        THEN 'whatsapp_call'
      WHEN ledger.entry_type = 'usage'
        AND ledger.metadata->>'mode' IN (
          'auto_reply',
          'draft',
          'analysis',
          'report',
          'call_summary',
          'voice_transcription',
          'image_description',
          'embeddings',
          'credential_test',
          'assistant'
        )
        THEN ledger.metadata->>'mode'
      WHEN ledger.entry_type = 'usage' THEN 'other'
      ELSE ledger.entry_type
    END,
    ledger.entry_type,
    count(*)::text,
    sum(ledger.delta_credits)::text
  FROM public.ai_credit_ledger AS ledger
  WHERE ledger.account_id = p_account_id
    AND ledger.created_at >= (p_from::timestamp AT TIME ZONE 'UTC')
    AND ledger.created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1, 2
  ORDER BY 1, 2;
END;
$$;

ALTER FUNCTION public.account_ai_credit_report_summary(uuid, date, date)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.account_ai_credit_report_summary(uuid, date, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_ai_credit_report_summary(uuid, date, date)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.account_ai_usage_report_summary(
  p_account_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  activity text,
  operation_count text,
  prompt_tokens text,
  completion_tokens text,
  total_tokens text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_account_id IS NULL
     OR p_from IS NULL
     OR p_to IS NULL
     OR p_to < p_from
     OR p_to - p_from > 364 THEN
    RAISE EXCEPTION 'Invalid AI usage report range' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'Account administrator required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    usage.mode,
    count(*)::text,
    sum(usage.prompt_tokens)::text,
    sum(usage.completion_tokens)::text,
    sum(usage.total_tokens)::text
  FROM public.ai_usage_log AS usage
  WHERE usage.account_id = p_account_id
    AND usage.created_at >= (p_from::timestamp AT TIME ZONE 'UTC')
    AND usage.created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')
  GROUP BY usage.mode
  ORDER BY usage.mode;
END;
$$;

ALTER FUNCTION public.account_ai_usage_report_summary(uuid, date, date)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.account_ai_usage_report_summary(uuid, date, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_ai_usage_report_summary(uuid, date, date)
  TO authenticated;

DROP POLICY IF EXISTS stripe_ai_credit_checkouts_account_select
  ON public.stripe_ai_credit_checkouts;
CREATE POLICY stripe_ai_credit_checkouts_account_select
  ON public.stripe_ai_credit_checkouts
  FOR SELECT
  USING (public.is_account_member(account_id, 'admin'));

GRANT SELECT (
  account_id,
  package_id,
  credits,
  amount_total_mxn_centavos,
  status,
  created_at,
  paid_at
) ON TABLE public.stripe_ai_credit_checkouts TO authenticated;

CREATE OR REPLACE FUNCTION public.record_ai_assistant_turn_with_report(
  p_account_id uuid,
  p_user_id uuid,
  p_thread_id uuid,
  p_user_message_id uuid,
  p_content text,
  p_sources jsonb,
  p_provider text,
  p_model text,
  p_prompt_tokens integer,
  p_completion_tokens integer,
  p_total_tokens integer,
  p_latency_ms integer,
  p_cost_nano_usd bigint,
  p_price_nano_usd bigint,
  p_credits bigint,
  p_idempotency_key text,
  p_report_data jsonb
)
RETURNS TABLE (
  result text,
  available_credits bigint,
  assistant_message_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result record;
  v_updated integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_report_data IS NOT NULL
     AND (
       jsonb_typeof(p_report_data) <> 'object'
       OR pg_column_size(p_report_data) > 262144
     ) THEN
    RAISE EXCEPTION 'Invalid assistant report data' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_result
  FROM public.record_ai_assistant_turn(
    p_account_id,
    p_user_id,
    p_thread_id,
    p_user_message_id,
    p_content,
    p_sources,
    p_provider,
    p_model,
    p_prompt_tokens,
    p_completion_tokens,
    p_total_tokens,
    p_latency_ms,
    p_cost_nano_usd,
    p_price_nano_usd,
    p_credits,
    p_idempotency_key
  );

  IF p_report_data IS NOT NULL AND v_result.assistant_message_id IS NOT NULL THEN
    UPDATE public.assistant_messages
    SET report_data = p_report_data
    WHERE id = v_result.assistant_message_id
      AND account_id = p_account_id
      AND user_id = p_user_id
      AND thread_id = p_thread_id
      AND reply_to_message_id = p_user_message_id
      AND role = 'assistant'
      AND report_data IS NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 0 AND NOT EXISTS (
      SELECT 1
      FROM public.assistant_messages AS message
      WHERE message.id = v_result.assistant_message_id
        AND message.account_id = p_account_id
        AND message.user_id = p_user_id
        AND message.thread_id = p_thread_id
        AND message.reply_to_message_id = p_user_message_id
        AND message.role = 'assistant'
        AND message.report_data IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Assistant report could not be stored';
    END IF;
  END IF;

  RETURN QUERY
    SELECT v_result.result, v_result.available_credits, v_result.assistant_message_id;
END;
$$;

ALTER FUNCTION public.record_ai_assistant_turn_with_report(
  uuid, uuid, uuid, uuid, text, jsonb, text, text, integer, integer,
  integer, integer, bigint, bigint, bigint, text, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_ai_assistant_turn_with_report(
  uuid, uuid, uuid, uuid, text, jsonb, text, text, integer, integer,
  integer, integer, bigint, bigint, bigint, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_assistant_turn_with_report(
  uuid, uuid, uuid, uuid, text, jsonb, text, text, integer, integer,
  integer, integer, bigint, bigint, bigint, text, jsonb
) TO service_role;
