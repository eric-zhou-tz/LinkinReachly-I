import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let prevDataDir: string | undefined

beforeEach(() => {
  prevDataDir = process.env['LOA_USER_DATA_DIR']
  process.env['LOA_USER_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'loa-apphist-'))
})

afterEach(() => {
  const d = process.env['LOA_USER_DATA_DIR']
  if (d && existsSync(d)) {
    rmSync(d, { recursive: true, force: true })
  }
  if (prevDataDir === undefined) delete process.env['LOA_USER_DATA_DIR']
  else process.env['LOA_USER_DATA_DIR'] = prevDataDir
})

describe('application-history-store', () => {
  it('load returns empty array when no file exists', async () => {
    const { loadApplicationHistory } = await import('../../../src/main/application-history-store')
    expect(loadApplicationHistory()).toEqual([])
  })

  it('append creates record with id and createdAt', async () => {
    const { appendApplicationRecord, loadApplicationHistory } = await import(
      '../../../src/main/application-history-store'
    )
    const rec = appendApplicationRecord({
      company: 'Acme',
      title: 'Engineer',
      source: 'manual',
      outcome: 'opened'
    })
    expect(rec.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(rec.createdAt).toBeTruthy()
    expect(rec.company).toBe('Acme')
    const all = loadApplicationHistory()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(rec.id)
  })

  it('round-trip append then load', async () => {
    const { appendApplicationRecord, loadApplicationHistory } = await import(
      '../../../src/main/application-history-store'
    )
    appendApplicationRecord({
      company: 'B',
      title: 'T',
      source: 'manual',
      outcome: 'submitted'
    })
    const rows = loadApplicationHistory()
    expect(rows.length).toBe(1)
    expect(rows[0].outcome).toBe('submitted')
  })

  it('preserves stuckFieldLabels and generated coverLetterMeta through load normalization', async () => {
    const { appendApplicationRecord, loadApplicationHistory } = await import(
      '../../../src/main/application-history-store'
    )
    appendApplicationRecord({
      company: 'Chronicle',
      title: 'Content Creator',
      source: 'linkedin_easy_apply',
      outcome: 'needs_review',
      detail: '2 required fields unfilled.',
      stuckFieldLabels: ['Meta, include links?', 'Work authorization status'],
      coverLetterMeta: { mode: 'generated', model: 'gpt-5.2' },
      hiringTeam: [
        { name: 'Ada Recruiter', profileUrl: 'https://www.linkedin.com/in/ada-recruiter/' }
      ],
      hiringTeamSearchHint: '"Chronicle" "Content Creator" hiring manager OR recruiter',
      pipelineStage: 'applied'
    })

    const rows = loadApplicationHistory()
    expect(rows).toHaveLength(1)
    expect(rows[0].stuckFieldLabels).toEqual(['Meta, include links?', 'Work authorization status'])
    expect(rows[0].coverLetterMeta?.mode).toBe('generated')
    expect(rows[0].coverLetterMeta?.model).toBe('gpt-5.2')
    expect(rows[0].hiringTeam?.[0]?.profileUrl).toContain('/in/ada-recruiter/')
    expect(rows[0].hiringTeamSearchHint).toContain('"Chronicle"')
    expect(rows[0].pipelineStage).toBe('applied')
  })

  it('updates hiring team, pipeline stage, and stuck labels without dropping fields', async () => {
    const { appendApplicationRecord, updateApplicationRecord, loadApplicationHistory } = await import(
      '../../../src/main/application-history-store'
    )

    const rec = appendApplicationRecord({
      company: 'Acme',
      title: 'ML Engineer',
      source: 'linkedin_easy_apply',
      outcome: 'autofilled',
      detail: 'Filled 2/5 fields.',
      coverLetterMeta: { mode: 'tailored', model: 'gpt-5.4' }
    })

    const updated = updateApplicationRecord(rec.id, {
      hiringTeam: [{ name: 'Sam Hiring Manager', profileUrl: 'https://www.linkedin.com/in/sam-hiring/' }],
      hiringTeamSearchHint: '"Acme" "ML Engineer" hiring manager OR recruiter',
      pipelineStage: 'response',
      stuckFieldLabels: ['Do you need sponsorship?']
    })

    expect(updated?.hiringTeam?.[0]?.name).toBe('Sam Hiring Manager')
    expect(updated?.hiringTeamSearchHint).toContain('"Acme"')
    expect(updated?.pipelineStage).toBe('response')
    expect(updated?.stuckFieldLabels).toEqual(['Do you need sponsorship?'])
    expect(updated?.coverLetterMeta?.mode).toBe('tailored')

    const rows = loadApplicationHistory()
    expect(rows[0]?.hiringTeam?.[0]?.profileUrl).toContain('/in/sam-hiring/')
    expect(rows[0]?.pipelineStage).toBe('response')
    expect(rows[0]?.stuckFieldLabels).toEqual(['Do you need sponsorship?'])
    expect(rows[0]?.coverLetterMeta?.mode).toBe('tailored')
  })

  it('computeInsights counts outcomes', async () => {
    const { appendApplicationRecord, loadApplicationHistory, computeInsights } = await import(
      '../../../src/main/application-history-store'
    )
    appendApplicationRecord({
      company: 'c',
      title: 't',
      source: 'linkedin_easy_apply',
      outcome: 'submitted'
    })
    appendApplicationRecord({
      company: 'c2',
      title: 't2',
      source: 'linkedin_easy_apply',
      outcome: 'opened'
    })
    appendApplicationRecord({
      company: 'c3',
      title: 't3',
      source: 'linkedin_easy_apply',
      outcome: 'needs_review'
    })
    const ins = computeInsights(loadApplicationHistory())
    expect(ins.total).toBe(3)
    expect(ins.submittedCount).toBe(1)
    expect(ins.activeCount).toBe(1)
    expect(ins.needsReviewCount).toBe(1)
    expect(ins.blockedCount).toBe(0)
  })

  it('delete removes by id', async () => {
    const { appendApplicationRecord, loadApplicationHistory, deleteApplicationRecord } = await import(
      '../../../src/main/application-history-store'
    )
    const r = appendApplicationRecord({
      company: 'x',
      title: 'y',
      source: 'manual',
      outcome: 'failed'
    })
    expect(deleteApplicationRecord(r.id)).toBe(true)
    expect(loadApplicationHistory()).toHaveLength(0)
    expect(deleteApplicationRecord('missing')).toBe(false)
  })

  it('collapses legacy needs_review + failed twin rows for same job/detail', async () => {
    const baseDir = process.env['LOA_USER_DATA_DIR'] as string
    const logs = join(baseDir, 'logs')
    mkdirSync(logs, { recursive: true })
    const historyFile = join(logs, 'applications.jsonl')

    const t0 = new Date('2026-04-13T10:00:00.000Z')
    const t1 = new Date(t0.getTime() + 5_000)
    const t2 = new Date(t0.getTime() + 20_000)
    const lines = [
      {
        id: 'nr-1',
        createdAt: t0.toISOString(),
        company: 'Acme',
        title: 'ML Engineer',
        source: 'linkedin_easy_apply',
        outcome: 'needs_review',
        jobUrl: 'https://www.linkedin.com/jobs/view/1',
        detail:
          "The Easy Apply form didn't open on this page. The job may have been removed or may not support Easy Apply. Filled 0/0 fields. sessionId=101"
      },
      {
        id: 'f-1',
        createdAt: t1.toISOString(),
        company: 'Acme',
        title: 'ML Engineer',
        source: 'linkedin_easy_apply',
        outcome: 'failed',
        jobUrl: 'https://www.linkedin.com/jobs/view/1',
        detail:
          "The Easy Apply form didn't open on this page. The job may have been removed or may not support Easy Apply. Filled 0/0 fields."
      },
      {
        id: 'nr-2',
        createdAt: t2.toISOString(),
        company: 'Beta',
        title: 'Researcher',
        source: 'linkedin_easy_apply',
        outcome: 'needs_review',
        jobUrl: 'https://www.linkedin.com/jobs/view/2',
        detail: '2 required fields unfilled.'
      }
    ].map((r) => JSON.stringify(r))

    writeFileSync(historyFile, `${lines.join('\n')}\n`, 'utf8')

    const { loadApplicationHistory } = await import('../../../src/main/application-history-store')
    const rows = loadApplicationHistory()
    expect(rows.map((r) => r.id)).toEqual(['nr-2', 'f-1'])
  })

  it('does not collapse rows that are not near-simultaneous twins', async () => {
    const baseDir = process.env['LOA_USER_DATA_DIR'] as string
    const logs = join(baseDir, 'logs')
    mkdirSync(logs, { recursive: true })
    const historyFile = join(logs, 'applications.jsonl')

    const t0 = new Date('2026-04-13T10:00:00.000Z')
    const t1 = new Date(t0.getTime() + 60_000)
    const lines = [
      {
        id: 'nr-1',
        createdAt: t0.toISOString(),
        company: 'Acme',
        title: 'ML Engineer',
        source: 'linkedin_easy_apply',
        outcome: 'needs_review',
        jobUrl: 'https://www.linkedin.com/jobs/view/3',
        detail:
          "The Easy Apply form didn't open on this page. The job may have been removed or may not support Easy Apply. Filled 0/0 fields."
      },
      {
        id: 'f-1',
        createdAt: t1.toISOString(),
        company: 'Acme',
        title: 'ML Engineer',
        source: 'linkedin_easy_apply',
        outcome: 'failed',
        jobUrl: 'https://www.linkedin.com/jobs/view/3',
        detail:
          "The Easy Apply form didn't open on this page. The job may have been removed or may not support Easy Apply. Filled 0/0 fields."
      }
    ].map((r) => JSON.stringify(r))

    writeFileSync(historyFile, `${lines.join('\n')}\n`, 'utf8')

    const { loadApplicationHistory } = await import('../../../src/main/application-history-store')
    const rows = loadApplicationHistory()
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.id)).toEqual(['f-1', 'nr-1'])
  })
})
