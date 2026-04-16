const LS_PREFIX = 'loa.cache.'
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

type CacheEntry<T> = {
  data: T
  cachedAt: number
  ttlMs: number
}

export function cacheTabResults<T>(tabKey: string, data: T, ttlMs = DEFAULT_TTL_MS): void {
  if (typeof localStorage === 'undefined') return
  try {
    const entry: CacheEntry<T> = { data, cachedAt: Date.now(), ttlMs }
    localStorage.setItem(LS_PREFIX + tabKey, JSON.stringify(entry))
  } catch { /* quota / private mode */ }
}

export function getCachedTabResults<T>(tabKey: string): T | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(LS_PREFIX + tabKey)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry<T>
    if (!entry.cachedAt || !entry.data) return null
    if (Date.now() - entry.cachedAt > (entry.ttlMs || DEFAULT_TTL_MS)) {
      localStorage.removeItem(LS_PREFIX + tabKey)
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

export function clearTabCache(tabKey: string): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.removeItem(LS_PREFIX + tabKey) } catch { /* quota / private mode */ }
}

export function clearAllTabCaches(prefix?: string): number {
  if (typeof localStorage === 'undefined') return 0
  const target = LS_PREFIX + (prefix || '')
  const toRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(target)) toRemove.push(key)
  }
  for (const key of toRemove) localStorage.removeItem(key)
  return toRemove.length
}

export function getCacheAge(tabKey: string): number | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(LS_PREFIX + tabKey)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry<unknown>
    if (!entry.cachedAt) return null
    return Date.now() - entry.cachedAt
  } catch {
    return null
  }
}

export function formatCacheAge(ms: number | null): string {
  if (ms === null) return ''
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}
