-- Validate inbound PDF documents before the AI auto-reply uses them.
-- Existing accounts opt in through the same visual-media setting that already
-- controls billable image analysis.

ALTER TABLE public.ai_media_analysis_jobs
  DROP CONSTRAINT IF EXISTS ai_media_analysis_jobs_kind_check;
ALTER TABLE public.ai_media_analysis_jobs
  ADD CONSTRAINT ai_media_analysis_jobs_kind_check
  CHECK (kind IN ('image', 'voice_note', 'document'));

CREATE OR REPLACE FUNCTION public.queue_ai_media_analysis_from_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account_id uuid;
  v_images_enabled boolean;
  v_voice_enabled boolean;
  v_kind text;
  v_supported_connector boolean := false;
BEGIN
  IF NEW.sender_type <> 'customer' OR NEW.media_url IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT account_id INTO v_account_id FROM conversations WHERE id = NEW.conversation_id;
  SELECT EXISTS (
    SELECT 1 FROM conversations c
    LEFT JOIN omnichannel_connectors oc ON oc.id = c.connector_id
    WHERE c.id = NEW.conversation_id
      AND oc.provider IN ('yeastar_live_chat', 'facebook', 'instagram', 'zernio_whatsapp', 'zernio_facebook', 'zernio_instagram')
  ) INTO v_supported_connector;

  IF NEW.media_url !~ '^/api/whatsapp/media/[^/?#]+$' AND NOT v_supported_connector THEN
    RETURN NEW;
  END IF;

  SELECT analysis_images_enabled, analysis_voice_notes_enabled
    INTO v_images_enabled, v_voice_enabled
    FROM ai_configs WHERE account_id = v_account_id;

  IF NEW.content_type = 'image' AND COALESCE(v_images_enabled, false) THEN
    v_kind := 'image';
  ELSIF NEW.content_type = 'audio' AND COALESCE(v_voice_enabled, false) THEN
    v_kind := 'voice_note';
  ELSIF NEW.content_type = 'document' AND COALESCE(v_images_enabled, false) THEN
    v_kind := 'document';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO ai_media_analysis_jobs(account_id, conversation_id, message_id, kind)
  VALUES (v_account_id, NEW.conversation_id, NEW.id, v_kind)
  ON CONFLICT (account_id, message_id, kind) DO NOTHING;

  UPDATE messages SET media_analysis_status = 'queued', media_analysis_error = null WHERE id = NEW.id;
  RETURN NEW;
END;
$$;
