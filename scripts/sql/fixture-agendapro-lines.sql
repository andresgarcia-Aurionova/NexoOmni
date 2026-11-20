-- Disposable fixture: run after fixture-whatsapp-lines.sql and migration 202.
ALTER TABLE notifications ADD COLUMN account_id uuid, ADD COLUMN user_id uuid,
  ADD COLUMN type text, ADD COLUMN title text, ADD COLUMN body text;
CREATE TABLE profiles (account_id uuid, user_id uuid, is_active boolean, account_role text);
CREATE TABLE appointments (
  id uuid PRIMARY KEY, account_id uuid, contact_id uuid, starts_at timestamptz,
  status text, reservation_whatsapp_phone text
);
CREATE TABLE reservation_confirmation_jobs (
  appointment_id uuid, account_id uuid, conversation_id uuid, state text, response text
);
CREATE TABLE agendapro_bookings (
  id uuid PRIMARY KEY, account_id uuid NOT NULL, contact_id uuid,
  start_time timestamptz, confirmation_status text DEFAULT 'pending',
  confirmation_reminder_status text DEFAULT 'queued', confirmation_reminder_due_at timestamptz,
  confirmation_reminder_sent_at timestamptz, confirmation_responded_at timestamptz,
  reception_alert_sent_at timestamptz
);
CREATE FUNCTION public.agendapro_bookings_sync_confirmation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER agendapro_bookings_sync_confirmation_trigger
  BEFORE INSERT OR UPDATE OF start_time ON public.agendapro_bookings
  FOR EACH ROW EXECUTE FUNCTION public.agendapro_bookings_sync_confirmation();
GRANT ALL ON public.agendapro_bookings, public.profiles TO postgres;
