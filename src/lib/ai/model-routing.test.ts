import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAiTaskConfig, isAiTaskRoutingEnabled } from './model-routing';
import type { AiConfig } from './types';

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    accountId: 'acct-1',
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
  });

  it('routes each task to its best provider when both keys exist', () => {
    const both = config({ providerKeys: { openai: 'o-key', anthropic: 'a-key' } });
    const report = resolveAiTaskConfig(both, 'report', true);
    expect(report).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      apiKey: 'a-key',
    });
    const reply = resolveAiTaskConfig(
      config({ provider: 'anthropic', apiKey: 'a-key', providerKeys: { openai: 'o-key', anthropic: 'a-key' } }),
      'reply',
      true
    );
    expect(reply).toMatchObject({ provider: 'openai', model: 'gpt-6-luna', apiKey: 'o-key' });
  });

  it('falls back to the provider that has a key', () => {
    const anthropicOnly = config({
      provider: 'anthropic',
      apiKey: 'a-key',
      providerKeys: { anthropic: 'a-key' },
    });
    expect(resolveAiTaskConfig(anthropicOnly, 'reply', true)).toMatchObject({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
    });
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

  it('enables candidate routing by default and allows disabling it', () => {
    expect(isAiTaskRoutingEnabled()).toBe(true);
    vi.stubEnv('AI_TASK_ROUTING_ENABLED', 'false');
    expect(isAiTaskRoutingEnabled()).toBe(false);
  });
});
