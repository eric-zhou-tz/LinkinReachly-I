import { describe, expect, it } from 'vitest'
import type { UserProfile } from '@core/profile-db'
import {
  normalizeJobSearchInput,
  rankJobsForQueries,
  rankJobsForSearch,
  rankJobsWithResumeFit,
  rerankScoredJobsForSearch,
  sortJobsByResumeFit
} from '@core/job-search'

describe('normalizeJobSearchInput', () => {
  it('keeps domain text in keywords instead of treating it as a location', () => {
    expect(normalizeJobSearchInput('looking for roles in AI, infra, and developer tools')).toEqual({
      keywords: 'AI, infra, and developer tools'
    })
  })

  it('supports non-whitelisted city names in a trailing location segment', () => {
    expect(normalizeJobSearchInput('anthropic in palo alto')).toEqual({
      keywords: 'anthropic',
      location: 'palo alto'
    })
  })

  it('trims trailing punctuation from parsed locations', () => {
    expect(normalizeJobSearchInput('roles at Anthropic in New York.')).toEqual({
      keywords: 'Anthropic',
      location: 'New York'
    })
  })

  it('extracts a bare trailing city into the location field', () => {
    expect(normalizeJobSearchInput('chief of staff ai startup new york')).toEqual({
      keywords: 'chief of staff ai startup',
      location: 'new york'
    })
  })

  it('keeps ordinary suffix phrases in keywords instead of rewriting them as locations', () => {
    expect(normalizeJobSearchInput('product manager market intelligence')).toEqual({
      keywords: 'product manager market intelligence'
    })

    expect(normalizeJobSearchInput('chief of staff frontier labs')).toEqual({
      keywords: 'chief of staff frontier labs'
    })
  })

  it('keeps explicit in-segments that describe a role area rather than a place', () => {
    expect(normalizeJobSearchInput('roles in market intelligence')).toEqual({
      keywords: 'market intelligence'
    })
  })

  it('keeps common role-family phrases after `in` in keywords', () => {
    expect(normalizeJobSearchInput('roles in business strategy')).toEqual({
      keywords: 'business strategy'
    })

    expect(normalizeJobSearchInput('roles in customer success')).toEqual({
      keywords: 'customer success'
    })

    expect(normalizeJobSearchInput('roles in public policy')).toEqual({
      keywords: 'public policy'
    })
  })

  it('promotes generic short queries into keyword plus location instead of leaving only the city', () => {
    expect(normalizeJobSearchInput('jobs new york')).toEqual({
      keywords: 'jobs',
      location: 'new york'
    })

    expect(normalizeJobSearchInput('openings berlin')).toEqual({
      keywords: 'openings',
      location: 'berlin'
    })
  })

  it('preserves bare multi-word cities instead of splitting them on the last token', () => {
    expect(normalizeJobSearchInput('jobs los gatos')).toEqual({
      keywords: 'jobs',
      location: 'los gatos'
    })

    expect(normalizeJobSearchInput('openings mexico city')).toEqual({
      keywords: 'openings',
      location: 'mexico city'
    })

    expect(normalizeJobSearchInput('openings new york city')).toEqual({
      keywords: 'openings',
      location: 'new york city'
    })
  })

  it('does not split general descriptive text after the last in-segment', () => {
    expect(
      normalizeJobSearchInput('senior engineer interested in infrastructure, reliability, and tooling at Anthropic')
    ).toEqual({
      keywords: 'senior engineer interested in infrastructure, reliability, and tooling at Anthropic'
    })
  })
})

describe('rankJobsForSearch', () => {
  it('boosts exact company matches over unrelated listings', () => {
    const ranked = rankJobsForSearch(
      [
        { title: 'Strategic Account Executive', company: 'AIRIA', location: 'New York, NY' },
        { title: 'Strategic Account Executive', company: 'Anthropic', location: 'New York, NY' }
      ],
      "I'm looking for roles at Anthropic",
      'new york'
    )

    expect(ranked[0]?.company).toBe('Anthropic')
  })

  it('uses parsed location when the keywords collapse to generic job noise', () => {
    const ranked = rankJobsForSearch(
      [
        { title: 'Any role', company: 'Acme', location: 'Berlin' },
        { title: 'Any role', company: 'Acme', location: 'New York, NY' }
      ],
      'jobs new york'
    )

    expect(ranked[0]?.location).toContain('New York')
  })
})

describe('rankJobsForQueries', () => {
  it('uses planned company-targeted queries instead of noisy background text', () => {
    const ranked = rankJobsForQueries(
      [
        { title: 'VP, Head of Transformation Office', company: 'New York Life Insurance Company', location: 'New York, NY' },
        { title: 'Product Manager, Claude Code', company: 'Anthropic', location: 'New York, NY' }
      ],
      ['Anthropic', 'Anthropic developer tools', 'Anthropic platform engineer'],
      'New York.'
    )

    expect(ranked[0]?.company).toBe('Anthropic')
  })
})

