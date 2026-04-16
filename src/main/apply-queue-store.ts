import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ApplyQueueItem, ApplyQueueState } from '@core/application-types'
import { detailSuggestsEasyApplyUnavailable } from '@core/apply-queue-heuristics'
import { userDataDir } from './user-data-path'
import { loadApplicationHistory } from './application-history-store'
import { appLog } from './app-log'


/** Test-only override: point queue store at a temp directory instead of real user data. */
let _testDataDir: string | null = null
export function setTestDataDir(dir: string | null): void { _testDataDir = dir; queueMemory = null; queueMemoryConfigDir = null }
function configDir(): string {
  if (_testDataDir) { if (!existsSync(_testDataDir)) mkdirSync(_testDataDir, { recursive: true }); return _testDataDir }
  const dir = join(userDataDir(), 'config')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function queuePath(): string {
  return join(configDir(), 'apply-queue.json')
}

/** In-process queue snapshot so concurrent IPC handlers cannot interleave stale load/save. */
let queueMemory: ApplyQueueState | null = null
let queueMemoryConfigDir: string | null = null

function defaultState(): ApplyQueueState {
  return {
    items: [],
    running: false,
    currentIndex: 0
  }
}

function normalizeItem(raw: unknown): ApplyQueueItem | null {
  if (typeof raw !== 'object' || raw == null) return null
  const o = raw as Partial<ApplyQueueItem>
  const id = String(o.id || '').trim()
  const jobTitle = String(o.jobTitle || '').trim()
  const company = String(o.company || '').trim()
  if (!id || !jobTitle || !company) return null
  const rawSurface = String(o.surface || '').trim()
  const wasExternal = rawSurface === 'external'
  const statusRaw = String(o.status || 'pending').trim()
  let status: ApplyQueueItem['status'] =
    statusRaw === 'active' ||
    statusRaw === 'done' ||
    statusRaw === 'error' ||
    statusRaw === 'skipped'
      ? statusRaw
      : 'pending'
  let detail = String(o.detail || '').trim() || undefined
  if (wasExternal && (status === 'pending' || status === 'active')) {
    status = 'skipped'
    detail = detail || 'External apply is no longer supported — Easy Apply only.'
  }
  return {
    id,
    jobTitle,
    company,
    location: String(o.location || '').trim(),
    linkedinJobUrl: String(o.linkedinJobUrl || '').trim(),
    applyUrl: String(o.applyUrl || o.linkedinJobUrl || '').trim(),
    surface: 'linkedin_easy_apply',
    atsId: String(o.atsId || '').trim() || undefined,
    status,
    addedAt: String(o.addedAt || new Date().toISOString()),
    processedAt: String(o.processedAt || '').trim() || undefined,
    applicationRecordId: String(o.applicationRecordId || '').trim() || undefined,
    detail,
    descriptionSnippet: String(o.descriptionSnippet || '').trim() || undefined,
    reasonSnippet: String(o.reasonSnippet || '').trim() || undefined,
    postedDate: String(o.postedDate || '').trim() || undefined,
    matchScore: typeof o.matchScore === 'number' && Number.isFinite(o.matchScore) ? o.matchScore : undefined,
    stuckFieldLabels: Array.isArray(o.stuckFieldLabels)
      ? o.stuckFieldLabels.map((label) => String(label || '').trim()).filter(Boolean)
      : undefined
  }
}

function normalizeState(raw: unknown): ApplyQueueState {
  const d = defaultState()
  if (typeof raw !== 'object' || raw == null) return d
  const s = raw as Partial<ApplyQueueState>
  const items = Array.isArray(s.items) ? s.items.map(normalizeItem).filter((x): x is ApplyQueueItem => x != null) : []

  return {
    items,
    running: !!s.running,
    currentIndex: typeof s.currentIndex === 'number' && Number.isFinite(s.currentIndex) ? Math.max(0, s.currentIndex) : 0,
    startedAt: String(s.startedAt || '').trim() || undefined,
    pausedAt: String(s.pausedAt || '').trim() || undefined,
    lastError: String(s.lastError || '').trim() || undefined,
    lastErrorCode: String((s as { lastErrorCode?: string }).lastErrorCode || '').trim() || undefined,
    lastDetail: s.lastDetail ? String(s.lastDetail).trim() : undefined,
    cooldownEndsAt: typeof s.cooldownEndsAt === 'number' && Number.isFinite(s.cooldownEndsAt) ? s.cooldownEndsAt : undefined,
    lastRunSummary: s.lastRunSummary && typeof s.lastRunSummary === 'object' ? s.lastRunSummary : undefined
  }
}

function readQueueFromDisk(): ApplyQueueState {
  const path = queuePath()
  if (!existsSync(path)) return defaultState()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return normalizeState(parsed)
  } catch (e) {
    appLog.info('[apply-queue] disk read error, using default', {
      error: e instanceof Error ? e.message : e
    })
    return defaultState()
  }
}

