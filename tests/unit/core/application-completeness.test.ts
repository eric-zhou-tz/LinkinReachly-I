import { describe, expect, it } from 'vitest'
import { getProfileCompleteness } from '@core/application-completeness'
import type { ApplicantProfile } from '@core/application-types'

function emptyProfile(): ApplicantProfile {
  return {
    version: 1,
    basics: { fullName: '', email: '' },
    links: {},
    workAuth: { countryCode: 'US' },
    compensation: {},
    background: {},
    assets: [],
    answerBank: [],
    updatedAt: new Date(0).toISOString()
  }
}

describe('getProfileCompleteness', () => {
  it('empty profile: not ready, score 0', () => {
    const c = getProfileCompleteness(emptyProfile())
    expect(c.readyToApply).toBe(false)
    expect(c.complete).toBe(false)
    expect(c.score).toBe(0)
    expect(c.missingRequired).toContain('Full name')
    expect(c.missingRequired).toContain('Email')
  })

  it('name + email + resume: ready, low score', () => {
    const p = emptyProfile()
    p.basics.fullName = 'Ada Lovelace'
    p.basics.email = 'ada@example.com'
    p.assets = [{ id: 'r1', kind: 'resume', label: 'Resume', fileName: 'resume.pdf', storagePath: '/tmp/resume.pdf', mimeType: 'application/pdf', updatedAt: new Date().toISOString() }]
    const c = getProfileCompleteness(p)
    expect(c.readyToApply).toBe(true)
    expect(c.complete).toBe(false)
    expect(c.score).toBeGreaterThanOrEqual(15)
    expect(c.score).toBeLessThanOrEqual(45)
    expect(c.missingRecommended.length).toBeGreaterThan(0)
  })

  it('name + email without resume: not ready (resume is required)', () => {
    const p = emptyProfile()
    p.basics.fullName = 'Ada Lovelace'
    p.basics.email = 'ada@example.com'
    const c = getProfileCompleteness(p)
    expect(c.readyToApply).toBe(false)
    expect(c.missingRequired).toContain('Resume uploaded')
  })

  it('full recommended + optional: complete and 100', () => {
    const p = emptyProfile()
    p.basics = {
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '555',
      city: 'London',
      state: 'Eng',
      country: 'UK',
      currentLocationLine: 'London, Eng, UK',
      currentResidenceAnswer: 'I am currently residing in London, Eng, UK.'
    }
    p.links = {
      linkedInUrl: 'https://linkedin.com/in/ada',
      portfolioUrl: 'https://ada.dev',
      githubUrl: 'https://github.com/ada',
      websiteUrl: 'https://ada.com'
    }
    p.workAuth = {
      countryCode: 'UK',
      authorizedToWork: true,
      requiresSponsorship: false
    }
    p.compensation = {
      salaryMin: 120000,
      salaryCurrency: 'USD',
      noticePeriod: '2 weeks',
      startDatePreference: 'ASAP',
      workLocationPreference: 'remote'
    }
    p.assets = [
      {
        id: 'r1',
        kind: 'resume',
        label: 'Resume',
        fileName: 'cv.pdf',
        storagePath: '/tmp/cv.pdf',
        mimeType: 'application/pdf',
        updatedAt: new Date().toISOString()
      }
    ]
    const c = getProfileCompleteness(p)
    expect(c.readyToApply).toBe(true)
    expect(c.complete).toBe(true)
    expect(c.score).toBe(100)
    expect(c.missingRecommended).toHaveLength(0)
  })

  it('missing phone lists in missingRecommended', () => {
    const p = emptyProfile()
    p.basics.fullName = 'A'
    p.basics.email = 'a@b.c'
    p.basics.city = 'NYC'
    p.links.linkedInUrl = 'https://li'
    p.workAuth.authorizedToWork = true
    p.workAuth.requiresSponsorship = false
    p.assets = [
      {
        id: 'r',
        kind: 'resume',
        label: 'R',
        fileName: 'f.pdf',
        storagePath: '/x',
        mimeType: 'application/pdf',
        updatedAt: new Date().toISOString()
      }
    ]
    const c = getProfileCompleteness(p)
    expect(c.missingRecommended).toContain('Phone')
  })
})
