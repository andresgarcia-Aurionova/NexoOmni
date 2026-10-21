import type { SupabaseClient } from '@supabase/supabase-js';

export type CreditExpirationResult = {
  processed_batches: number;
  expired_credits: string;
};

export async function processAiCreditExpirations(
  db: SupabaseClient
): Promise<CreditExpirationResult> {
  const { data, error } = await db.rpc('expire_ai_credit_batches', {
    p_account_id: null,
    p_limit: 100,
  });
  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : null;
  if (
    !result ||
    !Number.isSafeInteger(Number(result.processed_batches)) ||
    Number(result.processed_batches) < 0 ||
    result.expired_credits === null ||
    result.expired_credits === undefined
  ) {
    throw new Error('The database did not confirm credit expiration processing.');
  }
  return {
    processed_batches: Number(result.processed_batches),
    expired_credits: String(result.expired_credits),
  };
}
