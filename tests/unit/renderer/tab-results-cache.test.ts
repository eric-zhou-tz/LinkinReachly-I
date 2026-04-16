import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheTabResults, getCachedTabResults, clearTabCache, getCacheAge, formatCacheAge } from '../../../src/renderer/src/tab-results-cache'

const storage = new Map<string, string>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('tab-results-cache', () => {
  it('stores and retrieves cached data', () => {
    cacheTabResults('test-tab', { items: [1, 2, 3] })
    const result = getCachedTabResults<{ items: number[] }>('test-tab')
    expect(result).toEqual({ items: [1, 2, 3] })
  })

  it('returns null for missing keys', () => {
    expect(getCachedTabResults('nonexistent')).toBeNull()
  })

  it('returns null for expired entries', () => {
    cacheTabResults('expired', { x: 1 }, 1)
    const raw = storage.get('loa.cache.expired')!
    const entry = JSON.parse(raw) as { cachedAt: number }
    entry.cachedAt = Date.now() - 10000
    storage.set('loa.cache.expired', JSON.stringify(entry))
    expect(getCachedTabResults('expired')).toBeNull()
  })

  it('clearTabCache removes the entry', () => {
    cacheTabResults('to-clear', { y: 2 })
    clearTabCache('to-clear')
    expect(getCachedTabResults('to-clear')).toBeNull()
  })

  it('getCacheAge returns milliseconds since cache', () => {
    cacheTabResults('age-test', { z: 3 })
    const age = getCacheAge('age-test')
    expect(age).toBeGreaterThanOrEqual(0)
    expect(age).toBeLessThan(1000)
  })

  it('getCacheAge returns null for missing', () => {
    expect(getCacheAge('no-such')).toBeNull()
  })

  it('formatCacheAge produces readable labels', () => {
    expect(formatCacheAge(null)).toBe('')
    expect(formatCacheAge(30000)).toBe('just now')
    expect(formatCacheAge(5 * 60000)).toBe('5m ago')
    expect(formatCacheAge(90 * 60000)).toBe('1h ago')
    expect(formatCacheAge(180 * 60000)).toBe('3h ago')
  })

  it('handles complex data types', () => {
    const data = {
      records: [{ id: '1', title: 'Engineer', company: 'Acme' }],
      stats: { total: 1, applied: 1 }
    }
    cacheTabResults('complex', data)
    expect(getCachedTabResults('complex')).toEqual(data)
  })
})
