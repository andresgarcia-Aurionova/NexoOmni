ALTER TABLE public.ai_billing_settings
  ADD COLUMN IF NOT EXISTS yeastar_transcription_cost_nano_usd_per_minute bigint
    CHECK (
      yeastar_transcription_cost_nano_usd_per_minute IS NULL
      OR yeastar_transcription_cost_nano_usd_per_minute > 0
    );

CREATE TABLE IF NOT EXISTS public.yeastar_transcription_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  call_transcription_id uuid NOT NULL UNIQUE
    REFERENCES public.yeastar_call_transcriptions(id) ON DELETE CASCADE,
  duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
  rate_nano_usd_per_minute bigint NOT NULL CHECK (rate_nano_usd_per_minute > 0),
  cost_nano_usd bigint NOT NULL CHECK (cost_nano_usd > 0),
  price_nano_usd bigint NOT NULL CHECK (price_nano_usd >= cost_nano_usd),
  markup_basis_points integer NOT NULL DEFAULT 5000
    CHECK (markup_basis_points = 5000),
  estimated_credits bigint NOT NULL CHECK (estimated_credits > 0),
  credits_charged bigint NOT NULL DEFAULT 0 CHECK (credits_charged >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'charged')),
  ledger_entry_id uuid REFERENCES public.ai_credit_ledger(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'pending' AND ledger_entry_id IS NULL AND credits_charged = 0)
    OR (status = 'charged' AND ledger_entry_id IS NOT NULL AND credits_charged > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_yeastar_transcription_charges_pending
  ON public.yeastar_transcription_charges(created_at)
  WHERE status = 'pending';

ALTER TABLE public.yeastar_transcription_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.yeastar_transcription_charges
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.yeastar_transcription_charges TO service_role;
COMMENT ON TABLE public.yeastar_transcription_charges IS
  'Service-role-only estimated external transcription costs. Rate snapshots preserve historical calculations; tenant-level actual OpenAI tokens are unavailable from the shared Yeastar key.';

CREATE OR REPLACE FUNCTION public.platform_process_yeastar_transcription_charges(
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  considered integer,
  charged integer,
  pending integer,
  rate_configured boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate bigint;
  v_nano_usd_per_credit bigint;
  v_call record;
  v_charge public.yeastar_transcription_charges%ROWTYPE;
  v_cost bigint;
  v_price bigint;
  v_credits bigint;
  v_result text;
  v_balance bigint;
  v_ledger_entry_id uuid;
  v_considered integer := 0;
  v_charged integer := 0;
  v_pending integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Invalid processing limit' USING ERRCODE = '22023';
  END IF;

  SELECT
    settings.yeastar_transcription_cost_nano_usd_per_minute,
    settings.nano_usd_per_credit
  INTO v_rate, v_nano_usd_per_credit
  FROM public.ai_billing_settings AS settings
  WHERE settings.id = true;

  IF v_rate IS NULL OR v_rate <= 0 THEN
    RETURN QUERY SELECT 0, 0, 0, false;
    RETURN;
  END IF;
  IF v_nano_usd_per_credit IS NULL OR v_nano_usd_per_credit <= 0 THEN
    RAISE EXCEPTION 'Invalid credit conversion rate' USING ERRCODE = '23514';
  END IF;

  FOR v_call IN
    SELECT
      calls.id,
      calls.account_id,
      CASE
        WHEN calls.talk_duration_seconds IS NOT NULL
          THEN calls.talk_duration_seconds
        ELSE calls.duration_seconds
      END AS duration_seconds
    FROM public.yeastar_call_transcriptions AS calls
    LEFT JOIN public.yeastar_transcription_charges AS charges
      ON charges.call_transcription_id = calls.id
    WHERE calls.transcription_status = 'completed'
      AND nullif(btrim(calls.transcript), '') IS NOT NULL
      AND (
        CASE
          WHEN calls.talk_duration_seconds IS NOT NULL
            THEN calls.talk_duration_seconds
          ELSE calls.duration_seconds
        END
      ) > 0
      AND (charges.id IS NULL OR charges.status = 'pending')
    ORDER BY COALESCE(calls.started_at, calls.created_at), calls.id
    LIMIT p_limit
    FOR UPDATE OF calls SKIP LOCKED
  LOOP
    v_considered := v_considered + 1;

    SELECT * INTO v_charge
    FROM public.yeastar_transcription_charges AS charges
    WHERE charges.call_transcription_id = v_call.id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_cost := ceil(
        v_rate::numeric * v_call.duration_seconds::numeric / 60
      )::bigint;
      v_price := ceil(v_cost::numeric * 1.5)::bigint;
      v_credits := ceil(
        v_price::numeric / v_nano_usd_per_credit::numeric
      )::bigint;

      INSERT INTO public.yeastar_transcription_charges (
        account_id,
        call_transcription_id,
        duration_seconds,
        rate_nano_usd_per_minute,
        cost_nano_usd,
        price_nano_usd,
        estimated_credits
      )
      VALUES (
        v_call.account_id,
        v_call.id,
        v_call.duration_seconds,
        v_rate,
        v_cost,
        v_price,
        v_credits
      )
      ON CONFLICT (call_transcription_id) DO NOTHING;

      SELECT * INTO v_charge
      FROM public.yeastar_transcription_charges AS charges
      WHERE charges.call_transcription_id = v_call.id
      FOR UPDATE;
    END IF;

    IF v_charge.status = 'charged' THEN
      CONTINUE;
    END IF;

    SELECT debit.result, debit.available_credits, debit.ledger_entry_id
    INTO v_result, v_balance, v_ledger_entry_id
    FROM public.ai_credit_debit(
      v_charge.account_id,
      v_charge.estimated_credits,
      'yeastar_transcription:' || v_charge.call_transcription_id::text,
      v_charge.cost_nano_usd,
      v_charge.price_nano_usd,
      NULL,
      'openai',
      'gpt-4o-transcribe',
      jsonb_build_object(
        'source', 'yeastar_transcription_estimate',
        'mode', 'yeastar_transcription',
        'estimated', true,
        'call_transcription_id', v_charge.call_transcription_id,
        'duration_seconds', v_charge.duration_seconds,
        'cost_rate_nano_usd_per_minute', v_charge.rate_nano_usd_per_minute,
        'markup_basis_points', v_charge.markup_basis_points
      )
    ) AS debit;

    IF v_result IN ('debited', 'duplicate') THEN
      UPDATE public.yeastar_transcription_charges
      SET status = 'charged',
          credits_charged = v_charge.estimated_credits,
          ledger_entry_id = v_ledger_entry_id,
          updated_at = now()
      WHERE id = v_charge.id;
      v_charged := v_charged + 1;
    ELSIF v_result = 'insufficient_credits' THEN
      v_pending := v_pending + 1;
    ELSE
      RAISE EXCEPTION 'Unexpected AI credit debit result: %', v_result
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_considered, v_charged, v_pending, true;
END;
$$;

ALTER FUNCTION public.platform_process_yeastar_transcription_charges(integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_process_yeastar_transcription_charges(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_process_yeastar_transcription_charges(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.platform_ai_financial_report(
  p_since timestamptz,
  p_until timestamptz,
  p_account_id uuid DEFAULT NULL
)
RETURNS TABLE (
  account_id uuid,
  activity text,
  provider text,
  model text,
  operation_count bigint,
  prompt_tokens bigint,
  completion_tokens bigint,
  total_tokens bigint,
  cost_nano_usd numeric,
  charged_price_nano_usd numeric,
  expected_price_nano_usd numeric,
  profit_nano_usd numeric,
  credits_charged numeric,
  pending_charges bigint,
  estimated boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_since >= p_until
     OR p_until - p_since > interval '366 days' THEN
    RAISE EXCEPTION 'Invalid financial report range' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH ai AS (
    SELECT
      usage.account_id,
      usage.mode AS activity,
      usage.provider,
      usage.model,
      count(*)::bigint AS operation_count,
      COALESCE(sum(usage.prompt_tokens), 0)::bigint AS prompt_tokens,
      COALESCE(sum(usage.completion_tokens), 0)::bigint AS completion_tokens,
      COALESCE(sum(usage.total_tokens), 0)::bigint AS total_tokens,
      COALESCE(sum(usage.cost_nano_usd), 0)::numeric AS cost_nano_usd,
      COALESCE(sum(ledger.price_nano_usd), 0)::numeric AS charged_price_nano_usd,
      COALESCE(sum(ledger.price_nano_usd), 0)::numeric AS expected_price_nano_usd,
      COALESCE(sum(
        COALESCE(ledger.price_nano_usd, 0)
        - COALESCE(usage.cost_nano_usd, 0)
      ), 0)::numeric AS profit_nano_usd,
      COALESCE(sum(-ledger.delta_credits), 0)::numeric AS credits_charged,
      count(*) FILTER (
        WHERE usage.cost_nano_usd IS NOT NULL AND ledger.id IS NULL
      )::bigint AS pending_charges,
      false AS estimated
    FROM public.ai_usage_log AS usage
    LEFT JOIN public.ai_credit_ledger AS ledger
      ON ledger.usage_id = usage.id
     AND ledger.entry_type = 'usage'
    WHERE usage.created_at >= p_since
      AND usage.created_at < p_until
      AND (p_account_id IS NULL OR usage.account_id = p_account_id)
    GROUP BY usage.account_id, usage.mode, usage.provider, usage.model
  ),
  yeastar AS (
    SELECT
      charges.account_id,
      'yeastar_transcription'::text AS activity,
      'openai'::text AS provider,
      'gpt-4o-transcribe'::text AS model,
      count(*)::bigint AS operation_count,
      NULL::bigint AS prompt_tokens,
      NULL::bigint AS completion_tokens,
      NULL::bigint AS total_tokens,
      COALESCE(sum(charges.cost_nano_usd), 0)::numeric AS cost_nano_usd,
      COALESCE(sum(
        CASE WHEN charges.status = 'charged' THEN charges.price_nano_usd ELSE 0 END
      ), 0)::numeric AS charged_price_nano_usd,
      COALESCE(sum(charges.price_nano_usd), 0)::numeric AS expected_price_nano_usd,
      COALESCE(sum(
        CASE
          WHEN charges.status = 'charged'
            THEN charges.price_nano_usd - charges.cost_nano_usd
          ELSE -charges.cost_nano_usd
        END
      ), 0)::numeric AS profit_nano_usd,
      COALESCE(sum(charges.credits_charged), 0)::numeric AS credits_charged,
      count(*) FILTER (WHERE charges.status = 'pending')::bigint AS pending_charges,
      true AS estimated
    FROM public.yeastar_transcription_charges AS charges
    JOIN public.yeastar_call_transcriptions AS calls
      ON calls.id = charges.call_transcription_id
    WHERE COALESCE(calls.started_at, calls.created_at) >= p_since
      AND COALESCE(calls.started_at, calls.created_at) < p_until
      AND (p_account_id IS NULL OR charges.account_id = p_account_id)
    GROUP BY charges.account_id
  )
  SELECT * FROM ai
  UNION ALL
  SELECT * FROM yeastar
  ORDER BY account_id, activity, provider, model;
END;
$$;

ALTER FUNCTION public.platform_ai_financial_report(timestamptz, timestamptz, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_ai_financial_report(timestamptz, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_ai_financial_report(timestamptz, timestamptz, uuid)
  TO service_role;

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
        'yeastar_transcription',
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
