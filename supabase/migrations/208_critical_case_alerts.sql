-- Critical cases (N2/N3): every conversation can carry a case level. The AI
-- classifies it automatically and supervisors can correct it. Reaching N2 or
-- N3 marks the conversation critical and alerts immediately (in-app, web
-- push, email and WhatsApp to the restaurant/branch numbers).

ALTER TABLE public.conversations
  ADD COLUMN case_level text CHECK (case_level IN ('n1', 'n2', 'n3')),
  ADD COLUMN case_level_source text CHECK (case_level_source IN ('ai', 'human')),
  ADD COLUMN case_level_reason text CHECK (char_length(case_level_reason) <= 500),
  ADD COLUMN case_level_set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN case_level_set_at timestamptz,
  ADD COLUMN case_sede text CHECK (char_length(case_sede) <= 120),
  ADD COLUMN critical_alerted_level text CHECK (critical_alerted_level IN ('n2', 'n3')),
  ADD COLUMN is_critical boolean GENERATED ALWAYS AS (COALESCE(case_level IN ('n2', 'n3'), FALSE)) STORED;

CREATE INDEX conversations_critical_idx
  ON public.conversations (account_id, case_level_set_at DESC)
  WHERE is_critical;

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
    'ai_credit_balance_5',
    'critical_case'
  ));

CREATE TABLE public.critical_case_settings (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT FALSE,
  template_name text NOT NULL DEFAULT 'alerta_caso_critico'
    CHECK (template_name ~ '^[a-z0-9_]{1,512}$'),
  template_language text NOT NULL DEFAULT 'es_MX'
    CHECK (template_language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  default_phones text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(default_phones) <= 5),
  -- [{ "name": "Sede Centro", "phones": ["+52..."] }]
  sedes jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(sedes) = 'array' AND jsonb_array_length(sedes) <= 50),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.critical_case_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY critical_case_settings_select ON public.critical_case_settings
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY critical_case_settings_insert ON public.critical_case_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY critical_case_settings_update ON public.critical_case_settings
  FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

REVOKE ALL ON public.critical_case_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.critical_case_settings TO authenticated, service_role;

CREATE TABLE public.critical_case_alert_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  recipient text NOT NULL CHECK (length(btrim(recipient)) > 0),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  level text NOT NULL CHECK (level IN ('n2', 'n3')),
  sede text,
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, level, channel, recipient)
);

CREATE INDEX critical_case_alert_outbox_pending_idx
  ON public.critical_case_alert_outbox (next_attempt_at, created_at)
  WHERE status = 'pending';
CREATE INDEX critical_case_alert_outbox_processing_idx
  ON public.critical_case_alert_outbox (claimed_at)
  WHERE status = 'processing';

ALTER TABLE public.critical_case_alert_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.critical_case_alert_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.critical_case_alert_outbox TO service_role;

COMMENT ON TABLE public.critical_case_alert_outbox IS
  'Service-role-only email/WhatsApp outbox for N2/N3 critical case alerts.';

-- Case levels are written only by the server (AI evaluator or the
-- supervisor-gated API). Members keep their normal conversation UPDATE
-- access, but cannot forge or silence a classification from the browser.
CREATE OR REPLACE FUNCTION public.guard_conversation_case_level()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IN ('authenticated', 'anon') AND (
    NEW.case_level IS DISTINCT FROM OLD.case_level
    OR NEW.case_level_source IS DISTINCT FROM OLD.case_level_source
    OR NEW.case_level_reason IS DISTINCT FROM OLD.case_level_reason
    OR NEW.case_level_set_by IS DISTINCT FROM OLD.case_level_set_by
    OR NEW.case_level_set_at IS DISTINCT FROM OLD.case_level_set_at
    OR NEW.case_sede IS DISTINCT FROM OLD.case_sede
    OR NEW.critical_alerted_level IS DISTINCT FROM OLD.critical_alerted_level
  ) THEN
    RAISE EXCEPTION 'Case level can only be changed through the server API'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_conversation_case_level() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_conversation_case_level() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER conversations_guard_case_level
  BEFORE UPDATE OF case_level, case_level_source, case_level_reason, case_level_set_by,
    case_level_set_at, case_sede, critical_alerted_level
  ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.guard_conversation_case_level();

CREATE OR REPLACE FUNCTION public.notify_critical_case()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_rank integer;
  v_alerted_rank integer;
  v_settings public.critical_case_settings%ROWTYPE;
  v_phones text[] := '{}';
  v_phone text;
  v_recipient record;
