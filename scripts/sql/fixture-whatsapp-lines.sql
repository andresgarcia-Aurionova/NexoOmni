-- Only for a disposable database. Apply migration 198 after this fixture.
CREATE TABLE contacts (
  id uuid PRIMARY KEY, account_id uuid NOT NULL, name text, email text,
  company text, avatar_url text, phone text, alternate_phones text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE omnichannel_connectors (id uuid PRIMARY KEY);
CREATE TABLE conversations (
  id uuid PRIMARY KEY, account_id uuid NOT NULL, contact_id uuid REFERENCES contacts(id),
  channel_type text NOT NULL, connector_id uuid REFERENCES omnichannel_connectors(id) ON DELETE SET NULL,
  external_session_id text, unread_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_conversations_account_contact_channel ON conversations(account_id, contact_id, channel_type);
CREATE UNIQUE INDEX idx_conversations_connector_external_session ON conversations(account_id, connector_id, external_session_id)
  WHERE connector_id IS NOT NULL AND external_session_id IS NOT NULL;
CREATE TABLE flow_runs (
  id uuid PRIMARY KEY, account_id uuid NOT NULL, contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL, status text NOT NULL
);
CREATE UNIQUE INDEX idx_one_active_run_per_contact ON flow_runs(account_id, contact_id) WHERE status = 'active';
CREATE TABLE messages (conversation_id uuid);
CREATE TABLE message_reactions (conversation_id uuid);
CREATE TABLE deals (conversation_id uuid, contact_id uuid);
CREATE TABLE notifications (conversation_id uuid, contact_id uuid);
CREATE TABLE ai_usage_log (conversation_id uuid);
CREATE TABLE conversation_internal_notes (conversation_id uuid);
CREATE TABLE ai_conversation_analyses (conversation_id uuid, source text);
CREATE TABLE contact_tags (contact_id uuid, tag_id uuid);
CREATE TABLE contact_custom_values (contact_id uuid, custom_field_id uuid);
CREATE TABLE contact_notes (contact_id uuid);
CREATE TABLE broadcast_recipients (contact_id uuid);
CREATE TABLE automation_logs (contact_id uuid);
CREATE TABLE automation_pending_executions (contact_id uuid);
CREATE TABLE yeastar_call_transcriptions (contact_id uuid);
CREATE TABLE omnichannel_contact_identities (contact_id uuid);
GRANT USAGE ON SCHEMA public TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;
