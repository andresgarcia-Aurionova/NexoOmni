import type { NotificationType } from '@/types';

export type AiCreditAlertThreshold = 5 | 10;

export function getAiCreditAlertThreshold(
  type: NotificationType
): AiCreditAlertThreshold | null {
  if (type === 'ai_credit_balance_5') return 5;
  if (type === 'ai_credit_balance_10') return 10;
  return null;
}

export function formatCreditBalance(
  value: string | undefined,
  locale: string
): string | null {
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const numberLocale =
    locale === 'es' ? 'es-MX' : locale === 'ko' ? 'ko-KR' : 'en-US';
  return new Intl.NumberFormat(numberLocale).format(BigInt(value));
}
