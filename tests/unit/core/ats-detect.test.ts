import { describe, expect, it } from 'vitest'
import { detectAts, getSupportedAtsLabels } from '@core/ats-detect'

describe('detectAts', () => {
  it('detects Greenhouse URLs', () => {
    const result = detectAts('https://boards.greenhouse.io/example/jobs/1234567')
    expect(result.matched).toBe(true)
    expect(result.atsId).toBe('greenhouse')
    expect(result.surface).toBe('ats')
    expect(result.company).toBe('example')
    expect(result.jobId).toBe('1234567')
  })

  it('does not classify Greenhouse confirmation pages as apply flow', () => {
    const r = detectAts('https://boards.greenhouse.io/example/jobs/1234567/confirmation')
    expect(r.matched).toBe(false)
    expect(r.atsId).toBe('unknown')
  })

  it('detects Lever URLs', () => {
    const result = detectAts('https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555')
    expect(result.matched).toBe(true)
    expect(result.atsId).toBe('lever')
    expect(result.company).toBe('acme')
  })

  it('detects Workday wd* host variants', () => {
    const wd2 = detectAts(
      'https://acme.wd2.myworkdayjobs.com/en-US/careers/job/New-York-NY/Software-Engineer_R1234'
    )
    const wd5 = detectAts(
      'https://acme.wd5.myworkdayjobs.com/en-US/External/job/San-Francisco-CA/Engineer_JR-99'
    )
    const wd12 = detectAts(
      'https://acme.wd12.myworkdayjobs.com/en-US/careers/job/Austin-TX/Product-Designer_JR-42'
    )

    expect(wd2.matched).toBe(true)
    expect(wd5.matched).toBe(true)
    expect(wd12.matched).toBe(true)
    expect(wd2.atsId).toBe('workday')
    expect(wd5.atsId).toBe('workday')
    expect(wd12.atsId).toBe('workday')
  })

  it('detects Ashby URLs', () => {
    const result = detectAts('https://jobs.ashbyhq.com/notion/11111111-2222-3333-4444-555555555555')
    expect(result.matched).toBe(true)
    expect(result.atsId).toBe('ashby')
    expect(result.company).toBe('notion')
  })

  it('detects iCIMS by hostname', () => {
    const r = detectAts('https://acme.icims.com/jobs/1234/customer/job')
    expect(r.matched).toBe(true)
    expect(r.atsId).toBe('icims')
    expect(r.confidence).toBe('medium')
  })

  it('detects Indeed Smart Apply as board, not Indeed Hiring', () => {
    const r = detectAts('https://smartapply.indeed.com/beta/indeedapply/form/contact-info')
    expect(r.matched).toBe(true)
    expect(r.atsId).toBe('indeed_smartapply')
    expect(r.surface).toBe('board')
  })

  it('detects Handshake board', () => {
    const r = detectAts('https://joinhandshake.com/jobs/abc')
    expect(r.matched).toBe(true)
    expect(r.atsId).toBe('handshake')
    expect(r.surface).toBe('board')
  })

  it('excludes Uber dashboard URLs from Uber vendor hostname match', () => {
    const r = detectAts('https://www.uber.com/global/en/careers/apply/dashboard/123/')
    expect(r.matched).toBe(false)
    expect(r.atsId).toBe('unknown')
  })

  it('returns unknown when no pattern matches', () => {
    const result = detectAts('https://careers.example.com/apply/123')
    expect(result.matched).toBe(false)
    expect(result.atsId).toBe('unknown')
  })

  it('getSupportedAtsLabels includes vendors and boards', () => {
    const labels = getSupportedAtsLabels()
    expect(labels.some((l) => /Greenhouse/i.test(l))).toBe(true)
    expect(labels.some((l) => /Indeed Smart Apply/i.test(l))).toBe(true)
  })
})