/**
 * On cold load, reset items stuck at 'active' (app crashed mid-run) back to 'pending',
 * clear terminal items (done/skipped) so stale results don't clutter the queue,
 * and clear the stale 'running' flag so the queue can be started again.
 */
function recoverOrphanedState(state: ApplyQueueState): ApplyQueueState {
  let dirty = false
  const items = state.items
    .filter((item) => {
      if (item.status === 'done' || item.status === 'skipped') {
        dirty = true
        return false
      }
      return true
    })
    .map((item) => {
      if (item.status !== 'active') return item
      dirty = true
      return { ...item, status: 'pending' as const, detail: 'Recovered after app restart.' }
    })
  if (state.running) dirty = true
  if (!dirty) return state
  return { ...state, items, running: false, lastError: undefined, lastErrorCode: undefined }
}

export function loadQueue(): ApplyQueueState {
  const dir = configDir()
  if (!queueMemory || queueMemoryConfigDir !== dir) {
    const raw = readQueueFromDisk()
    const recovered = recoverOrphanedState(raw)
    queueMemory = recovered
    if (recovered !== raw) {
      saveQueue(recovered)
    }
    queueMemoryConfigDir = dir
  }
  return queueMemory
}

let _pendingFlush: { snapshot: ApplyQueueState; dest: string } | null = null
let _flushInProgress = false

function scheduleFlush(): void {
  if (_flushInProgress || !_pendingFlush) return
  _flushInProgress = true
  const { snapshot, dest } = _pendingFlush
  _pendingFlush = null
  const tmp = `${dest}.${process.pid}.tmp`
  const ensureDestDir = (): void => {
    const dir = dirname(dest)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  const finalize = (): void => {
    _flushInProgress = false
    if (_pendingFlush) setImmediate(scheduleFlush)
  }
  ensureDestDir()
  writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8')
    .then(() => rename(tmp, dest))
    .catch((e) => {
      appLog.debug('[apply-queue-store] async disk write failed, falling back to sync', e instanceof Error ? e.message : String(e))
      try {
        ensureDestDir()
        writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8')
        renameSync(tmp, dest)
      } catch (e2) {
        appLog.debug('[apply-queue-store] sync fallback also failed', e2 instanceof Error ? e2.message : String(e2))
      }
    })
    .finally(() => { finalize() })
}

export function saveQueue(state: ApplyQueueState): void {
  if (!Array.isArray(state.items)) {
    state = { ...state, items: [] }
  }
  queueMemoryConfigDir = configDir()
  queueMemory = state
  _pendingFlush = { snapshot: state, dest: queuePath() }
  setImmediate(scheduleFlush)
}

function parsePostedDateMs(d?: string): number {
  if (!d) return 0
  const t = new Date(d).getTime()
  return Number.isFinite(t) ? t : 0
}

/** Higher match score and fresher posted/added dates sort first (pending batch ordering). */
function compareApplyQueueSortOrder(
  a: ApplyQueueItem,
  b: ApplyQueueItem,
  opts: { addedAtTiebreak: boolean }
): number {
  const aScore = a.matchScore ?? 0
  const bScore = b.matchScore ?? 0
  if (aScore !== bScore) return bScore - aScore
  const aPosted = parsePostedDateMs(a.postedDate)
  const bPosted = parsePostedDateMs(b.postedDate)
  if (aPosted !== bPosted) return bPosted - aPosted
  if (!opts.addedAtTiebreak) return 0
  const aDate = a.addedAt ? new Date(a.addedAt).getTime() : 0
  const bDate = b.addedAt ? new Date(b.addedAt).getTime() : 0
  return bDate - aDate
}

interface AddToQueueResult {
  state: ApplyQueueState
  added: number
  skippedDuplicate: number
  skippedAlreadyApplied: number
  skippedNames: string[]
}

/** Normalize LinkedIn job URLs to canonical form for dedup: strip query params, trailing slashes. */
function normalizeJobUrl(raw: string): string {
  const s = String(raw || '').trim().toLowerCase()
  // LinkedIn job URLs: extract /jobs/view/ID path, ignore query params
  const m = s.match(/linkedin\.com\/jobs\/view\/(\d+)/)
  if (m) return `https://www.linkedin.com/jobs/view/${m[1]}/`
  // For non-LinkedIn URLs, strip query params and fragment
  try {
    const u = new URL(s)
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '/')
  } catch {
    return s
  }
}

