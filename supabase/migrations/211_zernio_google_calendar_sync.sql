ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS zernio_calendar_connector_id uuid
    REFERENCES public.omnichannel_connectors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zernio_calendar_id text;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_zernio_calendar_event_unique
  ON public.appointments (
    zernio_calendar_connector_id,
    zernio_calendar_id,
    google_calendar_event_id
  )
  WHERE zernio_calendar_connector_id IS NOT NULL
    AND google_calendar_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS appointments_zernio_calendar_connector_idx
  ON public.appointments (zernio_calendar_connector_id, starts_at);

COMMENT ON COLUMN public.appointments.zernio_calendar_connector_id IS
  'Connector that imported this Google Calendar event; NULL for native NexoOmni appointments.';
