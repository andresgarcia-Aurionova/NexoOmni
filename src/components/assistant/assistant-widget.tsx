'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { BookOpen, ChevronDown, Download, LoaderCircle, MessageCircle, Plus, Printer, Send, Trash2, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { hasMinRole } from '@/lib/auth/roles'
import {
  AssistantReportDataSchema,
  type AssistantReportChannel,
  type AssistantReportSectionKey,
  type AssistantReportWarning,
} from '@/lib/assistant/report-types'
import {
  assistantReportCsv,
  assistantReportExcelXml,
  assistantReportFilename,
  assistantReportPrintHtml,
  type AssistantReportExportLabels,
} from '@/lib/assistant/report-export'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface Thread {
  id: string
  title: string
  created_at: string
  updated_at: string
}

interface Source {
  kind: 'platform_manual' | 'account_data' | 'account_knowledge'
  title: string
  href?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources: unknown
  report_data: unknown
  created_at: string
}

const SOURCE_KINDS = new Set<Source['kind']>([
  'platform_manual',
  'account_data',
  'account_knowledge',
])

function readSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Source =>
    typeof item === 'object' &&
    item !== null &&
    SOURCE_KINDS.has((item as Source).kind) &&
    typeof (item as Source).title === 'string' &&
    (typeof (item as Source).href === 'string' || (item as Source).href === undefined)
  )
}

function responseErrorCode(body: unknown): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    typeof body.code === 'string'
  ) {
    return body.code
  }
  return 'assistant_failed'
}

