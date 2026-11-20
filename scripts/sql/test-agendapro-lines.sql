-- Disposable fixture only: apply both fixtures and migrations 201 and 202.
BEGIN;
INSERT INTO contacts(id,account_id) VALUES
  ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
INSERT INTO conversations(id,account_id,contact_id,channel_type) VALUES
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','whatsapp'),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','zernio_whatsapp');
INSERT INTO profiles VALUES
  ('10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',true,'admin');
INSERT INTO agendapro_bookings(id,account_id,contact_id,start_time) VALUES
  ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',now() + interval '1 day');
UPDATE agendapro_bookings SET confirmation_reminder_status='sent',
  confirmation_reminder_conversation_id='20000000-0000-0000-0000-000000000001';
DO $$
DECLARE r jsonb;
BEGIN
  r := handle_agendapro_confirmation_reply('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','yes');
  IF r->>'outcome' <> 'none' THEN RAISE EXCEPTION 'Other line matched a reminder'; END IF;
  r := handle_agendapro_confirmation_reply('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','yes');
  IF r->>'outcome' <> 'handled' OR (SELECT confirmation_status FROM agendapro_bookings LIMIT 1) <> 'confirmed' THEN
    RAISE EXCEPTION 'Correct line did not confirm';
  END IF;
END $$;
UPDATE agendapro_bookings SET start_time=now() + interval '2 days';
UPDATE agendapro_bookings SET confirmation_reminder_status='sent';
UPDATE profiles SET is_active=false;
DO $$
BEGIN
  IF notify_agendapro_confirmation_review('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','title','body') THEN
    RAISE EXCEPTION 'Missing administrators must leave the notification pending';
  END IF;
  IF (SELECT confirmation_review_notified_at FROM agendapro_bookings LIMIT 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Missing administrators marked a review notified';
  END IF;
END $$;
UPDATE profiles SET is_active=true;
DO $$
DECLARE r jsonb;
BEGIN
  IF NOT (SELECT confirmation_review_required FROM agendapro_bookings LIMIT 1) THEN
    RAISE EXCEPTION 'Rescheduling a sent reminder must require review';
  END IF;
  r := handle_agendapro_confirmation_reply('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','yes');
  IF r->>'outcome' <> 'review' OR (SELECT confirmation_status FROM agendapro_bookings LIMIT 1) <> 'pending'
    OR NOT (SELECT confirmation_review_required FROM agendapro_bookings LIMIT 1) THEN RAISE EXCEPTION 'Legacy reply was not flagged'; END IF;
  IF NOT notify_agendapro_confirmation_review('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','title','body') THEN
    RAISE EXCEPTION 'Review notification was not sent';
  END IF;
  IF NOT notify_agendapro_confirmation_review('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','title','body')
     OR (SELECT count(*) FROM notifications) <> 1 THEN RAISE EXCEPTION 'Review notification was not idempotent'; END IF;
END $$;
UPDATE agendapro_bookings SET start_time=now() + interval '3 days';
UPDATE agendapro_bookings SET confirmation_reminder_status='sending';
DO $$
DECLARE r jsonb;
BEGIN
  IF NOT (SELECT confirmation_review_required FROM agendapro_bookings LIMIT 1) THEN RAISE EXCEPTION 'Reschedule lost review state'; END IF;
  r := handle_agendapro_confirmation_reply('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','no');
  IF r->>'outcome' <> 'review' THEN RAISE EXCEPTION 'In-flight response was not flagged'; END IF;
END $$;
UPDATE agendapro_bookings SET start_time=now() + interval '4 days';
UPDATE agendapro_bookings SET confirmation_reminder_status='sent',
  confirmation_reminder_conversation_id='20000000-0000-0000-0000-000000000001',
  confirmation_review_required=false;
INSERT INTO flow_runs VALUES
  ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','active');
DO $$
DECLARE r jsonb;
BEGIN
  r := handle_agendapro_confirmation_reply('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','yes');
  IF r->>'outcome' <> 'review' THEN RAISE EXCEPTION 'Active flow did not take priority'; END IF;
  IF has_function_privilege('authenticated','public.handle_agendapro_confirmation_reply(uuid,uuid,uuid,text,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Reply function is not service-only';
  END IF;
  BEGIN
    PERFORM handle_agendapro_confirmation_reply('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',NULL);
    RAISE EXCEPTION 'Null response was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Invalid confirmation response' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
