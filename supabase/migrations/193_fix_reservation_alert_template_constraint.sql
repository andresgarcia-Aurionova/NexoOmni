-- PostgreSQL regular-expression repetition bounds cannot exceed 255.
ALTER TABLE public.reservation_alert_settings
  DROP CONSTRAINT reservation_alert_settings_template_name_check;

ALTER TABLE public.reservation_alert_settings
  ADD CONSTRAINT reservation_alert_settings_template_name_check
  CHECK (
    template_name ~ '^[a-z0-9_]+$'
    AND char_length(template_name) <= 512
  );
