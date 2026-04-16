/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('jobs-search-local', () => {
  const store: Record<string, string> = {}

  beforeEach(() => {
    vi.stubGlobal(
      'localStorage',
      {
        getItem: (k: string) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = v
        },
        removeItem: (k: string) => {
          delete store[k]
        }
      } as Storage
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Object.keys(store).forEach((k) => delete store[k])
  })

  async function loadModule() {
    return import('@/jobs-search-local')
  }

  it('round-trips draft', async () => {
    const { writeJobsSearchDraft, readJobsSearchDraft } = await loadModule()
    writeJobsSearchDraft({ keywords: 'PM', location: 'NYC' })
    expect(readJobsSearchDraft()).toEqual({ keywords: 'PM', location: 'NYC' })
  })

  it('clears draft keywords only and keeps history', async () => {
    const { writeJobsSearchLocal, readJobsSearchLocal, clearJobsSearchLocalDraft } = await loadModule()
    writeJobsSearchLocal({
      keywords: 'a',
      location: 'b',
      history: [{ keywords: 'pm', location: 'sf' }]
    })
    clearJobsSearchLocalDraft()
    expect(readJobsSearchLocal()).toEqual({
      keywords: '',
      location: '',
      history: [{ keywords: 'pm', location: 'sf' }]
    })
  })

  it('clamps length', async () => {
    const { writeJobsSearchDraft, readJobsSearchDraft } = await loadModule()
    const long = 'x'.repeat(900)
    writeJobsSearchDraft({ keywords: long, location: '' })
    expect(readJobsSearchDraft().keywords.length).toBe(800)
  })

  it('preserves history when updating keywords only', async () => {
    const { writeJobsSearchLocal, readJobsSearchLocal } = await loadModule()
    writeJobsSearchLocal({
      keywords: 'a',
      location: 'b',
      history: [{ keywords: 'pm', location: 'sf' }]
    })
    writeJobsSearchLocal({ keywords: 'c', location: 'd' })
    expect(readJobsSearchLocal().history).toEqual([{ keywords: 'pm', location: 'sf' }])
    expect(readJobsSearchLocal().keywords).toBe('c')
  })
})
