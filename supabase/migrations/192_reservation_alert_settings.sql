-- Staff alert sent when the AI receptionist registers a restaurant reservation.
-- The recipients and template are account settings managed by admins in the
-- app; the AI never chooses them.
CREATE TABLE public.reservation_alert_settings (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  template_name text NOT NULL DEFAULT 'aviso_reservacion_restaurante'
    CHECK (template_name ~ '^[a-z0-9_]{1,512}$'),
  template_language text NOT NULL DEFAULT 'es_MX'
    CHECK (template_language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  recipient_phones text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(recipient_phones) <= 5),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reservation_alert_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY reservation_alert_settings_admin_select ON public.reservation_alert_settings
  FOR SELECT USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY reservation_alert_settings_admin_insert ON public.reservation_alert_settings
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY reservation_alert_settings_admin_update ON public.reservation_alert_settings
  FOR UPDATE USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

GRANT SELECT, INSERT, UPDATE ON public.reservation_alert_settings TO authenticated, service_role;
