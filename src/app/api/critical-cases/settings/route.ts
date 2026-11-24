import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { AlertSettingsError } from '@/lib/telephony/reservation-alert'
import { loadCriticalSettings, parseCriticalSettings } from '@/lib/critical-cases/settings'

export async function GET() {
  try {
    const { accountId, supabase } = await requireRole('admin')
    return NextResponse.json({ settings: await loadCriticalSettings(supabase, accountId) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  try {
    const { accountId, userId, supabase } = await requireRole('admin')
    let settings
    try {
      const body = await request.json().catch(() => null)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AlertSettingsError('Expected a JSON object')
      settings = parseCriticalSettings({ ...await loadCriticalSettings(supabase, accountId), ...body })
    } catch (error) {
      if (error instanceof AlertSettingsError) return NextResponse.json({ error: error.message }, { status: 400 })
      throw error
    }
    const { error } = await supabase.from('critical_case_settings').upsert({
      account_id: accountId,
      enabled: settings.enabled,
      template_name: settings.templateName,
      template_language: settings.templateLanguage,
      default_phones: settings.defaultPhones,
      sedes: settings.sedes,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id' })
    if (error) {
      console.error('[critical-cases/settings] failed to save settings:', {
        accountId,
        code: error.code,
        message: error.message,
        details: error.details,
      })
      return NextResponse.json({
        error: 'No fue posible guardar las alertas de casos críticos. Inténtalo de nuevo.',
      }, { status: 500 })
    }
    return NextResponse.json({ settings })
  } catch (error) {
    return toErrorResponse(error)
  }
}
