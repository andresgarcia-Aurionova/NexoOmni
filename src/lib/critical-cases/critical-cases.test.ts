import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: vi.fn() }))
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: vi.fn() }))
vi.mock('@/lib/ai/context', () => ({ buildConversationContext: vi.fn() }))
vi.mock('@/lib/ai/generate', () => ({ generateText: vi.fn() }))
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: vi.fn() }))

import { parseClassification } from './classify'
import { shouldApplyAiLevel } from './evaluate'
import { criticalCaseWhatsAppParams } from './alert-copy'
import { parseCriticalSettings } from './settings'
import { criticalLevelLabel } from '@/lib/notifications/critical-case-notification'

const sedes = ['Polanco', 'Condesa', 'Cueva de Lobos']

describe('parseClassification', () => {
  it('accepts fenced JSON and maps the sede case-insensitively to the configured name', () => {
    const result = parseClassification('```json\n{"level":"n3","sede":"polanco","reason":"Intoxicación\\n  tras comer"}\n```', sedes)
    expect(result).toEqual({ level: 'n3', sede: 'Polanco', reason: 'Intoxicación tras comer' })
  })

  it('drops sedes that are not configured', () => {
    expect(parseClassification('{"level":"n2","sede":"Roma","reason":"Demora"}', sedes).sede).toBeNull()
  })

  it('detects a health incident and maps a partial branch alias', () => {
    const transcript = 'Cliente: Ayer fui a restaurante lobos y me enfermé del estómago; fue toda mi familia.'
    expect(parseClassification(
      '{"level":"n1","sede":null,"reason":"Seguimiento al cliente"}',
      sedes,
      transcript,
    )).toEqual({
      level: 'n3',
      sede: 'Cueva de Lobos',
      reason: 'Seguimiento al cliente',
    })
  })

  it('rejects invalid JSON, unknown levels and extra keys', () => {
    expect(() => parseClassification('not json', sedes)).toThrow()
    expect(() => parseClassification('{"level":"n4"}', sedes)).toThrow()
    expect(() => parseClassification('{"level":"n2","alert":true}', sedes)).toThrow()
  })
})

describe('shouldApplyAiLevel', () => {
  it('only raises the level and never overrides a human decision', () => {
    expect(shouldApplyAiLevel({ level: null, source: null }, 'n2')).toBe(true)
    expect(shouldApplyAiLevel({ level: 'n2', source: 'ai' }, 'n3')).toBe(true)
    expect(shouldApplyAiLevel({ level: 'n3', source: 'ai' }, 'n2')).toBe(false)
    expect(shouldApplyAiLevel({ level: 'n2', source: 'ai' }, 'n2')).toBe(false)
    expect(shouldApplyAiLevel({ level: 'n1', source: 'human' }, 'n3')).toBe(false)
  })
})

describe('criticalCaseWhatsAppParams', () => {
  it('builds single-line, non-empty template variables', () => {
    expect(criticalCaseWhatsAppParams({ level: 'n3', sede: 'Polanco', reason: 'Cliente\nenfermo', contact: 'Ana' }))
      .toEqual(['Nivel N3 – Sede Polanco', 'Ana', 'Cliente enfermo'])
    const [where, contact, detail] = criticalCaseWhatsAppParams({ level: 'n2', sede: null, reason: null, contact: '' })
    expect(where).toBe('Nivel N2')
    expect(contact).toBe('—')
    expect(detail).toBe('Sin detalle; revisar la conversación')
  })
})

describe('parseCriticalSettings', () => {
  const base = { enabled: true, templateName: 'alerta_caso_critico', templateLanguage: 'es_MX' }

  it('normalizes sedes and phones', () => {
    const result = parseCriticalSettings({ ...base, defaultPhones: ['+5215512345678'], sedes: [{ name: '  Polanco  ', phones: [] }] })
    expect(result.sedes).toEqual([{ name: 'Polanco', phones: [] }])
    expect(result.defaultPhones).toHaveLength(1)
  })

  it('rejects duplicated sedes and bad template names', () => {
    expect(() => parseCriticalSettings({ ...base, sedes: [{ name: 'Polanco' }, { name: 'polanco' }] })).toThrow()
    expect(() => parseCriticalSettings({ ...base, templateName: 'Bad Name' })).toThrow()
  })
})

describe('criticalLevelLabel', () => {
  it('renders known levels and falls back for unexpected bodies', () => {
    expect(criticalLevelLabel('n3')).toBe('N3')
    expect(criticalLevelLabel('other')).toBe('N2+')
  })
})
