export const AI_CREDIT_USAGE_ACTIVITIES = [
  'auto_reply',
  'draft',
  'analysis',
  'report',
  'call_summary',
  'voice_transcription',
  'image_description',
  'embeddings',
  'credential_test',
  'assistant',
  'whatsapp_call',
  'other',
] as const;

export type AiCreditUsageActivity =
  (typeof AI_CREDIT_USAGE_ACTIVITIES)[number];

export function isAiCreditUsageActivity(
  value: unknown
): value is AiCreditUsageActivity {
  return AI_CREDIT_USAGE_ACTIVITIES.some((activity) => activity === value);
}
