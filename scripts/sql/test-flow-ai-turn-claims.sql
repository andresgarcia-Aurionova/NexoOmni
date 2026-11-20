-- Run against an empty isolated database after flow-ai-turns-fixture.sql and migration 205.
DO $$
DECLARE
  v_account uuid := '00000000-0000-0000-0000-000000000002';
  v_run uuid := '00000000-0000-0000-0000-000000000001';
  v_first uuid;
  v_second uuid;
  v_result record;
BEGIN
  SELECT * INTO v_result FROM public.claim_flow_ai_turn(v_account, v_run, 'offer', 'message-1');
  IF v_result.outcome <> 'claimed' OR v_result.turn_id IS NULL THEN
    RAISE EXCEPTION 'First turn was not claimed';
  END IF;
  v_first := v_result.turn_id;
  IF NOT public.is_flow_ai_turn_active(v_account, v_run, v_first, 'offer') THEN
    RAISE EXCEPTION 'Claimed turn is not active';
  END IF;

  SELECT * INTO v_result FROM public.claim_flow_ai_turn(v_account, v_run, 'offer', 'message-1');
  IF v_result.outcome <> 'duplicate' OR v_result.turn_id <> v_first THEN
    RAISE EXCEPTION 'Duplicate message was not recognized';
  END IF;
  IF public.finish_flow_ai_turn(v_account, v_run, v_first, 'wrong-node') THEN
    RAISE EXCEPTION 'An obsolete node completed a turn';
  END IF;
  IF NOT public.finish_flow_ai_turn(v_account, v_run, v_first, 'offer') THEN
    RAISE EXCEPTION 'Active turn did not complete';
  END IF;
  IF public.finish_flow_ai_turn(v_account, v_run, v_first, 'offer') THEN
    RAISE EXCEPTION 'Completed turn was completed twice';
  END IF;

  SELECT * INTO v_result FROM public.claim_flow_ai_turn(v_account, v_run, 'offer', 'message-2');
  IF v_result.outcome <> 'claimed' THEN
    RAISE EXCEPTION 'Next message was not claimed';
  END IF;
  v_second := v_result.turn_id;
  IF public.handoff_flow_ai_turn(v_account, v_run, v_second, 'offer', true) THEN
    RAISE EXCEPTION 'Recent turn was treated as stalled';
  END IF;
  UPDATE public.flow_ai_turns SET started_at = clock_timestamp() - interval '4 minutes'
    WHERE id = v_second;
  IF NOT public.handoff_flow_ai_turn(v_account, v_run, v_second, 'offer', true) THEN
    RAISE EXCEPTION 'Stalled turn was not handed off';
  END IF;
  IF public.finish_flow_ai_turn(v_account, v_run, v_second, 'offer') THEN
    RAISE EXCEPTION 'A handed-off turn was allowed to complete';
  END IF;
  IF public.is_flow_ai_turn_active(v_account, v_run, v_second, 'offer') THEN
    RAISE EXCEPTION 'A handed-off turn remained active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.flow_runs WHERE id = v_run AND status = 'handed_off'
                 AND end_reason = 'ai_turn_stalled')
     OR NOT EXISTS (SELECT 1 FROM public.conversations
                    WHERE id = '00000000-0000-0000-0000-000000000006' AND status = 'pending')
     OR NOT EXISTS (SELECT 1 FROM public.flow_run_events
                    WHERE flow_run_id = v_run AND event_type = 'handoff'
                      AND payload->>'reason' = 'ai_turn_stalled') THEN
    RAISE EXCEPTION 'Stalled handoff was not recorded atomically';
  END IF;

  UPDATE public.flow_runs SET status = 'active', current_node_key = 'offer' WHERE id = v_run;
  SELECT * INTO v_result FROM public.claim_flow_ai_turn(v_account, v_run, 'offer', 'message-3');
  v_first := v_result.turn_id;
  UPDATE public.flow_runs SET current_node_key = 'next' WHERE id = v_run;
  SELECT * INTO v_result FROM public.claim_flow_ai_turn(v_account, v_run, 'next', 'message-4');
  IF v_result.outcome <> 'handed_off' OR v_result.turn_node_key <> 'offer' THEN
    RAISE EXCEPTION 'A moved node bypassed the active AI turn';
  END IF;
  IF public.finish_flow_ai_turn(v_account, v_run, v_first, 'offer')
     OR NOT EXISTS (SELECT 1 FROM public.flow_runs WHERE id = v_run AND status = 'handed_off'
                    AND end_reason = 'ai_turn_interrupted') THEN
    RAISE EXCEPTION 'The moved AI turn was not fenced by handoff';
  END IF;

  IF has_function_privilege('anon', 'public.claim_flow_ai_turn(uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.finish_flow_ai_turn(uuid,uuid,uuid,text)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.flow_ai_turns', 'SELECT')
     OR NOT has_function_privilege('service_role', 'public.handoff_flow_ai_turn(uuid,uuid,uuid,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected AI turn privileges';
  END IF;
END;
$$;
