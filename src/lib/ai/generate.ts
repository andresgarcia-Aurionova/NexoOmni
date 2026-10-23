import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
  type ProviderResult,
} from './types';
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults';
import {
  resolveAiTaskConfig,
  resolveAiTaskFallbackConfig,
  type AiTask,
} from './model-routing';
import { generateOpenAi } from './providers/openai';
import { generateAnthropic } from './providers/anthropic';
import { supabaseAdmin } from './admin-client';
import { AiBillingError, assertAiBillingReady } from './billing-config';

export interface GenerateArgs {
  config: AiConfig;
  task?: AiTask;
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string;
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[];
  /** Override the reply-sized default for long analytical outputs. */
  maxOutputTokens?: number;
  /** Override the default per-call timeout for slow analytical calls. */
  timeoutMs?: number;
}

export interface GenerateTextResult {
  text: string;
  usage: AiUsage | null;
  provider: AiConfig['provider'];
  model: string;
  latencyMs: number;
}

export interface GenerateReplyResult extends GenerateResult {
  provider: AiConfig['provider'];
  model: string;
  latencyMs: number;
}

const FAILOVER_CODES = new Set([
  'timeout',
  'network_error',
  'rate_limited',
  'provider_error',
  'invalid_key',
]);

async function callProvider(
  config: AiConfig,
  args: GenerateArgs
): Promise<ProviderResult> {
  await assertAiBillingReady(
    supabaseAdmin(),
    config.provider,
    config.model,
    config.accountId
  );
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt: args.systemPrompt,
    messages: args.messages,
    timeoutMs: args.timeoutMs ?? aiRequestTimeoutMs(),
    maxOutputTokens: args.maxOutputTokens,
  };
  switch (config.provider) {
    case 'openai':
      return generateOpenAi(providerArgs);
    case 'anthropic':
      return generateAnthropic(providerArgs);
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      });
  }
}

/** Generate arbitrary structured assistance with the configured provider. */
export async function generateText(
  args: GenerateArgs
): Promise<GenerateTextResult> {
  const task = args.task ?? 'reply';
  const primary = resolveAiTaskConfig(args.config, task);
  const startedAt = Date.now();
  let config = primary;
  let result: ProviderResult;
  try {
    result = await callProvider(primary, args);
  } catch (error) {
    // Only an outage-type failure (no response, so nothing was billed) moves
    // to the other provider; billing errors and bad requests never do.
    const fallback =
      error instanceof AiError && FAILOVER_CODES.has(error.code)
        ? resolveAiTaskFallbackConfig(args.config, task, primary)
        : null;
    if (!fallback) throw error;
    console.warn(
      `[ai] ${primary.provider}/${primary.model} failed (${(error as AiError).code}); retrying with ${fallback.provider}/${fallback.model}.`
    );
    config = fallback;
    result = await callProvider(fallback, args);
  }
  if (!result.usage) {
    throw new AiBillingError(
      `The ${config.provider}/${config.model} response did not include billable usage; its output was blocked.`
    );
  }
  return {
    ...result,
    provider: config.provider,
    model: config.model,
    latencyMs: Date.now() - startedAt,
  };
}

export async function generateForTask(
  args: GenerateArgs & { task: AiTask }
): Promise<GenerateTextResult> {
  return generateText(args);
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(
  args: GenerateArgs
): Promise<GenerateReplyResult> {
  const result = await generateText(args);
  return {
    ...parseGeneration(result.text, result.usage),
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
  };
}

/**
 * Split the raw model output into `{ text, handoff, handoffQueue, usage }`.
 * The sentinel can appear alone or trailing a partial reply; either way we
 * treat the turn as a handoff and strip the marker from any remaining
 * text. In `ai_queue` mode the model may name the department inside the
 * marker (`[[HANDOFF:Ventas]]`). `usage` is passed straight through (null
 * when the provider didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null
): GenerateResult {
  const withQueue = raw.match(/\[\[HANDOFF:([^\]]{1,80})\]\]/i);
  const handoff = raw.includes(HANDOFF_SENTINEL) || withQueue !== null;
  const text = raw
    .replace(/\[\[HANDOFF:[^\]]{1,80}\]\]/gi, '')
    .split(HANDOFF_SENTINEL)
    .join('')
    .trim();
  return { text, handoff, handoffQueue: withQueue?.[1]?.trim() || null, usage };
}
