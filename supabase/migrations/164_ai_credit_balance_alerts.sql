ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'conversation_transferred',
    'incoming_message',
    'negative_sentiment',
    'call_follow_up',
    'nexo_memory_alert',
    'task_reminder',
    'agendapro_unconfirmed_appointment',
    'ai_credit_balance_10',
    'ai_credit_balance_5'
  ));

CREATE TABLE public.ai_credit_balance_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.ai_credit_batches(id) ON DELETE CASCADE,
  threshold_percent smallint NOT NULL CHECK (threshold_percent IN (5, 10)),
  balance_at_alert bigint NOT NULL CHECK (balance_at_alert >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, threshold_percent)
);

CREATE INDEX ai_credit_balance_alerts_account_created_idx
  ON public.ai_credit_balance_alerts (account_id, created_at DESC);

CREATE TABLE public.ai_credit_alert_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.ai_credit_balance_alerts(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_email text NOT NULL CHECK (length(btrim(recipient_email)) > 0),
  threshold_percent smallint NOT NULL CHECK (threshold_percent IN (5, 10)),
  balance_at_alert bigint NOT NULL CHECK (balance_at_alert >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_id, user_id)
);

CREATE INDEX ai_credit_alert_email_outbox_pending_idx
  ON public.ai_credit_alert_email_outbox (next_attempt_at, created_at)
  WHERE status = 'pending';
CREATE INDEX ai_credit_alert_email_outbox_processing_idx
  ON public.ai_credit_alert_email_outbox (claimed_at)
  WHERE status = 'processing';

ALTER TABLE public.ai_credit_balance_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_credit_alert_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_credit_balance_alerts,
  public.ai_credit_alert_email_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_credit_balance_alerts,
  public.ai_credit_alert_email_outbox TO service_role;

COMMENT ON TABLE public.ai_credit_balance_alerts IS
  'Idempotent 10% and 5% balance threshold events, measured against the latest unexpired paid credit batch.';
COMMENT ON TABLE public.ai_credit_alert_email_outbox IS
  'Service-role-only email outbox; recipient addresses are snapshots from active account members when an alert is created.';

CREATE OR REPLACE FUNCTION public.notify_ai_credit_balance_threshold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.ai_credit_batches%ROWTYPE;
  v_threshold integer;
  v_alert_id uuid;
  v_alert_type text;
  v_recipient record;
BEGIN
  IF NEW.available_credits > OLD.available_credits THEN
    RETURN NEW;
  END IF;

  SELECT batch.*
  INTO v_batch
  FROM public.ai_credit_batches AS batch
  WHERE batch.account_id = NEW.account_id
    AND batch.batch_type = 'purchase'
    AND batch.expires_at > now()
  ORDER BY batch.created_at DESC, batch.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  FOREACH v_threshold IN ARRAY ARRAY[10, 5]
  LOOP
    IF NEW.available_credits::numeric * 100
       > v_batch.granted_credits::numeric * v_threshold THEN
      CONTINUE;
    END IF;

    v_alert_id := NULL;
    INSERT INTO public.ai_credit_balance_alerts (
      account_id,
      batch_id,
      threshold_percent,
      balance_at_alert
    )
    VALUES (
      NEW.account_id,
      v_batch.id,
      v_threshold,
      NEW.available_credits
    )
    ON CONFLICT (batch_id, threshold_percent) DO NOTHING
    RETURNING id INTO v_alert_id;

    IF v_alert_id IS NULL THEN
      CONTINUE;
    END IF;

    v_alert_type := CASE v_threshold
      WHEN 10 THEN 'ai_credit_balance_10'
      ELSE 'ai_credit_balance_5'
    END;

    FOR v_recipient IN
      SELECT profile.user_id, profile.email
      FROM public.profiles AS profile
      WHERE profile.account_id = NEW.account_id
        AND profile.is_active = TRUE
        AND CASE profile.account_role
          WHEN 'owner' THEN 5
          WHEN 'admin' THEN 4
          WHEN 'supervisor' THEN 3
          WHEN 'agent' THEN 2
          WHEN 'viewer' THEN 1
          ELSE 0
        END >= 3
    LOOP
      INSERT INTO public.notifications (
        account_id,
        user_id,
        type,
        title,
        body
      )
      VALUES (
        NEW.account_id,
        v_recipient.user_id,
        v_alert_type,
        v_alert_type,
        NEW.available_credits::text
      );

      IF NULLIF(btrim(v_recipient.email), '') IS NOT NULL THEN
        INSERT INTO public.ai_credit_alert_email_outbox (
          alert_id,
          account_id,
          user_id,
          recipient_email,
          threshold_percent,
          balance_at_alert
        )
        VALUES (
          v_alert_id,
          NEW.account_id,
          v_recipient.user_id,
          v_recipient.email,
          v_threshold,
          NEW.available_credits
        );
      ELSE
        RAISE WARNING 'AI credit alert email skipped for user % because the profile email is empty.',
          v_recipient.user_id;
      END IF;
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.notify_ai_credit_balance_threshold() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notify_ai_credit_balance_threshold()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ai_credit_balance_threshold_alert
  ON public.ai_credit_wallets;
CREATE TRIGGER ai_credit_balance_threshold_alert
  AFTER UPDATE OF available_credits ON public.ai_credit_wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_ai_credit_balance_threshold();

UPDATE public.ai_credit_wallets
SET available_credits = available_credits;
