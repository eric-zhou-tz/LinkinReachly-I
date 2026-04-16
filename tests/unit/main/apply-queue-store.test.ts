import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApplyQueueItem } from '@core/application-types'

let prevDataDir: string | undefined

beforeEach(() => {
  prevDataDir = process.env['LOA_USER_DATA_DIR']
  process.env['LOA_USER_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'loa-q-'))
})

afterEach(() => {
  const d = process.env['LOA_USER_DATA_DIR']
  if (d && existsSync(d)) {
    rmSync(d, { recursive: true, force: true })
  }
  if (prevDataDir === undefined) delete process.env['LOA_USER_DATA_DIR']
  else process.env['LOA_USER_DATA_DIR'] = prevDataDir
})

function item(id: string): ApplyQueueItem {
  return {
    id,
    jobTitle: 'Engineer',
    company: 'Acme',
    location: '',
    linkedinJobUrl: 'https://example.com/j',
    applyUrl: 'https://example.com/j',
    surface: 'linkedin_easy_apply',
    status: 'pending',
    addedAt: new Date().toISOString()
  }
}

describe('apply-queue-store', () => {
  it('load default empty', async () => {
    const { loadQueue } = await import('../../../src/main/apply-queue-store')
    const s = loadQueue()
    expect(s.items).toEqual([])
    expect(s.running).toBe(false)
  })

  it('add and remove', async () => {
    const { loadQueue, addToQueue, removeFromQueue, clearQueue } = await import(
      '../../../src/main/apply-queue-store'
    )
    addToQueue([item('a')])
    expect(loadQueue().items).toHaveLength(1)
    removeFromQueue('a')
    expect(loadQueue().items).toHaveLength(0)
    addToQueue([item('b')])
    clearQueue()
    expect(loadQueue().items).toHaveLength(0)
  })

  it('clearQueue returns unchanged state when running is true', async () => {
    const { loadQueue, saveQueue, clearQueue } = await import('../../../src/main/apply-queue-store')
    const snapshot = { items: [item('run-a')], running: true, currentIndex: 0 }
    saveQueue(snapshot)
    const before = loadQueue()
    const returned = clearQueue()
    expect(returned).toEqual(before)
    expect(loadQueue().items).toHaveLength(1)
    expect(loadQueue().running).toBe(true)
    expect(loadQueue().items[0]?.id).toBe('run-a')
  })

  it('deduplicates by id and URL', async () => {
    const { addToQueue, loadQueue } = await import(
      '../../../src/main/apply-queue-store'
    )
    addToQueue([item('a')])
    expect(loadQueue().items).toHaveLength(1)

    // Same id should be deduplicated
    addToQueue([item('a')])
    expect(loadQueue().items).toHaveLength(1)

    // Same URL but different id should also be deduplicated
    const b = { ...item('b'), linkedinJobUrl: 'https://example.com/j', applyUrl: 'https://example.com/j' }
    addToQueue([b])
    expect(loadQueue().items).toHaveLength(1)

    // Different URL and id should be added
    const c = { ...item('c'), linkedinJobUrl: 'https://example.com/other', applyUrl: 'https://example.com/other' }
    addToQueue([c])
    expect(loadQueue().items).toHaveLength(2)

    // Same URL as existing with different casing should still dedupe
    const d = {
      ...item('d'),
      linkedinJobUrl: 'HTTPS://EXAMPLE.COM/OTHER',
      applyUrl: 'HTTPS://EXAMPLE.COM/OTHER'
    }
    addToQueue([d])
    expect(loadQueue().items).toHaveLength(2)
  })

  it('skips jobs that previously failed for non-actionable reasons', async () => {
    const dir = process.env['LOA_USER_DATA_DIR']!
    const logsDir = join(dir, 'logs')
    mkdirSync(logsDir, { recursive: true })
    const historyFile = join(logsDir, 'applications.jsonl')
    writeFileSync(
      historyFile,
      JSON.stringify({
        id: 'hist-1',
        createdAt: new Date().toISOString(),
        company: 'Stealth Startup',
        title: 'Researcher',
        source: 'linkedin_easy_apply',
        outcome: 'failed',
        jobUrl: 'https://www.linkedin.com/jobs/view/4399392911/',
        detail:
          "The Easy Apply form didn't open on this page. The job may have been removed or may not support Easy Apply. Filled 0/0 fields."
      }) + '\n',
      'utf8'
    )

    const { addToQueue, loadQueue } = await import('../../../src/main/apply-queue-store')
    const result = addToQueue([
      {
        ...item('new-job'),
        jobTitle: 'Researcher',
        company: 'Stealth Startup',
        linkedinJobUrl: 'https://www.linkedin.com/jobs/view/4399392911/?trackingId=abc',
        applyUrl: 'https://www.linkedin.com/jobs/view/4399392911/?trackingId=abc'
      }
    ])

    expect(result.added).toBe(0)
    expect(result.skippedAlreadyApplied).toBe(1)
    expect(loadQueue().items).toHaveLength(0)
  })

  it('drops done items when adding so new picks do not inherit old completed counts', async () => {
    const { addToQueue, loadQueue, updateItemStatus } = await import(
      '../../../src/main/apply-queue-store'
    )
    addToQueue([item('old-a'), item('old-b')])
    updateItemStatus('old-a', 'done', { processedAt: new Date().toISOString() })
    updateItemStatus('old-b', 'done', { processedAt: new Date().toISOString() })
    expect(loadQueue().items).toHaveLength(2)

    addToQueue([item('new-1')])
    const next = loadQueue()
    expect(next.items.map((i) => i.id)).toEqual(['new-1'])
    expect(next.items.every((i) => i.status === 'pending')).toBe(true)
  })

  it('retries failed items and can skip by id', async () => {
    const { addToQueue, loadQueue, updateItemStatus, retryQueueItems, skipQueueItem } = await import(
      '../../../src/main/apply-queue-store'
    )
    addToQueue([item('a'), item('b')])
    updateItemStatus('a', 'error', { detail: 'blocked' })
    updateItemStatus('b', 'error', { detail: 'captcha' })

    retryQueueItems(['a'])
    const afterRetry = loadQueue()
    expect(afterRetry.items.find((i) => i.id === 'a')?.status).toBe('pending')
    expect(afterRetry.items.find((i) => i.id === 'b')?.status).toBe('error')

    skipQueueItem('b')
    const afterSkip = loadQueue()
    expect(afterSkip.items.find((i) => i.id === 'b')?.status).toBe('skipped')
    expect(afterSkip.items.find((i) => i.id === 'b')?.processedAt).toBeTruthy()
  })

  it('recovers orphaned active items on cold load', async () => {
    const dir = process.env['LOA_USER_DATA_DIR']!
    const configPath = join(dir, 'config')
    mkdirSync(configPath, { recursive: true })
    const queueFile = join(configPath, 'apply-queue.json')
    const orphanedState = {
      items: [
        { ...item('stuck'), status: 'active' },
        { ...item('ok'), status: 'pending', linkedinJobUrl: 'https://other.com', applyUrl: 'https://other.com' }
      ],
      running: true,
      currentIndex: 0
    }
    writeFileSync(queueFile, JSON.stringify(orphanedState), 'utf8')

    const { loadQueue } = await import('../../../src/main/apply-queue-store')
    const loaded = loadQueue()
    expect(loaded.running).toBe(false)
    expect(loaded.items[0]?.status).toBe('pending')
    expect(loaded.items[0]?.detail).toBe('Recovered after app restart.')
    expect(loaded.items[1]?.status).toBe('pending')
  })

  it('preserves stuckFieldLabels when loading queue items from disk', async () => {
    const dir = process.env['LOA_USER_DATA_DIR']!
    const configPath = join(dir, 'config')
    mkdirSync(configPath, { recursive: true })
    const queueFile = join(configPath, 'apply-queue.json')
    const seededState = {
      items: [
        {
          ...item('needs-answers'),
          status: 'error',
          detail: 'Required fields unfilled.',
          stuckFieldLabels: ['Meta, include links?', 'Are you authorized to work in the U.S.?']
        }
      ],
      running: false,
      currentIndex: 0
    }
    writeFileSync(queueFile, JSON.stringify(seededState), 'utf8')

    const { loadQueue } = await import('../../../src/main/apply-queue-store')
    const loaded = loadQueue()
    expect(loaded.items[0]?.stuckFieldLabels).toEqual([
      'Meta, include links?',
      'Are you authorized to work in the U.S.?'
    ])
  })

  it('writes queue atomically via tmp file', async () => {
    const { saveQueue, loadQueue } = await import('../../../src/main/apply-queue-store')
    saveQueue({ items: [item('atomic-test')], running: false, currentIndex: 0 })
    const dir = process.env['LOA_USER_DATA_DIR']!
    const tmpFile = join(dir, 'config', `apply-queue.json.${process.pid}.tmp`)
    expect(existsSync(tmpFile)).toBe(false)
    const loaded = loadQueue()
    expect(loaded.items[0]?.id).toBe('atomic-test')
  })

  it('persists the latest snapshot under rapid successive saves', async () => {
    const { saveQueue } = await import('../../../src/main/apply-queue-store')
    saveQueue({ items: [item('rapid-1')], running: false, currentIndex: 0 })
    saveQueue({ items: [item('rapid-2')], running: false, currentIndex: 0 })
    saveQueue({ items: [item('rapid-3')], running: false, currentIndex: 0 })

    await new Promise((resolve) => setTimeout(resolve, 60))

    const dir = process.env['LOA_USER_DATA_DIR']!
    const queueFile = join(dir, 'config', 'apply-queue.json')
    const parsed = JSON.parse(readFileSync(queueFile, 'utf8')) as { items?: Array<{ id?: string }> }
    expect(parsed.items?.[0]?.id).toBe('rapid-3')
    expect(existsSync(join(dir, 'config', `apply-queue.json.${process.pid}.tmp`))).toBe(false)
  })

  it('preserves lastRunSummary through save/load', async () => {
    const { saveQueue, loadQueue } = await import('../../../src/main/apply-queue-store')
    const summary = {
      startedAt: '2026-04-03T00:00:00Z',
      finishedAt: '2026-04-03T00:01:00Z',
      durationSec: 60,
      done: 3,
      failed: 1,
      skipped: 0,
      pending: 0,
      total: 4
    }
    saveQueue({ items: [], running: false, currentIndex: 0, lastRunSummary: summary })
    const loaded = loadQueue()
    expect(loaded.lastRunSummary).toEqual(summary)
  })

  it('retryStuckItemsIfAnswered resets error items whose stuck labels now have answers', async () => {
    const { addToQueue, updateItemStatus, retryStuckItemsIfAnswered, loadQueue } = await import(
      '../../../src/main/apply-queue-store'
    )
    addToQueue([item('x'), item('y')])
    updateItemStatus('x', 'error', {
      detail: 'Required fields unfilled.',
      stuckFieldLabels: ['Are you authorized?', 'Years of Experience']
    })
    updateItemStatus('y', 'error', {
      detail: 'Required fields unfilled.',
      stuckFieldLabels: ['Cover letter required']
    })

    const answerKeys = new Set(['are_you_authorized', 'years_of_experience'])
    const { retriedCount, state } = retryStuckItemsIfAnswered(answerKeys)
    expect(retriedCount).toBe(1)
    expect(state.items.find((i) => i.id === 'x')?.status).toBe('pending')
    expect(state.items.find((i) => i.id === 'x')?.stuckFieldLabels).toBeUndefined()
    expect(state.items.find((i) => i.id === 'y')?.status).toBe('error')

    const persisted = loadQueue()
    expect(persisted.items.find((i) => i.id === 'x')?.status).toBe('pending')
  })

  it('retryStuckItemsIfAnswered uses fuzzy matching for near-identical labels', async () => {
    const { addToQueue, updateItemStatus, retryStuckItemsIfAnswered } = await import(
      '../../../src/main/apply-queue-store'
    )
    addToQueue([item('agoda')])
    updateItemStatus('agoda', 'error', {
      detail: 'Required fields unfilled.',
      stuckFieldLabels: [
        'In which country/region are you currently based?',
        'Given that the majority of our team is based in Bangkok, would you be open to relocating there? We offer visa sponsorship and comprehensive relocation assistance.'
      ]
    })
    const answerKeys = new Set([
      'in_which_country_are_you_currently_based',
      'given_that_the_majority_of_our_team_is_based_in_bangkok_would_you_be_open_to_relocating_there_we_offer_sponsorship_and_comprehensive_relocation_assistance'
    ])
    const { retriedCount } = retryStuckItemsIfAnswered(answerKeys)
    expect(retriedCount).toBe(1)
  })

  it('retryStuckItemsIfAnswered does nothing when answer bank is empty', async () => {
    const { addToQueue, updateItemStatus, retryStuckItemsIfAnswered } = await import(
      '../../../src/main/apply-queue-store'
    )
    addToQueue([item('z')])
    updateItemStatus('z', 'error', {
      detail: 'stuck',
      stuckFieldLabels: ['Some field']
    })
    const { retriedCount } = retryStuckItemsIfAnswered(new Set())
    expect(retriedCount).toBe(0)
  })
})
