/** Persisted Jobs tab search pairs (keywords + location), newest first. */

export type JobSearchHistoryEntry = {
  keywords: string
  location: string
}

export const MAX_JOB_SEARCH_HISTORY = 20

function pairKey(keywords: string, location: string): string {
  const k = keywords.trim().toLowerCase().replace(/\s+/g, ' ')
  const l = location.trim().toLowerCase().replace(/\s+/g, ' ')
  return `${k}\u0000${l}`
}

/** Sanitize disk / IPC payload: valid entries only, dedupe preserving order, cap length. */
export function normalizeJobsSearchHistory(raw: unknown): JobSearchHistoryEntry[] {
  if (!Array.isArray(raw)) return []
  const out: JobSearchHistoryEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const keywords = typeof o.keywords === 'string' ? o.keywords.slice(0, 800).trim() : ''
    const location = typeof o.location === 'string' ? o.location.slice(0, 800).trim() : ''
    if (!keywords) continue
    out.push({ keywords, location })
  }
  const seen = new Set<string>()
  const deduped: JobSearchHistoryEntry[] = []
  for (const e of out) {
    const key = pairKey(e.keywords, e.location)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(e)
    if (deduped.length >= MAX_JOB_SEARCH_HISTORY) break
  }
  return deduped
}

/** Prepend a successful search; drops duplicate pair elsewhere in the list. */
export function appendJobSearchHistory(
  current: JobSearchHistoryEntry[],
  keywords: string,
  location: string
): JobSearchHistoryEntry[] {
  const kw = keywords.trim().slice(0, 800)
  const loc = location.trim().slice(0, 800)
  if (!kw) return current
  const key = pairKey(kw, loc)
  const filtered = current.filter((e) => pairKey(e.keywords, e.location) !== key)
  return [{ keywords: kw, location: loc }, ...filtered].slice(0, MAX_JOB_SEARCH_HISTORY)
}

/**
 * Combine settings-backed history with a local cache (e.g. localStorage). `local` order wins on
 * duplicate keyword+location pairs so the newest cached searches stay on top.
 */
export function mergeJobSearchHistoryLists(
  disk: JobSearchHistoryEntry[],
  local: JobSearchHistoryEntry[]
): JobSearchHistoryEntry[] {
  const d = normalizeJobsSearchHistory(disk)
  const l = normalizeJobsSearchHistory(local)
  return normalizeJobsSearchHistory([...l, ...d])
}
