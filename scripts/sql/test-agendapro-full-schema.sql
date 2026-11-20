-- Run only against a disposable database with the application migrations applied.
BEGIN;
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('01000000-0000-0000-0000-000000000001', 'agendapro-test@example.test',
        '{"platform_provisioned":true}');
INSERT INTO public.accounts (id, name, owner_user_id)
VALUES ('11000000-0000-0000-0000-000000000001', 'AgendaPro test', '01000000-0000-0000-0000-000000000001');
INSERT INTO public.account_subscriptions (account_id)
VALUES ('11000000-0000-0000-0000-000000000001');
INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
VALUES ('01000000-0000-0000-0000-000000000001', 'Test', 'agendapro-test@example.test',
        '11000000-0000-0000-0000-000000000001', 'owner');
INSERT INTO public.contacts (id, user_id, account_id, phone)
VALUES ('21000000-0000-0000-0000-000000000001', '01000000-0000-0000-0000-000000000001',
        '11000000-0000-0000-0000-000000000001', '+5215555550101');
INSERT INTO public.omnichannel_connectors (id, account_id, provider, display_name, external_channel_id, created_by)
VALUES
 ('31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001',
  'zernio_whatsapp', 'Line A', 'test-a', '01000000-0000-0000-0000-000000000001'),
 ('31000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001',
  'zernio_whatsapp', 'Line B', 'test-b', '01000000-0000-0000-0000-000000000001');
INSERT INTO public.conversations (id, account_id, user_id, contact_id, channel_type, connector_id)
VALUES
 ('41000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001',
  '01000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
  'zernio_whatsapp', '31000000-0000-0000-0000-000000000001'),
 ('41000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001',
  '01000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
  'zernio_whatsapp', '31000000-0000-0000-0000-000000000002');
INSERT INTO public.agendapro_bookings (id, account_id, contact_id, agendapro_booking_id, start_time)
VALUES ('51000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001',
        '21000000-0000-0000-0000-000000000001', 'test-1', now() + interval '1 day');
UPDATE public.agendapro_bookings SET confirmation_reminder_status = 'sent',
  confirmation_reminder_conversation_id = '41000000-0000-0000-0000-000000000001';
