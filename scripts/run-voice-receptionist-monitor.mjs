import WebSocket from 'ws'

const baseUrl = process.env.APP_URL?.replace(/\/$/, '')
const secret = process.env.AI_ANALYSIS_WORKER_SECRET

if (!baseUrl || !secret) {
  console.error('APP_URL and AI_ANALYSIS_WORKER_SECRET are required.')
  process.exit(1)
}

const active = new Map()
let stopped = false

async function requestJobs() {
  const response = await fetch(`${baseUrl}/api/internal/voice-receptionist-monitor`, {
    headers: { 'x-ai-worker-secret': secret },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Monitor jobs request failed: ${response.status} ${await response.text()}`)
  const payload = await response.json()
  return Array.isArray(payload.jobs) ? payload.jobs : []
}

async function publishEvent(job, event) {
  const response = await fetch(`${baseUrl}/api/internal/voice-receptionist-monitor`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ai-worker-secret': secret,
    },
    body: JSON.stringify({
      account_id: job.account_id,
      conversation_id: job.conversation_id,
      event,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Monitor event request failed: ${response.status}`)
}

function monitorKey(job) {
  return `${job.account_id}:${job.conversation_id}`
}

function openMonitor(job) {
  const key = monitorKey(job)
  if (active.has(key)) return
  const url = `wss://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(job.conversation_id)}/monitor`
  const socket = new WebSocket(url, { headers: { 'xi-api-key': job.api_key } })
  active.set(key, socket)

  socket.on('open', () => {
    console.info('[voice receptionist monitor] connected:', job.conversation_id)
  })
  socket.on('message', (raw) => {
    void (async () => {
      try {
        const event = JSON.parse(raw.toString())
        await publishEvent(job, event)
      } catch (error) {
        console.error('[voice receptionist monitor] event failed:', error)
      }
    })()
  })
  socket.on('error', (error) => {
    console.error('[voice receptionist monitor] socket error:', error)
  })
  socket.on('close', () => {
    if (active.get(key) === socket) active.delete(key)
  })
}

async function reconcile() {
  const jobs = await requestJobs()
  const desired = new Set(jobs.map(monitorKey))
  for (const [key, socket] of active) {
    if (!desired.has(key)) {
      socket.close(1000, 'conversation no longer active')
      active.delete(key)
    }
  }
  for (const job of jobs) openMonitor(job)
}

const interval = setInterval(() => {
  void reconcile().catch((error) => console.error('[voice receptionist monitor] reconcile failed:', error))
}, 3_000)
await reconcile().catch((error) => console.error('[voice receptionist monitor] initial reconcile failed:', error))

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopped) return
    stopped = true
    clearInterval(interval)
    for (const socket of active.values()) socket.close(1000, 'service shutting down')
  })
}

await new Promise(() => {})