function failedHistoryRecordBlocksRequeue(detail: string | undefined): boolean {
  const d = String(detail || '')
  return (
    detailSuggestsEasyApplyUnavailable(d) ||
    /job is no longer accepting applications/i.test(d) ||
    /job_closed_no_longer_accepting/i.test(d) ||
    /external_apply_unsupported/i.test(d)
  )
}

export function addToQueue(items: ApplyQueueItem[]): AddToQueueResult {
  const cur = loadQueue()
  /** Drop finished rows so a new batch does not inherit stale "N done" counts from disk. */
  const doneItems = cur.items.filter((i) => i.status === 'done')
  const baseItems = cur.items.filter((i) => i.status !== 'done')
  const hadDonePruned = doneItems.length > 0

  const existingUrls = new Set(
    baseItems.map((i) => normalizeJobUrl(i.linkedinJobUrl || i.applyUrl || ''))
  )
  const existingIds = new Set(baseItems.map((i) => i.id))

  let historyUrls: Set<string> | null = null
  try {
    const history = loadApplicationHistory()
    historyUrls = new Set(
      history
        .filter((r) =>
          r.outcome === 'submitted' ||
          r.outcome === 'autofilled' ||
          r.outcome === 'needs_review' ||
          (r.outcome === 'failed' && failedHistoryRecordBlocksRequeue(r.detail))
        )
        .map((r) => normalizeJobUrl(r.jobUrl || ''))
        .filter((u) => u !== '/')
    )
  } catch (e) {
    appLog.info('[apply-queue] history load error, skipping history dedup', {
      error: e instanceof Error ? e.message : e
    })
  }

  let skippedDuplicate = 0
  let skippedAlreadyApplied = 0
  const skippedNames: string[] = []

  const deduped = items.filter((i) => {
    if (existingIds.has(i.id)) {
      skippedDuplicate++
      skippedNames.push(`${i.jobTitle} @ ${i.company}`)
      return false
    }
    const urlKey = normalizeJobUrl(i.linkedinJobUrl || i.applyUrl || '')
    if (existingUrls.has(urlKey)) {
      skippedDuplicate++
      skippedNames.push(`${i.jobTitle} @ ${i.company}`)
      return false
    }
    if (historyUrls && urlKey && urlKey !== '/' && historyUrls.has(urlKey)) {
      skippedAlreadyApplied++
      skippedNames.push(`${i.jobTitle} @ ${i.company}`)
      return false
    }
    return true
  })

  if (deduped.length === 0 && !hadDonePruned) {
    return { state: cur, added: 0, skippedDuplicate, skippedAlreadyApplied, skippedNames }
  }

  const MAX_QUEUE_ITEMS = 2000
  const sortedDeduped = [...deduped].sort((a, b) =>
    compareApplyQueueSortOrder(a, b, { addedAtTiebreak: true })
  )
  const available = Math.max(0, MAX_QUEUE_ITEMS - baseItems.length)
  const capped = sortedDeduped.length > available ? sortedDeduped.slice(0, available) : sortedDeduped
  const merged = capped.length > 0 ? [...baseItems, ...capped] : baseItems
  const next: ApplyQueueState = {
    ...cur,
    items: merged,
    currentIndex: Math.min(cur.currentIndex, Math.max(0, merged.length - 1))
  }
  saveQueue(next)
  return { state: next, added: capped.length, skippedDuplicate, skippedAlreadyApplied, skippedNames }
}

