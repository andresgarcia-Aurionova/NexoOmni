ALTER TABLE public.voice_receptionist_configs
  ADD COLUMN IF NOT EXISTS transfer_method text NOT NULL DEFAULT 'sip'
    CHECK (transfer_method IN ('sip', 'yeastar_api'));

COMMENT ON COLUMN public.voice_receptionist_configs.transfer_method IS
  'sip lets the voice provider complete the handoff; yeastar_api transfers the active Yeastar call by channel_id and avoids provider SIP REFER.';
