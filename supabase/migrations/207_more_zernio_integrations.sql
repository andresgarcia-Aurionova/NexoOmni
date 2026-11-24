-- ============================================================
-- 207 · Google, email, social and CRM integrations
--
-- Zernio is the connection transport, not a customer-visible provider.
-- Conversation events are still normalized into the existing inbox and
-- CRM-only providers remain connectors without inventing chat threads.
-- ============================================================

ALTER TABLE public.omnichannel_connectors
  DROP CONSTRAINT IF EXISTS omnichannel_connectors_provider_check;
ALTER TABLE public.omnichannel_connectors
  ADD CONSTRAINT omnichannel_connectors_provider_check CHECK (provider IN (
    'yeastar_live_chat', 'facebook', 'instagram', 'tiktok',
    'zernio_whatsapp', 'zernio_facebook', 'zernio_instagram',
    'zernio_googlebusiness', 'zernio_google', 'zernio_imap',
    'zernio_tiktok', 'zernio_twitter', 'zernio_threads',
    'zernio_telegram', 'zernio_hubspot', 'zernio_salesforce'
  ));

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_channel_type_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_channel_type_check CHECK (channel_type IN (
    'whatsapp', 'yeastar_live_chat', 'facebook', 'instagram', 'tiktok',
    'zernio_whatsapp', 'zernio_facebook', 'zernio_instagram',
    'zernio_googlebusiness', 'zernio_google', 'zernio_imap',
    'zernio_tiktok', 'zernio_twitter', 'zernio_threads', 'zernio_telegram'
  ));

ALTER TABLE public.zernio_connection_attempts
  DROP CONSTRAINT IF EXISTS zernio_connection_attempts_channel_check;
ALTER TABLE public.zernio_connection_attempts
  ADD CONSTRAINT zernio_connection_attempts_channel_check CHECK (channel IN (
    'whatsapp', 'facebook', 'instagram', 'googlebusiness', 'google',
    'email', 'tiktok', 'twitter', 'threads', 'telegram', 'hubspot',
    'salesforce'
  ));

ALTER TABLE public.zernio_connection_attempts
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.automations
  DROP CONSTRAINT IF EXISTS automations_channel_types_check;
ALTER TABLE public.automations
  ADD CONSTRAINT automations_channel_types_check CHECK (
    channel_types IS NULL OR (
      array_length(channel_types, 1) > 0
      AND channel_types <@ ARRAY[
        'whatsapp', 'zernio_whatsapp', 'zernio_facebook',
        'zernio_instagram', 'facebook', 'instagram', 'tiktok',
        'yeastar_live_chat', 'zernio_googlebusiness', 'zernio_google',
        'zernio_imap', 'zernio_tiktok', 'zernio_twitter',
        'zernio_threads', 'zernio_telegram'
      ]::TEXT[]
    )
  );

ALTER TABLE public.flows
  DROP CONSTRAINT IF EXISTS flows_channel_types_check;
ALTER TABLE public.flows
  ADD CONSTRAINT flows_channel_types_check CHECK (
    channel_types IS NULL OR (
      array_length(channel_types, 1) > 0
      AND channel_types <@ ARRAY[
        'whatsapp', 'zernio_whatsapp', 'zernio_facebook',
        'zernio_instagram', 'facebook', 'instagram', 'tiktok',
        'yeastar_live_chat', 'zernio_googlebusiness', 'zernio_google',
        'zernio_imap', 'zernio_tiktok', 'zernio_twitter',
        'zernio_threads', 'zernio_telegram'
      ]::TEXT[]
    )
  );

ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_channel_types_check;
ALTER TABLE public.ai_configs
  ADD CONSTRAINT ai_configs_channel_types_check CHECK (
    channel_types IS NULL OR (
      array_length(channel_types, 1) > 0
      AND channel_types <@ ARRAY[
        'whatsapp', 'zernio_whatsapp', 'zernio_facebook',
        'zernio_instagram', 'facebook', 'instagram', 'tiktok',
        'yeastar_live_chat', 'zernio_googlebusiness', 'zernio_google',
        'zernio_imap', 'zernio_tiktok', 'zernio_twitter',
        'zernio_threads', 'zernio_telegram'
      ]::TEXT[]
    )
  );

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_source_channel_check;
ALTER TABLE public.deals
  ADD CONSTRAINT deals_source_channel_check CHECK (
    source_channel IS NULL OR source_channel IN (
      'whatsapp', 'yeastar_live_chat', 'yeastar_voice', 'facebook',
      'instagram', 'tiktok', 'googlebusiness', 'email', 'twitter',
      'threads', 'telegram', 'other'
    )
  );
