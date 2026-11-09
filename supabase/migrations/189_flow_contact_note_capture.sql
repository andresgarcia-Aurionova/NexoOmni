-- Receipt rows are internal idempotency records, accessible only to service_role.
CREATE TABLE public.flow_contact_note_receipts (
  flow_run_id uuid NOT NULL REFERENCES public.flow_runs(id) ON DELETE CASCADE,
  inbound_message_id text NOT NULL,
  prompt_message_id uuid NOT NULL,
  note_id uuid NOT NULL REFERENCES public.contact_notes(id) ON DELETE CASCADE,
  PRIMARY KEY (flow_run_id, inbound_message_id),
  UNIQUE (flow_run_id, prompt_message_id)
);

ALTER TABLE public.flow_contact_note_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flow_contact_note_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_contact_note_receipts TO service_role;

CREATE FUNCTION public.capture_flow_input_with_contact_note(
  p_account_id uuid,
  p_run_id uuid,
  p_node_key text,
  p_message_id text,
  p_value text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.flow_runs%ROWTYPE;
  v_config jsonb;
  v_note_id uuid;
  v_var_key text;
  v_label text;
BEGIN
  IF p_message_id IS NULL OR btrim(p_message_id) = '' OR
     p_value IS NULL OR btrim(p_value) = '' THEN
    RAISE EXCEPTION 'Invalid flow input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM public.flow_runs
    WHERE id = p_run_id AND account_id = p_account_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flow run not found' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.flow_contact_note_receipts
    WHERE flow_run_id = p_run_id AND inbound_message_id = p_message_id
  ) THEN
    RETURN false;
  END IF;
  IF v_run.status <> 'active' OR v_run.current_node_key IS DISTINCT FROM p_node_key
     OR v_run.last_prompt_message_id IS NULL OR v_run.contact_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.contacts
       WHERE id = v_run.contact_id AND account_id = p_account_id
     ) THEN
    RAISE EXCEPTION 'Flow run is not awaiting this input' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.flow_contact_note_receipts
    WHERE flow_run_id = p_run_id AND prompt_message_id = v_run.last_prompt_message_id
  ) THEN
    RETURN false;
  END IF;
  SELECT config INTO v_config FROM public.flow_nodes
    WHERE flow_id = v_run.flow_id AND node_key = p_node_key AND node_type = 'collect_input';
  v_var_key := v_config->>'var_key';
  v_label := btrim(v_config->>'contact_note_label');
  IF v_config IS NULL OR v_config->'save_contact_note' IS DISTINCT FROM 'true'::jsonb
     OR v_var_key IS NULL OR v_var_key !~ '^[a-zA-Z_][a-zA-Z0-9_]*$'
     OR v_label IS NULL OR v_label = '' OR length(v_label) > 100 THEN
    RAISE EXCEPTION 'Invalid contact note configuration' USING ERRCODE = '22023';
  END IF;

  UPDATE public.flow_runs
    SET vars = coalesce(vars, '{}'::jsonb) || jsonb_build_object(v_var_key, btrim(p_value)),
        reprompt_count = 0
    WHERE id = p_run_id;
  INSERT INTO public.contact_notes (account_id, contact_id, user_id, note_text)
    VALUES (p_account_id, v_run.contact_id, v_run.user_id, v_label || ': ' || btrim(p_value))
    RETURNING id INTO v_note_id;
  INSERT INTO public.flow_contact_note_receipts (flow_run_id, inbound_message_id, prompt_message_id, note_id)
    VALUES (p_run_id, p_message_id, v_run.last_prompt_message_id, v_note_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_flow_input_with_contact_note(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_flow_input_with_contact_note(uuid, uuid, text, text, text)
  TO service_role;
