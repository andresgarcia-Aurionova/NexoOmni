CREATE TABLE public.connected_whatsapp_business_hours (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  connector_id uuid NOT NULL REFERENCES public.omnichannel_connectors(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  timezone text NOT NULL,
  windows jsonb NOT NULL,
  holidays jsonb NOT NULL DEFAULT '[]'::jsonb,
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 4096),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, connector_id)
);
ALTER TABLE public.connected_whatsapp_business_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_hours_admin_select ON public.connected_whatsapp_business_hours
  FOR SELECT USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY business_hours_admin_insert ON public.connected_whatsapp_business_hours
  FOR INSERT WITH CHECK (
    public.is_account_member(account_id, 'admin') AND EXISTS (
      SELECT 1 FROM public.omnichannel_connectors c
      WHERE c.id = connected_whatsapp_business_hours.connector_id
        AND c.account_id = connected_whatsapp_business_hours.account_id
        AND c.provider = 'zernio_whatsapp'
    )
  );
CREATE POLICY business_hours_admin_update ON public.connected_whatsapp_business_hours
  FOR UPDATE USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (
    public.is_account_member(account_id, 'admin') AND EXISTS (
      SELECT 1 FROM public.omnichannel_connectors c
      WHERE c.id = connected_whatsapp_business_hours.connector_id
        AND c.account_id = connected_whatsapp_business_hours.account_id
        AND c.provider = 'zernio_whatsapp'
    )
  );
GRANT SELECT, INSERT, UPDATE ON public.connected_whatsapp_business_hours TO authenticated, service_role;

-- Internal delivery claims. A claim is never retried automatically: an
-- uncertain provider response may already have delivered the message.
CREATE TABLE public.connected_whatsapp_closure_receipts (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  connector_id uuid NOT NULL REFERENCES public.omnichannel_connectors(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'claimed' CHECK (state IN ('claimed', 'sent', 'failed')),
  deferred_first_inbound boolean NOT NULL DEFAULT false,
  resumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, period_start)
);
ALTER TABLE public.connected_whatsapp_closure_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.connected_whatsapp_closure_receipts FROM PUBLIC, anon, authenticated;
CREATE POLICY business_hours_receipts_admin_select ON public.connected_whatsapp_closure_receipts
  FOR SELECT USING (public.is_account_member(account_id, 'admin'));
GRANT SELECT ON public.connected_whatsapp_closure_receipts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.connected_whatsapp_closure_receipts TO service_role;

CREATE FUNCTION public.has_deferred_whatsapp_first_inbound(
  p_account_id uuid, p_conversation_id uuid
) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.connected_whatsapp_closure_receipts r
    WHERE r.account_id = p_account_id AND r.conversation_id = p_conversation_id
      AND r.deferred_first_inbound AND r.resumed_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.messages m WHERE m.conversation_id = r.conversation_id
          AND m.sender_type = 'agent' AND m.created_at >= r.created_at
      )
  );
$$;
REVOKE ALL ON FUNCTION public.has_deferred_whatsapp_first_inbound(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_deferred_whatsapp_first_inbound(uuid, uuid)
  TO service_role;

CREATE FUNCTION public.consume_deferred_whatsapp_first_inbound(
  p_account_id uuid, p_conversation_id uuid
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH consumed AS (
    UPDATE public.connected_whatsapp_closure_receipts
      SET resumed_at = now()
      WHERE account_id = p_account_id AND conversation_id = p_conversation_id
        AND deferred_first_inbound AND resumed_at IS NULL
      RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM consumed);
$$;
REVOKE ALL ON FUNCTION public.consume_deferred_whatsapp_first_inbound(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_deferred_whatsapp_first_inbound(uuid, uuid)
  TO service_role;
