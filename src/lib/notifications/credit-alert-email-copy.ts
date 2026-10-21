import esMessages from '../../../messages/es.json';
import enMessages from '../../../messages/en.json';
import koMessages from '../../../messages/ko.json';
import {
  formatCreditBalance,
  type AiCreditAlertThreshold,
} from './credit-alert-types';

export type AiCreditAlertLocale = 'es' | 'en' | 'ko';
type AlertMessages = typeof enMessages.AiCreditAlerts;

const messages: Record<AiCreditAlertLocale, AlertMessages> = {
  es: esMessages.AiCreditAlerts,
  en: enMessages.AiCreditAlerts,
  ko: koMessages.AiCreditAlerts,
};

export function configuredAiCreditAlertLocale(): AiCreditAlertLocale {
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE;
  return locale === 'es' || locale === 'ko' ? locale : 'en';
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildAiCreditAlertEmail(
  threshold: AiCreditAlertThreshold,
  balance: string,
  locale: AiCreditAlertLocale = configuredAiCreditAlertLocale()
) {
  const formattedBalance = formatCreditBalance(balance, locale);
  if (!formattedBalance) {
    throw new Error('AI credit alert balance must be a non-negative integer.');
  }

  const copy = messages[locale];
  const subject =
    threshold === 5 ? copy.threshold5EmailSubject : copy.threshold10EmailSubject;
  const heading =
    threshold === 5 ? copy.threshold5EmailHeading : copy.threshold10EmailHeading;
  const body =
    threshold === 5 ? copy.threshold5EmailBody : copy.threshold10EmailBody;
  const renderedBody = body.replace('{credits}', formattedBalance);
  const color = threshold === 5 ? '#b91c1c' : '#b45309';

  return {
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937"><div style="border-left:5px solid ${color};padding:4px 0 4px 16px"><h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(heading)}</h1><p style="font-size:15px;line-height:1.6;margin:0">${escapeHtml(renderedBody)}</p></div><p style="font-size:12px;color:#6b7280;margin-top:24px">NexoOmni</p></div>`,
  };
}
