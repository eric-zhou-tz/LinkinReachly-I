import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApplicationRecord } from '@core/application-types'

const { loadApplicationHistoryMock } = vi.hoisted(() => ({
  loadApplicationHistoryMock: vi.fn<() => ApplicationRecord[]>()
}))

vi.mock('../../../src/main/application-history-store', () => ({
  loadApplicationHistory: () => loadApplicationHistoryMock(),
  updateApplicationRecord: vi.fn()
}))

vi.mock('../../../src/main/apply-queue-store', () => ({
  loadQueue: vi.fn(() => ({ items: [], running: false, currentIndex: 0 })),
  saveQueue: vi.fn()
}))

vi.mock('../../../src/main/settings', () => ({
  loadSettings: vi.fn(() => ({ autoSuggestOutreachAfterApply: false }))
}))

vi.mock('../../../src/main/broadcast-to-renderer', () => ({
  broadcastToRenderer: vi.fn()
}))

vi.mock('../../../src/main/app-log', () => ({
  appLog: { info: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

import { buildOutreachCandidatesFromHistory } from '../../../src/main/apply-queue-helpers'

function baseRecord(overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
  return {
    id: 'r1',
    createdAt: '2026-04-01T12:00:00.000Z',
    company: 'Acme',
    title: 'Engineer',
    source: 'linkedin_easy_apply',
    outcome: 'submitted',
    easyApply: true,
    companySignals: {
      companyType: 'other',
      stage: 'unknown',
      industry: 'other',
      workModel: 'unknown'
    },
    hiringTeam: [{ name: 'Jane Doe', title: 'Recruiter', profileUrl: 'https://www.linkedin.com/in/janedoe' }],
    ...overrides
  }
}

describe('apply-queue-helpers', () => {
  beforeEach(() => {
    loadApplicationHistoryMock.mockReset()
  })

  describe('buildOutreachCandidatesFromHistory', () => {
    it('returns empty array for empty history', () => {
      loadApplicationHistoryMock.mockReturnValue([])
      expect(buildOutreachCandidatesFromHistory(loadApplicationHistoryMock())).toEqual([])
      expect(buildOutreachCandidatesFromHistory([])).toEqual([])
    })

    it('excludes records with outreachStatus sent', () => {
      const history = [
        baseRecord({ id: 'a', outreachStatus: 'sent' }),
        baseRecord({ id: 'b', outreachStatus: 'pending' })
      ]
      loadApplicationHistoryMock.mockReturnValue(history)
      const fromMock = buildOutreachCandidatesFromHistory(loadApplicationHistoryMock())
      expect(fromMock).toHaveLength(1)
      expect(fromMock[0]!.applicationRecordId).toBe('b')
    })

    it('includes submitted outcome records that qualify', () => {
      const history = [baseRecord({ id: 'x', outcome: 'submitted' })]
      const out = buildOutreachCandidatesFromHistory(history)
      expect(out).toHaveLength(1)
      expect(out[0]!.applicationRecordId).toBe('x')
    })

    it('excludes records without easyApply true', () => {
      const history = [
        baseRecord({ id: 'easy', easyApply: true }),
        baseRecord({ id: 'no-ea', easyApply: false }),
        baseRecord({ id: 'missing-ea', easyApply: undefined })
      ]
      const out = buildOutreachCandidatesFromHistory(history)
      expect(out.map((c) => c.applicationRecordId)).toEqual(['easy'])
    })

    it('excludes records without a known hiring contact and no jobUrl', () => {
      const history = [
        baseRecord({ id: 'has-contact' }),
        baseRecord({ id: 'no-team', hiringTeam: undefined }),
        baseRecord({ id: 'empty-team', hiringTeam: [] }),
        baseRecord({ id: 'no-profile', hiringTeam: [{ name: 'Someone', title: 'Recruiter' }] })
      ]
      const out = buildOutreachCandidatesFromHistory(history)
      expect(out.map((c) => c.applicationRecordId)).toEqual(['has-contact'])
    })

    it('includes records without hiring team if jobUrl is present (chain can re-extract)', () => {
      const history = [
        baseRecord({ id: 'with-url', hiringTeam: undefined, jobUrl: 'https://www.linkedin.com/jobs/view/123' }),
        baseRecord({ id: 'no-url-no-team', hiringTeam: undefined }),
      ]
      const out = buildOutreachCandidatesFromHistory(history)
      expect(out.map((c) => c.applicationRecordId)).toEqual(['with-url'])
    })
  })
})
