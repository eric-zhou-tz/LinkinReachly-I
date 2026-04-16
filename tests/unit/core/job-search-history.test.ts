import { describe, expect, it } from 'vitest'
import {
  appendJobSearchHistory,
  MAX_JOB_SEARCH_HISTORY,
  mergeJobSearchHistoryLists,
  normalizeJobsSearchHistory
} from '../../../src/core/job-search-history'

describe('job-search-history', () => {
  it('normalizeJobsSearchHistory drops invalid and dedupes by keywords+location', () => {
    expect(normalizeJobsSearchHistory(null)).toEqual([])
    const raw = [
      { keywords: '  PM  ', location: ' NYC ' },
      { keywords: 'PM', location: 'NYC' },
      { keywords: '', location: 'x' },
      'bad',
      { keywords: 'Eng', location: 'Remote' }
    ]
    expect(normalizeJobsSearchHistory(raw)).toEqual([
      { keywords: 'PM', location: 'NYC' },
      { keywords: 'Eng', location: 'Remote' }
    ])
  })

  it('appendJobSearchHistory prepends and moves duplicate to front', () => {
    const cur = [
      { keywords: 'a', location: '1' },
      { keywords: 'b', location: '2' }
    ]
    expect(appendJobSearchHistory(cur, 'b', '2')).toEqual([
      { keywords: 'b', location: '2' },
      { keywords: 'a', location: '1' }
    ])
  })

  it('appendJobSearchHistory ignores empty keywords', () => {
    const cur = [{ keywords: 'a', location: '1' }]
    expect(appendJobSearchHistory(cur, '  ', 'x')).toEqual(cur)
  })

  it('caps at MAX_JOB_SEARCH_HISTORY', () => {
    let cur: { keywords: string; location: string }[] = []
    for (let i = 0; i < MAX_JOB_SEARCH_HISTORY + 5; i++) {
      cur = appendJobSearchHistory(cur, `k${i}`, '')
    }
    expect(cur.length).toBe(MAX_JOB_SEARCH_HISTORY)
  })

  it('mergeJobSearchHistoryLists dedupes with local entries first', () => {
    const disk = [{ keywords: 'pm', location: 'sf' }]
    const local = [
      { keywords: 'eng', location: 'remote' },
      { keywords: 'pm', location: 'sf' }
    ]
    expect(mergeJobSearchHistoryLists(disk, local)).toEqual([
      { keywords: 'eng', location: 'remote' },
      { keywords: 'pm', location: 'sf' }
    ])
  })
})
