'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, Copy, Loader2, Radio, RefreshCw, Save } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { transcriptText, type VoiceReceptionistCall, type VoiceReceptionistPublicConfig } from '@/lib/telephony/voice-receptionist'

type Voice = {
  voice_id: string
  name: string
  category: string | null
  labels: Record<string, string>
}

export function VoiceReceptionistConfig() {
  const t = useTranslations('Settings.voiceReceptionist')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<VoiceReceptionistPublicConfig | null>(null)
  const [calls, setCalls] = useState<VoiceReceptionistCall[]>([])
  const [voices, setVoices] = useState<Voice[]>([])
  const [initiationUrl, setInitiationUrl] = useState('')
  const [postCallUrl, setPostCallUrl] = useState('')
  const [customLlmUrl, setCustomLlmUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [initiationSecret, setInitiationSecret] = useState('')
  const [postCallSecret, setPostCallSecret] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/telephony/voice-receptionist/config', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error)
      setConfig(payload.config)
      setCalls(Array.isArray(payload.calls) ? payload.calls : [])
      setInitiationUrl(payload.webhook_urls?.initiation ?? '')
      setPostCallUrl(payload.webhook_urls?.post_call ?? '')
      setCustomLlmUrl(payload.webhook_urls?.custom_llm ?? '')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  const loadVoices = useCallback(async () => {
    try {
      const response = await fetch('/api/telephony/voice-receptionist/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_voices' }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error)
      setVoices(Array.isArray(payload.voices) ? payload.voices : [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('voicesFailed'))
    }
  }, [t])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (!config?.api_key_configured) return
    const timer = window.setTimeout(() => void loadVoices(), 0)
    return () => window.clearTimeout(timer)
  }, [config?.api_key_configured, loadVoices])

  const hasLiveCall = useMemo(
    () => calls.some((call) => call.status === 'initiated' || call.status === 'in-progress'),
    [calls],
  )
  useEffect(() => {
    if (!hasLiveCall) return
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [hasLiveCall, load])

  const update = <Key extends keyof VoiceReceptionistPublicConfig>(
    key: Key,
    value: NoInfer<VoiceReceptionistPublicConfig[Key]>,
  ) => setConfig((current) => current ? { ...current, [key]: value } : current)

  const save = async () => {
    if (!config) return
    setSaving(true)
    try {
      const response = await fetch('/api/telephony/voice-receptionist/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          elevenlabs_api_key: apiKey,
          initiation_secret: initiationSecret,
          post_call_secret: postCallSecret,
          sync_provider: true,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error)
      setApiKey('')
      setInitiationSecret('')
      setPostCallSecret('')
      toast.success(t('saved'))
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(t('copied'))
    } catch {
      toast.error(t('copyFailed'))
    }
  }

  if (loading || !config) {
    return <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />{t('loading')}
    </div>
  }

  return <Card className="mt-6">
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><Bot className="size-4" />{t('title')}</CardTitle>
      <CardDescription>{t('description')}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="voice-receptionist-transcription">{t('transcriptionMode')}</Label>
        <Select
          value={config.transcription_mode}
          onValueChange={(value) => {
            if (value === 'post_call' || value === 'turns' || value === 'enterprise') {
              update('transcription_mode', value)
              update('realtime_monitoring_enabled', value === 'enterprise')
            }
          }}
          disabled={saving}
        >
          <SelectTrigger id="voice-receptionist-transcription"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="turns">{t('transcriptionTurns')}</SelectItem>
            <SelectItem value="post_call">{t('transcriptionPostCall')}</SelectItem>
            <SelectItem value="enterprise">{t('transcriptionEnterprise')}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {config.transcription_mode === 'turns' ? t('transcriptionTurnsHint') : t('realtimeHint')}
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border p-4">
        <div>
          <p className="text-sm font-medium">{t('enabled')}</p>
          <p className="text-xs text-muted-foreground">{t('enabledHint')}</p>
        </div>
        <Switch checked={config.enabled} onCheckedChange={(value) => update('enabled', value)} disabled={saving} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="voice-receptionist-name">{t('displayName')}</Label>
          <Input id="voice-receptionist-name" value={config.display_name} onChange={(event) => update('display_name', event.target.value)} disabled={saving} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-receptionist-extension">{t('extension')}</Label>
          <Input id="voice-receptionist-extension" inputMode="numeric" value={config.yeastar_extension} onChange={(event) => update('yeastar_extension', event.target.value)} disabled={saving} />
          <p className="text-xs text-muted-foreground">{t('extensionHint')}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-receptionist-language">{t('language')}</Label>
          <Select value={config.language} onValueChange={(value) => { if (value) update('language', value) }} disabled={saving}>
            <SelectTrigger id="voice-receptionist-language"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="es">{t('spanish')}</SelectItem>
              <SelectItem value="en">{t('english')}</SelectItem>
              <SelectItem value="ko">{t('korean')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-receptionist-timezone">{t('timezone')}</Label>
          <Input id="voice-receptionist-timezone" value={config.timezone} onChange={(event) => update('timezone', event.target.value)} disabled={saving} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="voice-receptionist-greeting">{t('greeting')}</Label>
        <Textarea id="voice-receptionist-greeting" rows={3} value={config.first_message ?? ''} onChange={(event) => update('first_message', event.target.value)} disabled={saving} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="voice-receptionist-context">{t('context')}</Label>
        <Textarea id="voice-receptionist-context" rows={7} value={config.system_prompt ?? ''} onChange={(event) => update('system_prompt', event.target.value)} disabled={saving} />
        <p className="text-xs text-muted-foreground">{t('contextHint')}</p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border p-4">
        <div>
          <p className="text-sm font-medium">{t('nexoKnowledge')}</p>
          <p className="text-xs text-muted-foreground">{t('nexoKnowledgeHint')}</p>
        </div>
        <Switch checked={config.use_nexo_knowledge} onCheckedChange={(value) => update('use_nexo_knowledge', value)} disabled={saving} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="voice-receptionist-api-key">{t('apiKey')}</Label>
          <Input id="voice-receptionist-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={config.api_key_configured ? t('savedSecret') : ''} disabled={saving} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-receptionist-voice">{t('voice')}</Label>
          <div className="flex gap-2">
            <Select value={config.elevenlabs_voice_id ?? ''} onValueChange={(value) => { if (value) update('elevenlabs_voice_id', value) }} disabled={saving || !voices.length}>
              <SelectTrigger id="voice-receptionist-voice"><SelectValue placeholder={t('voicePlaceholder')} /></SelectTrigger>
              <SelectContent>
                {voices.map((voice) => <SelectItem key={voice.voice_id} value={voice.voice_id}>{voice.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" size="icon" variant="outline" onClick={() => void loadVoices()} disabled={saving || !config.api_key_configured}>
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="voice-receptionist-transfer">{t('transferSip')}</Label>
          <Input id="voice-receptionist-transfer" value={config.transfer_sip_uri ?? ''} onChange={(event) => update('transfer_sip_uri', event.target.value)} placeholder="sip:1000@pbx.example.com" disabled={saving} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-receptionist-fallback-phone">{t('fallbackPhone')}</Label>
          <Input id="voice-receptionist-fallback-phone" value={config.fallback_phone ?? ''} onChange={(event) => update('fallback_phone', event.target.value)} placeholder="+525512345678" disabled={saving} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-receptionist-duration">{t('maxDuration')}</Label>
          <Input id="voice-receptionist-duration" type="number" min={60} max={7200} value={config.max_duration_seconds} onChange={(event) => update('max_duration_seconds', Number(event.target.value) || 900)} disabled={saving} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-receptionist-silence">{t('silenceTimeout')}</Label>
          <Input id="voice-receptionist-silence" type="number" min={5} max={300} value={config.silence_end_call_seconds} onChange={(event) => update('silence_end_call_seconds', Number(event.target.value) || 20)} disabled={saving} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="voice-receptionist-init-secret">{t('initiationSecret')}</Label>
          <Input id="voice-receptionist-init-secret" type="password" value={initiationSecret} onChange={(event) => setInitiationSecret(event.target.value)} placeholder={config.initiation_secret_configured ? t('savedSecret') : ''} disabled={saving} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-receptionist-post-secret">{t('postCallSecret')}</Label>
          <Input id="voice-receptionist-post-secret" type="password" value={postCallSecret} onChange={(event) => setPostCallSecret(event.target.value)} placeholder={config.post_call_secret_configured ? t('savedSecret') : ''} disabled={saving} />
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <p className="text-sm font-medium">{t('webhooks')}</p>
        {[initiationUrl, postCallUrl, customLlmUrl].map((url, index) => <div key={url} className="space-y-2">
          <Label>{index === 0 ? t('initiationUrl') : index === 1 ? t('postCallUrl') : t('customLlmUrl')}</Label>
          <div className="flex gap-2">
            <Input readOnly value={url} />
            <Button type="button" size="icon" variant="outline" onClick={() => void copy(url)} disabled={!url}><Copy className="size-4" /></Button>
          </div>
        </div>)}
        <p className="text-xs text-muted-foreground">{t('webhookHint')}</p>
      </div>

      <Button onClick={() => void save()} disabled={saving}>
        {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{t('save')}
      </Button>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{t('recentCalls')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="size-4" />{t('refresh')}</Button>
        </div>
        {calls.length ? calls.map((call) => {
          const text = call.summary || transcriptText(call.transcript)
          return <div key={call.id} className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{call.caller_number || t('unknownCaller')}</p>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {(call.status === 'initiated' || call.status === 'in-progress') && <Radio className="size-3 animate-pulse text-emerald-500" />}
                {t(`status.${call.status}`, { defaultValue: call.status })}
              </span>
            </div>
            <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">{text || t('noTranscript')}</p>
          </div>
        }) : <p className="text-sm text-muted-foreground">{t('noCalls')}</p>}
      </div>
    </CardContent>
  </Card>
}
