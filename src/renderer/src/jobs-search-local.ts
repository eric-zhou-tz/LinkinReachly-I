import type { JobSearchHistoryEntry } from '@core/job-search-history'
import { normalizeJobsSearchHistory } from '@core/job-search-history'

/** Single blob: draft fields + recent search pills (mirrors settings jobsSearchHistory). */
const LS_KEY = 'loa.jobsSearchLocal.v1'
/** Previous key — only keywords + location; migrated once on read. */
const LEGACY_DRAFT_KEY = 'loa.jobsSearchDraft.v1'

type JobsSearchLocalSnapshot = {
  keywords: string
  location: string
  history: JobSearchHistoryEntry[]
}

const empty = (): JobsSearchLocalSnapshot => ({
  keywords: '',
  location: '',
  history: []
})

function clamp(s: string, max: number): string {
  return typeof s === 'string' ? s.slice(0, max) : ''
}

function tryParseSnapshot(raw: string): JobsSearchLocalSnapshot | null {
  try {
    const p = JSON.parse(raw) as unknown
    if (!p || typeof p !== 'object') return null
    const o = p as Record<string, unknown>
    return {
      keywords: clamp(String(o.keywords ?? ''), 800),
      location: clamp(String(o.location ?? ''), 800),
      history: normalizeJobsSearchHistory(o.history)
    }
  } catch {
    return null
  }
}

/** Read legacy draft key once and persist to v1 blob (no writeJobsSearchLocal recursion). */
function migrateLegacyDraftIfNeeded(): JobsSearchLocalSnapshot | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const legacy = localStorage.getItem(LEGACY_DRAFT_KEY)
    if (!legacy) return null
    const snap = tryParseSnapshot(legacy)
    localStorage.removeItem(LEGACY_DRAFT_KEY)
    if (!snap) return null
    const next: JobsSearchLocalSnapshot = { ...snap, history: [] }
    localStorage.setItem(LS_KEY, JSON.stringify(next))
    return next
  } catch {
    return null
  }
}

export function readJobsSearchLocal(): JobsSearchLocalSnapshot {
  if (typeof localStorage === 'undefined') return empty()
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) {
      return migrateLegacyDraftIfNeeded() ?? empty()
    }
    return tryParseSnapshot(raw) ?? empty()
  } catch {
    return empty()
  }
}

/** Merge `partial` into the stored snapshot so keyword saves never wipe history. */
export function writeJobsSearchLocal(partial: Partial<JobsSearchLocalSnapshot>): void {
  if (typeof localStorage === 'undefined') return
  try {
    const prev = readJobsSearchLocal()
    const next: JobsSearchLocalSnapshot = {
      keywords: partial.keywords !== undefined ? clamp(partial.keywords, 800) : prev.keywords,
      location: partial.location !== undefined ? clamp(partial.location, 800) : prev.location,
      history:
        partial.history !== undefined ? normalizeJobsSearchHistory(partial.history) : prev.history
    }
    localStorage.setItem(LS_KEY, JSON.stringify(next))
  } catch {
    /* quota / private mode */
  }
}

/** Clear keyword draft only (used by “Clear and start over”); keeps past-search pills. */
export function clearJobsSearchLocalDraft(): void {
  writeJobsSearchLocal({ keywords: '', location: '' })
}

function clearJobsSearchLocalEntire(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(LS_KEY)
    localStorage.removeItem(LEGACY_DRAFT_KEY)
  } catch { /* quota / private mode */ }
}

/** @deprecated use readJobsSearchLocal */
export function readJobsSearchDraft(): Pick<JobsSearchLocalSnapshot, 'keywords' | 'location'> {
  const s = readJobsSearchLocal()
  return { keywords: s.keywords, location: s.location }
}

/** @deprecated use writeJobsSearchLocal — preserves history */
export function writeJobsSearchDraft(draft: { keywords: string; location: string }): void {
  writeJobsSearchLocal(draft)
}
