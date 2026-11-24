-- Preserve only the channel access already in use; every new channel remains
-- an explicit, billable add-on controlled by the platform operator.

WITH existing_channels(account_id, feature) AS (
  SELECT account_id, 'channel_whatsapp'
  FROM public.whatsapp_config
  WHERE account_id IS NOT NULL

  UNION

  SELECT
    account_id,
    CASE provider
      WHEN 'zernio_whatsapp' THEN 'channel_whatsapp'
      WHEN 'facebook' THEN 'channel_facebook'
      WHEN 'zernio_facebook' THEN 'channel_facebook'
      WHEN 'instagram' THEN 'channel_instagram'
      WHEN 'zernio_instagram' THEN 'channel_instagram'
      WHEN 'zernio_googlebusiness' THEN 'channel_googlebusiness'
      WHEN 'zernio_google' THEN 'channel_google'
      WHEN 'zernio_imap' THEN 'channel_email'
      WHEN 'zernio_tiktok' THEN 'channel_tiktok'
      WHEN 'zernio_twitter' THEN 'channel_twitter'
      WHEN 'zernio_threads' THEN 'channel_threads'
      WHEN 'zernio_telegram' THEN 'channel_telegram'
      WHEN 'zernio_hubspot' THEN 'channel_hubspot'
      WHEN 'zernio_salesforce' THEN 'channel_salesforce'
      ELSE NULL
    END
  FROM public.omnichannel_connectors
),
enabled_by_account AS (
  SELECT
    account_id,
    jsonb_object_agg(feature, true) AS features
  FROM existing_channels
  WHERE feature IS NOT NULL
  GROUP BY account_id
)
UPDATE public.account_subscriptions AS subscription
SET feature_overrides = COALESCE(subscription.feature_overrides, '{}'::jsonb)
  || enabled_by_account.features
FROM enabled_by_account
WHERE subscription.account_id = enabled_by_account.account_id;
