// ---------------------------------------------------------------------------
// event-queue.ts — Reliable event delivery pipeline.
// Pattern: local JSONL write (crash-safe) → in-memory queue → batch POST
// with retry. Matches Segment/Amplitude SDK architecture.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { userDataDir } from './user-data-path'
import { getServiceConfig, isBackendConfigured } from './service-config'
import { getAuthHeaders } from './auth-service'
import { appLog } from './app-log'

// -- Types ------------------------------------------------------------------

export interface TrackedEvent {
  id: string
  event: string
  userId: string | null
  anonymousId: string
  sessionId: string
  timestamp: string
  properties: Record<string, unknown>
  appVersion: string
  platform: string
}

interface QueuedEvent extends TrackedEvent {
  retries: number
}

// -- Configuration ----------------------------------------------------------

const FLUSH_AT = 10          // batch size threshold
const FLUSH_INTERVAL = 30_000 // 30 seconds
const MAX_RETRIES = 3
const RETRY_DELAYS = [1000, 2000, 4000] // exponential backoff
const MAX_BATCH_SIZE = 50

// -- State ------------------------------------------------------------------

const queue: QueuedEvent[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null
let flushing = false
let _anonymousId: string | null = null
let _sessionId: string = randomUUID()

// -- Paths ------------------------------------------------------------------

function eventDir(): string {
  const d = join(userDataDir(), 'telemetry')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function eventsFilePath(): string {
  return join(eventDir(), 'events.jsonl')
}

function pendingFilePath(): string {
  return join(eventDir(), 'pending.jsonl')
}

function anonymousIdPath(): string {
  return join(eventDir(), 'anonymous-id')
}

// -- Anonymous ID -----------------------------------------------------------

export function getAnonymousId(): string {
  if (_anonymousId) return _anonymousId
  const path = anonymousIdPath()
  try {
    if (existsSync(path)) {
      const stored = readFileSync(path, 'utf8').trim()
      if (stored) {
        _anonymousId = stored
        return stored
      }
    }
  } catch { /* ignore */ }
  _anonymousId = randomUUID()
  try {
    writeFileSync(path, _anonymousId, 'utf8')
  } catch { /* best effort */ }
  return _anonymousId
}

export function getSessionId(): string {
  return _sessionId
}

// -- Local persistence (crash-safe) -----------------------------------------

function writeToLocalLog(event: TrackedEvent): void {
  try {
    appendFileSync(eventsFilePath(), JSON.stringify(event) + '\n', 'utf8')
  } catch (err) {
    appLog.debug('[event-queue] local write failed', err instanceof Error ? err.message : String(err))
  }
}

function writeToPendingLog(events: TrackedEvent[]): void {
  try {
    const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
    appendFileSync(pendingFilePath(), lines, 'utf8')
  } catch (err) {
    appLog.debug('[event-queue] pending log write failed', err instanceof Error ? err.message : String(err))
  }
}

function clearPendingLog(): void {
  try {
    writeFileSync(pendingFilePath(), '', 'utf8')
  } catch { /* best effort */ }
}

// -- Enqueue ----------------------------------------------------------------

export function enqueue(event: TrackedEvent): void {
  writeToLocalLog(event)
  queue.push({ ...event, retries: 0 })

  if (queue.length >= FLUSH_AT) {
    void flush()
  }
}

// -- Flush ------------------------------------------------------------------

async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return
  if (!isBackendConfigured()) return

  flushing = true
  const batch = queue.splice(0, MAX_BATCH_SIZE)

  // Write to pending log in case of crash during flush
  writeToPendingLog(batch)

  try {
    const ok = await sendBatch(batch)
    if (ok) {
      clearPendingLog()
    } else {
      // Re-queue failed events with incremented retry count
      for (const event of batch) {
        if (event.retries < MAX_RETRIES) {
          queue.unshift({ ...event, retries: event.retries + 1 })
        } else {
          appLog.debug('[event-queue] dropping event after max retries', { event: event.event, id: event.id })
        }
      }
    }
  } catch {
    // Re-queue all on network error
    for (const event of batch) {
      if (event.retries < MAX_RETRIES) {
        queue.unshift({ ...event, retries: event.retries + 1 })
      }
    }
  } finally {
    flushing = false
  }
}

async function sendBatch(events: TrackedEvent[]): Promise<boolean> {
  const config = getServiceConfig()
  const url = config.cloudFunctions.url
  if (!url) return false

  const endpoint = `${url}/trackEvents`

  // Single attempt — retry is handled at the queue level in flush()
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ events }),
    signal: AbortSignal.timeout(15_000),
  })

  if (res.ok) return true

  appLog.debug('[event-queue] batch rejected', { status: res.status, count: events.length })
  return false
}

// -- Startup replay ---------------------------------------------------------

export function replayPendingEvents(): void {
  try {
    const path = pendingFilePath()
    if (!existsSync(path)) return
    const content = readFileSync(path, 'utf8').trim()
    if (!content) return

    const lines = content.split('\n').filter(Boolean)
    let replayed = 0
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as TrackedEvent
        queue.push({ ...event, retries: 0 })
        replayed++
      } catch { /* skip malformed */ }
    }
    clearPendingLog()
    if (replayed > 0) {
      appLog.info('[event-queue] replayed pending events', { count: replayed })
    }
  } catch { /* ignore */ }
}

// -- Lifecycle --------------------------------------------------------------

export function startEventQueue(): void {
  replayPendingEvents()
  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL)
  appLog.info('[event-queue] started', { flushAt: FLUSH_AT, flushInterval: FLUSH_INTERVAL })
}

export async function stopEventQueue(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  // Force flush remaining events
  if (queue.length > 0) {
    flushing = false // Reset to allow final flush
    await flush()
  }
  appLog.info('[event-queue] stopped', { remaining: queue.length })
}

export function getQueueSize(): number {
  return queue.length
}
