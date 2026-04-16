import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  statSync,
  readdirSync
} from 'node:fs'
import { join } from 'node:path'
import { canonicalProfileUrlKey } from '@core/linkedin-url'
import { userDataDir } from './user-data-path'
import { appLog } from './app-log'

export type LogStatus =
  | 'sent'
  | 'skipped'
  | 'error'
  | 'rate_limited'
  | 'already_connected'
  | 'dry_run'
  | 'info'

export type OutreachEntryKind = 'connection_invite' | 'followup_dm'
type HistoryEventType = 'outreach' | 'outreach_stage' | 'prospects_search' | 'jobs_search' | 'jobs_screen'
export type LoggedStageStatus = 'started' | 'completed' | 'blocked' | 'failed' | 'skipped'

interface LoggedProspectResult {
  profileUrl: string
  name?: string
  firstName?: string
  company?: string
  headline?: string
}

interface LoggedJobResult {
  title: string
  company: string
  location: string
  jobUrl: string
  postedDate?: string
  description?: string
  score?: number
  titleFit?: number
  seniorityMatch?: number
  locationFit?: number
  companyFit?: number
  reason?: string
  nextStep?: string
}

interface LoggedQueryResult {
  query: string
  count: number
}

export interface OutreachLogEntry {
  profileUrl: string
  name?: string
  company?: string
  variant?: string
  message?: string
  timestamp: string
  status: LogStatus
  detail: string
  executionId?: string
  logChannel?: string
  entryKind?: OutreachEntryKind
  sourceExecutionId?: string
  sourceLogChannel?: string
  eventType?: HistoryEventType
  summary?: string
  searchQuery?: string
  searchUrl?: string
  location?: string
  criteria?: string
  resultCount?: number
  people?: LoggedProspectResult[]
  jobs?: LoggedJobResult[]
  queryResults?: LoggedQueryResult[]
  profileSource?: 'settings' | 'linkedin_profile' | 'none'
  stageCode?: string
  stageLabel?: string
  stageStatus?: LoggedStageStatus
}

interface CompletedProfileLedger {
  keys: string[]
}

