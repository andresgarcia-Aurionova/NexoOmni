'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Bot,
  BriefcaseBusiness,
  Building2,
  Camera,
  CheckCircle2,
  ExternalLink,
  ImageDown,
  Link2,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Pause,
  Play,
  Send,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { channelAddOnEntitlement } from '@/lib/account/entitlements'
import {
  connectChannelForProvider,
  type ZernioConnectChannel,
} from '@/lib/zernio/channels'

type Connector = {
  id: string
  provider: string
  displayName: string
  externalChannelId: string
  status: 'configured' | 'active' | 'paused' | 'error'
  lastEventAt: string | null
  lastError: string | null
}

type TelegramAccess = {
  state: string
  code: string
  botUsername: string
  expiresAt: string | null
  instructions: string[]
}

const CHANNEL_ICONS: Record<ZernioConnectChannel, typeof MessageCircle> = {
  whatsapp: MessageCircle,
  facebook: MessagesSquare,
  instagram: Camera,
  googlebusiness: MapPin,
  google: Mail,
  email: Mail,
  tiktok: MessagesSquare,
  twitter: Send,
  threads: MessageCircle,
  telegram: Bot,
  hubspot: BriefcaseBusiness,
  salesforce: Building2,
}

const PROFILE_SYNC_PROVIDERS = new Set([
  'zernio_whatsapp',
  'zernio_facebook',
  'zernio_instagram',
])

