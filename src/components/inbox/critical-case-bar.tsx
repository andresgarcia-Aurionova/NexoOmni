'use client'

import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/hooks/use-auth'
import { hasMinRole } from '@/lib/auth/roles'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { Conversation } from '@/types'

const NONE = '__none__'
type CasePatch = Pick<Conversation, 'case_level' | 'case_level_source' | 'case_level_reason' | 'case_sede' | 'is_critical'>

export function CriticalCaseBar({ conversation: source }: { conversation: Conversation }) {
  const t = useTranslations('CriticalCases')
  const [local, setLocal] = useState<CasePatch | null>(null)
  const conversation = local ? { ...source, ...local } : source
  const { accountRole } = useAuth()
  const canEdit = accountRole !== null && hasMinRole(accountRole, 'supervisor')
  const [sedes, setSedes] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const level = conversation.case_level ?? null
  const sede = conversation.case_sede ?? null

  useEffect(() => {
    if (!canEdit) return
    let cancelled = false
    fetch('/api/critical-cases/sedes')
      .then((res) => (res.ok ? res.json() : { sedes: [] }))
      .then((data: { sedes?: string[] }) => { if (!cancelled) setSedes(data.sedes ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [canEdit])

  if (!level && !canEdit) return null

  async function save(body: { level: string | null; sede?: string | null }) {
    setSaving(true)
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/case-level`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, sede: body.sede === undefined ? undefined : body.sede ?? '' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.case) throw new Error()
      setLocal(data.case as CasePatch)
      toast.success(t('saved'))
    } catch {
      toast.error(t('saveError'))
    } finally {
      setSaving(false)
    }
  }

  const critical = conversation.is_critical === true
  const sedeOptions = sede && !sedes.includes(sede) ? [sede, ...sedes] : sedes

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-t px-4 py-2 text-xs',
        critical ? 'border-destructive/40 bg-destructive/10' : 'border-border',
      )}
      role={critical ? 'alert' : undefined}
    >
      <ShieldAlert className={cn('h-4 w-4 shrink-0', critical ? 'text-destructive' : 'text-muted-foreground')} aria-hidden />
      <span className={cn('font-medium', critical ? 'text-destructive' : 'text-foreground')}>
        {level ? t(`level.${level}`) : t('noLevel')}
      </span>
      {critical && <span className="rounded bg-destructive px-1.5 py-0.5 font-bold uppercase text-destructive-foreground">{t('criticalLabel')}</span>}
      {level && conversation.case_level_source && (
        <span className="text-muted-foreground">{t(conversation.case_level_source === 'ai' ? 'sourceAi' : 'sourceHuman')}</span>
      )}
      {conversation.case_level_reason && (
        <span className="min-w-0 max-w-full truncate text-muted-foreground" title={conversation.case_level_reason}>
          {conversation.case_level_reason}
        </span>
      )}
      {canEdit && (
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={level ?? NONE}
            onValueChange={(value) => {
              const next = !value || value === NONE ? null : value
              if (next !== level) void save({ level: next })
            }}
            disabled={saving}
          >
            <SelectTrigger size="sm" aria-label={t('levelSelectLabel')} className="h-7 min-w-[7rem] text-xs">
              <span>{level ? level.toUpperCase() : t('noLevelShort')}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('noLevelShort')}</SelectItem>
              <SelectItem value="n1">{t('level.n1')}</SelectItem>
              <SelectItem value="n2">{t('level.n2')}</SelectItem>
              <SelectItem value="n3">{t('level.n3')}</SelectItem>
            </SelectContent>
          </Select>
          {level && (
            <Select
              value={sede ?? NONE}
              onValueChange={(value) => {
                const next = !value || value === NONE ? null : value
                if (next !== sede) void save({ level, sede: next })
              }}
              disabled={saving}
            >
              <SelectTrigger size="sm" aria-label={t('sedeSelectLabel')} className="h-7 min-w-[8rem] text-xs">
                <span className="truncate">{sede ?? t('sedeUnknown')}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('sedeUnknown')}</SelectItem>
                {sedeOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  )
}
