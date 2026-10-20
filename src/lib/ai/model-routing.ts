import type { AiConfig, AiProvider } from './types';

export type AiTask =
  | 'reply'
  | 'analysis'
  | 'call_summary'
  | 'report'
  | 'image_description'
  | 'voice_transcription';

type TaskModelCandidates = Partial<Record<AiTask, string>>;

export const AI_TASK_MODEL_CANDIDATES: Record<AiProvider, TaskModelCandidates> =
  {
    openai: {
      reply: 'gpt-6-luna',
      analysis: 'gpt-6-luna',
      call_summary: 'gpt-6-luna',
      report: 'gpt-5.6-terra',
      image_description: 'gpt-6-luna',
      voice_transcription: 'gpt-4o-mini-transcribe',
    },
    anthropic: {
      reply: 'claude-haiku-5-5',
      analysis: 'claude-haiku-5-5',
      call_summary: 'claude-haiku-5-5',
      report: 'claude-sonnet-5-5',
    },
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
    case 'report':
      return undefined;
  }
}

export function isAiTaskRoutingEnabled(): boolean {
  return process.env.AI_TASK_ROUTING_ENABLED === 'true';
}

export function resolveAiTaskConfig(
  config: AiConfig,
  task: AiTask,
  routingEnabled = isAiTaskRoutingEnabled()
): AiConfig {
  const override = configuredModel(config, task)?.trim();
  if (override) return { ...config, model: override };

  if (routingEnabled) {
    const candidate = AI_TASK_MODEL_CANDIDATES[config.provider][task];
    if (candidate) return { ...config, model: candidate };
  }

  if (task === 'image_description') {
    return { ...config, model: 'gpt-4.1-mini' };
  }
  if (task === 'voice_transcription') {
    return { ...config, model: 'gpt-4o-mini-transcribe' };
  }
  return { ...config, model: config.model };
}
