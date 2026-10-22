import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEmbedTexts, mockLogAiUsage, mockSupabaseAdmin } = vi.hoisted(
  () => ({
    mockEmbedTexts: vi.fn(),
    mockLogAiUsage: vi.fn(),
    mockSupabaseAdmin: vi.fn(),
  })
);

vi.mock('./embeddings', () => ({
  EMBEDDING_MODEL: 'text-embedding-3-small',
  embedTexts: mockEmbedTexts,
}));
vi.mock('./admin-client', () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));
vi.mock('./usage', () => ({
  logAiUsage: mockLogAiUsage,
}));

import { validateEmbeddingCredentials } from './validate';

describe('validateEmbeddingCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a small embeddings request and records its billable usage', async () => {
    const db = { serviceRole: true };
    const usage = {
      promptTokens: 1,
      completionTokens: 0,
      totalTokens: 1,
    };
    mockSupabaseAdmin.mockReturnValue(db);
    mockEmbedTexts.mockImplementation(async (_apiKey, _inputs, onUsage) => {
      await onUsage(usage);
      return [[0.1]];
    });

    await validateEmbeddingCredentials('test-api-key', 'account-id');

    expect(mockEmbedTexts).toHaveBeenCalledWith(
      'test-api-key',
      ['NexoOmni credential check'],
      expect.any(Function),
      'account-id'
    );
    expect(mockLogAiUsage).toHaveBeenCalledWith(db, {
      accountId: 'account-id',
      conversationId: null,
      mode: 'credential_test',
      provider: 'openai',
      model: 'text-embedding-3-small',
      usage,
    });
  });

  it('surfaces provider or billing errors', async () => {
    const error = new Error('The embeddings request failed');
    mockSupabaseAdmin.mockReturnValue({});
    mockEmbedTexts.mockRejectedValue(error);

    await expect(
      validateEmbeddingCredentials('test-api-key', 'account-id')
    ).rejects.toBe(error);
  });
});