export function removeFromQueue(id: string): ApplyQueueState {
  const cur = loadQueue()
  const next: ApplyQueueState = {
    ...cur,
    items: cur.items.filter((i) => i.id !== id)
  }
  saveQueue(next)
  return next
}

export function clearQueue(): ApplyQueueState {
  const cur = loadQueue()
  if (cur.running) {
    return cur
  }

  const next = defaultState()
  saveQueue(next)
  return next
}

export function updateItemStatus(
  id: string,
  status: ApplyQueueItem['status'],
  extras?: { applicationRecordId?: string; detail?: string; processedAt?: string; stuckFieldLabels?: string[] }
): ApplyQueueState {
  const cur = loadQueue()
  const hasStuckFieldLabels = !!extras && Object.prototype.hasOwnProperty.call(extras, 'stuckFieldLabels')
  const items = cur.items.map((item) => {
    if (item.id !== id) return item
    return {
      ...item,
      status,
      applicationRecordId: extras?.applicationRecordId ?? item.applicationRecordId,
      detail: extras?.detail ?? item.detail,
      processedAt: extras?.processedAt ?? item.processedAt,
      stuckFieldLabels: hasStuckFieldLabels ? extras?.stuckFieldLabels : item.stuckFieldLabels
    }
  })
  const next = { ...cur, items }
  saveQueue(next)
  return next
}

export function patchQueueItem(
  id: string,
  partial: Partial<Pick<ApplyQueueItem, 'applyUrl' | 'linkedinJobUrl' | 'atsId' | 'detail'>>
): ApplyQueueState {
  const cur = loadQueue()
  let changed = false
  const items = cur.items.map((item) => {
    if (item.id !== id) return item
    changed = true
    return {
      ...item,
      applyUrl: partial.applyUrl !== undefined ? String(partial.applyUrl || '').trim() || item.applyUrl : item.applyUrl,
      linkedinJobUrl:
        partial.linkedinJobUrl !== undefined
          ? String(partial.linkedinJobUrl || '').trim() || item.linkedinJobUrl
          : item.linkedinJobUrl,
      atsId: partial.atsId !== undefined ? String(partial.atsId || '').trim() || undefined : item.atsId,
      detail: partial.detail !== undefined ? String(partial.detail || '').trim() || undefined : item.detail
    }
  })
  if (!changed) return cur
  const next = { ...cur, items }
  saveQueue(next)
  return next
}

/**
 * Re-evaluate error items with stuckFieldLabels: if all stuck fields now have
 * answers in the Answer Bank, reset the item to pending so it gets retried.
 */
function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s_]/g, '').split(/[\s_]+/).filter(Boolean)
}

function fuzzyMatchesAnyKey(label: string, answerBankKeys: ReadonlySet<string>, keyTokensMap: Map<string, string[]>): boolean {
  const normalized = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  if (answerBankKeys.has(normalized)) return true
  const labelTokens = tokenize(label)
  if (labelTokens.length === 0) return false
  for (const [, keyTokens] of keyTokensMap) {
    if (keyTokens.length === 0) continue
    const shared = labelTokens.filter((t) => keyTokens.includes(t)).length
    const overlap = shared / Math.max(labelTokens.length, keyTokens.length)
    if (overlap >= 0.85) return true
  }
  return false
}

