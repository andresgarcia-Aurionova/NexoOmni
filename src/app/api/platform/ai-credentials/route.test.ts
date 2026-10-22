import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  encrypt: vi.fn(),
  insertConfig: vi.fn(),
  mockAccountMaybeSingle: vi.fn(),
  mockConfigMaybeSingle: vi.fn(),
  rateLimitResponse: vi.fn(),
  requirePlatformOperator: vi.fn(),
  supabaseAdmin: vi.fn(),
  toErrorResponse: vi.fn(),
  updateConfig: vi.fn(),
  upsertCredential: vi.fn(),
  validateAiCredentials: vi.fn(),
  validateEmbeddingCredentials: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: mocks.toErrorResponse,
}));
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));
vi.mock('@/lib/ai/validate', () => ({
  validateAiCredentials: mocks.validateAiCredentials,
  validateEmbeddingCredentials: mocks.validateEmbeddingCredentials,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => value.replace(/^encrypted:/, ''),
  encrypt: mocks.encrypt,
}));
vi.mock('@/lib/platform/operator', () => ({
  requirePlatformOperator: mocks.requirePlatformOperator,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  RATE_LIMITS: { adminAction: {} },
  rateLimitResponse: mocks.rateLimitResponse,
}));

import { POST } from './route';

const ACCOUNT_ID = '1fdd7627-06f5-4f1d-b319-9f54ad4ee001';

function request(body: Record<string, unknown>) {
  return new Request('https://nexoomni.example/api/platform/ai-credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePlatformOperator.mockResolvedValue({
    user: { id: 'operator-1' },
  });
  mocks.checkRateLimit.mockReturnValue({ success: true });
  mocks.toErrorResponse.mockImplementation(() =>
    Response.json({ error: 'Internal server error' }, { status: 500 })
  );
  mocks.mockAccountMaybeSingle.mockResolvedValue({
    data: { id: ACCOUNT_ID },
    error: null,
  });
  mocks.mockConfigMaybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.upsertCredential.mockResolvedValue({ error: null });
  mocks.insertConfig.mockResolvedValue({ error: null });
  mocks.updateConfig.mockResolvedValue({ error: null });
  mocks.encrypt.mockImplementation((value: string) => `encrypted:${value}`);
  mocks.validateAiCredentials.mockResolvedValue(undefined);
  mocks.validateEmbeddingCredentials.mockResolvedValue(undefined);
  mocks.supabaseAdmin.mockReturnValue({
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          table === 'accounts'
            ? mocks.mockAccountMaybeSingle()
            : mocks.mockConfigMaybeSingle(),
        upsert: mocks.upsertCredential,
        update: () => ({ eq: mocks.updateConfig }),
        insert: mocks.insertConfig,
      };
      return chain;
    },
  });
});

describe('/api/platform/ai-credentials', () => {
  it('verifies and stores OpenAI embeddings credentials separately', async () => {
    const response = await POST(
      request({
        account_id: ACCOUNT_ID,
        provider: 'openai',
        credential_type: 'embeddings',
        api_key: 'test-embeddings-key',
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.validateEmbeddingCredentials).toHaveBeenCalledWith(
      'test-embeddings-key',
      ACCOUNT_ID
    );
    expect(mocks.validateAiCredentials).not.toHaveBeenCalled();
    expect(mocks.upsertCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: ACCOUNT_ID,
        provider: 'openai',
        credential_type: 'embeddings',
        encrypted_api_key: 'encrypted:test-embeddings-key',
        updated_by: 'operator-1',
      }),
      { onConflict: 'account_id,provider,credential_type' }
    );
    expect(await response.json()).toMatchObject({
      success: true,
      provider: 'openai',
      credential_type: 'embeddings',
      active: false,
    });
  });

  it('rejects embeddings credentials for Anthropic', async () => {
    const response = await POST(
      request({
        account_id: ACCOUNT_ID,
        provider: 'anthropic',
        credential_type: 'embeddings',
        api_key: 'test-embeddings-key',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'AI_EMBEDDINGS_OPENAI_ONLY',
    });
    expect(mocks.validateEmbeddingCredentials).not.toHaveBeenCalled();
    expect(mocks.upsertCredential).not.toHaveBeenCalled();
  });

  it('keeps accepting chat-key requests without a credential_type', async () => {
    const response = await POST(
      request({
        account_id: ACCOUNT_ID,
        provider: 'openai',
        api_key: 'test-chat-key',
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.validateAiCredentials).toHaveBeenCalledOnce();
    expect(mocks.validateEmbeddingCredentials).not.toHaveBeenCalled();
    expect(mocks.upsertCredential).toHaveBeenCalledWith(
      expect.objectContaining({ credential_type: 'chat' }),
      { onConflict: 'account_id,provider,credential_type' }
    );
    expect(mocks.insertConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: ACCOUNT_ID,
        provider: 'openai',
        api_key: 'encrypted:test-chat-key',
      })
    );
  });

  it('rotates an active chat key without changing its legacy copy', async () => {
    mocks.mockConfigMaybeSingle.mockResolvedValue({
      data: { provider: 'openai' },
      error: null,
    });
    const response = await POST(
      request({
        account_id: ACCOUNT_ID,
        provider: 'openai',
        api_key: 'rotated-chat-key',
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.upsertCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        credential_type: 'chat',
        encrypted_api_key: 'encrypted:rotated-chat-key',
      }),
      { onConflict: 'account_id,provider,credential_type' }
    );
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ active: true });
  });
});
