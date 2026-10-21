import { describe, expect, it } from 'vitest';
import {
  formatCreditBalance,
  getAiCreditAlertThreshold,
} from './credit-alert-types';

describe('AI credit balance alerts', () => {
  it('maps only the two credit alert types to their threshold', () => {
    expect(getAiCreditAlertThreshold('ai_credit_balance_10')).toBe(10);
    expect(getAiCreditAlertThreshold('ai_credit_balance_5')).toBe(5);
    expect(getAiCreditAlertThreshold('incoming_message')).toBeNull();
  });

  it('formats large balances without losing integer precision', () => {
    expect(formatCreditBalance('1234567890123456789', 'en')).toBe(
      '1,234,567,890,123,456,789'
    );
    expect(formatCreditBalance('10000', 'es')).toBe('10,000');
    expect(formatCreditBalance('10000', 'ko')).toBe('10,000');
  });

  it('rejects values that are not non-negative integer strings', () => {
    expect(formatCreditBalance('-1', 'en')).toBeNull();
    expect(formatCreditBalance('1.5', 'en')).toBeNull();
    expect(formatCreditBalance('01', 'en')).toBeNull();
  });
});
