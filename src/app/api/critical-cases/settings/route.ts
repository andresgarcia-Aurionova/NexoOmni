import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { AlertSettingsError } from '@/lib/telephony/reservation-alert'
import { loadCriticalSettings, parseCriticalSettings } from '@/lib/critical-cases/settings'

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    return NextResponse.json({ settings: await loadCriticalSettings(supabaseAdmin(), accountId) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const db = supabaseAdmin()
    let settings
    try {
      const body = await request.json().catch(() => null)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AlertSettingsError('Expected a JSON object')
      settings = parseCriticalSettings({ ...await loadCriticalSettings(db, accountId), ...body })
    } catch (error) {
      if (error instanceof AlertSettingsError) return NextResponse.json({ error: error.message }, { status: 400 })
      throw error
    }
    const { error } = await db.from('critical_case_settings').upsert({
      account_id: accountId,
      enabled: settings.enabled,
      template_name: settings.templateName,
      template_language: settings.templateLanguage,
      default_phones: settings.defaultPhones,
      sedes: settings.sedes,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    if (error) throw error
    return NextResponse.json({ settings })
  } catch (error) {
    return toErrorResponse(error)
  }
}
