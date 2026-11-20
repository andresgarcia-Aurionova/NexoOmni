-- Keep a removed connector's ID: clearing the scope on deletion would
-- silently allow the agent to answer on every other line.
ALTER TABLE public.ai_configs
  ADD COLUMN auto_reply_connector_id uuid;

COMMENT ON COLUMN public.ai_configs.auto_reply_connector_id IS
  'Optional connected-line restriction for inbound AI replies; NULL keeps the existing channel-wide behavior.';
