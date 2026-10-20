import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './admin-client';
import { resolveUsageBilling } from './billing-config';
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
    | 'embeddings';
  provider: AiProvider;
  model: string;
  latencyMs?: number;
  billing?: {
    mode: 'shadow' | 'enforced';
    costNanoUsd: bigint;
    priceNanoUsd: bigint;
    creditsCharged: bigint;
  };
  /** Provider usage; a no-op when null (nothing worth recording). */
  usage: AiUsage | null;
}

function isMissingLatencyColumn(error: {
  code?: string;
  message?: string;
}): boolean {
  return (
    (error.code === '42703' || error.code === 'PGRST204') &&
    /latency_ms/i.test(error.message ?? '')
  );
}

function isMissingBillingColumn(error: {
  code?: string;
  message?: string;
}): boolean {
  return (
    (error.code === '42703' || error.code === 'PGRST204') &&
    /(cost_nano_usd|price_nano_usd|credits_charged|billing_mode)/i.test(
      error.message ?? ''
    )
  );
}

/**
 * Best-effort append to `ai_usage_log` — one row per LLM call, for cost
 * visibility for the account's managed provider credential. NEVER throws: usage accounting
 * must not fail a reply the customer is waiting on, so any DB error is
 * logged and swallowed. Skips entirely when the provider didn't report
 * usage (we'd only be writing zeros).
 *
 * The log is server-only because it stores provider/model identifiers.
 * The service-role client is used regardless of the caller's client.
 */
export async function logAiUsage(
  db: SupabaseClient,
  args: LogAiUsageArgs
): Promise<void> {
  if (!args.usage) return;
  try {
    const logDb = supabaseAdmin();
    const billing =
      args.billing ??
      (await resolveUsageBilling(db, {
        provider: args.provider,
        model: args.model,
        usage: args.usage,
      }));
    const row = {
      account_id: args.accountId,
      conversation_id: args.conversationId,
      mode: args.mode,
      provider: args.provider,
      model: args.model,
      prompt_tokens: args.usage.promptTokens,
      completion_tokens: args.usage.completionTokens,
      total_tokens: args.usage.totalTokens,
    };
    const billingRow = billing
      ? {
          cost_nano_usd: billing.costNanoUsd.toString(),
          price_nano_usd: billing.priceNanoUsd.toString(),
          credits_charged: billing.creditsCharged.toString(),
          billing_mode: billing.mode,
        }
      : {};
    let { error } = await logDb.from('ai_usage_log').insert({
      ...row,
      latency_ms: args.latencyMs ?? null,
      ...billingRow,
    });

    if (error && isMissingBillingColumn(error)) {
      console.warn(
        '[ai usage] billing columns are not available yet; apply migration 151 to start recording charge estimates.'
      );
      const retry = await logDb
        .from('ai_usage_log')
        .insert({ ...row, latency_ms: args.latencyMs ?? null });
      error = retry.error;
    }

    if (error && isMissingLatencyColumn(error)) {
      console.warn(
        '[ai usage] latency_ms column is not available yet; apply migration 150 to start recording latency.'
      );
      const retry = await logDb.from('ai_usage_log').insert(row);
      error = retry.error;
    }

    if (error) {
      console.error('[ai usage] log insert failed:', error);
    }
  } catch (err) {
    console.error('[ai usage] log insert threw:', err);
  }
}
