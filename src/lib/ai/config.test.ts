import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const { mockSupabaseAdmin, mockEntitlements } = vi.hoisted(() => ({
  mockSupabaseAdmin: vi.fn(),
  mockEntitlements: vi.fn(),
}));

vi.mock('@/lib/account/entitlements', () => ({
  getAccountEntitlements: mockEntitlements,
}));

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}));
vi.mock('./admin-client', () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));

import { loadAiConfig, loadEmbeddingsKey } from './config';

beforeEach(() => {
  mockEntitlements.mockReset();
  mockEntitlements.mockResolvedValue({ features: { ai_credits: true } });
});

describe('plan gate', () => {
  it('returns no AI config or embeddings key for accounts without the AI plan', async () => {
    mockEntitlements.mockResolvedValue({ features: { ai_credits: false } });
    mockSupabaseAdmin.mockReturnValue(
      dbReturning(
        { ...ROW, is_active: true },
        {
          'openai:chat': { encrypted_api_key: 'k' },
          'openai:embeddings': { encrypted_api_key: 'e' },
        }
      )
    );
    expect(await loadAiConfig(dbReturning(null), 'acct')).toBeNull();
    expect(await loadEmbeddingsKey(dbReturning(null), 'acct')).toEqual({
      key: null,
      corrupt: false,
    });
  });
});

function dbReturning(
  row: Record<string, unknown> | null,
  credentials: Record<string, Record<string, unknown> | null> = {},
  credentialQueryError: { code: string; message: string } | null = null
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
                : (credentials[`${provider}:${credentialType}`] ?? null),
            error: table === 'ai_configs' ? null : credentialQueryError,
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
    mockSupabaseAdmin.mockReturnValue(
      dbReturning(ROW, {
        'openai:chat': { encrypted_api_key: 'managed-encrypted-key' },
      })
    );
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    });
    expect(config).not.toBeNull();
    expect(config!.provider).toBe('openai');
    expect(config!.apiKey).toBe('plain:managed-encrypted-key');
    expect(config!.analysisModel).toBeUndefined();
    expect(config!.imageAnalysisModel).toBeUndefined();
    expect(config!.voiceTranscriptionModel).toBeUndefined();
  });

  it('does not use the legacy ai_configs key when no managed key exists', async () => {
    mockSupabaseAdmin.mockReturnValue(dbReturning(ROW));
    expect(
      await loadAiConfig(dbReturning(ROW), 'acct', { requireActive: false })
    ).toBeNull();
  });

  it('does not fall back to legacy keys when the credential table is unavailable', async () => {
    mockSupabaseAdmin.mockReturnValue(
      dbReturning(
        ROW,
        {},
        {
          code: 'PGRST205',
          message: 'Could not find the table in the schema cache',
        }
      )
    );
    await expect(
      loadAiConfig(dbReturning(ROW), 'acct', { requireActive: false })
    ).rejects.toMatchObject({ code: 'PGRST205' });
  });

  it('reports an active config without a managed provider credential', async () => {
    mockSupabaseAdmin.mockReturnValue(dbReturning({ ...ROW, is_active: true }));
    await expect(loadAiConfig(dbReturning(ROW), 'acct')).rejects.toThrow(
      'The platform-managed openai credential is not configured for account acct.'
    );
  });

  it('returns null when there is no row', async () => {
    mockSupabaseAdmin.mockReturnValue(dbReturning(null));
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false })
    ).toBeNull();
  });
});

describe('loadEmbeddingsKey', () => {
  it('does not use a legacy embeddings key from ai_configs', async () => {
    mockSupabaseAdmin.mockReturnValue(
      dbReturning({ ...ROW, embeddings_api_key: 'legacy-embedding-key' })
    );
    await expect(loadEmbeddingsKey(dbReturning(null), 'acct')).resolves.toEqual(
      {
        key: null,
        corrupt: false,
      }
    );
  });

  it('loads the platform-managed embeddings key', async () => {
    mockSupabaseAdmin.mockReturnValue(
      dbReturning(null, {
        'openai:embeddings': { encrypted_api_key: 'managed-embedding-key' },
      })
    );
    await expect(loadEmbeddingsKey(dbReturning(null), 'acct')).resolves.toEqual(
      {
        key: 'plain:managed-embedding-key',
        corrupt: false,
      }
    );
  });
});
