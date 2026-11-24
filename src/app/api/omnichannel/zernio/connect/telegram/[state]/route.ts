import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { completeZernioTelegramConnect, listZernioAccounts } from '@/lib/zernio/server'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

export async function POST(_request: Request, { params }: { params: Promise<{ state: string }> }) {
  try {
    const { state } = await params
    const { accountId } = await requireEntitlement('social_messaging', 'admin')
    const db = admin()
    const { data: attempt, error } = await db.from('zernio_connection_attempts')
      .select('*')
      .eq('state', state)
      .eq('account_id', accountId)
      .eq('channel', 'telegram')
      .maybeSingle()
    if (error) throw error
    if (!attempt || attempt.completed_at || new Date(attempt.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'El código de Telegram venció. Solicita uno nuevo.' }, { status: 409 })
    }
    const metadata = attempt.metadata && typeof attempt.metadata === 'object'
      ? attempt.metadata as Record<string, unknown>
      : {}
    const code = typeof metadata.telegram_code === 'string' ? metadata.telegram_code : ''
    if (!code) return NextResponse.json({ error: 'No se encontró el código de conexión.' }, { status: 409 })

    const status = await completeZernioTelegramConnect(code)
    if (!status.connected) return NextResponse.json({ connected: false })

    const accounts = await listZernioAccounts(attempt.zernio_profile_id, 'telegram')
    const selected = accounts.find((item) => item.id === status.accountId) ?? (accounts.length === 1 ? accounts[0] : undefined)
    if (!selected) return NextResponse.json({ connected: false })

    const now = new Date().toISOString()
    const { error: connectorError } = await db.from('omnichannel_connectors').upsert({
      account_id: attempt.account_id,
      provider: 'zernio_telegram',
      display_name: (selected.displayName || selected.username || 'Telegram').slice(0, 80),
      external_channel_id: selected.id.slice(0, 128),
      zernio_profile_id: attempt.zernio_profile_id,
      zernio_account_id: selected.id.slice(0, 256),
      zernio_metadata: {
        username: selected.username,
        display_name: selected.displayName,
        platform: selected.platform,
        connected_at: now,
      },
      status: 'configured',
      last_error: null,
      created_by: attempt.user_id,
      updated_at: now,
    }, { onConflict: 'account_id,provider,external_channel_id' })
    if (connectorError) throw connectorError
    await db.from('zernio_connection_attempts').update({ completed_at: now, metadata: {} }).eq('id', attempt.id)
    return NextResponse.json({ connected: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
