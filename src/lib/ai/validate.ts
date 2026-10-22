import { generateReply } from './generate'
import { EMBEDDING_MODEL, embedTexts } from './embeddings'
import { supabaseAdmin } from './admin-client'
import { logAiUsage } from './usage'
import type { AiConfig } from './types'

/**
 * Cheap liveness + auth check: one tiny generation against the
 * configured provider/model with the caller's key. Throws `AiError`
 * (invalid_key / rate_limited / network / timeout) on failure, resolves
 * on success. Used by the settings "Test key" button and before
 * persisting a config — the same "verify before save" discipline the
 * WhatsApp config uses with Meta.
 */
export async function validateAiCredentials(config: AiConfig, accountId: string): Promise<void> {
  const result = await generateReply({
    config,
    systemPrompt: 'You are a connectivity check. Reply with the single word: OK.',
    messages: [{ role: 'user', content: 'ping' }],
  })
  await logAiUsage(supabaseAdmin(), {
    accountId,
    conversationId: null,
    mode: 'credential_test',
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    usage: result.usage,
  })
}

export async function validateEmbeddingCredentials(apiKey: string, accountId: string): Promise<void> {
  const db = supabaseAdmin()
  await embedTexts(
    apiKey,
    ['NexoOmni credential check'],
    async (usage) => {
      await logAiUsage(db, {
        accountId,
        conversationId: null,
        mode: 'credential_test',
        provider: 'openai',
        model: EMBEDDING_MODEL,
        usage,
      })
    },
    accountId
  )
}
