-- Read-only sample of up to 50 completed chat analyses for model evaluation.
-- Replace the UUID below with the tenant account_id before running.
-- To sample 100 cases, change LIMIT 50 to LIMIT 100.
--
-- This masks common email, phone, and URL patterns, but SQL regexes cannot
-- guarantee anonymization. Review every row locally and remove names,
-- addresses, order numbers, health/financial data, or other identifiers
-- before sharing any output. No database or conversation IDs are returned.

WITH parameters AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS account_id
),
sampled AS (
  SELECT
    row_number() OVER (ORDER BY a.analyzed_at DESC NULLS LAST, a.created_at DESC) AS case_number,
    a.conversation_id,
    a.summary,
    a.sentiment,
    a.sentiment_score,
    a.next_best_action,
    a.reasons
  FROM ai_conversation_analyses a
  JOIN conversations c ON c.id = a.conversation_id
  CROSS JOIN parameters p
  WHERE c.account_id = p.account_id
    AND a.account_id = p.account_id
    AND a.source = 'whatsapp'
    AND a.status = 'completed'
    AND EXISTS (
      SELECT 1
      FROM messages m
      WHERE m.conversation_id = a.conversation_id
        AND m.content_text IS NOT NULL
    )
  ORDER BY a.analyzed_at DESC NULLS LAST, a.created_at DESC
  LIMIT 50
),
case_turns AS (
  SELECT
    s.case_number,
    m.id,
    m.sender_type,
    m.created_at,
    regexp_replace(
      regexp_replace(
        regexp_replace(m.content_text, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}', '[EMAIL]', 'g'),
        'https?://[^[:space:]]+', '[URL]', 'gi'
      ),
      '[+]?[0-9][0-9 ()-]{6,}[0-9]', '[TELEFONO]', 'g'
    ) AS redacted_text
  FROM sampled s
  JOIN LATERAL (
    SELECT recent.*
    FROM (
      SELECT id, sender_type, created_at, content_text
      FROM messages
      WHERE conversation_id = s.conversation_id
        AND content_text IS NOT NULL
      ORDER BY created_at DESC, id DESC
      LIMIT 20
    ) recent
    ORDER BY recent.created_at, recent.id
  ) m ON true
),
turns AS (
  SELECT
    case_number,
    jsonb_agg(
      jsonb_build_object(
        'turn', turn_number,
        'speaker', sender_type,
        'text', redacted_text
      )
      ORDER BY created_at, id
    ) AS messages
  FROM (
    SELECT
      case_number,
      id,
      sender_type,
      created_at,
      redacted_text,
      row_number() OVER (PARTITION BY case_number ORDER BY created_at, id) AS turn_number
    FROM case_turns
  ) ordered_turns
  GROUP BY case_number
)
SELECT
  s.case_number,
  s.sentiment,
  s.sentiment_score,
  regexp_replace(
    regexp_replace(
      regexp_replace(coalesce(s.summary, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}', '[EMAIL]', 'g'),
      'https?://[^[:space:]]+', '[URL]', 'gi'
    ),
    '[+]?[0-9][0-9 ()-]{6,}[0-9]', '[TELEFONO]', 'g'
  ) AS prior_summary,
  regexp_replace(
    regexp_replace(
      regexp_replace(coalesce(s.next_best_action, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}', '[EMAIL]', 'g'),
      'https?://[^[:space:]]+', '[URL]', 'gi'
    ),
    '[+]?[0-9][0-9 ()-]{6,}[0-9]', '[TELEFONO]', 'g'
  ) AS prior_next_best_action,
  regexp_replace(
    regexp_replace(
      regexp_replace(coalesce(s.reasons::text, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}', '[EMAIL]', 'g'),
      'https?://[^[:space:]]+', '[URL]', 'gi'
    ),
    '[+]?[0-9][0-9 ()-]{6,}[0-9]', '[TELEFONO]', 'g'
  ) AS prior_reasons,
  turns.messages
FROM sampled s
JOIN turns USING (case_number)
ORDER BY s.case_number;
