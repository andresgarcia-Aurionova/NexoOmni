-- Seed verified standard API token rates for models used by NexoOmni.
-- Prices are nanodollars per million tokens, based on the official provider
-- pricing pages consulted on 2026-10-20. Audio transcription uses the
-- provider-reported input/output token counts in the usage response.
INSERT INTO public.ai_model_prices (
  provider,
  model,
  input_nano_usd_per_million_tokens,
  output_nano_usd_per_million_tokens
)
SELECT v.provider, v.model, v.input_price, v.output_price
FROM (
  VALUES
    ('openai', 'gpt-4.1-mini', 400000000::bigint, 1600000000::bigint),
    ('openai', 'gpt-4o-mini-transcribe', 1250000000::bigint, 5000000000::bigint),
    ('openai', 'gpt-4o-transcribe', 2500000000::bigint, 10000000000::bigint),
    ('openai', 'text-embedding-3-small', 20000000::bigint, 0::bigint),
    ('anthropic', 'claude-haiku-4-5-20251001', 1000000000::bigint, 5000000000::bigint)
) AS v(provider, model, input_price, output_price)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ai_model_prices AS p
  WHERE p.provider = v.provider
    AND p.model = v.model
);
