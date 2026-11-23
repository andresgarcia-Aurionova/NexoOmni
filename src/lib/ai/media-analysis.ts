import { AiError, type AiUsage } from './types'
import { AiBillingError, assertAiBillingReady } from './billing-config'
import { supabaseAdmin } from './admin-client'

export type MediaUsageReport = (
  report: { model: string; usage: AiUsage }
) => void | Promise<void>

function tokenUsage(raw: unknown): AiUsage | null {
  const value = raw as {
    prompt_tokens?: number
    completion_tokens?: number
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  } | null
  const promptTokens = value?.prompt_tokens ?? value?.input_tokens
  const completionTokens = value?.completion_tokens ?? value?.output_tokens
  if (typeof promptTokens !== 'number' || typeof completionTokens !== 'number') return null
  return {
    promptTokens,
    completionTokens,
    totalTokens: value?.total_tokens ?? promptTokens + completionTokens,
  }
}

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_TRANSCRIPT_URL = 'https://api.openai.com/v1/audio/transcriptions'
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const MAX_MEDIA_BYTES = 15 * 1024 * 1024
// Media models are independent from the account's chat model. This avoids
// breaking image/audio processing when an account chooses another text model.
const IMAGE_ANALYSIS_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-4.1-mini'
const AUDIO_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe'

function isBlockedMediaHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  return normalized === 'localhost' || normalized.endsWith('.localhost') ||
    normalized === '0.0.0.0' || normalized === '::1' ||
    /^127\./.test(normalized) || /^10\./.test(normalized) ||
    /^192\.168\./.test(normalized) || /^169\.254\./.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
}

function textFromChatCompletion(data: unknown): string {
  const value = data as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> }
  const content = value.choices?.[0]?.message?.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : ''
  if (!text.trim()) throw new AiError('OpenAI did not return an image description.', { code: 'empty_response' })
  return text.trim().slice(0, 300)
}

function assertSize(bytes: Buffer) {
  if (bytes.length > MAX_MEDIA_BYTES) {
    throw new AiError('El archivo supera el máximo de 15 MB para análisis.', { code: 'media_too_large', status: 400 })
  }
}

export type InvoicePdfValidation = {
  documentType: 'tax_certificate' | 'receipt' | 'other' | 'unreadable'
  readable: boolean
  complete: boolean
  presentFields: string[]
  missingFields: string[]
  issues: string[]
  description?: string
}

function responsesText(data: unknown): string {
  const value = data as {
    output_text?: string
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  } | null
  if (value?.output_text?.trim()) return value.output_text.trim()
  const text = (value?.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text ?? '')
    .join('')
    .trim()
  if (!text) throw new AiError('OpenAI no devolvió el resultado del análisis del PDF.', { code: 'empty_response' })
  return text
}

export function parseInvoicePdfValidation(raw: string): InvoicePdfValidation {
  let parsed: unknown
  try {
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    parsed = JSON.parse(jsonStart >= 0 && jsonEnd >= jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw)
  } catch {
    throw new AiError('El análisis del PDF no devolvió un resultado estructurado válido.', { code: 'invalid_pdf_analysis' })
  }
  const value = parsed as Record<string, unknown>
  const allowedTypes = new Set<InvoicePdfValidation['documentType']>([
    'tax_certificate',
    'receipt',
    'other',
    'unreadable',
  ])
  const documentType = allowedTypes.has(value.document_type as InvoicePdfValidation['documentType'])
    ? value.document_type as InvoicePdfValidation['documentType']
    : 'unreadable'
  const strings = (field: unknown) => Array.isArray(field)
    ? field.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 20)
    : []
  return {
    documentType,
    readable: value.readable === true,
    complete: value.complete === true,
    presentFields: strings(value.present_fields),
    missingFields: strings(value.missing_fields),
    issues: strings(value.issues),
    description: typeof value.description === 'string' ? value.description.trim().slice(0, 300) : undefined,
  }
}