BEGIN
  v_new_rank := CASE NEW.case_level WHEN 'n3' THEN 3 WHEN 'n2' THEN 2 ELSE 0 END;
  v_alerted_rank := CASE NEW.critical_alerted_level WHEN 'n3' THEN 3 WHEN 'n2' THEN 2 ELSE 0 END;

  -- Back to N1 / unclassified: re-arm so a later escalation alerts again.
  IF v_new_rank < 2 THEN
    NEW.critical_alerted_level := NULL;
    RETURN NEW;
  END IF;

  -- Already alerted at this level (or higher): never alert twice.
  IF v_new_rank <= v_alerted_rank THEN
    RETURN NEW;
  END IF;

  NEW.critical_alerted_level := NEW.case_level;

  FOR v_recipient IN
    SELECT profile.user_id, profile.email
    FROM public.profiles AS profile
    WHERE profile.account_id = NEW.account_id
      AND profile.is_active = TRUE
      AND (
        CASE profile.account_role
          WHEN 'owner' THEN 5
          WHEN 'admin' THEN 4
          WHEN 'supervisor' THEN 3
          WHEN 'agent' THEN 2
          WHEN 'viewer' THEN 1
          ELSE 0
        END >= 3
        OR (
          profile.user_id = NEW.assigned_agent_id
          AND CASE profile.account_role
            WHEN 'owner' THEN 5
            WHEN 'admin' THEN 4
            WHEN 'supervisor' THEN 3
            WHEN 'agent' THEN 2
            ELSE 0
          END >= 2
        )
      )
  LOOP
    INSERT INTO public.notifications (
      account_id, user_id, type, conversation_id, contact_id, title, body
    )
    VALUES (
      NEW.account_id, v_recipient.user_id, 'critical_case', NEW.id, NEW.contact_id,
      'critical_case', NEW.case_level
    );

    IF NULLIF(btrim(v_recipient.email), '') IS NOT NULL THEN
      INSERT INTO public.critical_case_alert_outbox (
        account_id, conversation_id, channel, recipient, user_id, level, sede, reason
      )
      VALUES (
        NEW.account_id, NEW.id, 'email', lower(btrim(v_recipient.email)), v_recipient.user_id,
        NEW.case_level, NEW.case_sede, NEW.case_level_reason
      )
      ON CONFLICT (conversation_id, level, channel, recipient) DO NOTHING;
    END IF;
  END LOOP;

  SELECT settings.* INTO v_settings
  FROM public.critical_case_settings AS settings
  WHERE settings.account_id = NEW.account_id;

  IF FOUND AND v_settings.enabled THEN
    IF NULLIF(btrim(NEW.case_sede), '') IS NOT NULL THEN
      SELECT COALESCE(array_agg(DISTINCT phone.value), '{}')
        INTO v_phones
      FROM jsonb_array_elements(v_settings.sedes) AS sede(item)
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(sede.item -> 'phones') = 'array'
          THEN sede.item -> 'phones' ELSE '[]'::jsonb END
      ) AS phone(value)
      WHERE lower(btrim(sede.item ->> 'name')) = lower(btrim(NEW.case_sede));
    END IF;

    IF cardinality(v_phones) = 0 THEN
      v_phones := v_settings.default_phones;
    END IF;

    FOREACH v_phone IN ARRAY v_phones
    LOOP
      IF NULLIF(btrim(v_phone), '') IS NOT NULL THEN
        INSERT INTO public.critical_case_alert_outbox (
          account_id, conversation_id, channel, recipient, level, sede, reason
        )
        VALUES (
          NEW.account_id, NEW.id, 'whatsapp', btrim(v_phone), NEW.case_level,
          NEW.case_sede, NEW.case_level_reason
        )
        ON CONFLICT (conversation_id, level, channel, recipient) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block saving the classification itself.
  -- Inserts were rolled back; keep the alert armed so a later re-evaluation retries.
  RAISE WARNING 'Failed to enqueue critical case alerts for conversation %: %', NEW.id, SQLERRM;
  NEW.critical_alerted_level := OLD.critical_alerted_level;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.notify_critical_case() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notify_critical_case() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER conversations_notify_critical_case
  BEFORE UPDATE OF case_level ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.notify_critical_case();

-- Critical alerts push to every recipient, regardless of who is assigned
-- (enqueue_assigned_message_web_push only handles incoming_message).
CREATE OR REPLACE FUNCTION public.enqueue_critical_case_web_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type <> 'critical_case' OR NEW.conversation_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.web_push_outbox (notification_id, account_id, user_id, conversation_id)
  VALUES (NEW.id, NEW.account_id, NEW.user_id, NEW.conversation_id)
  ON CONFLICT (notification_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to enqueue critical case web push for notification %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enqueue_critical_case_web_push() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_critical_case_web_push() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER notifications_enqueue_critical_case_web_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_critical_case_web_push();
