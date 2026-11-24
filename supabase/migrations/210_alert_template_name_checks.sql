-- PostgreSQL's advanced-regex repetition bounds are capped below 512, so
-- `^[a-z0-9_]{1,512}$` raises 2201B while evaluating the CHECK constraint.
-- Keep the intended 512-character limit as a separate length predicate.

ALTER TABLE public.critical_case_settings
  DROP CONSTRAINT IF EXISTS critical_case_settings_template_name_check;
ALTER TABLE public.critical_case_settings
  ADD CONSTRAINT critical_case_settings_template_name_check
  CHECK (
    char_length(template_name) BETWEEN 1 AND 512
    AND template_name ~ '^[a-z0-9_]+$'
  );

ALTER TABLE public.reservation_alert_settings
  DROP CONSTRAINT IF EXISTS reservation_alert_settings_template_name_check;
ALTER TABLE public.reservation_alert_settings
  ADD CONSTRAINT reservation_alert_settings_template_name_check
  CHECK (
    char_length(template_name) BETWEEN 1 AND 512
    AND template_name ~ '^[a-z0-9_]+$'
  );
