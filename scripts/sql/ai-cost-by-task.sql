-- Real cost per task for pricing decisions. Read-only; returns aggregates only
-- (no conversation text, names or phone numbers). Run in the Supabase SQL Editor.
-- Change the interval to widen or narrow the window.

-- 1) Tokens, cost and price per task (mode) and model, last 30 days.
SELECT
  mode,
  provider,
  model,
  count(*) AS calls,
  round(avg(prompt_tokens))::bigint AS avg_in_tokens,
  round(avg(completion_tokens))::bigint AS avg_out_tokens,
  round(sum(cost_nano_usd) / 1e9, 4) AS total_cost_usd,
  round(avg(cost_nano_usd) / 1e9, 6) AS avg_cost_usd_per_call,
  round(sum(price_nano_usd) / 1e9, 4) AS total_price_usd,
  sum(credits_charged) AS total_credits,
  count(*) FILTER (WHERE cost_nano_usd IS NULL) AS calls_without_cost
FROM public.ai_usage_log
WHERE created_at >= now() - interval '30 days'
GROUP BY mode, provider, model
ORDER BY total_cost_usd DESC NULLS LAST;

-- 2) WhatsApp calls (Zernio): minutes and what Zernio really billed.
SELECT
  direction,
  count(*) AS calls,
  round(sum(duration_seconds) / 60.0, 1) AS talk_minutes,
  sum(billable_minutes) AS billable_minutes,
  round(sum(zernio_cost_nano_usd) / 1e9, 4) AS zernio_cost_usd,
  round(sum(zernio_cost_nano_usd) / 1e9 / NULLIF(sum(billable_minutes), 0), 5)
    AS zernio_cost_usd_per_billable_minute,
  round(sum(meta_cost_nano_usd) / 1e9, 4) AS meta_cost_usd_informational
FROM public.call_usage_log
WHERE created_at >= now() - interval '30 days'
GROUP BY direction;

-- 3) Yeastar (PSTN) transcription minutes that were transcribed.
SELECT
  count(*) AS calls,
  round(sum(duration_seconds) / 60.0, 1) AS minutes
FROM public.yeastar_call_transcriptions
WHERE started_at >= now() - interval '30 days'
  AND transcription_status = 'completed';
