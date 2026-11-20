-- Minimal schema for test-flow-ai-turn-claims.sql; use only in an empty test database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.flow_runs (
  id uuid PRIMARY KEY, account_id uuid NOT NULL, conversation_id uuid,
  status text NOT NULL, current_node_key text, ended_at timestamptz, end_reason text
);
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY, account_id uuid NOT NULL, status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.flow_run_events (
  flow_run_id uuid NOT NULL REFERENCES public.flow_runs(id),
  event_type text NOT NULL, node_key text, payload jsonb NOT NULL
);
INSERT INTO public.conversations (id, account_id, status)
  VALUES ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000002', 'open');
INSERT INTO public.flow_runs (id, account_id, conversation_id, status, current_node_key)
  VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000006', 'active', 'offer');
