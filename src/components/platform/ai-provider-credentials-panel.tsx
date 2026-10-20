'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { KeyRound, LoaderCircle, Save } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type AiProvider = 'openai' | 'anthropic'
type ProviderCredential = {
  provider: AiProvider
  has_key: boolean
  readable: boolean
  last_four: string | null
  updated_at: string
  active: boolean
}
type CredentialData = {
  account: { id: string; name: string }
  active_provider: AiProvider | null
  active_model: string | null
  credentials: ProviderCredential[]
}

const PROVIDERS: { id: AiProvider; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
]

export function AiProviderCredentialsPanel({
  accounts,
}: {
  accounts: { id: string; name: string }[]
}) {
  const t = useTranslations('PlatformAiCredentials')
  const [accountId, setAccountId] = useState('')
  const [provider, setProvider] = useState<AiProvider>('openai')
  const [apiKey, setApiKey] = useState('')
  const [data, setData] = useState<CredentialData | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === accountId),
    [accounts, accountId]
  )

  const load = useCallback(async () => {
    if (!accountId) {
      setData(null)
      return
    }
    setLoading(true)
    try {
      const response = await fetch(
        `/api/platform/ai-credentials?account_id=${encodeURIComponent(accountId)}`,
        { cache: 'no-store' }
      )
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error ?? t('loadError'))
      setData(json as CredentialData)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('loadError'))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [accountId, t])

  useEffect(() => {
    if (accounts.length === 0) {
      setAccountId('')
      setData(null)
      return
    }
    setAccountId((current) =>
      accounts.some((account) => account.id === current)
        ? current
        : accounts[0].id
    )
  }, [accounts])

  useEffect(() => {
    void load()
  }, [load])

  const saveCredential = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!accountId || !apiKey.trim()) return
    setSaving(true)
    try {
      const response = await fetch('/api/platform/ai-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          provider,
          api_key: apiKey.trim(),
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error ?? t('saveError'))
      toast.success(t('saveSuccess', { provider: PROVIDERS.find((item) => item.id === provider)?.label ?? provider }))
      setApiKey('')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('saveError'))
    } finally {
      setSaving(false)
    }
  }

  const credentialByProvider = new Map(
    (data?.credentials ?? []).map((credential) => [credential.provider, credential])
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="max-w-md space-y-2">
          <Label htmlFor="platform-ai-credential-account">{t('account')}</Label>
          <select
            id="platform-ai-credential-account"
            className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
            value={accountId}
            onChange={(event) => {
              setAccountId(event.target.value)
              setApiKey('')
            }}
            disabled={loading || accounts.length === 0}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>

        {accounts.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
            {t('noAccounts')}
          </p>
        ) : (
          <>
            <div className="rounded-md border px-3 py-3 text-sm">
              <p className="font-medium">{t('activeProvider')}</p>
              <p className="mt-1 text-muted-foreground">
                {loading
                  ? t('loading')
                  : data?.active_provider
                    ? `${PROVIDERS.find((item) => item.id === data.active_provider)?.label ?? data.active_provider} · ${data.active_model ?? ''}`
                    : t('notConfigured')}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('routingDisabled')}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {PROVIDERS.map((item) => {
                const credential = credentialByProvider.get(item.id)
                return (
                  <div key={item.id} className="rounded-md border p-3">
                    <p className="font-medium">{item.label}</p>
                    {credential ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {credential.readable
                          ? t('keyStored', {
                              lastFour: credential.last_four ?? '—',
                            })
                          : t('keyUnreadable')}
                        {credential.active ? ` · ${t('currentlyActive')}` : ''}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t('keyMissing')}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            <form
              onSubmit={saveCredential}
              className="grid gap-3 rounded-lg border p-4 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end"
            >
              <div className="space-y-2">
                <Label htmlFor="platform-ai-credential-provider">
                  {t('provider')}
                </Label>
                <select
                  id="platform-ai-credential-provider"
                  className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                  value={provider}
                  onChange={(event) =>
                    setProvider(event.target.value as AiProvider)
                  }
                  disabled={saving}
                >
                  {PROVIDERS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="platform-ai-credential-key">{t('apiKey')}</Label>
                <Input
                  id="platform-ai-credential-key"
                  type="password"
                  autoComplete="new-password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  maxLength={8192}
                  required
                  disabled={saving || loading || !selectedAccount}
                />
              </div>
              <Button
                type="submit"
                disabled={saving || loading || !selectedAccount || !apiKey.trim()}
              >
                {saving ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Save />
                )}
                {t('verifyAndSave')}
              </Button>
              <p className="text-xs text-muted-foreground md:col-span-3">
                {t('verificationCost')}
              </p>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  )
}
