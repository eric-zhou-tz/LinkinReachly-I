import { describe, expect, it } from 'vitest'
import type { UserProfile } from '@core/profile-db'
import {
  simpleHash,
  parseFlexibleDate,
  calculateDurationMonths,
  calculateRecencyWeight,
  recommendationFromScore,
  isProfileUsableForJobFit
} from '@core/profile-db'

function bareProfile(partial: Partial<UserProfile>): UserProfile {
  return {
    name: '',
    location: '',
    email: '',
    linkedinUrl: '',
    summary: '',
    entries: [],
    education: [],
    languages: [],
    countriesWorked: [],
    totalYearsExperience: 0,
    lastUpdated: '2026-01-01',
    ...partial
  }
}

describe('simpleHash', () => {
  it('returns a hex string', () => {
    const hash = simpleHash('test')
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  it('is deterministic', () => {
    expect(simpleHash('hello world')).toBe(simpleHash('hello world'))
  })

  it('produces different hashes for different inputs', () => {
    expect(simpleHash('abc')).not.toBe(simpleHash('xyz'))
  })
})

describe('parseFlexibleDate', () => {
  it('parses "Jan 2026" format', () => {
    const d = parseFlexibleDate('Jan 2026')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(0) // January
  })

  it('parses "July 2020" full month name', () => {
    const d = parseFlexibleDate('July 2020')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2020)
    expect(d!.getMonth()).toBe(6)
  })

  it('parses "Present" as roughly now', () => {
    const d = parseFlexibleDate('Present')
    expect(d).not.toBeNull()
    const now = new Date()
    expect(Math.abs(d!.getTime() - now.getTime())).toBeLessThan(2000) // within 2s
  })

  it('parses bare year "2025"', () => {
    const d = parseFlexibleDate('2025')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2025)
    expect(d!.getMonth()).toBe(0) // defaults to January
  })

  it('returns null for empty string', () => {
    expect(parseFlexibleDate('')).toBeNull()
  })

  it('returns null for garbage', () => {
    expect(parseFlexibleDate('not a date')).toBeNull()
  })
})

describe('calculateDurationMonths', () => {
  it('calculates months between two dates', () => {
    expect(calculateDurationMonths('Jan 2020', 'Jan 2022')).toBe(24)
  })

  it('handles same-year ranges', () => {
    expect(calculateDurationMonths('Mar 2021', 'Sep 2021')).toBe(6)
  })

  it('returns at least 1 for very short ranges', () => {
    expect(calculateDurationMonths('Jan 2020', 'Jan 2020')).toBe(1)
  })

  it('handles compact ranges like "Jan - May 2025"', () => {
    const months = calculateDurationMonths('Jan – May 2025', '')
    expect(months).toBe(5)
  })

  it('returns 0 for unparseable dates', () => {
    expect(calculateDurationMonths('garbage', 'nonsense')).toBe(0)
  })
})

describe('calculateRecencyWeight', () => {
  it('returns 1.0 for "Present"', () => {
    expect(calculateRecencyWeight('Present')).toBe(1.0)
  })

  it('returns 1.0 for recent end date', () => {
    const now = new Date()
    const monthName = now.toLocaleString('en', { month: 'short' })
    const dateStr = `${monthName} ${now.getFullYear()}`
    expect(calculateRecencyWeight(dateStr)).toBe(1.0)
  })

  it('decays for older dates', () => {
    // 3 years ago should be ~0.5 (half-life is 36 months)
    const threeYearsAgo = new Date()
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3)
    const dateStr = `Jan ${threeYearsAgo.getFullYear()}`
    const weight = calculateRecencyWeight(dateStr)
    expect(weight).toBeGreaterThan(0.3)
    expect(weight).toBeLessThan(0.7)
  })

  it('returns 0.5 for unparseable dates', () => {
    expect(calculateRecencyWeight('unknown')).toBe(0.5)
  })
})

describe('recommendationFromScore', () => {
  it('returns strong_fit for 75+', () => {
    expect(recommendationFromScore(80)).toBe('strong_fit')
    expect(recommendationFromScore(75)).toBe('strong_fit')
  })

  it('returns good_fit for 60-74', () => {
    expect(recommendationFromScore(65)).toBe('good_fit')
  })

  it('returns stretch for 40-59', () => {
    expect(recommendationFromScore(50)).toBe('stretch')
  })

  it('returns poor_fit for under 40', () => {
    expect(recommendationFromScore(20)).toBe('poor_fit')
  })
})

describe('isProfileUsableForJobFit', () => {
  it('returns false for null/undefined', () => {
    expect(isProfileUsableForJobFit(null)).toBe(false)
    expect(isProfileUsableForJobFit(undefined)).toBe(false)
  })

  it('returns true when experience entries exist', () => {
    expect(
      isProfileUsableForJobFit(
        bareProfile({
          entries: [
            {
              id: '1',
              type: 'experience',
              role: 'Engineer',
              company: 'Co',
              startDate: 'Jan 2020',
              endDate: 'Present',
              durationMonths: 12,
              skills: [],
              metrics: [],
              domain: [],
              experienceType: 'engineer',
              bullets: [],
              recencyWeight: 1
            }
          ]
        })
      )
    ).toBe(true)
  })

  it('returns true with education only', () => {
    expect(
      isProfileUsableForJobFit(
        bareProfile({
          education: [
            {
              id: 'e1',
              institution: 'State U',
              degree: 'BS',
              field: 'CS',
              location: '',
              graduationYear: 2020,
              highlights: []
            }
          ]
        })
      )
    ).toBe(true)
  })

  it('returns true with long summary only', () => {
    expect(isProfileUsableForJobFit(bareProfile({ summary: 'a'.repeat(41) }))).toBe(true)
    expect(isProfileUsableForJobFit(bareProfile({ summary: 'a'.repeat(40) }))).toBe(false)
  })
})
