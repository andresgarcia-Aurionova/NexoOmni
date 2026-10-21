-- Token de la API SIE de Banxico, cifrado (AES-256-GCM) por la aplicación.
-- ai_billing_settings solo es accesible con service_role.
ALTER TABLE public.ai_billing_settings
  ADD COLUMN IF NOT EXISTS banxico_token_encrypted text;
