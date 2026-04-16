import { describe, expect, it } from 'vitest'
import { humanizeQueueDetail } from '../../../src/renderer/src/components/jobs/jobs-helpers'
import type { ApplyQueueItem } from '../../../src/core/application-types'

function makeItem(status: ApplyQueueItem['status'], detail?: string): ApplyQueueItem {
  return {
    id: `q-${Math.random().toString(36).slice(2, 8)}`,
    jobTitle: 'Test Role',
    company: 'Test Co',
    location: 'Remote',
    linkedinJobUrl: 'https://linkedin.com/jobs/view/1/',
    applyUrl: 'https://linkedin.com/jobs/view/1/',
    surface: 'linkedin_easy_apply',
    status,
    detail,
    addedAt: new Date().toISOString()
  }
}

function computeStats(items: ApplyQueueItem[]) {
  let done = 0, pending = 0, error = 0, skipped = 0, activeCount = 0
  for (const item of items) {
    if (item.status === 'done') done++
    else if (item.status === 'pending') pending++
    else if (item.status === 'skipped') skipped++
    else if (item.status === 'error') error++
    else if (item.status === 'active') activeCount++
  }
  return { done, pending, error, skipped, activeCount, actionableTotal: items.length - skipped }
}

describe('queue stats with mixed outcomes', () => {
  it('excludes skipped items from actionableTotal', () => {
    const items = [
      makeItem('done'),
      makeItem('pending'),
      makeItem('skipped'),
      makeItem('error'),
    ]
    const stats = computeStats(items)
    expect(stats.actionableTotal).toBe(3)
    expect(stats.done).toBe(1)
    expect(stats.pending).toBe(1)
    expect(stats.error).toBe(1)
    expect(stats.skipped).toBe(1)
  })

  it('actionableTotal equals items.length when no skipped', () => {
    const items = [makeItem('done'), makeItem('pending'), makeItem('active')]
    const stats = computeStats(items)
    expect(stats.actionableTotal).toBe(3)
    expect(stats.skipped).toBe(0)
  })

  it('all skipped makes actionableTotal zero', () => {
    const items = [makeItem('skipped'), makeItem('skipped')]
    const stats = computeStats(items)
    expect(stats.actionableTotal).toBe(0)
  })

  it('progress denominator should be actionableTotal not items.length', () => {
    const items = [makeItem('done'), makeItem('skipped'), makeItem('skipped')]
    const stats = computeStats(items)
    const progress = stats.actionableTotal > 0
      ? Math.round((100 * stats.done) / stats.actionableTotal)
      : 0
    expect(progress).toBe(100)
  })

  it('progress with mixed: 1 done, 1 skipped, 1 pending = 50% not 33%', () => {
    const items = [makeItem('done'), makeItem('skipped'), makeItem('pending')]
    const stats = computeStats(items)
    const progress = stats.actionableTotal > 0
      ? Math.round((100 * stats.done) / stats.actionableTotal)
      : 0
    expect(progress).toBe(50)
  })
})

describe('humanizeQueueDetail', () => {
  it('returns null for empty input', () => {
    expect(humanizeQueueDetail(undefined)).toBeNull()
    expect(humanizeQueueDetail('')).toBeNull()
  })

  it('humanizes job_closed_no_longer_accepting', () => {
    expect(humanizeQueueDetail('job_closed_no_longer_accepting')).toBe('Job is no longer accepting applications')
  })

  it('humanizes easy_apply_not_available', () => {
    expect(humanizeQueueDetail('easy_apply_not_available_for_job')).toContain('company site')
  })

  it('humanizes verification_required', () => {
    expect(humanizeQueueDetail('verification_required')).toContain('Action needed in Chrome')
  })

  it('humanizes daily cap', () => {
    expect(humanizeQueueDetail('daily cap reached')).toBe('Daily application limit reached')
  })

  it('humanizes stuck fields with regex', () => {
    const detail = 'Could not advance: 2 required fields unfilled (Phone Number, Work Authorization). Filled 3/5 fields (2 pre-filled by LinkedIn).'
    const result = humanizeQueueDetail(detail)
    expect(result).toContain('Stuck on required fields')
    expect(result).toContain('Phone Number')
    expect(result).toContain('3 of 5 filled')
  })

  it('passes through unknown messages unchanged', () => {
    expect(humanizeQueueDetail('Something completely new happened')).toBe('Something completely new happened')
  })

  it('humanizes auto-fill paused', () => {
    const detail = 'auto-fill paused after Filled 5/8 fields (3 pre-filled by LinkedIn).'
    const result = humanizeQueueDetail(detail)
    expect(result).toContain('Auto-fill paused')
  })
})