export function ZernioConnectConfig({ channels }: { channels: ZernioConnectChannel[] }) {
  const t = useTranslations('ZernioConnect')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [configured, setConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string | null>(null)
  const [telegramAccess, setTelegramAccess] = useState<TelegramAccess | null>(null)
  const [entitlements, setEntitlements] = useState<Record<string, boolean>>({})
  const [blockedChannel, setBlockedChannel] = useState<ZernioConnectChannel | null>(null)

  useEffect(() => {
    const status = searchParams.get('zernio')
    if (!status) return
    const message = searchParams.get('zernio_message')
    if (status === 'connected') {
      toast.success(t('connected'))
    } else if (status === 'error') {
      toast.error(message || t('connectError'))
    }
    const params = new URLSearchParams(searchParams.toString())
    params.delete('zernio')
    params.delete('zernio_message')
    router.replace(`/settings?${params.toString()}`, { scroll: false })
    // The redirect parameters are intentionally handled once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    try {
      const [response, entitlementResponse] = await Promise.all([
        fetch('/api/omnichannel/zernio/connectors', { cache: 'no-store' }),
        fetch('/api/account/entitlements', { cache: 'no-store' }),
      ])
      if (!response.ok) throw new Error(t('loadError'))
      const body = await response.json() as { connectors: Connector[]; configured?: boolean }
      setConnectors(body.connectors ?? [])
      setConfigured(body.configured !== false)
      if (entitlementResponse.ok) {
        const entitlementBody = await entitlementResponse.json() as {
          entitlements?: { features?: Record<string, boolean> }
        }
        setEntitlements(entitlementBody.entitlements?.features ?? {})
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  const startConnect = async (channel: ZernioConnectChannel) => {
    const entitlement = channelAddOnEntitlement(channel)
    if (!entitlement || !entitlements[entitlement]) {
      setBlockedChannel(channel)
      return
    }
    setPending(`connect:${channel}`)
    if (channel !== 'telegram') {
      window.location.assign(`/api/omnichannel/zernio/connect/${channel}`)
      return
    }
    try {
      const response = await fetch('/api/omnichannel/zernio/connect/telegram', { cache: 'no-store' })
      const body = await response.json().catch(() => null) as (TelegramAccess & { error?: string }) | null
      if (!response.ok || !body?.state || !body.code || !body.botUsername) {
        throw new Error(body?.error || t('connectError'))
      }
      setTelegramAccess(body)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('connectError'))
    } finally {
      setPending(null)
    }
  }

  useEffect(() => {
    if (!telegramAccess) return
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/omnichannel/zernio/connect/telegram/${telegramAccess.state}`, {
        method: 'POST',
        cache: 'no-store',
      })
      const body = await response.json().catch(() => null) as { connected?: boolean; error?: string } | null
      if (response.status === 409) {
        window.clearInterval(timer)
        setTelegramAccess(null)
        toast.error(body?.error || t('telegramExpired'))
        return
      }
      if (body?.connected) {
        window.clearInterval(timer)
        setTelegramAccess(null)
        toast.success(t('connected'))
        await load()
      }
    }, 4_000)
    return () => window.clearInterval(timer)
  }, [load, t, telegramAccess])

  const manage = async (connector: Connector, action: 'pause' | 'resume' | 'delete') => {
    const isDelete = action === 'delete'
    if (isDelete && !window.confirm(t('confirmDelete', { name: connector.displayName }))) return
    setPending(`${action}:${connector.id}`)
    try {
      const response = await fetch(`/api/omnichannel/zernio/connectors/${connector.id}`, {
        method: isDelete ? 'DELETE' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: isDelete ? undefined : JSON.stringify({ status: action === 'pause' ? 'paused' : 'configured' }),
      })
      const body = await response.json().catch(() => null) as { error?: string; warning?: string } | null
      if (!response.ok) throw new Error(body?.error ?? t('updateError'))
      if (body?.warning) toast.warning(body.warning)
      else toast.success(isDelete ? t('deleted') : action === 'pause' ? t('paused') : t('resumed'))
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('updateError'))
    } finally {
      setPending(null)
    }
  }

  const syncAvatars = async (connector: Connector) => {
    setPending(`avatars:${connector.id}`)
    try {
      const response = await fetch('/api/omnichannel/zernio/avatars/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectorId: connector.id }),
      })
      const body = await response.json().catch(() => null) as { updated?: number; renamed?: number; recovered_messages?: number; error?: string } | null
      if (!response.ok) throw new Error(body?.error ?? t('syncError'))
      const parts = [
        body?.updated ? t('syncPhotos', { count: body.updated }) : null,
        body?.renamed ? t('syncNames', { count: body.renamed }) : null,
        body?.recovered_messages ? t('syncMessages', { count: body.recovered_messages }) : null,
      ].filter(Boolean)
      toast.success(parts.length ? t('syncSummary', { items: parts.join(', ') }) : t('syncCurrent'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('syncError'))
    } finally {
      setPending(null)
    }
  }

  const relevant = connectors.filter((connector) => {
    const channel = connectChannelForProvider(connector.provider)
    return channel !== null && channels.includes(channel)
  })

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Link2 className="size-5 text-primary" />{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!loading && !configured && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{t('notConfigured')}</p>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((channel) => {
            const Icon = CHANNEL_ICONS[channel]
            const isConnecting = pending === `connect:${channel}`
            const entitlement = channelAddOnEntitlement(channel)
            const enabled = Boolean(entitlement && entitlements[entitlement])
            return (
              <div key={channel} className="rounded-lg border border-border p-4">
                <Icon className="mb-3 size-5 text-primary" />
                <p className="font-medium">{t(`channels.${channel}.name`)}</p>
                <p className="mt-1 min-h-10 text-xs text-muted-foreground">{t(`channels.${channel}.description`)}</p>
                <Button className="mt-4 w-full" onClick={() => void startConnect(channel)} disabled={pending !== null || (enabled && !configured)}>
                  {isConnecting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Link2 className="mr-2 size-4" />}
                  {t(`channels.${channel}.connect`)}
                </Button>
              </div>
            )
          })}
        </div>

        {telegramAccess && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{t('telegramTitle')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('telegramHelp', { bot: telegramAccess.botUsername })}</p>
              </div>
              <Loader2 className="size-4 animate-spin text-primary" />
            </div>
            <div className="mt-3 rounded-md bg-background px-3 py-2 font-mono text-lg font-semibold">{telegramAccess.code}</div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => window.open(`https://t.me/${telegramAccess.botUsername.replace(/^@/, '')}`, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink className="mr-1.5 size-3.5" />{t('openTelegram')}
            </Button>
          </div>
        )}

        {!loading && relevant.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">{t('connectedTitle')}</p>
            {relevant.map((connector) => {
              const channel = connectChannelForProvider(connector.provider)
              const label = channel ? t(`channels.${channel}.name`) : connector.provider
              const busy = pending?.endsWith(`:${connector.id}`)
              return (
                <div key={connector.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-3">
                  <div>
                    <p className="flex items-center gap-2 font-medium">
                      <CheckCircle2 className={connector.status === 'paused' ? 'size-4 text-amber-500' : 'size-4 text-emerald-500'} />
                      {connector.displayName || label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {label} · {connector.status === 'paused' ? t('statusPaused') : t('statusConnected')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {PROFILE_SYNC_PROVIDERS.has(connector.provider) && (
                      <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void syncAvatars(connector)} title={t('syncHelp')}>
                        {pending === `avatars:${connector.id}` ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <ImageDown className="mr-1 size-3.5" />}
                        {t('sync')}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void manage(connector, connector.status === 'paused' ? 'resume' : 'pause')}>
                      {connector.status === 'paused' ? <Play className="mr-1 size-3.5" /> : <Pause className="mr-1 size-3.5" />}
                      {connector.status === 'paused' ? t('resume') : t('pause')}
                    </Button>
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={!!busy} onClick={() => void manage(connector, 'delete')}>
                      <Trash2 className="mr-1 size-3.5" />{t('delete')}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
    <Dialog
      open={blockedChannel !== null}
      onOpenChange={(open) => {
        if (!open) setBlockedChannel(null)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addonRequiredTitle')}</DialogTitle>
          <DialogDescription>
            {t('addonRequiredDescription', {
              channel: blockedChannel ? t(`channels.${blockedChannel}.name`) : '',
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => setBlockedChannel(null)}>{t('understood')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
