import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeInvoiceWithAnthropic, audioExtensionForMimeType } from './media-analysis'

vi.mock('./admin-client', () => ({ supabaseAdmin: vi.fn(() => ({})) }))
vi.mock('./billing-config', () => ({
  assertAiBillingReady: vi.fn().mockResolvedValue(undefined),
  AiBillingError: class extends Error {},
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('audioExtensionForMimeType', () => {
  it.each([
    ['video/mp4', 'mp4'],
    ['audio/mp4; codecs=mp4a.40.2', 'mp4'],
    ['audio/m4a', 'm4a'],
    ['audio/mpeg', 'mp3'],
    ['audio/ogg', 'ogg'],
    ['audio/wav', 'wav'],
    ['audio/webm', 'webm'],
    ['application/octet-stream', 'webm'],
  ])('maps %s to .%s', (mimeType, extension) => {
    expect(audioExtensionForMimeType(mimeType)).toBe(extension)
  })
})

describe('analyzeInvoiceWithAnthropic', () => {
  it('validates an invoice image with Claude and returns billable usage', async () => {
    const onUsage = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'claude-sonnet-5-5',
        content: [{
          type: 'text',
          text: '{"document_type":"receipt","readable":true,"complete":true,"present_fields":["comercio","fecha","importe total","folio"],"missing_fields":[],"issues":[]}',
        }],
        usage: { input_tokens: 30, output_tokens: 20 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(analyzeInvoiceWithAnthropic({
      accountId: 'account-1',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-5-5',
      kind: 'image',
      bytes: Buffer.from('image'),
      mimeType: 'image/jpeg',
      timeoutMs: 5_000,
      onUsage,
    })).resolves.toContain('tipo=ticket o comprobante de consumo')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg' },
    })
    expect(onUsage).toHaveBeenCalledWith({
      model: 'claude-sonnet-5-5',
      usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
    })
  })
})
