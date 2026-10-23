'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BrainCircuit, ChevronDown, ChevronUp, ClipboardCheck, RefreshCw, Smile, Frown, Meh, MessageCircleQuestion } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Analysis = {
  summary: string | null
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed' | null
  sentiment_score: number | null
  next_best_action: string | null
  reasons: string[] | null
  qa_score: number | null
  qa_empathy_score: number | null
  qa_objection_handling_score: number | null
  qa_script_adherence_score: number | null
  qa_summary: string | null
  qa_findings: string[] | null
  intent: string | null
  urgency: 'low' | 'medium' | 'high' | 'critical' | null
  lead_temperature: 'cold' | 'warm' | 'hot' | null
  handoff_required: boolean | null
  recommended_department: string | null
  insights: {
    sub_intent?: string | null
    need?: string | null
    product_service?: string | null
    impact?: string | null
    expected_result?: string | null
    missing_information?: string[] | null
    handoff_reason?: string | null
    customer_context_update?: string[] | null
    commercial_opportunity?: boolean | null
  } | null
  analyzed_message_count: number
  analyzed_at: string | null
}

type AnalysisJob = {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'skipped_limit' | 'failed'
}

const urgencyMeta: Record<string, { label: string; className: string }> = {
  low: { label: 'Urgencia baja', className: 'text-muted-foreground' },
  medium: { label: 'Urgencia media', className: 'text-sky-500' },
  high: { label: 'Urgencia alta', className: 'text-amber-500' },
  critical: { label: 'Urgencia crítica', className: 'text-red-500' },
}

const temperatureMeta: Record<string, { label: string; className: string }> = {
  cold: { label: 'Lead frío', className: 'text-sky-500' },
  warm: { label: 'Lead tibio', className: 'text-amber-500' },
  hot: { label: 'Lead caliente', className: 'text-red-500' },
}

const sentimentMeta = {
  positive: { label: 'Positivo', icon: Smile, className: 'text-emerald-500' },
  neutral: { label: 'Neutral', icon: Meh, className: 'text-sky-500' },
  negative: { label: 'Negativo', icon: Frown, className: 'text-red-500' },
  mixed: { label: 'Mixto', icon: MessageCircleQuestion, className: 'text-amber-500' },
} as const

async function readApiResponse(
  response: Response,
  errors: { unexpectedPage: string; invalidResponse: string },
) {
  const body = await response.text()
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(errors.unexpectedPage)
  }
  try {
    return JSON.parse(body) as { analysis?: Analysis | null; error?: string; job?: AnalysisJob | null }
  } catch {
    throw new Error(errors.invalidResponse)
  }
}

