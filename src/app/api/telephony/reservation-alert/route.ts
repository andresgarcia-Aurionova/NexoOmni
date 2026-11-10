import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { toErrorResponse } from '@/lib/auth/account'
import { requireEntitlement } from '@/lib/account/entitlements'
import { AlertSettingsError, loadAlertSettings, parseAlertSettings } from '@/lib/telephony/reservation-alert'

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET() {
  try {
    const { accountId } = await requireEntitlement('yeastar_telephony', 'admin')
    return NextResponse.json({ settings: await loadAlertSettings(admin(), accountId) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  try {
    const { accountId, userId } = await requireEntitlement('yeastar_telephony', 'admin')
    let settings
    try {
      const body = await request.json().catch(() => null)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AlertSettingsError('Expected a JSON object')
      settings = parseAlertSettings({ ...await loadAlertSettings(admin(), accountId), ...body })
    } catch (error) {
      if (error instanceof AlertSettingsError) return NextResponse.json({ error: error.message }, { status: 400 })
      throw error
    }
    const { error } = await admin().from('reservation_alert_settings').upsert({
      account_id: accountId,
      enabled: settings.enabled,
      template_name: settings.templateName,
      template_language: settings.templateLanguage,
      recipient_phones: settings.recipientPhones,
      confirmation_enabled: settings.confirmationEnabled,
      confirmation_template_name: settings.confirmationTemplateName,
      confirmation_template_language: settings.confirmationTemplateLanguage,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    if (error) throw error
    return NextResponse.json({ settings })
  } catch (error) {
    return toErrorResponse(error)
  }
}