describe('rerankScoredJobsForSearch', () => {
  it('penalizes off-location results when the search asked for a specific city', () => {
    const reranked = rerankScoredJobsForSearch(
      [
        { title: 'Strategic Finance Manager, Gen AI', company: 'Scale AI', location: 'San Francisco Bay Area (Hybrid)', score: 8 },
        { title: 'Sr. Manager/Director, ADP Ventures - Investments & AI', company: 'ADP', location: 'New York, NY (On-site)', score: 6 }
      ],
      'strategic finance ai startup',
      'new york'
    )

    expect(reranked[0]?.location).toContain('New York')
    expect(reranked[0]?.score).toBeGreaterThanOrEqual(reranked[1]?.score ?? 0)
  })

  it('does not let generic remote roles outrank city matches when the request names a city', () => {
    const reranked = rerankScoredJobsForSearch(
      [
        { title: 'Applied ML Engineer', company: 'Stealth Startup', location: 'United States (Remote)', score: 7 },
        { title: 'Applied AI Engineer', company: 'Snorkel AI', location: 'New York, NY', score: 5 }
      ],
      'research engineer ai startup',
      'nyc'
    )

    expect(reranked[0]?.location).toContain('New York')
  })

  it('matches short location aliases on token boundaries instead of substrings', () => {
    const reranked = rerankScoredJobsForSearch(
      [
        { title: 'Product Manager', company: 'Acme', location: 'Portland, OR', score: 7 },
        { title: 'Product Manager', company: 'Acme', location: 'Glasgow, United Kingdom', score: 7 },
        { title: 'Product Manager', company: 'Acme', location: 'Los Angeles, CA', score: 7 }
      ],
      'product manager',
      'la'
    )

    expect(reranked[0]?.location).toContain('Los Angeles')
    expect(reranked[1]?.location).not.toContain('Los Angeles')
    expect(reranked[1]?.score).toBeLessThan(reranked[0]?.score ?? 0)
  })
})

const testProfileForResumeRanking: UserProfile = {
  name: 'Test User',
  location: 'San Francisco, CA',
  email: 'u@example.com',
  linkedinUrl: 'https://linkedin.com/in/test',
  summary:
    'Software engineer with TypeScript and React experience building APIs and developer tools.',
  entries: [
    {
      id: 'exp-1',
      type: 'experience',
      role: 'Software Engineer',
      company: 'Acme',
      startDate: 'Jan 2020',
      endDate: 'Present',
      durationMonths: 72,
      skills: ['TypeScript', 'React', 'Node.js', 'APIs'],
      metrics: [],
      domain: ['developer tools'],
      experienceType: 'engineer',
      bullets: ['Built customer-facing APIs in TypeScript'],
      recencyWeight: 1
    }
  ],
  education: [],
  languages: ['English'],
  countriesWorked: ['US'],
  totalYearsExperience: 5,
  lastUpdated: '2026-01-01'
}

describe('sortJobsByResumeFit', () => {
  it('returns jobs unchanged without resume fields when profile is missing', () => {
    const jobs = [
      { title: 'Barista', company: 'Cafe', location: 'SF', jobUrl: 'https://example.com/b' }
    ]
    const out = sortJobsByResumeFit(jobs, null)
    expect(out).toHaveLength(1)
    expect(out[0]?.resumeMatchPercent).toBeUndefined()
    expect(out[0]?.title).toBe('Barista')
  })

  it('orders jobs best-first by heuristic fit and attaches match percent', () => {
    const jobs = [
      { title: 'Barista', company: 'Cafe', location: 'SF', jobUrl: 'https://example.com/b' },
      {
        title: 'Staff Software Engineer — TypeScript',
        company: 'DevCo',
        location: 'Remote',
        jobUrl: 'https://example.com/a'
      }
    ]
    const out = sortJobsByResumeFit(jobs, testProfileForResumeRanking)
    expect(out).toHaveLength(2)
    expect(out[0]?.title).toContain('Software Engineer')
    expect(out[0]?.resumeMatchPercent).toBeDefined()
    expect(out[1]?.resumeMatchPercent).toBeDefined()
    expect(out[0]?.resumeMatchPercent).toBeGreaterThanOrEqual(out[1]?.resumeMatchPercent ?? 0)
  })
})

describe('rankJobsWithResumeFit', () => {
  it('adds fallback match percent from search relevance when profile is missing', () => {
    const out = rankJobsWithResumeFit(
      [
        { title: 'Operations Manager', company: 'Acme', location: 'Austin, TX', jobUrl: 'https://example.com/ops' },
        { title: 'Product Manager', company: 'Anthropic', location: 'New York, NY', jobUrl: 'https://example.com/pm' }
      ],
      'product manager',
      'new york',
      null
    )

    expect(out).toHaveLength(2)
    expect(out[0]?.title).toContain('Product Manager')
    expect(out[0]?.resumeMatchPercent).toBeDefined()
    expect(out[1]?.resumeMatchPercent).toBeDefined()
    expect(out[0]?.resumeMatchPercent).toBeGreaterThan(out[1]?.resumeMatchPercent ?? 0)
    expect(out[0]?.resumeMatchReason).toContain('Search relevance')
  })
})
