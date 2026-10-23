-- Allow account agents to create and inspect only manual analysis jobs.
-- Automated jobs remain managed by database triggers and the service worker.

DROP POLICY IF EXISTS ai_analysis_jobs_manual_select ON public.ai_analysis_jobs;
CREATE POLICY ai_analysis_jobs_manual_select ON public.ai_analysis_jobs
  FOR SELECT TO authenticated
  USING (
    trigger = 'manual'
    AND is_account_member(account_id, 'agent')
  );

DROP POLICY IF EXISTS ai_analysis_jobs_manual_insert ON public.ai_analysis_jobs;
CREATE POLICY ai_analysis_jobs_manual_insert ON public.ai_analysis_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    trigger = 'manual'
    AND status = 'queued'
    AND attempts = 0
    AND is_account_member(account_id, 'agent')
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = ai_analysis_jobs.conversation_id
        AND c.account_id = ai_analysis_jobs.account_id
    )
  );

DROP POLICY IF EXISTS ai_analysis_jobs_manual_update ON public.ai_analysis_jobs;
CREATE POLICY ai_analysis_jobs_manual_update ON public.ai_analysis_jobs
  FOR UPDATE TO authenticated
  USING (
    trigger = 'manual'
    AND status IN ('completed', 'skipped_limit', 'failed')
    AND is_account_member(account_id, 'agent')
  )
  WITH CHECK (
    trigger = 'manual'
    AND status = 'queued'
    AND attempts = 0
    AND is_account_member(account_id, 'agent')
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = ai_analysis_jobs.conversation_id
        AND c.account_id = ai_analysis_jobs.account_id
    )
  );
