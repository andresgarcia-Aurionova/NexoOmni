-- Deploy the conversation-scoped flow runner before applying this migration.
-- The prior runner selects an active run by contact and could otherwise route
-- a reply to a different line once multiple runs become possible.
DROP INDEX IF EXISTS public.idx_conversations_account_contact_channel;

CREATE UNIQUE INDEX idx_conversations_contact_channel_without_line
  ON public.conversations (account_id, contact_id, channel_type)
  WHERE channel_type <> 'zernio_whatsapp';

-- A deleted connector becomes NULL. Allow multiple orphaned histories so
-- disconnecting two lines never deletes history or fails on this index.
CREATE UNIQUE INDEX idx_conversations_contact_whatsapp_line
  ON public.conversations (account_id, contact_id, channel_type, connector_id)
  WHERE channel_type = 'zernio_whatsapp' AND connector_id IS NOT NULL;

DROP INDEX IF EXISTS public.idx_one_active_run_per_contact;
CREATE UNIQUE INDEX idx_one_active_run_per_conversation
  ON public.flow_runs (account_id, conversation_id)
  WHERE status = 'active' AND conversation_id IS NOT NULL;

-- Retain the old uniqueness for orphaned active runs.
CREATE UNIQUE INDEX idx_one_orphan_active_run_per_contact
  ON public.flow_runs (account_id, contact_id)
  WHERE status = 'active' AND conversation_id IS NULL;

-- Based on the latest definition, migration 127. Conversations on different
-- WhatsApp lines must never be folded together.
CREATE OR REPLACE FUNCTION public.merge_contacts(
  p_account_id UUID,
  p_survivor_id UUID,
  p_loser_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_survivor contacts%ROWTYPE;
  v_loser contacts%ROWTYPE;
  v_conv RECORD;
  v_existing_conv UUID;
BEGIN
  IF p_survivor_id = p_loser_id THEN
    RAISE EXCEPTION 'No se puede fusionar un contacto consigo mismo.';
  END IF;

  SELECT * INTO v_survivor FROM contacts WHERE id = p_survivor_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contacto destino no encontrado.'; END IF;

  SELECT * INTO v_loser FROM contacts WHERE id = p_loser_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contacto a fusionar no encontrado.'; END IF;

  UPDATE contacts SET
    name = CASE WHEN name IS NULL OR btrim(name) = '' THEN v_loser.name ELSE name END,
    email = CASE WHEN email IS NULL OR btrim(email) = '' THEN v_loser.email ELSE email END,
    company = CASE WHEN company IS NULL OR btrim(company) = '' THEN v_loser.company ELSE company END,
    avatar_url = CASE WHEN avatar_url IS NULL OR btrim(avatar_url) = '' THEN v_loser.avatar_url ELSE avatar_url END,
    alternate_phones = (
      SELECT COALESCE(array_agg(DISTINCT phone_candidate), '{}')
      FROM unnest(
        alternate_phones || ARRAY[v_loser.phone] || v_loser.alternate_phones
      ) AS phone_candidate
      WHERE phone_candidate IS NOT NULL
        AND btrim(phone_candidate) <> ''
        AND phone_candidate <> phone
    ),
    updated_at = now()
  WHERE id = p_survivor_id;

  FOR v_conv IN
    SELECT id, channel_type, connector_id FROM conversations
    WHERE account_id = p_account_id AND contact_id = p_loser_id
  LOOP
    SELECT id INTO v_existing_conv FROM conversations
      WHERE account_id = p_account_id AND contact_id = p_survivor_id
        AND channel_type = v_conv.channel_type
        AND (v_conv.channel_type <> 'zernio_whatsapp'
          OR (v_conv.connector_id IS NOT NULL AND connector_id = v_conv.connector_id));

    IF v_existing_conv IS NULL THEN
      UPDATE conversations SET contact_id = p_survivor_id, updated_at = now() WHERE id = v_conv.id;
    ELSE
      IF v_conv.channel_type = 'zernio_whatsapp' THEN
        RAISE EXCEPTION 'No se pueden fusionar contactos con conversaciones de WhatsApp en la misma línea; se requiere revisión.';
      END IF;

      UPDATE messages                    SET conversation_id = v_existing_conv WHERE conversation_id = v_conv.id;
      UPDATE message_reactions           SET conversation_id = v_existing_conv WHERE conversation_id = v_conv.id;
      UPDATE deals                       SET conversation_id = v_existing_conv WHERE conversation_id = v_conv.id;
      UPDATE flow_runs                   SET conversation_id = v_existing_conv WHERE conversation_id = v_conv.id;
      UPDATE notifications               SET conversation_id = v_existing_conv WHERE conversation_id = v_conv.id;
      UPDATE ai_usage_log                SET conversation_id = v_existing_conv WHERE conversation_id = v_conv.id;
      UPDATE conversation_internal_notes SET conversation_id = v_existing_conv WHERE conversation_id = v_conv.id;

      UPDATE ai_conversation_analyses a SET conversation_id = v_existing_conv
        WHERE a.conversation_id = v_conv.id
          AND NOT EXISTS (
            SELECT 1 FROM ai_conversation_analyses s
            WHERE s.conversation_id = v_existing_conv AND s.source = a.source
          );
      DELETE FROM ai_conversation_analyses WHERE conversation_id = v_conv.id;

      UPDATE conversations c SET
        unread_count = c.unread_count + COALESCE((SELECT unread_count FROM conversations WHERE id = v_conv.id), 0),
        updated_at = now()
      WHERE c.id = v_existing_conv;

      DELETE FROM conversations WHERE id = v_conv.id;
    END IF;
  END LOOP;

  UPDATE contact_tags ct SET contact_id = p_survivor_id
    WHERE ct.contact_id = p_loser_id
      AND NOT EXISTS (SELECT 1 FROM contact_tags s WHERE s.contact_id = p_survivor_id AND s.tag_id = ct.tag_id);
  DELETE FROM contact_tags WHERE contact_id = p_loser_id;

  UPDATE contact_custom_values cv SET contact_id = p_survivor_id
    WHERE cv.contact_id = p_loser_id
      AND NOT EXISTS (SELECT 1 FROM contact_custom_values s WHERE s.contact_id = p_survivor_id AND s.custom_field_id = cv.custom_field_id);
  DELETE FROM contact_custom_values WHERE contact_id = p_loser_id;

  UPDATE flow_runs SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;
  UPDATE contact_notes                  SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;
  UPDATE deals                          SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;
  UPDATE broadcast_recipients           SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;
  UPDATE automation_logs                SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;
  UPDATE automation_pending_executions  SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;
  UPDATE notifications                  SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;
  UPDATE yeastar_call_transcriptions    SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;
  UPDATE omnichannel_contact_identities SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;

  DELETE FROM contacts WHERE id = p_loser_id AND account_id = p_account_id;
  RETURN p_survivor_id;
END;
$$;

ALTER FUNCTION public.merge_contacts(UUID, UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.merge_contacts(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_contacts(UUID, UUID, UUID) TO service_role;
