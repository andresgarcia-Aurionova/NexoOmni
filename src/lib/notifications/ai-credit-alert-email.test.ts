import { describe, expect, it } from 'vitest';
import { buildAiCreditAlertEmail } from './credit-alert-email-copy';

describe('AI credit alert email copy', () => {
  it('formats the 10% warning using the configured locale', () => {
    const email = buildAiCreditAlertEmail(10, '1000', 'es');
    expect(email.subject).toContain('10 %');
    expect(email.html).toContain('1,000 créditos');
    expect(email.html).toContain('#b45309');
  });

  it('gives the 5% alert stronger styling and exhaustion guidance', () => {
    const email = buildAiCreditAlertEmail(5, '500', 'en');
    expect(email.subject).toContain('5%');
    expect(email.html).toContain('#b91c1c');
    expect(email.html).toContain('Zernio calls will be paused');
  });

  it('rejects malformed balances instead of producing misleading email', () => {
    expect(() => buildAiCreditAlertEmail(5, '-1', 'en')).toThrow(
      'AI credit alert balance must be a non-negative integer.'
    );
  });
});
