import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import type { AiConfig } from './types';

interface AiConfigRow {
  provider: 'openai' | 'anthropic';
  model: string;
  analysis_model?: string | null;
  image_analysis_model?: string | null;
  voice_transcription_model?: string | null;
  system_prompt: string | null;
  is_active: boolean;
  auto_reply_enabled: boolean;
  auto_reply_max_per_conversation: number;
  handoff_agent_id: string | null;
  handoff_target?: 'unassigned' | 'agent' | 'queue' | 'ai_queue' | null;
  handoff_queue_id?: string | null;
  channel_types?: string[] | null;
  timezone?: string | null;
}

const CONFIG_COLUMNS =
  'provider, model, analysis_model, image_analysis_model, voice_transcription_model, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, handoff_target, handoff_queue_id, channel_types, timezone';

// Keep AI operational while a rolling deployment is waiting for migration 101.
// The dedicated model columns are additive, so the existing general model is a
// safe fallback until the database schema catches up.
const LEGACY_CONFIG_COLUMNS =
  'provider, model, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id';

function isMissingModelColumn(error: { code?: string; message?: string }) {
  return (
    error.code === '42703' ||
    /(?:analysis_model|image_analysis_model|voice_transcription_model|handoff_target|handoff_queue_id|channel_types|timezone)/i.test(
      error.message ?? ''
    )
  );
}

async function loadEncryptedCredential(
  db: SupabaseClient,
  accountId: string,
  provider: 'openai' | 'anthropic',
  credentialType: 'chat' | 'embeddings'
): Promise<string | null> {
  const { data, error } = await db
    .from('ai_provider_credentials')
    .select('encrypted_api_key')
    .eq('account_id', accountId)
    .eq('provider', provider)
    .eq('credential_type', credentialType)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data?.encrypted_api_key ?? null;
}

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off. Provider credentials are read only from the
 * platform-managed credential table; legacy values in `ai_configs` are
 * retained but never used. Throws if an active config has no credential or
 * its stored credential can't be decrypted.
 *
 * The passed client is retained for caller compatibility. Secrets and
 * configuration are always loaded with the server-only service-role client.
 */
export async function loadAiConfig(
  _db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {}
): Promise<AiConfig | null> {
  const { requireActive = true } = opts;
  const db = supabaseAdmin();
  const primary = await db
    .from('ai_configs')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle();
  let data = primary.data as AiConfigRow | null;
  let error = primary.error;

  if (error && isMissingModelColumn(error)) {
    console.warn(
      '[ai config] Migration 101 is pending; using the general AI model until it is applied.'
    );
    const fallback = await db
      .from('ai_configs')
      .select(LEGACY_CONFIG_COLUMNS)
      .eq('account_id', accountId)
      .maybeSingle();
    data = fallback.data as AiConfigRow | null;
    error = fallback.error;
  }

  if (error) throw error;
  if (!data) return null;

  const row = data as AiConfigRow;
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null;
  const encryptedApiKey = await loadEncryptedCredential(
    db,
    accountId,
    row.provider,
    'chat'
  );
  if (!encryptedApiKey) {
    if (requireActive && row.is_active) {
      throw new Error(
        `The platform-managed ${row.provider} credential is not configured for account ${accountId}.`
      );
    }
    return null;
  }

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null;
  const encryptedEmbeddingsKey = await loadEncryptedCredential(
    db,
    accountId,
    'openai',
    'embeddings'
  );
  if (encryptedEmbeddingsKey) {
    try {
      embeddingsApiKey = decrypt(encryptedEmbeddingsKey);
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`
      );
      embeddingsApiKey = null;
    }
  }

  return {
    accountId,
    provider: row.provider,
    model: row.model,
    // Existing rows keep working after the additive migration even before an
    // administrator saves the new routing fields.
    analysisModel: row.analysis_model?.trim() || undefined,
    imageAnalysisModel: row.image_analysis_model?.trim() || undefined,
    voiceTranscriptionModel: row.voice_transcription_model?.trim() || undefined,
    apiKey: decrypt(encryptedApiKey),
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    handoffTarget: row.handoff_target ?? 'agent',
    handoffQueueId: row.handoff_queue_id ?? null,
    channelTypes:
      Array.isArray(row.channel_types) && row.channel_types.length > 0
        ? row.channel_types
        : null,
    embeddingsApiKey,
    timezone: row.timezone?.trim() || 'America/Mexico_City',
  };
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  _db: SupabaseClient,
  accountId: string
): Promise<{ key: string | null; corrupt: boolean }> {
  const db = supabaseAdmin();
  const encryptedKey = await loadEncryptedCredential(
    db,
    accountId,
    'openai',
    'embeddings'
  );
  if (encryptedKey) {
    try {
      return { key: decrypt(encryptedKey), corrupt: false };
    } catch {
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`
      );
      return { key: null, corrupt: true };
    }
  }

  return { key: null, corrupt: false };
}
