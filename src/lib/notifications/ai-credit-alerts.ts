import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendAiCreditAlertEmail } from './ai-credit-alert-email';
import type { AiCreditAlertThreshold } from './credit-alert-types';

type EmailOutboxRow = {
  id: string;
  recipient_email: string;
  threshold_percent: AiCreditAlertThreshold;
  balance_at_alert: string | number;
  attempt_count: number;
};

const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 5;
const CLAIM_TIMEOUT_MS = 15 * 60_000;

function retryDelay(attempt: number) {
  return Math.min(2 ** Math.max(0, attempt - 1) * 60_000, 6 * 60 * 60_000);
}

export async function processAiCreditAlertEmails(db: SupabaseClient) {
  const now = new Date();
  const timestamp = now.toISOString();
  const { error: recoverError } = await db
    .from('ai_credit_alert_email_outbox')
    .update({ status: 'pending', claimed_at: null, next_attempt_at: timestamp })
    .eq('status', 'processing')
    .lt(
      'claimed_at',
      new Date(now.getTime() - CLAIM_TIMEOUT_MS).toISOString()
    );
  if (recoverError) throw recoverError;

  const { data, error } = await db
    .from('ai_credit_alert_email_outbox')
    .select(
      'id, recipient_email, threshold_percent, balance_at_alert, attempt_count'
    )
    .eq('status', 'pending')
    .lte('next_attempt_at', timestamp)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw error;

  const claimedRows: Array<{ row: EmailOutboxRow; attempts: number }> = [];
  for (const row of (data ?? []) as EmailOutboxRow[]) {
    const attempts = row.attempt_count + 1;
    const { data: claimed, error: claimError } = await db
      .from('ai_credit_alert_email_outbox')
      .update({
        status: 'processing',
        claimed_at: new Date().toISOString(),
        attempt_count: attempts,
      })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;
    claimedRows.push({ row, attempts });
  }

  const results = await Promise.all(
    claimedRows.map(async ({ row, attempts }) => {
      try {
        await sendAiCreditAlertEmail({
          to: row.recipient_email,
          threshold: row.threshold_percent,
          balance: String(row.balance_at_alert),
        });
        const { error: sentError } = await db
          .from('ai_credit_alert_email_outbox')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            claimed_at: null,
            last_error: null,
          })
          .eq('id', row.id)
          .eq('status', 'processing');
        if (sentError) throw sentError;
        return 'sent' as const;
      } catch (error) {
        const isDead = attempts >= MAX_ATTEMPTS;
        const { error: failureError } = await db
          .from('ai_credit_alert_email_outbox')
          .update({
            status: isDead ? 'dead' : 'pending',
            claimed_at: null,
            next_attempt_at: new Date(
              Date.now() + retryDelay(attempts)
            ).toISOString(),
            last_error: 'Email delivery failed.',
          })
          .eq('id', row.id)
          .eq('status', 'processing');
        if (failureError) throw failureError;
        console.error(
          `[ai credit alerts] Email delivery failed for outbox row ${row.id}:`,
          error
        );
        return isDead ? 'dead' as const : 'retried' as const;
      }
    })
  );

  return {
    sent: results.filter((result) => result === 'sent').length,
    retried: results.filter((result) => result === 'retried').length,
    dead: results.filter((result) => result === 'dead').length,
  };
}
