-- Seeds list prices (USD per 1M tokens, stored as nanodollars) for the models
-- the task router can select. Values come from each provider's official
-- pricing page as recorded in docs/plan-ia-multiproveedor-creditos-asistente.md.
-- Deliberately NOT seeded until confirmed against the provider's page:
-- gpt-4.1-mini, gpt-5.6-sol, claude-haiku-4-5-20251001 and the audio
-- transcription models (billed per minute/audio token, not per text token).
-- Shadow billing skips any model without a price and logs a warning.
-- Idempotent: re-running does not duplicate a model's current price.

INSERT INTO ai_model_prices (
  provider,
  model,
  input_nano_usd_per_million_tokens,
  output_nano_usd_per_million_tokens
)
SELECT v.provider, v.model, v.input_price, v.output_price
FROM (
  VALUES
    ('openai',    'gpt-5.4-mini',      750000000::bigint,  4500000000::bigint),
    ('openai',    'gpt-6-luna',        100000000::bigint,   500000000::bigint),
    ('openai',    'gpt-5.6-terra',    2000000000::bigint, 12000000000::bigint),
    ('anthropic', 'claude-haiku-5-5',  100000000::bigint,   500000000::bigint),
    ('anthropic', 'claude-sonnet-5-5', 2000000000::bigint, 10000000000::bigint)
) AS v(provider, model, input_price, output_price)
WHERE NOT EXISTS (
  SELECT 1
  FROM ai_model_prices p
  WHERE p.provider = v.provider
    AND p.model = v.model
);
