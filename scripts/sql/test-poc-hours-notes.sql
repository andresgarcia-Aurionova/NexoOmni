-- Run only against the isolated minimal fixture schema used for this test.
-- It is not a production migration and is not suitable for production data.
-- On a disposable database with Supabase roles, apply fixture-poc-hours-notes.sql,
-- migrations 189 and 190, then this script using psql with ON_ERROR_STOP=1.
BEGIN;
INSERT INTO public.accounts VALUES
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');
INSERT INTO public.contacts (id, account_id) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.conversations (id, account_id) VALUES
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.omnichannel_connectors (id, account_id, provider) VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'zernio_whatsapp'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'zernio_whatsapp');
INSERT INTO public.flow_runs
  (id, account_id, flow_id, user_id, contact_id, current_node_key, status, last_prompt_message_id)
VALUES
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'reason', 'active', '60000000-0000-0000-0000-000000000001');
INSERT INTO public.flow_nodes (flow_id, node_key, node_type, config) VALUES
  ('40000000-0000-0000-0000-000000000001', 'reason', 'collect_input',
   '{"var_key":"motivo","save_contact_note":true,"contact_note_label":"Motivo (flujo automático)"}');
INSERT INTO public.connected_whatsapp_closure_receipts
  (account_id, connector_id, conversation_id, period_start, deferred_first_inbound)
VALUES ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001', '2026-11-07 20:00:00+00', true);

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.capture_flow_input_with_contact_note(uuid,uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.capture_flow_input_with_contact_note(uuid,uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.consume_deferred_whatsapp_first_inbound(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.has_deferred_whatsapp_first_inbound(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Capture function is not service-only';
  END IF;
  IF has_table_privilege('authenticated', 'public.flow_contact_note_receipts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.connected_whatsapp_closure_receipts', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Internal receipts exposed to authenticated users';
  END IF;
END $$;

INSERT INTO public.messages (id, conversation_id, sender_type)
VALUES ('80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'agent');
DO $$
BEGIN
  IF public.has_deferred_whatsapp_first_inbound('00000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'A conversation answered by an agent should not restart a welcome flow';
  END IF;
END $$;
DELETE FROM public.messages WHERE id = '80000000-0000-0000-0000-000000000001';

SET LOCAL ROLE service_role;
DO $$
DECLARE
  account_id uuid := '00000000-0000-0000-0000-000000000001';
  run_id uuid := '30000000-0000-0000-0000-000000000001';
BEGIN
  IF NOT public.capture_flow_input_with_contact_note(account_id, run_id, 'reason', 'message-1', 'Consulta') THEN
    RAISE EXCEPTION 'First capture was not stored';
  END IF;
  IF public.capture_flow_input_with_contact_note(account_id, run_id, 'reason', 'message-1', 'Consulta') THEN
    RAISE EXCEPTION 'Duplicate inbound was stored twice';
  END IF;
  IF public.capture_flow_input_with_contact_note(account_id, run_id, 'reason', 'message-2', 'Otra respuesta') THEN
    RAISE EXCEPTION 'Concurrent reply to the same prompt was stored twice';
  END IF;
  BEGIN
    PERFORM public.capture_flow_input_with_contact_note('00000000-0000-0000-0000-000000000002', run_id, 'reason', 'message-3', 'Wrong tenant');
    RAISE EXCEPTION 'Cross-account capture accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF public.consume_deferred_whatsapp_first_inbound('00000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Cross-account deferred first inbound accepted';
  END IF;
  IF NOT public.has_deferred_whatsapp_first_inbound(account_id, '70000000-0000-0000-0000-000000000001')
     OR NOT public.has_deferred_whatsapp_first_inbound(account_id, '70000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Deferred input was consumed before a flow started';
  END IF;
  IF NOT public.consume_deferred_whatsapp_first_inbound(account_id, '70000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Deferred first inbound not consumed';
  END IF;
  IF public.consume_deferred_whatsapp_first_inbound(account_id, '70000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Deferred first inbound consumed twice';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.contact_notes) <> 1
    OR (SELECT note_text FROM public.contact_notes LIMIT 1) <> 'Motivo (flujo automático): Consulta'
    OR (SELECT vars->>'motivo' FROM public.flow_runs LIMIT 1) <> 'Consulta' THEN
    RAISE EXCEPTION 'Note and variable were not saved atomically';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('test.account_id', '00000000-0000-0000-0000-000000000001', true);
SELECT set_config('test.role', 'admin', true);
INSERT INTO public.connected_whatsapp_business_hours
  (account_id, connector_id, timezone, windows, message)
VALUES ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
  'America/Mexico_City', '[]', 'Closed');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.connected_whatsapp_business_hours (account_id, connector_id, timezone, windows, message)
    VALUES ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002',
      'America/Mexico_City', '[]', 'Cross-account');
    RAISE EXCEPTION 'Cross-account connector accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('test.role', 'agent', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.connected_whatsapp_business_hours) THEN
    RAISE EXCEPTION 'Agent can read admin settings';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
