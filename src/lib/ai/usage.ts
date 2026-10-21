import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from './admin-client';
import {
  AiBillingError,
  AiCreditsExhaustedError,
  resolveUsageBilling,
} from './billing-config';
import type { AiProvider, AiUsage } from './types';

export interface LogAiUsageArgs {
  accountId: string;
  /** Null for a draft not tied to one thread, or when the row was
   *  deleted between generation and logging. */
  conversationId: string | null;
  mode:
    | 'auto_reply'
    | 'draft'
    | 'analysis'
    | 'report'
    | 'call_summary'
    | 'voice_transcription'
    | 'image_description'
    | 'embeddings'
    | 'credential_test';
  provider: AiProvider;
  model: string;
  latencyMs?: number;
  billingIdempotencyKey?: string;
  /** Provider usage is required in enforced mode. */
  usage: AiUsage | null;
}

/**
 * Records provider usage and debits credits in one database transaction.
 * Provider/model prices and billing settings are read only with the
 * service-role client; failures are intentionally surfaced to the caller.
 */
export async function logAiUsage(
  _db: SupabaseClient,
  args: LogAiUsageArgs
): Promise<void> {
  if (!args.usage) {
    throw new AiBillingError(
      `The ${args.provider}/${args.model} response did not include billable usage.`
    );
  }

  const logDb = supabaseAdmin();
  const billing = await resolveUsageBilling(logDb, {
    provider: args.provider,
    model: args.model,
    usage: args.usage,
  });
  const idempotencyKey = args.billingIdempotencyKey ?? randomUUID();
  const { data, error } = await logDb.rpc('record_ai_usage_and_debit', {
    p_account_id: args.accountId,
    p_conversation_id: args.conversationId,
    p_mode: args.mode,
    p_provider: args.provider,
    p_model: args.model,
    p_prompt_tokens: args.usage.promptTokens,
    p_completion_tokens: args.usage.completionTokens,
    p_total_tokens: args.usage.totalTokens,
    p_latency_ms: args.latencyMs ?? null,
    p_cost_nano_usd: billing.costNanoUsd.toString(),
    p_price_nano_usd: billing.priceNanoUsd.toString(),
    p_credits: billing.creditsCharged.toString(),
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    console.error('[ai billing] atomic usage debit failed:', error);
    throw new AiBillingError(
      'AI usage could not be charged; the generated output was blocked.'
    );
  }

  const result = Array.isArray(data) ? data[0] : null;
  if (result?.result === 'insufficient_credits') {
    throw new AiCreditsExhaustedError();
  }
  if (
    !result ||
    !['debited', 'duplicate', 'recorded'].includes(result.result)
  ) {
    throw new AiBillingError(
      'The database did not confirm the AI usage debit; the generated output was blocked.'
    );
  }
}
