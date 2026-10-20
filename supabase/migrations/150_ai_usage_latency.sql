ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS latency_ms integer
  CHECK (latency_ms IS NULL OR latency_ms >= 0);
