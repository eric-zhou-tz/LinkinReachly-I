import { describe, expect, it } from 'vitest'
import {
  buildHiringManagerPeopleSearch,
  isPermittedLinkedInNavigationUrl,
  parseOutreachMarkSentPayload,
  parseOutreachRunChainPayload,
  parseOutreachRunPayload,
  parseOutreachSkipPayload,
  parseSearchHiringManagerPayload,
  pickStoredHiringPoster,
  selectChainCandidates
} from '../../../src/main/application-outreach-chain'
import type { PostApplyOutreachCandidate } from '../../../src/main/apply-queue-helpers'

function cand(p: Partial<PostApplyOutreachCandidate> & { applicationRecordId: string }): PostApplyOutreachCandidate {
  return {
    jobTitle: 'Eng',
    company: 'Acme',
    jobUrl: 'https://linkedin.com/jobs/1',
    ...p
  }
}

describe('application-outreach-chain', () => {
  describe('parseOutreachRunChainPayload', () => {
    it('returns empty for null', () => {
      expect(parseOutreachRunChainPayload(null)).toEqual({})
    })
    it('normalizes candidateIds and caps maxTargets', () => {
      expect(
        parseOutreachRunChainPayload({
          candidateIds: [' a ', '', 'b'],
          maxTargets: 500
        })
      ).toEqual({ candidateIds: ['a', 'b'], maxTargets: 100 })
    })
    it('ignores invalid maxTargets', () => {
      expect(parseOutreachRunChainPayload({ maxTargets: 0 })).toEqual({})
      expect(parseOutreachRunChainPayload({ maxTargets: NaN })).toEqual({})
    })
  })

  describe('parseOutreachRunPayload', () => {
    it('returns null for invalid payloads', () => {
      expect(parseOutreachRunPayload(null)).toBeNull()
      expect(parseOutreachRunPayload({})).toBeNull()
      expect(parseOutreachRunPayload({ targets: [] })).toBeNull()
      expect(parseOutreachRunPayload({ targets: [{}] })).toBeNull()
    })
    it('parses valid targets', () => {
      expect(
        parseOutreachRunPayload({
          targets: [
            {
              profileUrl: ' https://www.linkedin.com/in/x ',
              firstName: 'A',
              company: 'Co',
              headline: 'H',
              jobTitle: 'T',
              jobUrl: 'https://www.linkedin.com/jobs/1',
              applicationRecordId: 'rec-1'
            }
          ]
        })
      ).toEqual({
        targets: [
          {
            profileUrl: 'https://www.linkedin.com/in/x',
            firstName: 'A',
            company: 'Co',
            headline: 'H',
            jobTitle: 'T',
            jobUrl: 'https://www.linkedin.com/jobs/1',
            applicationRecordId: 'rec-1'
          }
        ]
      })
    })
  })

  describe('selectChainCandidates', () => {
    const pool = [cand({ applicationRecordId: '1' }), cand({ applicationRecordId: '2' }), cand({ applicationRecordId: '3' })]

    it('slices by maxTargets default 10', () => {
      const many = Array.from({ length: 15 }, (_, i) => cand({ applicationRecordId: String(i) }))
      expect(selectChainCandidates(many, {}).length).toBe(10)
    })
    it('filters by candidateIds when provided', () => {
      expect(selectChainCandidates(pool, { candidateIds: ['2'] }).map((c) => c.applicationRecordId)).toEqual(['2'])
    })
  })

  describe('pickStoredHiringPoster', () => {
    it('returns null when no /in/ profile', () => {
      expect(
        pickStoredHiringPoster(cand({ applicationRecordId: 'x', hiringTeam: [{ name: 'X', profileUrl: 'https://x.com' }] }))
      ).toBeNull()
    })
    it('picks first LinkedIn profile on team', () => {
      const hm = pickStoredHiringPoster(
        cand({
          applicationRecordId: 'x',
          company: 'Co',
          hiringTeam: [
            { name: 'Pat Lee', title: 'Recruiter', profileUrl: 'https://www.linkedin.com/in/pat' }
          ]
        })
      )
      expect(hm).toEqual({
        profileUrl: 'https://www.linkedin.com/in/pat',
        firstName: 'Pat',
        company: 'Co',
        headline: 'Recruiter'
      })
    })
  })

  describe('buildHiringManagerPeopleSearch', () => {
    it('uses searchHint when provided', () => {
      const { query, searchUrl } = buildHiringManagerPeopleSearch('Acme', 'SWE', 'custom hint')
      expect(query).toBe('custom hint')
      expect(searchUrl).toContain(encodeURIComponent('custom hint'))
    })
    it('builds default query from company and title', () => {
      const { query } = buildHiringManagerPeopleSearch('Beta Inc', 'PM', undefined)
      expect(query).toContain('Beta Inc')
      expect(query).toContain('PM')
      expect(query).toContain('hiring manager')
    })
  })

  describe('isPermittedLinkedInNavigationUrl', () => {
    it('accepts https www, apex, and regional *.linkedin.com hosts', () => {
      expect(isPermittedLinkedInNavigationUrl('https://www.linkedin.com/in/foo')).toBe(true)
      expect(isPermittedLinkedInNavigationUrl('https://linkedin.com/jobs/view/1')).toBe(true)
      expect(isPermittedLinkedInNavigationUrl('https://uk.linkedin.com/jobs/view/1')).toBe(true)
    })
    it('rejects non-https, other hosts, and malformed URLs', () => {
      expect(isPermittedLinkedInNavigationUrl('http://www.linkedin.com/in/foo')).toBe(false)
      expect(isPermittedLinkedInNavigationUrl('https://evil.com/linkedin')).toBe(false)
      expect(isPermittedLinkedInNavigationUrl('not a url')).toBe(false)
      expect(isPermittedLinkedInNavigationUrl('')).toBe(false)
    })
  })

  describe('parseSearchHiringManagerPayload', () => {
    it('returns null without company', () => {
      expect(parseSearchHiringManagerPayload({})).toBeNull()
      expect(parseSearchHiringManagerPayload({ company: '  ' })).toBeNull()
    })
    it('parses minimal payload', () => {
      expect(parseSearchHiringManagerPayload({ company: ' Acme ', jobTitle: 'Eng' })).toEqual({
        company: 'Acme',
        jobTitle: 'Eng',
        searchHint: undefined,
        hiringTeam: undefined
      })
    })
    it('normalizes hiringTeam and drops non-objects', () => {
      expect(
        parseSearchHiringManagerPayload({
          company: 'Co',
          hiringTeam: [
            { name: 'A', profileUrl: 'https://www.linkedin.com/in/a', extra: 1 },
            null,
            { bogus: true },
            { title: 'T' },
            { profileUrl: 'https://www.linkedin.com/in/b' }
          ]
        })
      ).toEqual({
        company: 'Co',
        jobTitle: undefined,
        searchHint: undefined,
        hiringTeam: [
          { name: 'A', title: undefined, profileUrl: 'https://www.linkedin.com/in/a' },
          { name: '', title: undefined, profileUrl: 'https://www.linkedin.com/in/b' }
        ]
      })
    })
  })

  describe('parseOutreachMarkSentPayload', () => {
    it('returns null when id missing', () => {
      expect(parseOutreachMarkSentPayload({})).toBeNull()
      expect(parseOutreachMarkSentPayload({ applicationRecordId: '  ' })).toBeNull()
    })
    it('parses optional strings', () => {
      expect(
        parseOutreachMarkSentPayload({
          applicationRecordId: ' id-1 ',
          targetUrl: 'https://www.linkedin.com/in/x',
          targetName: 'Pat'
        })
      ).toEqual({
        applicationRecordId: 'id-1',
        targetUrl: 'https://www.linkedin.com/in/x',
        targetName: 'Pat'
      })
    })
  })

  describe('parseOutreachSkipPayload', () => {
    it('returns null when id missing', () => {
      expect(parseOutreachSkipPayload(null)).toBeNull()
    })
    it('trims applicationRecordId', () => {
      expect(parseOutreachSkipPayload({ applicationRecordId: ' abc ' })).toEqual({ applicationRecordId: 'abc' })
    })
  })
})
