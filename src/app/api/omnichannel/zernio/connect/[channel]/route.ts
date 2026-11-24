import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { channelAddOnEntitlement, requireEntitlement } from '@/lib/account/entitlements'
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account'
import {
  createZernioTelegramCode,
  ensureZernioProfile,
  getZernioConnectUrl,
  isZernioConnectRouteChannel,
  listZernioAccountsForConnect,
} from '@/lib/zernio/server'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function publicOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.APP_URL?.trim()
  if (configured && /^https:\/\//i.test(configured)) return configured.replace(/\/$/, '')
  const host = request.headers.get('x-forwarded-host')?.split(',', 1)[0]?.trim() || request.headers.get('host')
  if (host) return `${request.headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim() || 'https'}://${host}`
  throw new Error('No se pudo determinar la URL pública de NexoOmni.')
}

// This route is loaded via a full-page `window.location.assign` (not
// `fetch`), so on error we must redirect back into the app instead of
// returning JSON — otherwise the browser shows a bare `{"error":...}`
// page with no way back, which is what admins were hitting. The thrown
// errors here are already safe, admin-facing Spanish messages (missing
// server config, Zernio API failures, etc.), so we surface them via the
// `zernio_message` query param instead of collapsing to a generic 500.
function settingsRedirect(request: Request, tab: string, status: string, message?: string) {
  const url = new URL('/settings', publicOrigin(request))
  url.searchParams.set('tab', tab)
  url.searchParams.set('zernio', status)
  if (message) url.searchParams.set('zernio_message', message.slice(0, 180))
  return NextResponse.redirect(url, { status: 302 })
}

export async function GET(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params
  const tab = channel === 'whatsapp' ? 'whatsapp' : 'social-messaging'
  try {
    if (!isZernioConnectRouteChannel(channel)) return settingsRedirect(request, tab, 'error', 'Integración no válida.')
    const entitlement = channelAddOnEntitlement(channel)
    if (!entitlement) return settingsRedirect(request, tab, 'error', 'Integración no válida.')
    const { accountId, userId, supabase } = await requireEntitlement(entitlement, 'admin')
    const { data: account, error: accountError } = await supabase.from('accounts').select('name').eq('id', accountId).single()
    if (accountError) throw accountError
    const db = admin()
    const profileId = await ensureZernioProfile(db, accountId, account?.name ?? 'Cuenta NexoOmni', userId)
    const knownAccounts = await listZernioAccountsForConnect(profileId, channel)
    const state = randomUUID()
    const origin = publicOrigin(request)
    const callback = new URL('/api/omnichannel/zernio/callback', origin)
    callback.searchParams.set('state', state)
    let metadata: Record<string, unknown> = {}
    let telegramCode: Awaited<ReturnType<typeof createZernioTelegramCode>> | null = null
    if (channel === 'telegram') {
      telegramCode = await createZernioTelegramCode(profileId)
      metadata = {
        telegram_code: telegramCode.code,
        telegram_bot_username: telegramCode.botUsername,
        telegram_expires_at: telegramCode.expiresAt,
      }
    }
    const { error: attemptError } = await db.from('zernio_connection_attempts').insert({
      account_id: accountId,
      user_id: userId,
      channel,
      state,
      zernio_profile_id: profileId,
      known_account_ids: knownAccounts.map((item) => item.id),
      redirect_uri: callback.toString(),
      metadata,
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    })
    if (attemptError) throw attemptError
    if (telegramCode) {
      return NextResponse.json({
        state,
        code: telegramCode.code,
        botUsername: telegramCode.botUsername,
        expiresAt: telegramCode.expiresAt,
        instructions: telegramCode.instructions,
      })
    }
    const authUrl = await getZernioConnectUrl(channel, profileId, callback.toString())
    return NextResponse.redirect(authUrl, { status: 302 })
  } catch (error) {
    console.error('Zernio connect failed', error)
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return settingsRedirect(request, tab, 'error', error.message)
    }
    return settingsRedirect(request, tab, 'error', error instanceof Error ? error.message : 'No fue posible iniciar la conexión. Inténtalo nuevamente.')
  }
}
