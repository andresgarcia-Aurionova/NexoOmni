-- Token baseline for model evaluation. Returns aggregate metrics only; no
-- conversation text, customer identifiers, or individual usage rows.
WITH usage_window AS (
  SELECT
    mode,
    provider,
    model,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    latency_ms,
    created_at
  FROM public.ai_usage_log
  WHERE created_at >= now() - interval '30 days'
)
SELECT
  mode,
  provider,
  model,
  count(*) AS calls,
  min(created_at) AS first_call_at,
  max(created_at) AS last_call_at,
  round(avg(prompt_tokens))::bigint AS avg_prompt_tokens,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY prompt_tokens)::bigint AS median_prompt_tokens,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY prompt_tokens)::bigint AS p95_prompt_tokens,
  round(avg(completion_tokens))::bigint AS avg_completion_tokens,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY completion_tokens)::bigint AS median_completion_tokens,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY completion_tokens)::bigint AS p95_completion_tokens,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY total_tokens)::bigint AS median_total_tokens,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY total_tokens)::bigint AS p95_total_tokens,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::bigint AS median_latency_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::bigint AS p95_latency_ms
FROM usage_window
GROUP BY mode, provider, model
ORDER BY mode, provider, model;
