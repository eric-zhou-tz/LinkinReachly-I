/**
 * Real-world ATS form fixture tests.
 * Feeds realistic accessibility tree snapshots from major ATS vendors
 * through the field matcher with a full applicant profile.
 * These tests catch regressions in field matching against real form structures.
 */
import { describe, expect, it } from 'vitest'
import type { ApplicantBridgeSnapshot } from '@core/applicant-bridge-snapshot'
import { matchSnapshotToProfile, findSubmitButtonRef, findNextStepButtonRef } from '@core/snapshot-field-matcher'
import { ATS_SNAPSHOTS } from '../../fixtures/ats-snapshots'

const fullProfile: ApplicantBridgeSnapshot = {
  fullName: 'Alex Chen',
  firstName: 'Alex',
  lastName: 'Chen',
  email: 'alex.chen@example.com',
  phone: '+1 415-555-0199',
  phoneDigits: '14155550199',
  addressLine1: '123 Market St',
  addressLine2: 'Apt 4B',
  linkedInUrl: 'https://www.linkedin.com/in/alexchen',
  githubUrl: 'https://github.com/alexchen',
  portfolioUrl: 'https://alexchen.dev',
  websiteUrl: 'https://alexchen.dev',
  city: 'San Francisco',
  state: 'CA',
  postalCode: '94105',
  stateVariants: ['CA', 'California'],
  country: 'US',
  countryDisplay: 'United States',
  cityStateComma: 'San Francisco, CA',
  currentLocationLine: 'San Francisco, CA, USA',
  currentResidenceAnswer: 'I currently reside in San Francisco, CA.',
  yearsOfExperience: '7',
  educationSummary: 'BS Computer Science, Stanford University',
  educationStartMonth: '9',
  educationStartYear: '2014',
  educationEndMonth: '6',
  educationEndYear: '2018',
  currentlyAttending: '',
  schoolName: 'Stanford University',
  degreeType: 'BS',
  fieldOfStudy: 'Computer Science',
  languages: 'English, Mandarin',
  certifications: '',
  authorizedToWork: 'Yes',
  requiresSponsorship: 'No',
  clearanceEligible: '',
  willingToRelocate: 'Yes',
  willingToTravel: '',
  over18: 'Yes',
  hasDriversLicense: '',
  canPassBackgroundCheck: 'Yes',
  canPassDrugTest: '',
  salaryMin: 180000,
  salaryMax: 220000,
  salaryCurrency: 'USD',
  noticePeriod: '2 weeks',
  startDatePreference: 'Immediately',
  startDateMMDDYYYY: '',
  startDateDashesYYYYMMDD: '',
  startDateSlashesMMDDYYYY: '',
  workLocationPreference: 'Remote',
  answerBank: []
}

describe('ATS vendor snapshot fixtures', () => {
  for (const [vendorKey, fixture] of Object.entries(ATS_SNAPSHOTS)) {
    describe(fixture.vendor, () => {
      it(`matches expected fields on ${fixture.formType} form`, () => {
        const { actions, unmatchedFields } = matchSnapshotToProfile(
          fixture.snapshot,
          fullProfile,
          '/tmp/resume.pdf'
        )

        const typeActions = actions.filter((a) => a.kind === 'type')
        const matchedRefs = typeActions.map((a) => a.ref)

        for (const expectedRef of fixture.expectedMatches) {
          expect(matchedRefs, `Expected ref ${expectedRef} to be matched on ${vendorKey}`).toContain(expectedRef)
        }
      })

      it(`produces at least ${fixture.expectedMatches.length} type actions`, () => {
        const { actions } = matchSnapshotToProfile(
          fixture.snapshot,
          fullProfile,
          '/tmp/resume.pdf'
        )
        const typeActions = actions.filter((a) => a.kind === 'type')
        expect(typeActions.length).toBeGreaterThanOrEqual(fixture.expectedMatches.length)
      })

      if ('expectedClickMatches' in fixture && fixture.expectedClickMatches) {
        it('matches Yes/No work auth questions correctly', () => {
          const { actions } = matchSnapshotToProfile(
            fixture.snapshot,
            fullProfile,
            '/tmp/resume.pdf'
          )
          const clickRefs = actions.filter((a) => a.kind === 'click').map((a) => a.ref)
          for (const expectedRef of fixture.expectedClickMatches!) {
            expect(clickRefs, `Expected click on ${expectedRef}`).toContain(expectedRef)
          }
        })
      }

      it('detects submit or next button', () => {
        const submit = findSubmitButtonRef(fixture.snapshot)
        const next = findNextStepButtonRef(fixture.snapshot)
        expect(submit || next).toBeTruthy()
      })

      if (fixture.expectedUnmatched.length > 0) {
        it('correctly reports unmatched fields', () => {
          const { unmatchedFields } = matchSnapshotToProfile(
            fixture.snapshot,
            fullProfile,
            '/tmp/resume.pdf'
          )
          for (const expected of fixture.expectedUnmatched) {
            expect(unmatchedFields, `Expected "${expected}" to be unmatched`).toContain(expected)
          }
        })
      }
    })
  }

  it('no vendor fixture produces zero matches with a full profile', () => {
    for (const [key, fixture] of Object.entries(ATS_SNAPSHOTS)) {
      const { actions } = matchSnapshotToProfile(
        fixture.snapshot,
        fullProfile,
        '/tmp/resume.pdf'
      )
      expect(
        actions.length,
        `${key} should produce at least 1 action with a full profile`
      ).toBeGreaterThan(0)
    }
  })
})
