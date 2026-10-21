import 'server-only';

import { sendSmtpEmail } from '@/lib/email/smtp';
import {
  buildAiCreditAlertEmail,
  configuredAiCreditAlertLocale,
} from './credit-alert-email-copy';
import type { AiCreditAlertThreshold } from './credit-alert-types';

export async function sendAiCreditAlertEmail({
  to,
  threshold,
  balance,
}: {
  to: string;
  threshold: AiCreditAlertThreshold;
  balance: string;
}) {
  const email = buildAiCreditAlertEmail(
    threshold,
    balance,
    configuredAiCreditAlertLocale()
  );
  return sendSmtpEmail({
    to,
    subject: email.subject,
    html: email.html,
  });
}
