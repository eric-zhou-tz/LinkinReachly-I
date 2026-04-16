import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { mockUserDataDir } = vi.hoisted(() => ({
  mockUserDataDir: vi.fn<() => string>()
}))

vi.mock('../../../src/main/user-data-path', () => ({
  userDataDir: mockUserDataDir
}))

import {
  buildApplicationInsights,
  inferCompanySignals
} from '../../../src/main/application-history'
import {
  appendApplicationRecord,
  computeInsights,
  loadApplicationHistory
} from '../../../src/main/application-history-store'
import type { ApplicationInsightsBucket } from '../../../src/core/application-types'

describe('application-history', () => {
  let tempDir = ''

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'linkinreachly-application-history-'))
    mockUserDataDir.mockReturnValue(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('infers startup, AI, and remote signals from application context', () => {
    const signals = inferCompanySignals({
      company: 'Nova Labs',
      title: 'Staff AI Engineer',
      location: 'Remote',
      source: 'linkedin_easy_apply',
      outcome: 'opened',
      detail: 'Seed-stage startup building LLM workflow tools'
    })

    expect(signals.companyType).toBe('startup')
    expect(signals.industry).toBe('ai_ml')
    expect(signals.workModel).toBe('remote')
    expect(signals.stage).toBe('seed_to_series_a')
  })

  it('persists application activity and computes company insight buckets', () => {
    appendApplicationRecord({
      company: 'Nova Labs',
      title: 'Staff AI Engineer',
      location: 'Remote',
      source: 'linkedin_easy_apply',
      outcome: 'autofilled',
      detail: 'Seed-stage startup building LLM workflow tools'
    })
    appendApplicationRecord({
      company: 'Mercury Bank',
      title: 'Product Lead',
      location: 'Hybrid - New York, NY',
      source: 'manual',
      outcome: 'opened',
      detail: 'Fintech growth-stage company'
    })

    const records = loadApplicationHistory()
    const insights = computeInsights(records)
    expect(records).toHaveLength(2)
    expect(insights.total).toBe(2)
    expect(insights.submittedCount).toBe(1)
    expect(insights.activeCount).toBe(1)
    expect(insights.blockedCount).toBe(0)
    expect(insights.byIndustry.map((bucket: ApplicationInsightsBucket) => bucket.key)).toContain('ai_ml')
    expect(insights.byIndustry.map((bucket: ApplicationInsightsBucket) => bucket.key)).toContain('fintech')
  })

  it('builds stable insight buckets from existing records', () => {
    const insights = buildApplicationInsights([
      {
        id: '1',
        createdAt: '2026-03-30T00:00:00.000Z',
        company: 'Nova Labs',
        title: 'AI Engineer',
        source: 'linkedin_easy_apply',
        outcome: 'submitted',
        companySignals: {
          companyType: 'startup',
          stage: 'seed_to_series_a',
          industry: 'ai_ml',
          workModel: 'remote'
        }
      },
      {
        id: '2',
        createdAt: '2026-03-31T00:00:00.000Z',
        company: 'Acme Corp',
        title: 'Platform Engineer',
        source: 'manual',
        outcome: 'needs_review',
        companySignals: {
          companyType: 'enterprise',
          stage: 'enterprise',
          industry: 'enterprise_software',
          workModel: 'hybrid'
        }
      }
    ])

    expect(insights.needsReviewCount).toBe(1)
    expect(insights.blockedCount).toBe(0)
    expect(insights.byCompanyType[0]).toEqual(expect.objectContaining({ key: 'enterprise', count: 1 }))
    expect(insights.byCompanyType[1]).toEqual(expect.objectContaining({ key: 'startup', count: 1 }))
  })

  it('does not count extension_stale failures as blocked', () => {
    appendApplicationRecord({
      company: 'Acme',
      title: 'Engineer',
      source: 'linkedin_easy_apply',
      outcome: 'failed',
      detail: 'extension_stale',
      reasonSnippet: 'extension_stale'
    })
    const ins = computeInsights(loadApplicationHistory())
    expect(ins.blockedCount).toBe(0)
    expect(ins.total).toBe(1)
  })
})
