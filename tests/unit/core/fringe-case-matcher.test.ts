/**
 * Fringe case test harness for Easy Apply form filling.
 * Runs every fringe case fixture through the snapshot field matcher.
 *
 * Layer 1 tests MUST pass (handled by regex today).
 * Layer 2 tests document gaps (verify fields ARE unmatched, so we know when promoted).
 */
import { describe, it, expect } from 'vitest'
import { FRINGE_CASES, type FringeCaseFixture } from '../../fixtures/fringe-case-snapshots'
import { matchSnapshotToProfile } from '@core/snapshot-field-matcher'
import type { ApplicantBridgeSnapshot } from '@core/applicant-bridge-snapshot'

const baseProfile: ApplicantBridgeSnapshot = {
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
  educationSummary: 'MBA, Columbia Business School, 2024',
  educationStartMonth: '8',
  educationStartYear: '2022',
  educationEndMonth: '5',
  educationEndYear: '2024',
  currentlyAttending: '',
  schoolName: 'Columbia Business School',
  degreeType: 'MBA',
  fieldOfStudy: 'Business Administration',
  languages: 'English, Mandarin',
  certifications: '',
  authorizedToWork: 'Yes',
  requiresSponsorship: 'No',
  clearanceEligible: '',
  willingToRelocate: 'Yes',
  willingToTravel: 'Yes',
  over18: 'Yes',
  hasDriversLicense: 'Yes',
  canPassBackgroundCheck: 'Yes',
  canPassDrugTest: 'Yes',
  salaryMin: 150000,
  salaryMax: 200000,
  salaryCurrency: 'USD',
  noticePeriod: '2 weeks',
  startDatePreference: 'Immediately',
  startDateMMDDYYYY: '',
  startDateDashesYYYYMMDD: '',
  startDateSlashesMMDDYYYY: '',
  workLocationPreference: 'Remote',
  answerBank: []
}

function mergeProfile(overrides?: Record<string, unknown>): ApplicantBridgeSnapshot {
  return { ...baseProfile, ...overrides } as ApplicantBridgeSnapshot
}

// ─── Layer 1 tests: must pass (handled by regex) ───
describe('Fringe cases — Layer 1 (regex matcher)', () => {
  const layer1Cases = FRINGE_CASES.filter((fc) => fc.layer === 1)

  for (const fc of layer1Cases) {
    it(`[${fc.id}] ${fc.description}`, () => {
      const profile = mergeProfile(fc.profileOverrides)
      const { actions } = matchSnapshotToProfile(
        fc.snapshot,
        profile,
        '/tmp/resume.pdf'
      )

      // Check expected type/click matches
      const matchedRefs = actions.map((a) => a.ref).filter(Boolean)
      for (const ref of fc.expectedMatches) {
        expect(matchedRefs, `Expected ref ${ref} to be matched`).toContain(ref)
      }

      // Check expected click matches (Yes/No buttons)
      if (fc.expectedClickMatches) {
        const clickRefs = actions.filter((a) => a.kind === 'click').map((a) => a.ref)
        for (const ref of fc.expectedClickMatches) {
          expect(clickRefs, `Expected click ref ${ref}`).toContain(ref)
        }
      }

      // Check expected values
      if (fc.expectedValues) {
        for (const [ref, expectedValue] of Object.entries(fc.expectedValues)) {
          const action = actions.find((a) => a.ref === ref && a.kind === 'type')
          expect(action, `Expected type action for ref ${ref}`).toBeDefined()
          expect((action as { text: string }).text).toBe(expectedValue)
        }
      }
    })
  }
})

// ─── Layer 2 tests: document current gaps (expected to be unmatched) ───
describe('Fringe cases — Layer 2 (LLM fallback needed)', () => {
  const layer2Cases = FRINGE_CASES.filter((fc) => fc.layer === 2)

  for (const fc of layer2Cases) {
    it(`[${fc.id}] ${fc.description} — documents unmatched fields`, () => {
      const profile = mergeProfile(fc.profileOverrides)
      const { unmatchedFields } = matchSnapshotToProfile(
        fc.snapshot,
        profile,
        '/tmp/resume.pdf'
      )

      // These fields SHOULD be unmatched (needs LLM)
      if (fc.expectedUnmatched?.length) {
        for (const label of fc.expectedUnmatched) {
          const normalizedLabel = label.replace(/\*$/, '').trim()
          const found = unmatchedFields.some(
            (u) => u.includes(normalizedLabel) || normalizedLabel.includes(u)
          )
          expect(found, `Expected "${normalizedLabel}" to be unmatched (needs LLM)`).toBe(true)
        }
      }
    })

    // When promoted: change layer to 1 and move to Layer 1 describe block
    if (fc.promotionTarget) {
      it.skip(`[${fc.id}] PROMOTION TARGET — once promoted, should be matched by regex`, () => {
        // Unskip and add assertions when pattern is promoted to Layer 1
      })
    }
  }
})

// ─── Summary report ───
describe('Fringe case coverage report', () => {
  it('reports overall coverage stats', () => {
    const total = FRINGE_CASES.length
    const layer1 = FRINGE_CASES.filter((fc) => fc.layer === 1).length
    const layer2 = FRINGE_CASES.filter((fc) => fc.layer === 2).length
    const promotionTargets = FRINGE_CASES.filter((fc) => fc.promotionTarget).length
    const p0 = FRINGE_CASES.filter((fc) => fc.priority === 'P0').length

    console.log(`\n  Fringe Case Coverage:`)
    console.log(`    Total: ${total}`)
    console.log(`    Layer 1 (regex): ${layer1}`)
    console.log(`    Layer 2 (LLM): ${layer2}`)
    console.log(`    Promotion targets: ${promotionTargets}`)
    console.log(`    P0 (critical): ${p0}\n`)

    expect(total).toBeGreaterThan(0)
  })
})