function logsDir(): string {
  const d = join(userDataDir(), 'logs')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function logArchiveDir(): string {
  const d = join(logsDir(), 'archive')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function mainLogPath(): string {
  return join(logsDir(), 'outreach.jsonl')
}

function archivedLogPaths(): string[] {
  if (!existsSync(logArchiveDir())) return []
  return readdirSync(logArchiveDir())
    .filter((name) => /^outreach-archive-.*\.jsonl$/i.test(name))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => join(logArchiveDir(), name))
}

function allLogPaths(): string[] {
  const current = mainLogPath()
  return [...archivedLogPaths(), current].filter((path) => existsSync(path))
}

function dayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function legacySentTodayPath(): string {
  return join(logsDir(), `sent-${dayKey()}.json`)
}

function sentTodayPath(kind: OutreachEntryKind = 'connection_invite'): string {
  return join(logsDir(), `sent-${kind}-${dayKey()}.json`)
}

function completedProfilesPath(): string {
  return join(logsDir(), 'completed-profile-keys.json')
}

interface SentToday {
  date: string
  urls: string[]
}

export function loadSentToday(kind: OutreachEntryKind = 'connection_invite'): SentToday {
  const p = sentTodayPath(kind)
  const legacy = kind === 'connection_invite' ? legacySentTodayPath() : null
  const source = existsSync(p) ? p : legacy && existsSync(legacy) ? legacy : null
  if (!source) return { date: dayKey(), urls: [] }
  try {
    const j = JSON.parse(readFileSync(source, 'utf8')) as SentToday
    if (j.date !== dayKey()) return { date: dayKey(), urls: [] }
    return j
  } catch (e) {
    appLog.debug('[loa-logger] loadSentToday parse failed', e instanceof Error ? e.message : String(e))
    return { date: dayKey(), urls: [] }
  }
}

export function appendSentToday(profileUrl: string, kind: OutreachEntryKind = 'connection_invite'): void {
  const st = loadSentToday(kind)
  if (!st.urls.includes(profileUrl)) st.urls.push(profileUrl)
  try {
    writeFileSync(sentTodayPath(kind), JSON.stringify(st, null, 2), 'utf8')
  } catch (e) {
    appLog.error('[loa-logger] appendSentToday write failed:', e)
  }
}

export function todayCount(kind?: OutreachEntryKind): number {
  if (kind) return loadSentToday(kind).urls.length
  return loadSentToday('connection_invite').urls.length + loadSentToday('followup_dm').urls.length
}

export function thisWeekConnectionCount(): number {
  const dir = logsDir()
  let total = 0
  for (let daysAgo = 0; daysAgo < 7; daysAgo++) {
    const d = new Date()
    d.setDate(d.getDate() - daysAgo)
    const key = d.toISOString().slice(0, 10)
    const p = join(dir, `sent-connection_invite-${key}.json`)
    if (!existsSync(p)) continue
    try {
      const j = JSON.parse(readFileSync(p, 'utf8')) as SentToday
      if (j.date === key) total += j.urls.length
    } catch (e) {
      appLog.debug('[loa-logger] thisWeekConnectionCount day file parse failed', e instanceof Error ? e.message : String(e))
      continue
    }
  }
  return total
}

const MAX_LOG_LINES = 5000

export function appendMainLog(entry: OutreachLogEntry): void {
  const line = JSON.stringify(entry) + '\n'
  const logPath = mainLogPath()
  try {
    const { appendFile } = require('node:fs/promises') as typeof import('node:fs/promises')
    appendFile(logPath, line, 'utf8').catch((e: unknown) => {
      appLog.debug('[loa-logger] async append failed', e instanceof Error ? e.message : String(e))
    })
    if (Math.random() < 0.02) rotateLogIfNeeded(logPath)
  } catch (e) {
    appLog.error('[loa-logger] appendMainLog write failed:', e)
  }
  _logCache = null
  if (entry.entryKind !== 'followup_dm' && (entry.status === 'sent' || entry.status === 'already_connected')) {
    rememberCompletedProfileUrl(entry.profileUrl)
  }
}

function rotateLogIfNeeded(logPath: string): void {
  try {
    if (!existsSync(logPath)) return
    const raw = readFileSync(logPath, 'utf8')
    const lines = raw.trim().split('\n')
    if (lines.length <= MAX_LOG_LINES) return
    const overflowCount = lines.length - MAX_LOG_LINES
    const archived = lines.slice(0, overflowCount)
    const trimmed = lines.slice(-MAX_LOG_LINES)
    if (archived.length > 0) {
      const archiveName = `outreach-archive-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}.jsonl`
      const archivePath = join(logArchiveDir(), archiveName)
      const archiveTmp = `${archivePath}.${randomUUID()}.tmp`
      writeFileSync(archiveTmp, archived.join('\n') + '\n', 'utf8')
      renameSync(archiveTmp, archivePath)
    }
    const mainTmp = `${logPath}.${randomUUID()}.tmp`
    writeFileSync(mainTmp, trimmed.join('\n') + '\n', 'utf8')
    renameSync(mainTmp, logPath)
  } catch (e) {
    appLog.debug('[loa-logger] rotateLogIfNeeded failed', e instanceof Error ? e.message : String(e))
  }
}

let _logCache: { entries: OutreachLogEntry[]; fileKey: string } | null = null

function loadAllLogLines(): OutreachLogEntry[] {
  const paths = allLogPaths()
  if (paths.length === 0) return []
  const fileKey = paths.map((path) => `${path}:${statSync(path).mtimeMs}`).join('|')
  if (_logCache && _logCache.fileKey === fileKey) return _logCache.entries
  const entries: OutreachLogEntry[] = []
  for (const path of paths) {
    const raw = readFileSync(path, 'utf8')
    const lines = raw.trim().split('\n').filter(Boolean)
    for (const l of lines) {
      try {
        entries.push(JSON.parse(l) as OutreachLogEntry)
      } catch (e) {
        appLog.debug('[loa-logger] skip malformed log line', e instanceof Error ? e.message : String(e))
      }
    }
  }
  _logCache = { entries, fileKey }
  return entries
}

export function loadLogHistory(): OutreachLogEntry[] {
  return loadAllLogLines()
}

export function loadRecentLogLines(max = 200): OutreachLogEntry[] {
  return loadAllLogLines().slice(-max)
}

export function readMainLogText(): string {
  const paths = allLogPaths()
  if (paths.length === 0) return ''
  try {
    return paths
      .map((path) => readFileSync(path, 'utf8'))
      .filter(Boolean)
      .join('')
  } catch (e) {
    appLog.debug('[loa-logger] readMainLogText failed', e instanceof Error ? e.message : String(e))
    return ''
  }
}

export function clearMainLog(): { ok: true; cleared: number } {
  const paths = allLogPaths()
  const currentPath = mainLogPath()
  let cleared = 0
  for (const path of paths) {
    try {
      const raw = readFileSync(path, 'utf8')
      cleared = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean).length + cleared
    } catch (e) {
      appLog.debug('[loa-logger] clearMainLog count read failed', e instanceof Error ? e.message : String(e))
    }
    try {
      if (path === currentPath) writeFileSync(path, '', 'utf8')
      else unlinkSync(path)
    } catch (e) {
      appLog.debug('[loa-logger] clearMainLog path clear failed', e instanceof Error ? e.message : String(e))
    }
  }
  _logCache = null
  return { ok: true as const, cleared }
}