export function formatInvoicePdfValidation(validation: InvoicePdfValidation): string {
  if (validation.documentType === 'other' && validation.description) {
    return validation.description
  }
  const labels: Record<InvoicePdfValidation['documentType'], string> = {
    tax_certificate: 'constancia de situación fiscal',
    receipt: 'ticket o comprobante de consumo',
    other: 'otro tipo de archivo',
    unreadable: 'documento o imagen no legible/protegido',
  }
  const parts = [
    `tipo=${labels[validation.documentType]}`,
    `legible=${validation.readable ? 'sí' : 'no'}`,
    `completo=${validation.complete ? 'sí' : 'no'}`,
  ]
  if (validation.presentFields.length > 0) parts.push(`campos_detectados=${validation.presentFields.join(', ')}`)
  if (validation.missingFields.length > 0) parts.push(`faltantes=${validation.missingFields.join(', ')}`)
  if (validation.issues.length > 0) parts.push(`observaciones=${validation.issues.join('; ')}`)
  return parts.join('; ')
}

export async function analyzeInvoiceImageWithOpenAi(args: {
  accountId: string
  apiKey: string
  model: string
  bytes: Buffer
  mimeType: string
  timeoutMs: number
  onUsage: MediaUsageReport
}): Promise<string> {
  assertSize(args.bytes)
  if (!args.mimeType.toLowerCase().startsWith('image/')) {
    throw new AiError('El medio recibido no es una imagen compatible.', { code: 'unsupported_image_type', status: 415 })
  }
  const model = args.model || IMAGE_ANALYSIS_MODEL
  await assertAiBillingReady(supabaseAdmin(), 'openai', model, args.accountId)
  const prompt = `Analiza esta imagen para apoyo de atención al cliente y facturación. Devuelve SOLO JSON válido:
{"document_type":"tax_certificate|receipt|other|unreadable","readable":true|false,"complete":true|false,"present_fields":[],"missing_fields":[],"issues":[],"description":""}

- tax_certificate: constancia de situación fiscal. Campos requeridos: RFC, razón social/nombre, código postal fiscal y régimen fiscal.
- receipt: ticket o comprobante de consumo. Campos requeridos: comercio/restaurante, fecha, importe total y folio/referencia.
- other: imagen que no es ninguno de esos documentos. Completa "description" con UNA sola oración factual de máximo 25 palabras.
- unreadable: borrosa, cortada, vacía o ilegible.

No incluyas valores personales/fiscales ni el contenido exacto de los campos. En present_fields y missing_fields usa solo nombres de campo. Para una constancia no incluyas uso de CFDI.`
  let response: Response
  try {
    response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${args.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:${args.mimeType};base64,${args.bytes.toString('base64')}` },
            },
          ],
        }],
        max_completion_tokens: 500,
      }),
      signal: AbortSignal.timeout(args.timeoutMs),
    })
  } catch (error) {
    throw new AiError(error instanceof Error ? error.message : 'No se pudo analizar la imagen.', { code: 'network_error' })
  }
  if (!response.ok) {
    throw new AiError(`OpenAI rechazó el análisis de imagen (${response.status}).`, { code: 'provider_error', status: response.status })
  }
  const data = await response.json().catch(() => null) as { model?: string; usage?: unknown } | null
  const result = parseInvoicePdfValidation(textFromChatCompletion(data))
  const usage = tokenUsage(data?.usage)
  if (!usage) {
    throw new AiBillingError(
      'OpenAI image validation did not report billable token usage; its output was blocked.'
    )
  }
  await args.onUsage({ model: data?.model || model, usage })
  return formatInvoicePdfValidation(result)
}

export async function analyzeInvoicePdfWithOpenAi(args: {
  accountId: string
  apiKey: string
  model: string
  bytes: Buffer
  mimeType: string
  fileName?: string
  timeoutMs: number
  onUsage: MediaUsageReport
}): Promise<string> {
  assertSize(args.bytes)
  if (!/application\/pdf/i.test(args.mimeType) && !args.bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new AiError('El documento enviado no es un PDF. Solicita un archivo PDF o una fotografía legible.', { code: 'unsupported_document_type', status: 415 })
  }
  const model = args.model || IMAGE_ANALYSIS_MODEL
  await assertAiBillingReady(supabaseAdmin(), 'openai', model, args.accountId)
  const prompt = `Analiza este PDF para apoyar una solicitud de facturación en México. Devuelve SOLO JSON válido con esta forma:
{"document_type":"tax_certificate|receipt|other|unreadable","readable":true|false,"complete":true|false,"present_fields":[],"missing_fields":[],"issues":[]}

Clasificación y reglas:
- tax_certificate: constancia de situación fiscal. Deben estar legibles RFC, razón social/nombre, código postal fiscal y régimen fiscal. "complete" solo es true si todos aparecen.
- receipt: ticket o comprobante de consumo. Deben estar legibles comercio/restaurante, fecha, importe total y folio/referencia. "complete" solo es true si todos aparecen.
- other: es legible pero no corresponde a ninguno de los dos documentos.
- unreadable: no se puede leer, está protegido, vacío o es demasiado borroso.

No devuelvas los valores personales o fiscales encontrados. Enumera únicamente nombres de campos detectados o faltantes, por ejemplo "RFC", "razón social", "código postal fiscal", "régimen fiscal", "comercio", "fecha", "importe total" y "folio". Si el documento es una constancia, "uso de CFDI" no debe aparecer como campo detectable: ese dato normalmente se confirma con el cliente.`
  let response: Response
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${args.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_file',
              filename: args.fileName?.trim() || 'documento.pdf',
              file_data: `data:application/pdf;base64,${args.bytes.toString('base64')}`,
              detail: 'high',
            },
            { type: 'input_text', text: prompt },
          ],
        }],
        max_output_tokens: 700,
      }),
      signal: AbortSignal.timeout(args.timeoutMs),
    })
  } catch (error) {
    throw new AiError(error instanceof Error ? error.message : 'No se pudo analizar el PDF.', { code: 'network_error' })
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null
    const detail = payload?.error?.message?.trim().slice(0, 300)
    throw new AiError(`OpenAI rechazó el análisis del PDF (${response.status})${detail ? `: ${detail}` : '.'}`, { code: 'provider_error', status: response.status })
  }
  const data = await response.json().catch(() => null) as { model?: string; usage?: unknown } | null
  const result = parseInvoicePdfValidation(responsesText(data))
  const usage = tokenUsage(data?.usage)
  if (!usage) {
    throw new AiBillingError(
      'OpenAI PDF analysis did not report billable token usage; its output was blocked.'
    )
  }
  await args.onUsage({ model: data?.model || model, usage })
  return formatInvoicePdfValidation(result)
}

export function audioExtensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase().split(';', 1)[0].trim()
  if (normalized.includes('ogg')) return 'ogg'
  if (normalized.includes('mpeg')) return 'mp3'
  if (normalized.includes('mpga')) return 'mpga'
  if (normalized.includes('mp4')) return 'mp4'
  if (normalized.includes('m4a')) return 'm4a'
  if (normalized.includes('wav')) return 'wav'
  if (normalized.includes('webm')) return 'webm'
  return 'webm'
}

/** Download a direct CDN attachment from a trusted connected channel. */
export async function downloadPublicMedia(urlValue: string): Promise<{ bytes: Buffer; mimeType: string | null }> {
  const url = new URL(urlValue)
  if (url.protocol !== 'https:' || isBlockedMediaHostname(url.hostname)) {
    throw new AiError('La URL del medio no es segura.', { code: 'unsupported_media_url', status: 400 })
  }
  let response: Response
  try {
    response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    throw new AiError(error instanceof Error ? error.message : 'No se pudo descargar el medio.', { code: 'network_error' })
  }
  if (!response.ok) throw new AiError(`No se pudo descargar el medio (${response.status}).`, { code: 'provider_error', status: response.status })
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_MEDIA_BYTES) {
    throw new AiError('El archivo supera el máximo de 15 MB para análisis.', { code: 'media_too_large', status: 400 })
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  assertSize(bytes)
  return { bytes, mimeType: response.headers.get('content-type') }
}

export async function describeImageWithOpenAi(args: {
  accountId: string
  apiKey: string
  model: string
  bytes: Buffer
  mimeType: string
  timeoutMs: number
  onUsage: MediaUsageReport
}): Promise<string> {
  assertSize(args.bytes)
  const model = args.model || IMAGE_ANALYSIS_MODEL
  await assertAiBillingReady(supabaseAdmin(), 'openai', model, args.accountId)
  const dataUrl = `data:${args.mimeType || 'image/jpeg'};base64,${args.bytes.toString('base64')}`
  let response: Response
  try {
    response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${args.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        // Short and fast on purpose: this blocks conversation analysis
        // until it finishes (see ai-analysis-worker), so a long, verbose
        // description directly slows down every other AI feature waiting
        // on it. One concise sentence is enough context for the summary.
        messages: [{ role: 'system', content: 'Describe la imagen en UNA sola oración breve (máximo 25 palabras), factual, para el contexto de atención al cliente. No infieras datos sensibles ni identidad.' }, { role: 'user', content: [{ type: 'text', text: 'Describe brevemente esta imagen en una oración.' }, { type: 'image_url', image_url: { url: dataUrl } }] }],
        max_completion_tokens: 80,
      }),
      signal: AbortSignal.timeout(args.timeoutMs),
    })
  } catch (error) {
    throw new AiError(error instanceof Error ? error.message : 'No se pudo analizar la imagen.', { code: 'network_error' })
  }
  if (!response.ok) throw new AiError(`OpenAI rechazó el análisis de imagen (${response.status}).`, { code: 'provider_error', status: response.status })
  const data = await response.json().catch(() => null) as { model?: string; usage?: unknown } | null
  const text = textFromChatCompletion(data)
  const usage = tokenUsage(data?.usage)
  if (!usage) {
    throw new AiBillingError(
      'OpenAI image analysis did not report billable usage; its output was blocked.'
    )
  }
  await args.onUsage({ model: data?.model || model, usage })
  return text
}

export async function transcribeAudioWithOpenAi(args: {
  accountId: string
  apiKey: string
  model: string
  bytes: Buffer
  mimeType: string
  timeoutMs: number
  onUsage: MediaUsageReport
}): Promise<string> {
  assertSize(args.bytes)
  const model = args.model || AUDIO_TRANSCRIPTION_MODEL
  await assertAiBillingReady(supabaseAdmin(), 'openai', model, args.accountId)
  const extension = audioExtensionForMimeType(args.mimeType)
  const form = new FormData()
  form.set('model', model)
  form.set('language', 'es')
  form.set('file', new Blob([new Uint8Array(args.bytes)], { type: args.mimeType || 'audio/ogg' }), `voice-note.${extension}`)
  let response: Response
  try {
    response = await fetch(OPENAI_TRANSCRIPT_URL, { method: 'POST', headers: { Authorization: `Bearer ${args.apiKey}` }, body: form, signal: AbortSignal.timeout(args.timeoutMs) })
  } catch (error) {
    throw new AiError(error instanceof Error ? error.message : 'No se pudo transcribir la nota de voz.', { code: 'network_error' })
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null
    const detail = payload?.error?.message?.trim().slice(0, 300)
    throw new AiError(`OpenAI rechazó la transcripción (${response.status})${detail ? `: ${detail}` : '.'}`, { code: 'provider_error', status: response.status })
  }
  const data = await response.json().catch(() => null) as { text?: string; usage?: { type?: string } } | null
  if (!data?.text?.trim()) throw new AiError('OpenAI no devolvió una transcripción.', { code: 'empty_response' })
  // Models billed by duration (whisper-1) report seconds, not tokens; those are not recorded here.
  const usage = data.usage?.type === 'tokens' ? tokenUsage(data.usage) : null
  if (!usage) {
    throw new AiBillingError(
      'OpenAI transcription did not report token usage that can be priced; its output was blocked.'
    )
  }
  await args.onUsage({ model, usage })
  return data.text.trim().slice(0, 10000)
}
