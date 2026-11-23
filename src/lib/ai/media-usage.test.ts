import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeInvoiceImageWithOpenAi,
  analyzeInvoicePdfWithOpenAi,
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

  it('validates PDF fields without returning their values', async () => {
    mockFetchJson({
      model: 'gpt-6-luna',
      output_text: JSON.stringify({
        document_type: 'tax_certificate',
        readable: true,
        complete: false,
        present_fields: ['RFC', 'razón social', 'código postal fiscal'],
        missing_fields: ['régimen fiscal'],
        issues: [],
      }),
      usage: { input_tokens: 500, output_tokens: 40, total_tokens: 540 },
    });
    const onUsage = vi.fn();
    const result = await analyzeInvoicePdfWithOpenAi({
      ...baseArgs,
      bytes: Buffer.from('%PDF-1.7 test'),
      mimeType: 'application/pdf',
      fileName: 'constancia.pdf',
      model: 'gpt-6-luna',
      onUsage,
    });
    expect(result).toContain('tipo=constancia de situación fiscal')
    expect(result).toContain('faltantes=régimen fiscal')
    expect(result).not.toContain('XAXX')
    expect(onUsage).toHaveBeenCalledWith({
      model: 'gpt-6-luna',
      usage: { promptTokens: 500, completionTokens: 40, totalTokens: 540 },
    });
  });

  it('validates an invoice document sent as an image', async () => {
    mockFetchJson({
      model: 'gpt-6-luna',
      choices: [{ message: { content: JSON.stringify({
        document_type: 'receipt',
        readable: true,
        complete: false,
        present_fields: ['comercio', 'fecha', 'importe total'],
        missing_fields: ['folio'],
        issues: ['La parte inferior está cortada'],
        description: '',
      }) } }],
      usage: { prompt_tokens: 800, completion_tokens: 55, total_tokens: 855 },
    });
    const onUsage = vi.fn();
    const result = await analyzeInvoiceImageWithOpenAi({
      ...baseArgs,
      bytes: Buffer.from('image'),
      mimeType: 'image/jpeg',
      model: 'gpt-6-luna',
      onUsage,
    });
    expect(result).toContain('tipo=ticket o comprobante de consumo')
    expect(result).toContain('faltantes=folio')
    expect(result).not.toContain('XAXX')
    expect(onUsage).toHaveBeenCalledWith({
      model: 'gpt-6-luna',
      usage: { promptTokens: 800, completionTokens: 55, totalTokens: 855 },
    });
  });

  it('keeps a normal image description', async () => {
    mockFetchJson({
      model: 'gpt-6-luna',
      choices: [{ message: { content: JSON.stringify({
        document_type: 'other',
        readable: true,
        complete: false,
        present_fields: [],
        missing_fields: [],
        issues: [],
        description: 'Fotografía de una mesa de restaurante con dos platillos.',
      }) } }],
      usage: { prompt_tokens: 300, completion_tokens: 20, total_tokens: 320 },
    });
    const result = await analyzeInvoiceImageWithOpenAi({
      ...baseArgs,
      bytes: Buffer.from('image'),
      mimeType: 'image/jpeg',
      model: 'gpt-6-luna',
      onUsage: vi.fn(),
    });
    expect(result).toBe('Fotografía de una mesa de restaurante con dos platillos.')
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
