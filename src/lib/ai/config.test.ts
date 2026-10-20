import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const { mockSupabaseAdmin } = vi.hoisted(() => ({
  mockSupabaseAdmin: vi.fn(),
}));

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}));
vi.mock('./admin-client', () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));

import { loadAiConfig } from './config';

function dbReturning(
  row: Record<string, unknown> | null,
  credentials: Record<string, Record<string, unknown> | null> = {}
): SupabaseClient {
  return {
    from(table: string) {
      let provider = '';
      let credentialType = '';
      const chain = {
        select: () => chain,
        eq: (column: string, value: string) => {
          if (column === 'provider') provider = value;
          if (column === 'credential_type') credentialType = value;
          return chain;
        },
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === 'ai_configs'
                ? row
                : credentials[`${provider}:${credentialType}`] ?? null,
            error: null,
          }),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  embeddings_api_key: null,
};

describe('loadAiConfig requireActive', () => {
  it('uses the server-side provider credential when it exists', async () => {
    mockSupabaseAdmin.mockReturnValue(
      dbReturning(ROW, {
        'openai:chat': { encrypted_api_key: 'new-encrypted-key' },
      })
    );
    const config = await loadAiConfig(dbReturning(null), 'acct', {
      requireActive: false,
    });
    expect(config?.apiKey).toBe('plain:new-encrypted-key');
  });

  it('returns null for an inactive config by default', async () => {
    mockSupabaseAdmin.mockReturnValue(dbReturning(ROW));
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull();
  });

  it('returns the config when requireActive is false (Playground path)', async () => {
    mockSupabaseAdmin.mockReturnValue(dbReturning(ROW));
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    });
    expect(config).not.toBeNull();
    expect(config!.provider).toBe('openai');
    expect(config!.apiKey).toBe('plain:enc-key');
    expect(config!.analysisModel).toBeUndefined();
    expect(config!.imageAnalysisModel).toBeUndefined();
    expect(config!.voiceTranscriptionModel).toBeUndefined();
  });

  it('returns null when there is no row', async () => {
    mockSupabaseAdmin.mockReturnValue(dbReturning(null));
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false })
    ).toBeNull();
  });
});
