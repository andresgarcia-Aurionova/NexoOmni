import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAiTaskConfig, isAiTaskRoutingEnabled } from './model-routing';
import type { AiConfig } from './types';

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'existing-model',
    apiKey: 'test-key',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    timezone: 'America/Mexico_City',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveAiTaskConfig', () => {
  it('preserves current configured models when routing is disabled', () => {
    expect(resolveAiTaskConfig(config(), 'reply', false).model).toBe(
      'existing-model'
    );
    expect(resolveAiTaskConfig(config(), 'analysis', false).model).toBe(
      'existing-model'
    );
  });

  it('selects task candidates for the configured provider when enabled', () => {
    expect(resolveAiTaskConfig(config(), 'reply', true).model).toBe(
      'gpt-6-luna'
    );
    expect(
      resolveAiTaskConfig(config({ provider: 'anthropic' }), 'report', true)
        .model
    ).toBe('claude-sonnet-5-5');
  });

  it('keeps explicit task-specific model overrides ahead of candidates', () => {
    expect(
      resolveAiTaskConfig(
        config({ analysisModel: 'custom-analysis' }),
        'analysis',
        true
      ).model
    ).toBe('custom-analysis');
  });

  it('retains dedicated media model defaults', () => {
    expect(
      resolveAiTaskConfig(config(), 'image_description', false).model
    ).toBe('gpt-4.1-mini');
    expect(
      resolveAiTaskConfig(config(), 'voice_transcription', false).model
    ).toBe('gpt-4o-mini-transcribe');
  });

  it('enables candidate routing only with an explicit environment flag', () => {
    vi.stubEnv('AI_TASK_ROUTING_ENABLED', 'false');
    expect(isAiTaskRoutingEnabled()).toBe(false);
    vi.stubEnv('AI_TASK_ROUTING_ENABLED', 'true');
    expect(isAiTaskRoutingEnabled()).toBe(true);
  });
});
