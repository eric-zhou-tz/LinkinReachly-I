import { describe, expect, it } from 'vitest'
import type { ApplyQueueItem, ApplyQueueState } from '@core/application-types'
import {
  buildApplyQueueRunSummary,
  collectStuckFieldLabelsFromQueueItems
} from '../../../src/main/apply-queue-run-summary'

function item(p: Partial<ApplyQueueItem> & { id: string; status: ApplyQueueItem['status'] }): ApplyQueueItem {
  return {
    jobTitle: 'T',
    company: 'C',
    location: '',
    linkedinJobUrl: 'https://li/j',
    applyUrl: 'https://li/j',
    surface: 'linkedin_easy_apply',
    addedAt: new Date().toISOString(),
    ...p
  }
}

describe('apply-queue-run-summary', () => {
  describe('collectStuckFieldLabelsFromQueueItems', () => {
    it('returns empty when no errors', () => {
      expect(collectStuckFieldLabelsFromQueueItems([item({ id: '1', status: 'done' })])).toEqual([])
    })
    it('parses unfilled labels from error detail', () => {
      expect(
        collectStuckFieldLabelsFromQueueItems([
          item({ id: '1', status: 'error', detail: 'Stuck: unfilled (Visa, Years of exp, ...)' })
        ])
      ).toEqual(['Visa', 'Years of exp'])
    })
    it('prefers structured stuckFieldLabels without splitting on commas', () => {
      expect(
        collectStuckFieldLabelsFromQueueItems([
          item({
            id: '1',
            status: 'error',
            detail:
              '10 required fields unfilled (Are you currently working at Google, Meta, AWS?). Answer these questions to continue.',
            stuckFieldLabels: ['Are you currently working at Google, Meta, AWS?']
          })
        ])
      ).toEqual(['Are you currently working at Google, Meta, AWS?'])
    })
  })

  describe('buildApplyQueueRunSummary', () => {
    it('builds summary from state and counts', () => {
      const cur: ApplyQueueState = {
        items: [item({ id: '1', status: 'error', detail: 'unfilled (Custom Q)' })],
        running: false,
        currentIndex: 0,
        startedAt: '2026-01-01T00:00:00.000Z',
        lastErrorCode: 'easy_apply_failed'
      }
      const counts = { pending: 0, active: 0, done: 0, error: 1, skipped: 0 }
      const s = buildApplyQueueRunSummary(cur, counts, 2)
      expect(s.done).toBe(0)
      expect(s.failed).toBe(1)
      expect(s.total).toBe(1)
      expect(s.stoppedReason).toBe('easy_apply_failed')
      expect(s.stuckFieldLabels).toEqual(['Custom Q'])
      expect(s.answersLearned).toBe(2)
      expect(s.durationSec).toBeGreaterThanOrEqual(0)
    })
  })
})
