import { describe, expect, it } from 'vitest'
import { applicantProfileBridgeSnapshot } from '@core/applicant-bridge-snapshot'
import type { ApplicantProfile } from '@core/application-types'

const baseProfile = (): ApplicantProfile => ({
  version: 1,
  basics: {
    fullName: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '+1 555 0100',
    city: 'London',
    country: 'UK'
  },
  links: {
    linkedInUrl: 'https://linkedin.com/in/ada',
    githubUrl: 'https://github.com/ada',
    portfolioUrl: 'https://ada.dev',
    websiteUrl: 'https://ada.example'
  },
  workAuth: { countryCode: 'UK', authorizedToWork: true, requiresSponsorship: false, clearanceEligible: true },
  compensation: {
    salaryCurrency: 'USD',
    salaryMin: 120000,
    noticePeriod: '2 weeks',
    startDatePreference: '2025-06-01'
  },
  background: { yearsOfExperience: '7', educationSummary: 'BSc Computer Science' },
  assets: [],
  answerBank: [],
  updatedAt: new Date().toISOString()
})

describe('applicantProfileBridgeSnapshot', () => {
  it('splits full name and maps core fields', () => {
    const s = applicantProfileBridgeSnapshot(baseProfile())
    expect(s.firstName).toBe('Ada')
    expect(s.lastName).toBe('Lovelace')
    expect(s.email).toBe('ada@example.com')
    expect(s.phone).toMatch(/555/)
    expect(s.linkedInUrl).toContain('linkedin.com')
    expect(s.yearsOfExperience).toBe('7')
    expect(s.authorizedToWork).toBe('Yes')
    expect(s.requiresSponsorship).toBe('No')
    expect(s.clearanceEligible).toBe('Yes')
    expect(s.phoneDigits).toMatch(/555/)
    expect(s.countryDisplay).toMatch(/kingdom|united/i)
    expect(s.startDateDashesYYYYMMDD).toBe('2025-06-01')
    expect(s.startDateSlashesMMDDYYYY).toContain('2025')
    expect(s.salaryMin).toBe(120000)
    expect(s.noticePeriod).toBe('2 weeks')
    expect(s.educationSummary).toContain('BSc')
    expect(Array.isArray(s.answerBank)).toBe(true)
    expect(s.currentLocationLine).toBe('')
    expect(s.currentResidenceAnswer).toBe('')
  })

  it('passes through currentLocationLine', () => {
    const p = baseProfile()
    p.basics.currentLocationLine = 'Brooklyn, NY, USA'
    const s = applicantProfileBridgeSnapshot(p)
    expect(s.currentLocationLine).toBe('Brooklyn, NY, USA')
  })

  it('passes through currentResidenceAnswer', () => {
    const p = baseProfile()
    p.basics.currentResidenceAnswer = 'I currently reside in London, UK.'
    const s = applicantProfileBridgeSnapshot(p)
    expect(s.currentResidenceAnswer).toBe('I currently reside in London, UK.')
  })

  it('handles single-token full name', () => {
    const p = baseProfile()
    p.basics.fullName = 'Cher'
    const s = applicantProfileBridgeSnapshot(p)
    expect(s.firstName).toBe('Cher')
    expect(s.lastName).toBe('')
  })
})