DO $$
DECLARE r jsonb;
BEGIN
  r := public.handle_agendapro_confirmation_reply('11000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000002', 'yes');
  IF r->>'outcome' <> 'none' THEN RAISE EXCEPTION 'Wrong line matched'; END IF;
  r := public.handle_agendapro_confirmation_reply('11000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'yes');
  IF r->>'outcome' <> 'handled' THEN RAISE EXCEPTION 'Correct line did not confirm'; END IF;
END $$;
UPDATE public.agendapro_bookings SET start_time = now() + interval '2 days';
DO $$
BEGIN
  IF NOT (SELECT confirmation_review_required FROM public.agendapro_bookings WHERE agendapro_booking_id='test-1') THEN
    RAISE EXCEPTION 'Reschedule lost review';
  END IF;
  IF NOT public.notify_agendapro_confirmation_review('11000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001', 'Review', 'Review appointment') THEN
    RAISE EXCEPTION 'Review notification not sent';
  END IF;
  IF (SELECT count(*) FROM public.notifications WHERE account_id='11000000-0000-0000-0000-000000000001'
      AND type='agendapro_unconfirmed_appointment') <> 1 THEN
    RAISE EXCEPTION 'Review notification not recorded';
  END IF;
END $$;
INSERT INTO public.agendapro_bookings (id, account_id, contact_id, agendapro_booking_id, start_time)
VALUES ('51000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001',
        '21000000-0000-0000-0000-000000000001', 'test-2', now() + interval '1 day');
UPDATE public.agendapro_bookings SET confirmation_reminder_status='sent',
  confirmation_reminder_conversation_id='41000000-0000-0000-0000-000000000001'
  WHERE agendapro_booking_id='test-2';
DO $$
DECLARE r jsonb;
BEGIN
  r := public.handle_agendapro_confirmation_reply('11000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'yes');
  IF r->>'outcome' <> 'review'
    OR EXISTS (SELECT 1 FROM public.agendapro_bookings WHERE agendapro_booking_id IN ('test-1','test-2')
      AND confirmation_status <> 'pending') THEN
    RAISE EXCEPTION 'A reply to the rescheduled reminder could confirm another booking';
  END IF;
END $$;
DELETE FROM public.agendapro_bookings WHERE agendapro_booking_id='test-2';
INSERT INTO public.flows (id, user_id, account_id, name, trigger_type)
VALUES ('61000000-0000-0000-0000-000000000001', '01000000-0000-0000-0000-000000000001',
        '11000000-0000-0000-0000-000000000001', 'Test flow', 'manual');
UPDATE public.agendapro_bookings SET confirmation_review_required=false,
  confirmation_reminder_status='sent',
  confirmation_reminder_conversation_id='41000000-0000-0000-0000-000000000001'
  WHERE agendapro_booking_id='test-1';
DO $$
DECLARE r jsonb;
BEGIN
  r := public.handle_agendapro_confirmation_reply('11000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'yes', true);
  IF r->>'outcome' <> 'review' THEN RAISE EXCEPTION 'Completed flow did not require review'; END IF;
END $$;
INSERT INTO public.flow_runs (id, flow_id, user_id, account_id, contact_id, conversation_id, status)
VALUES ('71000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001',
        '01000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001',
        '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'active');
UPDATE public.agendapro_bookings SET confirmation_review_required = false,
  confirmation_reminder_status = 'sent',
  confirmation_reminder_conversation_id = '41000000-0000-0000-0000-000000000001';
DO $$
DECLARE r jsonb;
BEGIN
  r := public.handle_agendapro_confirmation_reply('11000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'no');
  IF r->>'outcome' <> 'review' THEN RAISE EXCEPTION 'Active flow did not require review'; END IF;
END $$;
INSERT INTO public.appointments
  (id, account_id, contact_id, title, starts_at, ends_at, reservation_restaurant,
   reservation_whatsapp_preference, reservation_whatsapp_phone)
VALUES ('81000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001', 'Reservation',
  now() + interval '1 day', now() + interval '1 day 1 hour', 'A', 'caller', '5215555550101');
UPDATE public.reservation_confirmation_jobs SET state='sent',
  conversation_id='41000000-0000-0000-0000-000000000001'
  WHERE appointment_id='81000000-0000-0000-0000-000000000001';
DO $$
DECLARE revision integer; accepted boolean; r jsonb;
BEGIN
  SELECT j.revision INTO revision FROM public.reservation_confirmation_jobs j
    WHERE appointment_id='81000000-0000-0000-0000-000000000001';
  accepted := public.accept_voice_reservation_recipient_response(
    '11000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001',
    revision, '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001', '5215555550101', 'yes', 'Review', 'Review reservation');
  IF accepted THEN RAISE EXCEPTION 'Active flow accepted a voice confirmation'; END IF;
  UPDATE public.flow_runs SET status='completed' WHERE id='71000000-0000-0000-0000-000000000001';
  UPDATE public.agendapro_bookings SET confirmation_review_required=false WHERE agendapro_booking_id='test-1';
  UPDATE public.reservation_confirmation_jobs SET state='sending', conversation_id=NULL
    WHERE appointment_id='81000000-0000-0000-0000-000000000001';
  r := public.handle_agendapro_confirmation_reply('11000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'yes');
  IF r->>'outcome' <> 'review' THEN RAISE EXCEPTION 'Voice reminder in flight did not require review'; END IF;
  UPDATE public.agendapro_bookings SET confirmation_review_required=false WHERE agendapro_booking_id='test-1';
  UPDATE public.reservation_confirmation_jobs SET state='sent',
    conversation_id='41000000-0000-0000-0000-000000000002'
    WHERE appointment_id='81000000-0000-0000-0000-000000000001';
  r := public.handle_agendapro_confirmation_reply('11000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'yes');
  IF r->>'outcome' <> 'handled' THEN RAISE EXCEPTION 'Voice reminder on another line blocked confirmation'; END IF;
  UPDATE public.agendapro_bookings SET confirmation_status='pending' WHERE agendapro_booking_id='test-1';
  UPDATE public.reservation_confirmation_jobs SET conversation_id='41000000-0000-0000-0000-000000000001'
    WHERE appointment_id='81000000-0000-0000-0000-000000000001';
  r := public.handle_agendapro_confirmation_reply('11000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'yes');
  IF r->>'outcome' <> 'review' THEN RAISE EXCEPTION 'Voice reminder did not require AgendaPro review'; END IF;
  accepted := public.accept_voice_reservation_recipient_response(
    '11000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001',
    revision, '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001', '5215555550101', 'yes', 'Review', 'Review reservation');
  IF accepted THEN RAISE EXCEPTION 'An ambiguous AgendaPro reminder accepted a voice confirmation'; END IF;
  UPDATE public.agendapro_bookings SET confirmation_status='confirmed' WHERE agendapro_booking_id='test-1';
  accepted := public.accept_voice_reservation_recipient_response(
    '11000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001',
    revision, '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001', '5215555550101', 'yes', 'Review', 'Review reservation');
  IF NOT accepted THEN RAISE EXCEPTION 'Valid voice confirmation was rejected'; END IF;
END $$;
ROLLBACK;
