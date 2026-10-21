import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeImageWithOpenAi,
  transcribeAudioWithOpenAi,
} from './media-analysis';
import { embedTexts } from './embeddings';

vi.mock('./admin-client', () => ({ supabaseAdmin: vi.fn(() => ({})) }))
vi.mock('./billing-config', () => ({
  assertAiBillingReady: vi.fn().mockResolvedValue(undefined),
  AiBillingError: class extends Error {},
}))

function mockFetchJson(body: unknown) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const baseArgs = {
  accountId: 'acct-1',
  apiKey: 'sk-test',
  bytes: Buffer.from('x'),
  mimeType: 'audio/ogg',
  timeoutMs: 1000,
};

afterEach(() => vi.unstubAllGlobals());

describe('media usage reporting', () => {
  it('reports token usage for a token-billed transcription', async () => {
    mockFetchJson({
      text: 'hola',
      usage: {
        type: 'tokens',
        input_tokens: 14,
        output_tokens: 45,
        total_tokens: 59,
      },
    });
    const onUsage = vi.fn();
    await transcribeAudioWithOpenAi({
      ...baseArgs,
      model: 'gpt-4o-mini-transcribe',
      onUsage,
    });
    expect(onUsage).toHaveBeenCalledWith({
      model: 'gpt-4o-mini-transcribe',
      usage: { promptTokens: 14, completionTokens: 45, totalTokens: 59 },
    });
  });

  it('rejects duration-billed transcription without billable token usage', async () => {
    mockFetchJson({ text: 'hola', usage: { type: 'duration', seconds: 12 } });
    const onUsage = vi.fn();
    await expect(transcribeAudioWithOpenAi({
      ...baseArgs,
      model: 'whisper-1',
      onUsage,
    })).rejects.toThrow('did not report token usage');
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('reports usage for image descriptions', async () => {
    mockFetchJson({
      model: 'gpt-4.1-mini-2025-04-14',
      choices: [{ message: { content: 'Una foto.' } }],
      usage: { prompt_tokens: 300, completion_tokens: 12, total_tokens: 312 },
    });
    const onUsage = vi.fn();
    await describeImageWithOpenAi({
      ...baseArgs,
      mimeType: 'image/jpeg',
      model: 'gpt-4.1-mini',
      onUsage,
    });
    expect(onUsage).toHaveBeenCalledWith({
      model: 'gpt-4.1-mini-2025-04-14',
      usage: { promptTokens: 300, completionTokens: 12, totalTokens: 312 },
    });
  });

  it('reports embedding usage per batch', async () => {
    mockFetchJson({
      data: [{ index: 0, embedding: [0.1] }],
      usage: { prompt_tokens: 7, total_tokens: 7 },
    });
    const onUsage = vi.fn();
    await embedTexts('sk-test', ['hola'], onUsage, 'acct-1');
    expect(onUsage).toHaveBeenCalledWith({
      promptTokens: 7,
      completionTokens: 0,
      totalTokens: 7,
    });
  });
});
