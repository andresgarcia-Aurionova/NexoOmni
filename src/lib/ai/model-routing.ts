import type { AiConfig, AiProvider } from './types';

export type AiTask =
  | 'reply'
  | 'agent'
  | 'analysis'
  | 'call_summary'
  | 'report'
  | 'assistant_router'
  | 'assistant_data'
  | 'image_description'
  | 'voice_transcription';

export type TaskCandidate = { provider: AiProvider; model: string };

/**
 * Ordered policy per task: the first candidate whose provider credential the
 * tenant has wins. Every tenant is expected to have both providers; the order
 * only matters as a fallback when one key is missing.
 */
export const AI_TASK_POLICY: Record<AiTask, TaskCandidate[]> = {
  // Customer-facing text and call summaries (which feed Nexo Memory) use the
  // premium tier: wrong output here is visible to end customers or persisted
  // as business facts. High-volume internal classification stays on the
  // economy tier.
  reply: [
    { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    { provider: 'openai', model: 'gpt-5.6-terra' },
  ],
  agent: [
    { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    { provider: 'openai', model: 'gpt-5.6-terra' },
  ],
  analysis: [
    { provider: 'anthropic', model: 'claude-haiku-5-5' },
    { provider: 'openai', model: 'gpt-6-luna' },
  ],
  call_summary: [
    { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    { provider: 'openai', model: 'gpt-5.6-terra' },
  ],
  report: [
    { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    { provider: 'openai', model: 'gpt-5.6-terra' },
  ],
  assistant_router: [
    { provider: 'openai', model: 'gpt-6-luna' },
    { provider: 'anthropic', model: 'claude-haiku-5-5' },
  ],
  assistant_data: [
    { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    { provider: 'openai', model: 'gpt-5.6-terra' },
  ],
  image_description: [{ provider: 'openai', model: 'gpt-6-luna' }],
  voice_transcription: [
    { provider: 'openai', model: 'gpt-4o-mini-transcribe' },
  ],
};

function configuredModel(config: AiConfig, task: AiTask): string | undefined {
  switch (task) {
    case 'analysis':
    case 'call_summary':
      return config.analysisModel;
    case 'image_description':
      return config.imageAnalysisModel;
    case 'voice_transcription':
      return config.voiceTranscriptionModel;
    case 'reply':
    case 'agent':
    case 'report':
    case 'assistant_router':
    case 'assistant_data':
      return undefined;
  }
}

/** Task routing is on by default; set AI_TASK_ROUTING_ENABLED=false to pin every task to the tenant model. */
export function isAiTaskRoutingEnabled(): boolean {
  return process.env.AI_TASK_ROUTING_ENABLED !== 'false';
}

export function resolveProviderKey(
  config: AiConfig,
  provider: AiProvider
): string | null {
  const key = config.providerKeys?.[provider];
  if (key) return key;
  return provider === config.provider && config.apiKey ? config.apiKey : null;
}

/**
 * Config for the other provider, used only when the primary provider call
 * failed before returning billable usage. Null when routing is off, the task
 * has an explicit model override, or the tenant has no key for another provider.
 */
export function resolveAiTaskFallbackConfig(
  config: AiConfig,
  task: AiTask,
  primary: AiConfig,
  routingEnabled = isAiTaskRoutingEnabled()
): AiConfig | null {
  if (!routingEnabled || configuredModel(config, task)?.trim()) return null;
  for (const candidate of AI_TASK_POLICY[task]) {
    if (candidate.provider === primary.provider) continue;
    const apiKey = resolveProviderKey(config, candidate.provider);
    if (apiKey) {
      return {
        ...config,
        provider: candidate.provider,
        apiKey,
        model: candidate.model,
      };
    }
  }
  return null;
}

export function resolveAiTaskConfig(
  config: AiConfig,
  task: AiTask,
  routingEnabled = isAiTaskRoutingEnabled()
): AiConfig {
  const override = configuredModel(config, task)?.trim();
  if (override) return { ...config, model: override };

  if (routingEnabled) {
    for (const candidate of AI_TASK_POLICY[task]) {
      const apiKey = resolveProviderKey(config, candidate.provider);
      if (apiKey) {
        return {
          ...config,
          provider: candidate.provider,
          apiKey,
          model: candidate.model,
        };
      }
    }
  }

  if (task === 'image_description') {
    return { ...config, model: 'gpt-4.1-mini' };
  }
  if (task === 'voice_transcription') {
    return { ...config, model: 'gpt-4o-mini-transcribe' };
  }
  return { ...config, model: config.model };
}
