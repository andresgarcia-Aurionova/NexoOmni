-- Minimal fixture for a disposable database ONLY. Never run on a real database.
CREATE TYPE public.account_role_enum AS ENUM ('viewer', 'agent', 'supervisor', 'admin', 'owner');
CREATE TABLE public.accounts (id uuid PRIMARY KEY);
CREATE TABLE public.contacts (id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES public.accounts(id));
CREATE TABLE public.conversations (id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES public.accounts(id));
CREATE TABLE public.messages (
  id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES public.conversations(id),
  sender_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.omnichannel_connectors (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES public.accounts(id), provider text NOT NULL
);
ALTER TABLE public.omnichannel_connectors ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.omnichannel_connectors TO authenticated;
CREATE POLICY connector_test_read ON public.omnichannel_connectors FOR SELECT TO authenticated USING (true);
CREATE TABLE public.flow_runs (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES public.accounts(id),
  flow_id uuid NOT NULL, user_id uuid NOT NULL, contact_id uuid REFERENCES public.contacts(id),
  current_node_key text, status text NOT NULL, last_prompt_message_id uuid,
  vars jsonb NOT NULL DEFAULT '{}', reprompt_count integer NOT NULL DEFAULT 0
);
CREATE TABLE public.flow_nodes (flow_id uuid NOT NULL, node_key text NOT NULL, node_type text NOT NULL, config jsonb NOT NULL);
CREATE TABLE public.contact_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL,
  contact_id uuid NOT NULL, user_id uuid NOT NULL, note_text text NOT NULL
);
CREATE FUNCTION public.is_account_member(uuid, public.account_role_enum DEFAULT 'viewer') RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT $1::text = current_setting('test.account_id', true)
    AND current_setting('test.role', true) IN ('admin', 'owner');
$$;