export function retryStuckItemsIfAnswered(answerBankKeys: ReadonlySet<string>): { retriedCount: number; state: ApplyQueueState } {
  const cur = loadQueue()
  if (answerBankKeys.size === 0) return { retriedCount: 0, state: cur }
  const keyTokensMap = new Map<string, string[]>()
  for (const key of answerBankKeys) keyTokensMap.set(key, tokenize(key))
  let retriedCount = 0
  const items = cur.items.map((item) => {
    if (item.status !== 'error') return item
    const stuck = item.stuckFieldLabels
    if (!stuck || stuck.length === 0) return item
    const allCovered = stuck.every((label) => fuzzyMatchesAnyKey(label, answerBankKeys, keyTokensMap))
    if (!allCovered) return item
    retriedCount++
    return {
      ...item,
      status: 'pending' as const,
      processedAt: undefined,
      applicationRecordId: undefined,
      detail: undefined,
      stuckFieldLabels: undefined
    }
  })
  if (retriedCount === 0) return { retriedCount: 0, state: cur }
  const next: ApplyQueueState = { ...cur, items, lastError: undefined, lastErrorCode: undefined }
  saveQueue(next)
  appLog.info('[apply-queue] auto-retried stuck items after answer bank update', { retriedCount })
  return { retriedCount, state: next }
}

export function retryQueueItems(ids?: string[]): ApplyQueueState {
  const cur = loadQueue()
  const idSet = new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))
  let changed = false
  const items = cur.items.map((item) => {
    if (item.status !== 'error') return item
    if (idSet.size > 0 && !idSet.has(item.id)) return item
    changed = true
    return {
      ...item,
      status: 'pending' as const,
      processedAt: undefined,
      applicationRecordId: undefined,
      detail: undefined,
      stuckFieldLabels: undefined
    }
  })
  if (!changed) return cur
  const next: ApplyQueueState = {
    ...cur,
    items,
    lastError: undefined,
    lastErrorCode: undefined
  }
  saveQueue(next)
  return next
}

export function skipQueueItem(id: string): ApplyQueueState {
  const targetId = String(id || '').trim()
  if (!targetId) return loadQueue()
  const cur = loadQueue()
  let changed = false
  const items = cur.items.map((item) => {
    if (item.id !== targetId) return item
    changed = true
    return {
      ...item,
      status: 'skipped' as const,
      processedAt: new Date().toISOString(),
      detail: item.detail || 'Skipped by user.'
    }
  })
  if (!changed) return cur
  const next: ApplyQueueState = {
    ...cur,
    items,
    lastError: undefined,
    lastErrorCode: undefined
  }
  saveQueue(next)
  return next
}

function sortPendingItems(items: ApplyQueueItem[]): ApplyQueueItem[] {
  const pending: ApplyQueueItem[] = []
  const nonPending: ApplyQueueItem[] = []
  for (const item of items) {
    if (item.status === 'pending') pending.push(item)
    else nonPending.push(item)
  }
  pending.sort((a, b) => compareApplyQueueSortOrder(a, b, { addedAtTiebreak: false }))
  return [...nonPending, ...pending]
}

export function setQueueRunning(
  running: boolean,
  extras?: {
    startedAt?: string
    pausedAt?: string
    currentIndex?: number
    lastError?: string
    lastErrorCode?: string
    lastDetail?: string
    cooldownEndsAt?: number
  }
): ApplyQueueState {
  const cur = loadQueue()
  const isInitialStart = running && !cur.running
  const items = isInitialStart ? sortPendingItems(cur.items) : cur.items
  const next: ApplyQueueState = {
    ...cur,
    items,
    running,
    currentIndex: extras?.currentIndex ?? cur.currentIndex,
    startedAt: running ? (extras?.startedAt ?? new Date().toISOString()) : cur.startedAt,
    pausedAt: !running ? (extras?.pausedAt ?? new Date().toISOString()) : undefined,
    lastError: extras?.lastError !== undefined ? extras.lastError : cur.lastError,
    lastErrorCode: extras?.lastErrorCode !== undefined ? extras.lastErrorCode : cur.lastErrorCode,
    lastDetail: extras?.lastDetail !== undefined ? extras.lastDetail : cur.lastDetail,
    cooldownEndsAt: extras?.cooldownEndsAt !== undefined ? extras.cooldownEndsAt : cur.cooldownEndsAt
  }
  saveQueue(next)
  return next
}

export function setQueueCurrentIndex(index: number): ApplyQueueState {
  const cur = loadQueue()
  const next = { ...cur, currentIndex: Math.max(0, index) }
  saveQueue(next)
  return next
}
