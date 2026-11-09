import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseBusinessHours } from '@/lib/business-hours/config'

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const [connectors, settings, receipts] = await Promise.all([
      supabase.from('omnichannel_connectors').select('id, display_name, status')
        .eq('account_id', accountId).eq('provider', 'zernio_whatsapp'),
      supabase.from('connected_whatsapp_business_hours')
        .select('connector_id, enabled, timezone, windows, holidays, message')
        .eq('account_id', accountId),
      supabase.from('connected_whatsapp_closure_receipts')
        .select('connector_id, conversation_id, state, created_at')
        .eq('account_id', accountId).in('state', ['failed', 'claimed'])
        .order('created_at', { ascending: false }).limit(100),
    ])
    if (connectors.error) throw connectors.error
    if (settings.error) throw settings.error
    if (receipts.error) throw receipts.error
    const cutoff = Date.now() - 120_000
    const problems = receipts.data.filter((receipt) =>
      receipt.state === 'failed' || new Date(receipt.created_at).getTime() < cutoff,
    )
    return NextResponse.json({ connectors: connectors.data, settings: settings.data, problems })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = parseBusinessHours(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid business-hours configuration' }, { status: 400 })
    const config = parsed.data
    const { data: connector, error: connectorError } = await supabase.from('omnichannel_connectors')
      .select('id').eq('id', config.connectorId).eq('account_id', accountId)
      .eq('provider', 'zernio_whatsapp').maybeSingle()
    if (connectorError) throw connectorError
    if (!connector) return NextResponse.json({ error: 'Connector not found' }, { status: 404 })
    const { error } = await supabase.from('connected_whatsapp_business_hours').upsert({
      account_id: accountId,
      connector_id: config.connectorId,
      enabled: config.enabled,
      timezone: config.timezone,
      windows: config.windows,
      holidays: config.holidays,
      message: config.message,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id,connector_id' })
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
