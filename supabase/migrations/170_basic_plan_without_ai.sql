-- Plan 1 ("basic"): platform, WhatsApp and social channels without any AI.
-- Plan 2 = 'ai', Plan 3 = 'whatsapp_voice'; 'yeastar_voice' stays as a legacy
-- intermediate tier. Existing accounts keep their current plan code.

ALTER TABLE account_subscriptions
  DROP CONSTRAINT IF EXISTS account_subscriptions_plan_code_check;

ALTER TABLE account_subscriptions
  ADD CONSTRAINT account_subscriptions_plan_code_check
  CHECK (plan_code IN ('basic', 'ai', 'yeastar_voice', 'whatsapp_voice'));
