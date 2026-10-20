-- Registra también transcripción de notas de voz, descripción de imágenes y
-- embeddings en ai_usage_log para que el consumo por cliente sea completo.
-- Definición anterior de la restricción: migración 087.
ALTER TABLE public.ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;

ALTER TABLE public.ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN (
    'auto_reply',
    'draft',
    'analysis',
    'report',
    'call_summary',
    'voice_transcription',
    'image_description',
    'embeddings'
  ));