export function ConversationIntelligence({ conversationId }: { conversationId: string }) {
  const t = useTranslations('Inbox.conversationIntelligence')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/ai/conversation-analysis/${conversationId}`)
      const data = await readApiResponse(response, { unexpectedPage: t('serverError'), invalidResponse: t('invalidResponse') })
      if (!response.ok) throw new Error(data.error ?? t('loadFailed'))
      setAnalysis(data.analysis ?? null)
      return data
    } finally {
      setLoading(false)
    }
  }, [conversationId, t])

  useEffect(() => {
    void load().catch(() => toast.error(t('loadFailed')))
  }, [load, t])

  const analyze = async () => {
    setRunning(true)
    try {
      const response = await fetch(`/api/ai/conversation-analysis/${conversationId}`, { method: 'POST' })
      const data = await readApiResponse(response, { unexpectedPage: t('serverError'), invalidResponse: t('invalidResponse') })
      if (!response.ok) throw new Error(data.error ?? t('failed'))
      if (!data.job) throw new Error(t('failed'))

      const jobId = data.job.id
      const deadline = Date.now() + 5 * 60_000
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 4_000))
        const statusResponse = await fetch(`/api/ai/conversation-analysis/${conversationId}`, { cache: 'no-store' })
        const statusData = await readApiResponse(statusResponse, { unexpectedPage: t('serverError'), invalidResponse: t('invalidResponse') })
        if (!statusResponse.ok) throw new Error(statusData.error ?? t('failed'))
        if (statusData.job?.id !== jobId) throw new Error(t('failed'))
        if (statusData.job.status === 'failed' || statusData.job.status === 'skipped_limit') {
          throw new Error(statusData.job.status === 'skipped_limit' ? t('limitReached') : t('failed'))
        }
        if (statusData.job.status === 'completed') {
          setAnalysis(statusData.analysis ?? null)
          setExpanded(true)
          toast.success(t('success'))
          return
        }
      }

      const latest = await load()
      setAnalysis(latest.analysis ?? null)
      toast.info(t('stillProcessing'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('failed'))
    } finally {
      setRunning(false)
    }
  }

  const meta = analysis?.sentiment ? sentimentMeta[analysis.sentiment] : null
  const Icon = meta?.icon ?? BrainCircuit
  const qaScore = analysis?.qa_score ?? null

  return (
    <section className="border-t border-border bg-card px-3 py-2 sm:px-4">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={cn('size-4 shrink-0', meta?.className ?? 'text-primary')} />
          <p className="truncate text-sm font-medium">Análisis IA</p>
          {meta ? <span className={cn('text-xs font-medium', meta.className)}>{meta.label}{analysis?.sentiment_score != null ? ` · ${analysis.sentiment_score}/100` : ''}</span> : null}
          {qaScore != null ? <span className={cn('inline-flex items-center gap-1 text-xs font-medium', qaScore < 50 ? 'text-red-500' : qaScore < 75 ? 'text-amber-500' : 'text-emerald-500')}><ClipboardCheck className="size-3" />QA {qaScore}/100</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => void analyze()} disabled={running || loading} aria-label={running ? t('analyzing') : analysis ? t('refresh') : t('analyze')} title={running ? t('analyzing') : undefined}>
            <RefreshCw className={cn('size-3.5', running && 'animate-spin')} />
            <span className="hidden sm:inline">{running ? t('analyzing') : analysis ? t('refresh') : t('analyze')}</span>
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? 'Ocultar análisis' : 'Mostrar análisis'} title={expanded ? 'Ocultar análisis' : 'Mostrar análisis'}>
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
        </div>
      </div>
      {expanded && (loading ? <p className="mt-2 text-xs text-muted-foreground">Cargando análisis…</p> : analysis ? <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
        <ClassificationRow analysis={analysis} />
        {analysis.summary ? <p><span className="font-medium text-foreground">Resumen:</span> {analysis.summary}</p> : null}
        {analysis.insights?.need ? <p><span className="font-medium text-foreground">Necesidad:</span> {analysis.insights.need}</p> : null}
        {analysis.insights?.product_service ? <p><span className="font-medium text-foreground">Producto/servicio:</span> {analysis.insights.product_service}</p> : null}
        {analysis.insights?.expected_result ? <p><span className="font-medium text-foreground">Resultado esperado:</span> {analysis.insights.expected_result}</p> : null}
        {analysis.next_best_action ? <p><span className="font-medium text-foreground">Siguiente acción:</span> {analysis.next_best_action}</p> : null}
        {analysis.insights?.missing_information?.length ? <p><span className="font-medium text-foreground">Falta por confirmar:</span> {analysis.insights.missing_information.join(' · ')}</p> : null}
        {analysis.handoff_required ? <p className="text-amber-500"><span className="font-medium">Requiere agente humano</span>{analysis.insights?.handoff_reason ? `: ${analysis.insights.handoff_reason}` : ''}{analysis.recommended_department ? ` → ${analysis.recommended_department}` : ''}</p> : null}
        {analysis.insights?.customer_context_update?.length ? <div><p className="font-medium text-foreground">Nuevo del cliente:</p><ul className="mt-0.5 list-disc space-y-0.5 pl-4">{analysis.insights.customer_context_update.map((fact, index) => <li key={`${index}-${fact}`}>{fact}</li>)}</ul></div> : null}
        {analysis.reasons?.length ? <p>{analysis.reasons.join(' · ')}</p> : null}
        {qaScore != null ? <div className="mt-3 rounded-md border border-border bg-muted/30 p-2.5"><p className="flex items-center gap-1.5 font-medium text-foreground"><ClipboardCheck className="size-3.5 text-primary" />Auditoría de calidad · {qaScore}/100</p><div className="mt-2 grid grid-cols-3 gap-2 text-center"><QaMetric label="Empatía" value={analysis.qa_empathy_score} /><QaMetric label="Objeciones" value={analysis.qa_objection_handling_score} /><QaMetric label="Guion" value={analysis.qa_script_adherence_score} /></div>{analysis.qa_summary ? <p className="mt-2">{analysis.qa_summary}</p> : null}{analysis.qa_findings?.length ? <ul className="mt-1.5 list-disc space-y-0.5 pl-4">{analysis.qa_findings.map((finding, index) => <li key={`${index}-${finding}`}>{finding}</li>)}</ul> : null}</div> : null}
      </div> : <p className="mt-2 text-xs text-muted-foreground">Genera un resumen, sentimiento y siguiente acción para este chat.</p>)}
    </section>
  )
}

function QaMetric({ label, value }: { label: string; value: number | null }) {
  return <div className="rounded bg-background px-1.5 py-1"><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-xs font-semibold text-foreground">{value == null ? '—' : `${value}/100`}</p></div>
}

function ClassificationRow({ analysis }: { analysis: Analysis }) {
  const urgency = analysis.urgency ? urgencyMeta[analysis.urgency] : null
  const temperature = analysis.lead_temperature ? temperatureMeta[analysis.lead_temperature] : null
  const chips: { key: string; label: string; className: string }[] = []
  if (analysis.intent) chips.push({ key: 'intent', label: analysis.intent, className: 'text-foreground' })
  if (analysis.insights?.sub_intent) chips.push({ key: 'sub', label: analysis.insights.sub_intent, className: 'text-muted-foreground' })
  if (urgency) chips.push({ key: 'urgency', label: urgency.label, className: urgency.className })
  if (temperature) chips.push({ key: 'temp', label: temperature.label, className: temperature.className })
  if (analysis.insights?.commercial_opportunity) chips.push({ key: 'opp', label: 'Oportunidad comercial', className: 'text-emerald-500' })
  if (analysis.recommended_department) chips.push({ key: 'dept', label: analysis.recommended_department, className: 'text-primary' })
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span key={chip.key} className={cn('rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium', chip.className)}>
          {chip.label}
        </span>
      ))}
    </div>
  )
}