function loadCompletedProfileKeysLedger(): Set<string> {
  const p = completedProfilesPath()
  if (!existsSync(p)) return new Set<string>()
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as CompletedProfileLedger
    if (!Array.isArray(raw.keys)) return new Set<string>()
    return new Set(
      raw.keys
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean)
    )
  } catch (e) {
    appLog.debug('[loa-logger] loadCompletedProfileKeysLedger parse failed', e instanceof Error ? e.message : String(e))
    return new Set<string>()
  }
}

function saveCompletedProfileKeysLedger(keys: Set<string>): void {
  try {
    const payload: CompletedProfileLedger = { keys: [...keys] }
    writeFileSync(completedProfilesPath(), JSON.stringify(payload, null, 2), 'utf8')
  } catch (e) {
    appLog.error('[loa-logger] saveCompletedProfileKeysLedger write failed:', e)
  }
}

function rememberCompletedProfileUrl(profileUrl: string): void {
  const key = canonicalProfileUrlKey(profileUrl)
  if (!key) return
  const keys = loadCompletedProfileKeysLedger()
  if (keys.has(key)) return
  keys.add(key)
  saveCompletedProfileKeysLedger(keys)
}

export function loadCompletedConnectionInviteProfileKeys(): Set<string> {
  const done = loadCompletedProfileKeysLedger()
  let ledgerUpdated = false
  for (const entry of loadAllLogLines()) {
    if (entry.entryKind === 'followup_dm') continue
    if (entry.status !== 'sent' && entry.status !== 'already_connected') continue
    const key = canonicalProfileUrlKey(entry.profileUrl)
    if (!key || done.has(key)) continue
    done.add(key)
    ledgerUpdated = true
  }
  if (ledgerUpdated) saveCompletedProfileKeysLedger(done)
  return done
}

export function loadRecentConnectionInvites(max = 400): OutreachLogEntry[] {
  const rows = loadRecentLogLines(max).filter((e) => e.status === 'sent' && e.entryKind !== 'followup_dm')

  const out: OutreachLogEntry[] = []
  const seen = new Set<string>()
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!
    const key = canonicalProfileUrlKey(row.profileUrl) || row.profileUrl
    if (seen.has(key)) continue
    seen.add(key)
    out.unshift(row)
  }
  return out
}
