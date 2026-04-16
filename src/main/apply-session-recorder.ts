import { existsSync, mkdirSync, appendFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { userDataDir } from './user-data-path'
import { appLog } from './app-log'

type SessionEvent = {
  t: string
  stage: string
  elapsedMs?: number
  stepMs?: number
  sessionId?: number
  data: Record<string, unknown>
  snapshot?: string
}

type ActiveSession = {
  id: number
  filePath: string
  events: number
  startMs: number
  vendor?: string
  jobTitle?: string
  company?: string
}

let activeSession: ActiveSession | null = null

function sessionsDir(): string {
  const dir = join(userDataDir(), 'logs', 'sessions')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function sessionFileName(sessionId: number): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `session-${sessionId}-${ts}.jsonl`
}

export function startSessionRecording(sessionId: number, meta: { jobUrl?: string; jobTitle?: string; company?: string }): void {
  if (activeSession) {
    appLog.warn('[session-recorder] ending previous session before starting new one', { previousId: activeSession.id, newId: sessionId })
    endSessionRecording('replaced_by_new_session')
  }
  pruneSessionLogs()
  const filePath = join(sessionsDir(), sessionFileName(sessionId))
  activeSession = {
    id: sessionId,
    filePath,
    events: 0,
    startMs: Date.now(),
    vendor: extractVendorFromUrl(meta.jobUrl || ''),
    jobTitle: meta.jobTitle,
    company: meta.company
  }
  recordEvent({
    t: new Date().toISOString(),
    stage: 'session:start',
    sessionId,
    data: { ...meta, vendor: activeSession.vendor }
  })
}

export function recordEvent(event: SessionEvent): void {
  if (!activeSession) return
  try {
    appendFileSync(activeSession.filePath, JSON.stringify(event) + '\n', 'utf8')
    activeSession.events++
  } catch (e) {
    appLog.warn('[session-recorder] write failed', e instanceof Error ? e.message : String(e))
  }
}

export function endSessionRecording(outcome: string, extra: Record<string, unknown> = {}): void {
  if (!activeSession) return
  const durationMs = Date.now() - activeSession.startMs
  const summary = {
    sessionId: activeSession.id,
    vendor: activeSession.vendor,
    jobTitle: activeSession.jobTitle,
    company: activeSession.company,
    outcome,
    durationMs,
    totalEvents: activeSession.events + 1,
    ...extra
  }
  recordEvent({
    t: new Date().toISOString(),
    stage: 'session:end',
    sessionId: activeSession.id,
    elapsedMs: durationMs,
    data: summary
  })
  appLog.info('[session-recorder] Session complete', {
    file: activeSession.filePath.split('/').slice(-1)[0],
    ...summary
  })
  activeSession = null
}

export function isRecording(): boolean {
  return activeSession !== null
}

const MAX_SESSION_FILES = 200
const MAX_SESSION_DIR_BYTES = 500 * 1024 * 1024 // 500 MB

function pruneSessionLogs(): void {
  try {
    const dir = sessionsDir()
    const files = readdirSync(dir)
      .filter(f => f.startsWith('session-') && f.endsWith('.jsonl'))
      .map(f => {
        const p = join(dir, f)
        const st = statSync(p)
        return { name: f, path: p, mtime: st.mtimeMs, size: st.size }
      })
      .sort((a, b) => a.mtime - b.mtime)

    // Prune by count
    while (files.length > MAX_SESSION_FILES) {
      const oldest = files.shift()!
      unlinkSync(oldest.path)
      appLog.info('[session-recorder] pruned old session log', { file: oldest.name })
    }

    // Prune by total size
    let totalSize = files.reduce((sum, f) => sum + f.size, 0)
    while (totalSize > MAX_SESSION_DIR_BYTES && files.length > 0) {
      const oldest = files.shift()!
      unlinkSync(oldest.path)
      totalSize -= oldest.size
      appLog.info('[session-recorder] pruned session log (size limit)', { file: oldest.name })
    }
  } catch (e) { appLog.warn('[session-recorder] prune failed', e instanceof Error ? e.message : String(e)) }
}

const VENDOR_PATTERNS: [string, string][] = [
  ['greenhouse', 'greenhouse'], ['lever', 'lever'],
  ['workday', 'workday'], ['myworkdayjobs', 'workday'],
  ['ashby', 'ashby'], ['smartrecruiters', 'smartrecruiters'],
  ['bamboohr', 'bamboohr'], ['icims', 'icims'],
  ['taleo', 'taleo'], ['eightfold', 'eightfold'],
  ['jazz', 'jazzhr'], ['breezy', 'breezyhr'],
  ['teamtailor', 'teamtailor'], ['homerun', 'homerun']
]

function extractVendorFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase()
    for (const [pattern, vendor] of VENDOR_PATTERNS) {
      if (host.includes(pattern)) return vendor
    }
    return host.split('.').slice(-2, -1)[0] || 'unknown'
  } catch (e) {
    appLog.debug('[apply-session-recorder] extractVendorFromUrl failed', e instanceof Error ? e.message : String(e))
    return 'unknown'
  }
}
