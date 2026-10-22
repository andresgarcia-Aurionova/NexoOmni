'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { BookOpen, ChevronDown, LoaderCircle, MessageCircle, Plus, Send, Trash2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { hasMinRole } from '@/lib/auth/roles'
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

export function AssistantWidget() {
  const t = useTranslations('Assistant')
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
      default:
        return t('errors.generic')
    }
  }, [t])

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