function readReportData(value: unknown) {
  const parsed = AssistantReportDataSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function AssistantWidget() {
  const t = useTranslations('Assistant')
  const locale = useLocale()
  const { accountRole, profileLoading } = useAuth()
  const [open, setOpen] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [threads, setThreads] = useState<Thread[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loadingThreads, setLoadingThreads] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const selectedThreadIdRef = useRef<string | null>(null)
  const reportLabels: AssistantReportExportLabels = {
    language: locale,
    title: t('report.title'),
    period: t('report.period'),
    channel: t('report.channel'),
    agent: t('report.agent'),
    agentFiltered: t('report.agentFiltered'),
    filterNone: t('report.filterNone'),
    warningsTitle: t('report.warningsTitle'),
    sectionTitles: {
      conversations: t('report.sections.conversations'),
      agents: t('report.sections.agents'),
      sales: t('report.sections.sales'),
      appointments: t('report.sections.appointments'),
      agendapro: t('report.sections.agendapro'),
      broadcasts: t('report.sections.broadcasts'),
      calls: t('report.sections.calls'),
      intelligence: t('report.sections.intelligence'),
      memory: t('report.sections.memory'),
      contacts: t('report.sections.contacts'),
      credits: t('report.sections.credits'),
      billing: t('report.sections.billing'),
      ai_usage: t('report.sections.ai_usage'),
    } satisfies Record<AssistantReportSectionKey, string>,
    channelTitles: {
      whatsapp: t('report.values.whatsapp'),
      facebook: t('report.values.facebook'),
      instagram: t('report.values.instagram'),
      tiktok: t('report.values.tiktok'),
      yeastar_live_chat: t('report.values.yeastar_live_chat'),
      yeastar_voice: t('report.values.yeastar_voice'),
    } satisfies Record<AssistantReportChannel, string>,
    columnTitles: {
      channel: t('report.columns.channel'),
      status: t('report.columns.status'),
      agent: t('report.columns.agent'),
      conversations: t('report.columns.conversations'),
      currency: t('report.columns.currency'),
      deals: t('report.columns.deals'),
      value: t('report.columns.value'),
      appointments: t('report.columns.appointments'),
      status_id: t('report.columns.status_id'),
      bookings: t('report.columns.bookings'),
      broadcasts: t('report.columns.broadcasts'),
      recipients: t('report.columns.recipients'),
      sent: t('report.columns.sent'),
      delivered: t('report.columns.delivered'),
      read: t('report.columns.read'),
      replied: t('report.columns.replied'),
      failed: t('report.columns.failed'),
      direction: t('report.columns.direction'),
      transcription_status: t('report.columns.transcription_status'),
      calls: t('report.columns.calls'),
      duration_seconds: t('report.columns.duration_seconds'),
      sentiment: t('report.columns.sentiment'),
      analyses: t('report.columns.analyses'),
      average_sentiment_score: t('report.columns.average_sentiment_score'),
      average_qa_score: t('report.columns.average_qa_score'),
      metric: t('report.columns.metric'),
      count: t('report.columns.count'),
      average_opportunity_score: t('report.columns.average_opportunity_score'),
      month: t('report.columns.month'),
      new_contacts: t('report.columns.new_contacts'),
      activity: t('report.columns.activity'),
      entry_type: t('report.columns.entry_type'),
      operations: t('report.columns.operations'),
      credits: t('report.columns.credits'),
      package: t('report.columns.package'),
      paid_checkouts: t('report.columns.paid_checkouts'),
      total_mxn: t('report.columns.total_mxn'),
      pending: t('report.columns.pending'),
      prompt_tokens: t('report.columns.prompt_tokens'),
      completion_tokens: t('report.columns.completion_tokens'),
      total_tokens: t('report.columns.total_tokens'),
    },
    warningTitles: {
      partial_data: t('report.warnings.partial_data'),
      admin_required: t('report.warnings.admin_required'),
      feature_unavailable: t('report.warnings.feature_unavailable'),
      channel_filter_partial: t('report.warnings.channel_filter_partial'),
      agent_filter_partial: t('report.warnings.agent_filter_partial'),
      agent_not_found: t('report.warnings.agent_not_found'),
      agent_ambiguous: t('report.warnings.agent_ambiguous'),
      current_snapshot: t('report.warnings.current_snapshot'),
    } satisfies Record<AssistantReportWarning, string>,
    valueTitles: {
      whatsapp: t('report.values.whatsapp'),
      facebook: t('report.values.facebook'),
      instagram: t('report.values.instagram'),
      tiktok: t('report.values.tiktok'),
      yeastar_live_chat: t('report.values.yeastar_live_chat'),
      yeastar_voice: t('report.values.yeastar_voice'),
      open: t('report.values.open'),
      pending: t('report.values.pending'),
      closed: t('report.values.closed'),
      active: t('report.values.active'),
      won: t('report.values.won'),
      lost: t('report.values.lost'),
      scheduled: t('report.values.scheduled'),
      confirmed: t('report.values.confirmed'),
      completed: t('report.values.completed'),
      cancelled: t('report.values.cancelled'),
      no_show: t('report.values.no_show'),
      draft: t('report.values.draft'),
      sending: t('report.values.sending'),
      sent: t('report.values.sent'),
      failed: t('report.values.failed'),
      credited: t('report.values.credited'),
      positive: t('report.values.positive'),
      neutral: t('report.values.neutral'),
      negative: t('report.values.negative'),
      mixed: t('report.values.mixed'),
      inbound: t('report.values.inbound'),
      outbound: t('report.values.outbound'),
      internal: t('report.values.internal'),
      unknown: t('report.values.unknown'),
      processing: t('report.values.processing'),
      unavailable: t('report.values.unavailable'),
      assistant: t('report.values.assistant'),
      current_balance: t('report.values.current_balance'),
      overdue_commitments: t('report.values.overdue_commitments'),
      unassigned: t('report.values.unassigned'),
      other: t('report.values.other'),
      entrepreneur: t('report.values.entrepreneur'),
      commercial_pro: t('report.values.commercial_pro'),
      corporate: t('report.values.corporate'),
      usage: t('report.values.usage'),
      purchase: t('report.values.purchase'),
      adjustment: t('report.values.adjustment'),
      refund: t('report.values.refund'),
      expiration: t('report.values.expiration'),
      whatsapp_call: t('report.values.whatsapp_call'),
      auto_reply: t('report.values.auto_reply'),
      report: t('report.values.report'),
      call_summary: t('report.values.call_summary'),
      voice_transcription: t('report.values.voice_transcription'),
      image_description: t('report.values.image_description'),
      embeddings: t('report.values.embeddings'),
      credential_test: t('report.values.credential_test'),
      analysis: t('report.values.analysis'),
    },
  }

  const selectThread = useCallback((id: string | null) => {
    selectedThreadIdRef.current = id
    setThreadId(id)
  }, [])

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true)
    try {
      const response = await fetch('/api/ai/assistant')
      const body = await response.json()
      if (!response.ok) {
        if (response.status === 403) setUnavailable(true)
        throw new Error(response.status === 429 ? 'rate_limited' : responseErrorCode(body))
      }
      const nextThreads = Array.isArray(body.threads) ? body.threads as Thread[] : []
      setThreads(nextThreads)
      return nextThreads
    } finally {
      setLoadingThreads(false)
    }
  }, [])

  const loadMessages = useCallback(async (id: string) => {
    setLoadingMessages(true)
    try {
      const response = await fetch(`/api/ai/assistant?thread_id=${encodeURIComponent(id)}`)
      const body = await response.json()
      if (!response.ok) {
        if (response.status === 403) setUnavailable(true)
        throw new Error(response.status === 429 ? 'rate_limited' : responseErrorCode(body))
      }
      setThreads(Array.isArray(body.threads) ? body.threads as Thread[] : [])
      setMessages(Array.isArray(body.messages) ? body.messages as Message[] : [])
      selectThread(id)
    } finally {
      setLoadingMessages(false)
    }
  }, [selectThread])

  const errorMessage = useCallback((value: unknown) => {
    const code = value instanceof Error ? value.message : 'assistant_failed'
    switch (code) {
      case 'credits_exhausted':
        return t('errors.credits')
      case 'ai_not_configured':
        return t('errors.notConfigured')
      case 'timeout':
        return t('errors.timeout')
      case 'rate_limited':
        return t('errors.rateLimit')
      case 'turn_pending':
        return t('errors.pending')
      case 'invalid_report_request':
        return t('errors.invalidReport')
      default:
        return t('errors.generic')
    }
  }, [t])

  function downloadReport(report: NonNullable<ReturnType<typeof readReportData>>, format: 'csv' | 'xls' | 'pdf') {
    if (format === 'pdf') {
      const html = assistantReportPrintHtml(report, reportLabels)
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      const printWindow = window.open(url, '_blank')
      if (!printWindow) {
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
        setError(t('report.popupBlocked'))
        return
      }
      printWindow.opener = null
      const print = () => {
        printWindow.focus()
        printWindow.print()
      }
      if (printWindow.document.readyState === 'complete') print()
      else printWindow.addEventListener('load', print, { once: true })
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return
    }

    const content = format === 'csv'
      ? assistantReportCsv(report, reportLabels)
      : assistantReportExcelXml(report, reportLabels)
    const blob = new Blob(
      [content],
      { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.ms-excel;charset=utf-8' }
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = assistantReportFilename(report, format)
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  function displayReportValue(value: string | number | null) {
    if (typeof value !== 'string') return value ?? t('report.filterNone')
    return reportLabels.valueTitles[value] ?? value
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  useEffect(() => {
    if (!open) return
    let active = true
    void (async () => {
      try {
        const loaded = await loadThreads()
        if (!active) return
        const selectedThreadId = selectedThreadIdRef.current
        if (selectedThreadId && loaded.some((thread) => thread.id === selectedThreadId)) {
          await loadMessages(selectedThreadId)
        } else if (loaded[0]) {
          await loadMessages(loaded[0].id)
        }
      } catch (loadError) {
        if (active) setError(errorMessage(loadError))
      }
    })()
    return () => {
      active = false
    }
  }, [open, loadMessages, loadThreads, errorMessage])

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = input.trim()
    if (!content || sending) return

    const optimistic: Message = {
      id: `local-${crypto.randomUUID()}`,
      role: 'user',
      content,
      sources: [],
      report_data: null,
      created_at: new Date().toISOString(),
    }
    setMessages((current) => [...current, optimistic])
    setInput('')
    setError(null)
    setSending(true)

    try {
      const response = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: threadId ?? undefined,
          client_message_id: crypto.randomUUID(),
          content,
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        if (response.status === 403) setUnavailable(true)
        throw new Error(response.status === 429 ? 'rate_limited' : responseErrorCode(body))
      }
      const nextThreadId = body.thread_id as string
      await loadMessages(nextThreadId)
      setThreads(await loadThreads())
    } catch (sendError) {
      setError(errorMessage(sendError))
    } finally {
      setSending(false)
    }
  }

  async function deleteThread() {
    if (!threadId || !window.confirm(t('confirmDelete'))) return
    setError(null)
    try {
      const response = await fetch(`/api/ai/assistant?thread_id=${encodeURIComponent(threadId)}`, {
        method: 'DELETE',
      })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(response.status === 429 ? 'rate_limited' : responseErrorCode(body))
      }
      setMessages([])
      selectThread(null)
      const remaining = await loadThreads()
      if (remaining[0]) await loadMessages(remaining[0].id)
    } catch (deleteError) {
      setError(errorMessage(deleteError))
    }
  }

  if (profileLoading || unavailable || !accountRole || !hasMinRole(accountRole, 'supervisor')) {
    return null
  }

  return (
    <>
      {open && (
        <section
          aria-label={t('title')}
          className="bg-background fixed right-4 bottom-20 z-50 flex h-[min(680px,calc(100dvh-7rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border shadow-xl"
        >
          <header className="bg-primary text-primary-foreground flex items-center gap-2 px-4 py-3">
            <MessageCircle aria-hidden="true" className="size-5" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold">{t('title')}</h2>
              <p className="text-primary-foreground/80 text-xs">{t('creditNotice')}</p>
            </div>
            <Button
              aria-label={t('newConversation')}
              className="text-primary-foreground hover:bg-primary-foreground/15"
              onClick={() => {
                selectThread(null)
                setMessages([])
                setError(null)
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Plus aria-hidden="true" />
            </Button>
            <Button
              aria-label={t('close')}
              className="text-primary-foreground hover:bg-primary-foreground/15"
              onClick={() => setOpen(false)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" />
            </Button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b p-2">
              <label className="sr-only" htmlFor="assistant-thread">{t('history')}</label>
              <select
                className="bg-background w-full rounded-md border px-2 py-1.5 text-sm"
                id="assistant-thread"
                onChange={(event) => {
                  const value = event.target.value
                  setError(null)
                  if (!value) {
                    selectThread(null)
                    setMessages([])
                  } else {
                    void loadMessages(value).catch((loadError) => setError(errorMessage(loadError)))
                  }
                }}
                value={threadId ?? ''}
              >
                <option value="">{t('newConversation')}</option>
                {threads.map((thread) => (
                  <option key={thread.id} value={thread.id}>{thread.title}</option>
                ))}
              </select>
              {threadId && (
                <div className="mt-1 flex justify-end">
                  <Button onClick={() => void deleteThread()} size="sm" type="button" variant="ghost">
                    <Trash2 aria-hidden="true" />
                    {t('deleteConversation')}
                  </Button>
                </div>
              )}
            </div>

            <div aria-live="polite" className="flex-1 space-y-3 overflow-y-auto p-3">
              {loadingThreads || loadingMessages ? (
                <p className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  {t('loading')}
                </p>
              ) : messages.length === 0 ? (
                <p className="text-muted-foreground px-2 py-6 text-center text-sm">{t('empty')}</p>
              ) : messages.map((message) => (
                <article
                  className={message.role === 'user'
                    ? 'bg-primary text-primary-foreground ml-8 rounded-lg px-3 py-2 text-sm'
                    : 'bg-muted mr-4 rounded-lg px-3 py-2 text-sm'}
                  key={message.id}
                >
                  <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  {message.role === 'assistant' && (() => {
                    const report = readReportData(message.report_data)
                    if (!report) return null
                    return (
                      <section aria-label={reportLabels.title} className="mt-3 border-t border-current/10 pt-3">
                        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          <span>{reportLabels.period}: {report.from} – {report.to}</span>
                          <span>{reportLabels.channel}: {report.filters.channel
                            ? reportLabels.channelTitles[report.filters.channel]
                            : reportLabels.filterNone}</span>
                          <span>{reportLabels.agent}: {report.filters.agent_selected
                            ? reportLabels.agentFiltered
                            : reportLabels.filterNone}</span>
                        </div>
                        {report.warnings.length > 0 && (
                          <ul className="mb-2 list-disc space-y-1 pl-4 text-xs">
                            {report.warnings.map((warning) => (
                              <li key={warning}>{reportLabels.warningTitles[warning]}</li>
                            ))}
                          </ul>
                        )}
                        <div className="space-y-3">
                          {report.sections.map((item) => (
                            <div key={item.key}>
                              <h3 className="mb-1 text-xs font-semibold">{reportLabels.sectionTitles[item.key]}</h3>
                              <div className="max-h-40 overflow-auto rounded border">
                                <table className="w-full text-left text-xs">
                                  <thead className="bg-background sticky top-0">
                                    <tr>
                                      {item.columns.map((column) => (
                                        <th className="whitespace-nowrap px-2 py-1 font-medium" key={column}>
                                          {reportLabels.columnTitles[column] ?? column}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {item.rows.length === 0 ? (
                                      <tr><td className="px-2 py-1" colSpan={item.columns.length}>{t('report.empty')}</td></tr>
                                    ) : item.rows.map((row, rowIndex) => (
                                      <tr className="border-t" key={`${item.key}-${rowIndex}`}>
                                        {row.map((cell, cellIndex) => (
                                          <td className="whitespace-nowrap px-2 py-1" key={`${item.key}-${rowIndex}-${cellIndex}`}>
                                            {displayReportValue(cell)}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Button onClick={() => downloadReport(report, 'csv')} size="sm" type="button" variant="outline">
                            <Download aria-hidden="true" />{t('report.exportCsv')}
                          </Button>
                          <Button onClick={() => downloadReport(report, 'xls')} size="sm" type="button" variant="outline">
                            <Download aria-hidden="true" />{t('report.exportExcel')}
                          </Button>
                          <Button onClick={() => downloadReport(report, 'pdf')} size="sm" type="button" variant="outline">
                            <Printer aria-hidden="true" />{t('report.exportPdf')}
                          </Button>
                        </div>
                      </section>
                    )
                  })()}
                  {message.role === 'assistant' && readSources(message.sources).length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-current/10 pt-2">
                      {readSources(message.sources).map((source, index) => (
                        <li key={`${source.href ?? source.title}-${index}`}>
                          {source.href ? (
                            <a
                              className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
                              href={source.href}
                              rel={source.href.startsWith('http') ? 'noreferrer' : undefined}
                              target={source.href.startsWith('http') ? '_blank' : undefined}
                            >
                              <BookOpen aria-hidden="true" className="size-3" />
                              {source.kind === 'platform_manual'
                                ? source.title
                                : t(`sourceKinds.${source.kind}`)}
                            </a>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs">
                            <BookOpen aria-hidden="true" className="size-3" />
                            {source.kind === 'platform_manual'
                              ? source.title
                              : t(`sourceKinds.${source.kind}`)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
              {sending && (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  {t('thinking')}
                </p>
              )}
              <div ref={messagesEndRef} />
            </div>

            {error && (
              <p className="text-destructive px-3 pb-2 text-sm" role="alert">{error}</p>
            )}
            <form className="border-t p-3" onSubmit={sendMessage}>
              <label className="sr-only" htmlFor="assistant-prompt">{t('messageLabel')}</label>
              <Textarea
                className="max-h-32 min-h-20 resize-y"
                disabled={sending}
                id="assistant-prompt"
                maxLength={4000}
                onChange={(event) => setInput(event.target.value)}
                placeholder={t('placeholder')}
                value={input}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">{t('readOnlyNotice')}</span>
                <Button disabled={!input.trim() || sending} size="sm" type="submit">
                  {sending
                    ? <LoaderCircle aria-hidden="true" className="animate-spin" />
                    : <Send aria-hidden="true" />}
                  {t('send')}
                </Button>
              </div>
            </form>
          </div>
        </section>
      )}

      <Button
        aria-expanded={open}
        aria-label={open ? t('close') : t('open')}
        className="fixed right-4 bottom-4 z-50 size-12 rounded-full shadow-lg"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open
          ? <ChevronDown aria-hidden="true" className="size-5" />
          : <MessageCircle aria-hidden="true" className="size-5" />}
      </Button>
    </>
  )
}
