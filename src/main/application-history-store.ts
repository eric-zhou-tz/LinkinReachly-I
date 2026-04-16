import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { appLog } from './app-log'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type {
  ApplicationCoverLetterMeta,
  ApplicationInsights,
  ApplicationRecord,
  ApplicationRecordInput
} from '@core/application-types'
import { buildApplicationInsights, inferCompanySignals } from './application-history'
import { userDataDir } from './user-data-path'

const MAX_HISTORY_ITEMS = 10_000
const COMPACT_THRESHOLD = MAX_HISTORY_ITEMS + 500

/** Serialize history rewrites vs appends so a full-file rewrite cannot drop a concurrent append. */
let _historyWriteLock = false

const LEGACY_JSON_RELATIVE = join('config', 'application-history.json')

function logsDir(): string {
  const dir = join(userDataDir(), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function historyPath(): string {
  return join(logsDir(), 'applications.jsonl')
}

function legacyJsonArrayPath(): string {
  return join(logsDir(), 'applications.json')
}

function legacyHistoryPath(): string {
  return join(userDataDir(), LEGACY_JSON_RELATIVE)
}

function normalizeCoverLetterMeta(raw: unknown): ApplicationCoverLetterMeta | undefined {
  if (typeof raw !== 'object' || raw == null) return undefined
  const o = raw as Record<string, unknown>
  const mode = String(o.mode || '')
  if (mode !== 'static' && mode !== 'tailored' && mode !== 'generated') return undefined
  return {
    mode,
    fileBytes: typeof o.fileBytes === 'number' && Number.isFinite(o.fileBytes) ? o.fileBytes : undefined,
    model: typeof o.model === 'string' ? o.model.slice(0, 80) : undefined,
    promptVersion: typeof o.promptVersion === 'string' ? o.promptVersion.slice(0, 32) : undefined,
    templateSha256: typeof o.templateSha256 === 'string' ? o.templateSha256.slice(0, 64) : undefined
  }
}

const PIPELINE_STAGES = new Set<ApplicationRecord['pipelineStage']>([
  'saved',
  'applied',
  'outreach_sent',
  'response',
  'interview',
  'offer',
  'rejected',
  'ghosted'
])

function normalizePipelineStage(raw: unknown): ApplicationRecord['pipelineStage'] | undefined {
  const stage = String(raw || '').trim() as ApplicationRecord['pipelineStage']
  if (!stage) return undefined
  return PIPELINE_STAGES.has(stage) ? stage : undefined
}

function normalizeHiringTeam(raw: unknown): ApplicationRecord['hiringTeam'] | undefined {
  if (!Array.isArray(raw)) return undefined
  const normalized = raw
    .map((entry) => {
      if (typeof entry !== 'object' || entry == null) return null
      const row = entry as Record<string, unknown>
      const name = String(row.name || '').trim()
      const title = String(row.title || '').trim() || undefined
      const profileUrl = String(row.profileUrl || '').trim() || undefined
      if (!name && !profileUrl) return null
      return { name, title, profileUrl }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null)
  return normalized.length > 0 ? normalized : undefined
}

function normalizeStuckFieldLabels(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const labels = raw.map((label) => String(label || '').trim()).filter(Boolean)
  return labels.length > 0 ? labels : undefined
}

function normalizeRecord(raw: unknown): ApplicationRecord | null {
  if (typeof raw !== 'object' || raw == null) return null
  const record = raw as Partial<ApplicationRecord>
  const id = String(record.id || '').trim()
  const company = String(record.company || '').trim()
  const title = String(record.title || '').trim()
  const createdAt = String(record.createdAt || '').trim()
  const source = String(record.source || '').trim()
  const outcome = String(record.outcome || '').trim()
  if (!id || !company || !title || !createdAt || !source || !outcome) return null
  const sig = record.companySignals
  const companySignals =
    typeof sig === 'object' && sig != null
      ? {
          companyType: String((sig as ApplicationRecord['companySignals']).companyType || 'unknown').trim() || 'unknown',
          stage: String((sig as ApplicationRecord['companySignals']).stage || 'unknown').trim() || 'unknown',
          industry: String((sig as ApplicationRecord['companySignals']).industry || 'unknown').trim() || 'unknown',
          workModel: String((sig as ApplicationRecord['companySignals']).workModel || 'unknown').trim() || 'unknown'
        }
      : inferCompanySignals({
          company,
          title,
          location: String(record.location || '').trim() || undefined,
          source: source === 'linkedin_easy_apply' || source === 'manual' ? source : 'manual',
          outcome:
            outcome === 'submitted' ||
            outcome === 'autofilled' ||
            outcome === 'needs_review' ||
            outcome === 'failed' ||
            outcome === 'blocked' ||
            outcome === 'opened'
              ? outcome
              : 'opened',
          detail: String(record.detail || '').trim() || undefined,
          descriptionSnippet: String(record.descriptionSnippet || '').trim() || undefined,
          reasonSnippet: String(record.reasonSnippet || '').trim() || undefined
        })
  return {
    id,
    createdAt,
    company,
    title,
    location: String(record.location || '').trim() || undefined,
    jobUrl: String(record.jobUrl || '').trim() || undefined,
    easyApply: typeof record.easyApply === 'boolean' ? record.easyApply : undefined,
    atsId: String(record.atsId || '').trim() || undefined,
    source: source === 'linkedin_easy_apply' || source === 'manual' ? source : 'manual',
    outcome:
      outcome === 'submitted' ||
      outcome === 'autofilled' ||
      outcome === 'needs_review' ||
      outcome === 'failed' ||
      outcome === 'blocked' ||
      outcome === 'opened'
        ? outcome
        : 'opened',
    detail: String(record.detail || '').trim() || undefined,
    descriptionSnippet: String(record.descriptionSnippet || '').trim() || undefined,
    reasonSnippet: String(record.reasonSnippet || '').trim() || undefined,
    easyApplySessionId:
      typeof record.easyApplySessionId === 'number' && Number.isFinite(record.easyApplySessionId)
        ? record.easyApplySessionId
        : undefined,
    coverLetterMeta: normalizeCoverLetterMeta(record.coverLetterMeta),
    companySignals,
    outreachStatus: typeof record.outreachStatus === 'string' ? record.outreachStatus : undefined,
    outreachTargetUrl: String(record.outreachTargetUrl || '').trim() || undefined,
    outreachTargetName: String(record.outreachTargetName || '').trim() || undefined,
    outreachSentAt: String(record.outreachSentAt || '').trim() || undefined,
    hiringTeam: normalizeHiringTeam(record.hiringTeam),
    hiringTeamSearchHint: String(record.hiringTeamSearchHint || '').trim() || undefined,
    pipelineStage: normalizePipelineStage(record.pipelineStage),
    stuckFieldLabels: normalizeStuckFieldLabels(record.stuckFieldLabels)
  }
}

function readJsonlRecords(path: string): unknown[] {
  if (!existsSync(path)) return []
  try {
    const text = readFileSync(path, 'utf8')
    const records: unknown[] = []
    let skipped = 0
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try { records.push(JSON.parse(trimmed)) } catch { skipped++ }
    }
    if (skipped > 0) appLog.debug('[application-history] skipped malformed JSONL lines', { skipped })
    return records
  } catch (e) {
    appLog.debug('[application-history] readJsonlRecords failed', e instanceof Error ? e.message : String(e))
    return []
  }
}

function readLegacyJsonArray(path: string): unknown[] {
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    appLog.debug('[application-history] readLegacyJsonArray failed', e instanceof Error ? e.message : String(e))
    return []
  }
}

function migrateLegacyIfNeeded(): void {
  const jsonlPath = historyPath()
  if (existsSync(jsonlPath)) return

  const sources = [legacyJsonArrayPath(), legacyHistoryPath()]
  for (const src of sources) {
    if (!existsSync(src)) continue
    try {
      const rows = readLegacyJsonArray(src)
      if (!rows.length) continue
      const lines = rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
      writeFileSync(jsonlPath, lines, 'utf8')
      appLog.info('[application-history] migrated legacy JSON to JSONL', { source: src, records: rows.length })
      return
    } catch (e) {
      appLog.warn('[application-history] legacy migration failed', e instanceof Error ? e.message : String(e))
    }
  }
}

function normalizeDetailForDedup(detail: string | undefined): string {
  return String(detail || '')
    .replace(/\bsessionId=\d+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Legacy cleanup (read-time only): collapse duplicate `needs_review` + `failed` twins
 * produced within a few seconds for the same job/detail.
 *
 * Keeps the `failed` record as the canonical row so dashboards show a single
 * actionable outcome instead of double-counting.
 */
function collapseLegacyOutcomeTwinRecords(records: ApplicationRecord[]): ApplicationRecord[] {
  const DUPLICATE_WINDOW_MS = 15_000
  const dropNeedsReviewIds = new Set<string>()
  const byKey = new Map<string, ApplicationRecord[]>()

  for (const r of records) {
    if (r.source !== 'linkedin_easy_apply') continue
    const jobUrl = String(r.jobUrl || '').trim()
    if (!jobUrl) continue
    const detail = normalizeDetailForDedup(r.detail)
    if (!detail) continue
    const key = `${jobUrl}|${detail}`
    const bucket = byKey.get(key) || []
    bucket.push(r)
    byKey.set(key, bucket)
  }

  for (const bucket of byKey.values()) {
    if (bucket.length < 2) continue
    const failed = bucket.filter((r) => r.outcome === 'failed')
    const needsReview = bucket.filter((r) => r.outcome === 'needs_review')
    if (failed.length === 0 || needsReview.length === 0) continue

    for (const nr of needsReview) {
      const nrTs = Date.parse(nr.createdAt)
      if (!Number.isFinite(nrTs)) continue
      const nearFailed = failed.some((f) => {
        const fTs = Date.parse(f.createdAt)
        if (!Number.isFinite(fTs)) return false
        return Math.abs(fTs - nrTs) <= DUPLICATE_WINDOW_MS
      })
      if (nearFailed) dropNeedsReviewIds.add(nr.id)
    }
  }

  if (dropNeedsReviewIds.size === 0) return records
  return records.filter((r) => !dropNeedsReviewIds.has(r.id))
}

export function loadApplicationHistory(): ApplicationRecord[] {
  migrateLegacyIfNeeded()
  const path = historyPath()
  const normalized = readJsonlRecords(path)
    .map((entry) => normalizeRecord(entry))
    .filter((entry): entry is ApplicationRecord => entry != null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return collapseLegacyOutcomeTwinRecords(normalized)
}

export function todayApplicationCount(): number {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return loadApplicationHistory().filter((r) => {
    const d = new Date(r.createdAt)
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return local === today && (r.outcome === 'submitted' || r.outcome === 'autofilled')
  }).length
}

function writeRecords(records: ApplicationRecord[]): void {
  const dest = historyPath()
  const tmp = `${dest}.tmp`
  const capped = records.slice(0, MAX_HISTORY_ITEMS)
  const lines = capped.map((r) => JSON.stringify(r)).join('\n') + '\n'
  writeFileSync(tmp, lines, 'utf8')
  renameSync(tmp, dest)
}

function compactIfNeeded(count: number): void {
  if (count <= COMPACT_THRESHOLD) return
  const records = loadApplicationHistory()
  writeRecords(records.slice(0, MAX_HISTORY_ITEMS))
  appLog.info('[application-history] compacted', { before: count, after: Math.min(records.length, MAX_HISTORY_ITEMS) })
}

export function importApplicationRecords(incoming: ApplicationRecord[]): void {
  const existing = loadApplicationHistory()
  const existingIds = new Set(existing.map(r => r.id))
  const merged = [...existing]
  for (const rec of incoming) {
    if (!existingIds.has(rec.id)) {
      merged.push(rec)
      existingIds.add(rec.id)
    }
  }
  merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  writeRecords(merged)
}

export function computeInsights(records: ApplicationRecord[]): ApplicationInsights {
  return buildApplicationInsights(records)
}

export function appendApplicationRecord(input: ApplicationRecordInput): ApplicationRecord {
  while (_historyWriteLock) {
    /* single-threaded: yields only if re-entrant misuse */
  }
  _historyWriteLock = true
  try {
    const next: ApplicationRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      company: String(input.company || '').trim() || 'Unknown company',
      title: String(input.title || '').trim() || 'Unknown role',
      location: String(input.location || '').trim() || undefined,
      jobUrl: String(input.jobUrl || '').trim() || undefined,
      easyApply: input.easyApply,
      atsId: String(input.atsId || '').trim() || undefined,
      source: input.source,
      outcome: input.outcome,
      detail: String(input.detail || '').trim() || undefined,
      descriptionSnippet: String(input.descriptionSnippet || '').trim().slice(0, 600) || undefined,
      reasonSnippet: String(input.reasonSnippet || '').trim().slice(0, 300) || undefined,
      easyApplySessionId:
        typeof input.easyApplySessionId === 'number' && Number.isFinite(input.easyApplySessionId)
          ? input.easyApplySessionId
          : undefined,
      coverLetterMeta: normalizeCoverLetterMeta(input.coverLetterMeta),
      companySignals: inferCompanySignals(input),
      hiringTeam: normalizeHiringTeam(input.hiringTeam),
      hiringTeamSearchHint: String(input.hiringTeamSearchHint || '').trim() || undefined,
      pipelineStage: normalizePipelineStage(input.pipelineStage),
      stuckFieldLabels: normalizeStuckFieldLabels(input.stuckFieldLabels)
    }
    migrateLegacyIfNeeded()
    const dest = historyPath()
    if (!existsSync(logsDir())) mkdirSync(logsDir(), { recursive: true })
    appendFileSync(dest, JSON.stringify(next) + '\n', 'utf8')

    const lineCount = readFileSync(dest, 'utf8').split('\n').filter(l => l.trim()).length
    compactIfNeeded(lineCount)
    return next
  } finally {
    _historyWriteLock = false
  }
}

export function deleteApplicationRecord(id: string): boolean {
  const current = loadApplicationHistory()
  const next = current.filter((r) => r.id !== id)
  if (next.length === current.length) return false
  writeRecords(next)
  return true
}

export function updateApplicationRecord(
  id: string,
  partial: Partial<ApplicationRecordInput> & {
    outcome?: ApplicationRecord['outcome']
    outreachStatus?: ApplicationRecord['outreachStatus']
    outreachTargetUrl?: string
    outreachTargetName?: string
    outreachSentAt?: string
  }
): ApplicationRecord | null {
  while (_historyWriteLock) {
    /* single-threaded: yields only if re-entrant misuse */
  }
  _historyWriteLock = true
  try {
    const current = loadApplicationHistory()
    const idx = current.findIndex((r) => r.id === id)
    if (idx === -1) return null
    const prev = current[idx]
    const mergedInput: ApplicationRecordInput = {
      company: partial.company !== undefined ? String(partial.company).trim() : prev.company,
      title: partial.title !== undefined ? String(partial.title).trim() : prev.title,
      location: partial.location !== undefined ? String(partial.location).trim() || undefined : prev.location,
      jobUrl: partial.jobUrl !== undefined ? String(partial.jobUrl).trim() || undefined : prev.jobUrl,
      easyApply: partial.easyApply !== undefined ? partial.easyApply : prev.easyApply,
      atsId: partial.atsId !== undefined ? String(partial.atsId).trim() || undefined : prev.atsId,
      source: partial.source !== undefined ? partial.source : prev.source,
      outcome: partial.outcome !== undefined ? partial.outcome : prev.outcome,
      detail: partial.detail !== undefined ? String(partial.detail).trim() || undefined : prev.detail,
      descriptionSnippet:
        partial.descriptionSnippet !== undefined
          ? String(partial.descriptionSnippet).trim().slice(0, 600) || undefined
          : prev.descriptionSnippet,
      reasonSnippet:
        partial.reasonSnippet !== undefined
          ? String(partial.reasonSnippet).trim().slice(0, 300) || undefined
          : prev.reasonSnippet,
      easyApplySessionId:
        partial.easyApplySessionId !== undefined ? partial.easyApplySessionId : prev.easyApplySessionId,
      coverLetterMeta:
        partial.coverLetterMeta !== undefined
          ? normalizeCoverLetterMeta(partial.coverLetterMeta)
          : prev.coverLetterMeta,
      hiringTeam:
        partial.hiringTeam !== undefined ? normalizeHiringTeam(partial.hiringTeam) : prev.hiringTeam,
      hiringTeamSearchHint:
        partial.hiringTeamSearchHint !== undefined
          ? String(partial.hiringTeamSearchHint).trim() || undefined
          : prev.hiringTeamSearchHint,
      pipelineStage:
        partial.pipelineStage !== undefined ? normalizePipelineStage(partial.pipelineStage) : prev.pipelineStage,
      stuckFieldLabels:
        partial.stuckFieldLabels !== undefined
          ? normalizeStuckFieldLabels(partial.stuckFieldLabels)
          : prev.stuckFieldLabels
    }
    const updated: ApplicationRecord = {
      ...prev,
      ...mergedInput,
      id: prev.id,
      createdAt: prev.createdAt,
      companySignals:
        partial.company !== undefined ||
        partial.title !== undefined ||
        partial.location !== undefined ||
        partial.detail !== undefined ||
        partial.descriptionSnippet !== undefined ||
        partial.reasonSnippet !== undefined
          ? inferCompanySignals(mergedInput)
          : prev.companySignals,
      outreachStatus: partial.outreachStatus !== undefined ? partial.outreachStatus : prev.outreachStatus,
      outreachTargetUrl: partial.outreachTargetUrl !== undefined ? partial.outreachTargetUrl : prev.outreachTargetUrl,
      outreachTargetName: partial.outreachTargetName !== undefined ? partial.outreachTargetName : prev.outreachTargetName,
      outreachSentAt: partial.outreachSentAt !== undefined ? partial.outreachSentAt : prev.outreachSentAt
    }
    const fresh = loadApplicationHistory()
    const idxFresh = fresh.findIndex((r) => r.id === id)
    if (idxFresh === -1) return null
    const rest = fresh.filter((_, i) => i !== idxFresh)
    writeRecords([updated, ...rest])
    return updated
  } finally {
    _historyWriteLock = false
  }
}

export function exportApplicationHistoryCsv(): string {
  const records = loadApplicationHistory()
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
  const header = 'Date,Company,Title,Location,Outcome,Pipeline Stage,Source,Job URL'
  const rows = records.map((r) =>
    [
      r.createdAt,
      escape(r.company),
      escape(r.title),
      escape(r.location || ''),
      r.outcome,
      r.pipelineStage || '',
      r.source,
      r.jobUrl || '',
    ].join(',')
  )
  return [header, ...rows].join('\n')
}
