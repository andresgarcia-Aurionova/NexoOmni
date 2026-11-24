import type { SupabaseClient } from '@supabase/supabase-js'
import { AlertSettingsError, DEFAULT_ALERT_LANGUAGE, parseRecipientPhones } from '@/lib/telephony/reservation-alert'

export const CASE_LEVELS = ['n1', 'n2', 'n3'] as const
export type CaseLevel = (typeof CASE_LEVELS)[number]
export const DEFAULT_CRITICAL_TEMPLATE = 'alerta_caso_critico'
export const MAX_SEDES = 50

export type CriticalCaseSede = { name: string; phones: string[] }

export type CriticalCaseSettings = {
  enabled: boolean
  templateName: string
  templateLanguage: string
  defaultPhones: string[]
  sedes: CriticalCaseSede[]
}

export const EMPTY_CRITICAL_SETTINGS: CriticalCaseSettings = {
  enabled: false,
  templateName: DEFAULT_CRITICAL_TEMPLATE,
  templateLanguage: DEFAULT_ALERT_LANGUAGE,
  defaultPhones: [],
  sedes: [],
}

export function caseLevelRank(level: string | null | undefined): number {
  return level === 'n3' ? 3 : level === 'n2' ? 2 : level === 'n1' ? 1 : 0
}

export function isCaseLevel(value: unknown): value is CaseLevel {
  return typeof value === 'string' && (CASE_LEVELS as readonly string[]).includes(value)
}

function parseSedes(input: unknown): CriticalCaseSede[] {
  if (!Array.isArray(input)) throw new AlertSettingsError('sedes must be a list')
  if (input.length > MAX_SEDES) throw new AlertSettingsError(`At most ${MAX_SEDES} branches are allowed`)
  const sedes: CriticalCaseSede[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new AlertSettingsError('Invalid branch entry')
    const raw = item as Record<string, unknown>
    const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim() : ''
    if (!name || name.length > 120) throw new AlertSettingsError('Each branch needs a name of up to 120 characters')
    if (sedes.some((sede) => sede.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new AlertSettingsError(`Duplicated branch: ${name}`)
    }
    sedes.push({ name, phones: parseRecipientPhones(raw.phones ?? []) })
  }
  return sedes
}

export function parseCriticalSettings(body: unknown): CriticalCaseSettings {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AlertSettingsError('Expected a JSON object')
  const raw = body as Record<string, unknown>
  const templateName = typeof raw.templateName === 'string' ? raw.templateName.trim() : ''
  const templateLanguage = typeof raw.templateLanguage === 'string' ? raw.templateLanguage.trim() : ''
  if (!/^[a-z0-9_]{1,512}$/.test(templateName)) throw new AlertSettingsError('templateName must use lowercase letters, numbers and underscores')
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(templateLanguage)) throw new AlertSettingsError('templateLanguage must look like es_MX')
  const defaultPhones = parseRecipientPhones(raw.defaultPhones ?? [])
  const sedes = parseSedes(raw.sedes ?? [])
  return { enabled: raw.enabled === true, templateName, templateLanguage, defaultPhones, sedes }
}

export async function loadCriticalSettings(db: SupabaseClient, accountId: string): Promise<CriticalCaseSettings> {
  const { data, error } = await db.from('critical_case_settings')
    .select('enabled, template_name, template_language, default_phones, sedes')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data) return EMPTY_CRITICAL_SETTINGS
  let sedes: CriticalCaseSede[] = []
  try {
    sedes = parseSedes(data.sedes ?? [])
  } catch {
    sedes = []
  }
  return {
    enabled: data.enabled === true,
    templateName: data.template_name,
    templateLanguage: data.template_language,
    defaultPhones: data.default_phones ?? [],
    sedes,
  }
}
