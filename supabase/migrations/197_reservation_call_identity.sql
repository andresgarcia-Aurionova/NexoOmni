ALTER TABLE public.appointments
  ADD COLUMN reservation_call_id text,
  ADD COLUMN reservation_call_phone text,
  ADD CONSTRAINT reservation_call_identity_check CHECK (
    (reservation_call_id IS NULL AND reservation_call_phone IS NULL)
    OR (reservation_call_id IS NOT NULL AND length(reservation_call_id) BETWEEN 1 AND 120 AND reservation_call_phone IS NOT NULL
      AND reservation_call_phone ~ '^[1-9][0-9]{6,14}$')
  );

CREATE INDEX reservation_call_identity_idx ON public.appointments (account_id, reservation_call_id)
  WHERE reservation_call_id IS NOT NULL;
