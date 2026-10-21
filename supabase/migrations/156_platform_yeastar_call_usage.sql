CREATE INDEX IF NOT EXISTS idx_yeastar_call_transcriptions_usage_time
  ON public.yeastar_call_transcriptions (
    (COALESCE(started_at, created_at))
  );

CREATE OR REPLACE FUNCTION public.platform_yeastar_call_usage_summary(
  p_since timestamptz,
  p_until timestamptz
)
RETURNS TABLE (
  account_id uuid,
  calls bigint,
  talk_duration_seconds bigint,
  transcribed_calls bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  IF p_since IS NULL OR p_until IS NULL OR p_since >= p_until THEN
    RAISE EXCEPTION 'Invalid usage date range' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    calls.account_id,
    count(*)::bigint,
    COALESCE(sum(calls.talk_duration_seconds), 0)::bigint,
    count(*) FILTER (
      WHERE nullif(btrim(calls.transcript), '') IS NOT NULL
    )::bigint
  FROM public.yeastar_call_transcriptions AS calls
  WHERE COALESCE(calls.started_at, calls.created_at) >= p_since
    AND COALESCE(calls.started_at, calls.created_at) < p_until
  GROUP BY calls.account_id
  ORDER BY calls.account_id;
END;
$$;

ALTER FUNCTION public.platform_yeastar_call_usage_summary(timestamptz, timestamptz)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_yeastar_call_usage_summary(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_yeastar_call_usage_summary(timestamptz, timestamptz)
  TO service_role;
