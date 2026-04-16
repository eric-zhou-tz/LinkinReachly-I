import { describe, expect, it } from 'vitest'
import type { ApplicantBridgeSnapshot } from '../../../src/core/applicant-bridge-snapshot'
import {
  evaluateFormCompleteness,
  findNextStepButtonRef,
  findSelectedOptionRefs,
  findSubmitButtonRef,
  looksLikeEssayQuestion,
  matchSnapshotToProfile,
  parseSnapshotRows,
  snapshotHasOptionLines
} from '../../../src/core/snapshot-field-matcher'

function profile(p: Partial<ApplicantBridgeSnapshot>): ApplicantBridgeSnapshot {
  return {
    fullName: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    phoneDigits: '',
    addressLine1: '',
    addressLine2: '',
    linkedInUrl: '',
    githubUrl: '',
    portfolioUrl: '',
    websiteUrl: '',
    city: '',
    state: '',
    postalCode: '',
    stateVariants: [],
    country: '',
    countryDisplay: '',
    cityStateComma: '',
    currentLocationLine: '',
    currentResidenceAnswer: '',
    yearsOfExperience: '',
    educationSummary: '',
    educationStartMonth: '',
    educationStartYear: '',
    educationEndMonth: '',
    educationEndYear: '',
    currentlyAttending: '',
    schoolName: '',
    degreeType: '',
    fieldOfStudy: '',
    languages: '',
    certifications: '',
    authorizedToWork: '',
    requiresSponsorship: '',
    clearanceEligible: '',
    willingToRelocate: '',
    willingToTravel: '',
    over18: '',
    hasDriversLicense: '',
    canPassBackgroundCheck: '',
    canPassDrugTest: '',
    salaryMin: undefined,
    salaryMax: undefined,
    salaryCurrency: '',
    noticePeriod: '',
    startDatePreference: '',
    startDateMMDDYYYY: '',
    startDateDashesYYYYMMDD: '',
    startDateSlashesMMDDYYYY: '',
    workLocationPreference: '',
    answerBank: [],
    ...p
  }
}

describe('parseSnapshotRows', () => {
  it('parses role, label, ref from OpenClaw-style lines', () => {
    const snap = `- textbox "Email*" [ref=e61] [cursor=pointer]:
- combobox "Location" [ref=e20]:`
    const rows = parseSnapshotRows(snap)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ role: 'textbox', label: 'Email*', ref: 'e61' })
    expect(rows[1]).toMatchObject({ role: 'combobox', label: 'Location', ref: 'e20' })
  })

  it('merges generic [ref]: label hint into following unlabeled textbox', () => {
    const snap = `- generic [ref=e55]: Name*
- textbox [ref=e56]:`
    const rows = parseSnapshotRows(snap)
    expect(rows.find((r) => r.ref === 'e56')?.label).toBe('Name*')
  })
})

describe('matchSnapshotToProfile', () => {
  it('prefers digits-only phone when label asks for numeric phone', () => {
    const snap = '- textbox "Phone number (digits only)" [ref=p1]:'
    const { actions } = matchSnapshotToProfile(
      snap,
      profile({ phone: '+1 555-0100', phoneDigits: '15550100' }),
      ''
    )
    expect(actions).toEqual([
      expect.objectContaining({ kind: 'type', ref: 'p1', text: '15550100' })
    ])
  })

  it('maps name, email, phone, linkedin from labels', () => {
    const snap = `
- textbox "First name" [ref=a1]:
- textbox "Last name" [ref=a2]:
- textbox "Email" [ref=a3]:
- textbox "Mobile phone number" [ref=a4]:
- textbox "LinkedIn Profile" [ref=a5]:
`
    const pr = profile({
      firstName: 'Sam',
      lastName: 'Porter',
      email: 'sam@example.com',
      phone: '555-1111',
      linkedInUrl: 'https://linkedin.com/in/sam'
    })
    const { actions, unmatchedFields } = matchSnapshotToProfile(snap, pr)
    const types = actions.filter((x) => x.kind === 'type') as Array<{
      ref: string
      text: string
    }>
    expect(types.find((t) => t.ref === 'a1')?.text).toBe('Sam')
    expect(types.find((t) => t.ref === 'a2')?.text).toBe('Porter')
    expect(types.find((t) => t.ref === 'a3')?.text).toBe('sam@example.com')
    expect(types.find((t) => t.ref === 'a4')?.text).toBe('555-1111')
    expect(types.find((t) => t.ref === 'a5')?.text).toContain('linkedin.com')
    expect(unmatchedFields).toHaveLength(0)
  })

  it('matches Yes/No for work authorization from preceding question line', () => {
    const snap = `
- generic "Are you legally authorized to work in the United States?" [ref=g1]:
- button "Yes" [ref=y1]:
- button "No" [ref=n1]:
- generic "Will you require visa sponsorship?" [ref=g2]:
- button "Yes" [ref=y2]:
- button "No" [ref=n2]:
`
    const pr = profile({
      authorizedToWork: 'Yes',
      requiresSponsorship: 'No'
    })
    const { actions } = matchSnapshotToProfile(snap, pr)
    const clicks = actions.filter((x) => x.kind === 'click')
    expect(clicks.some((c) => c.ref === 'y1')).toBe(true)
    expect(clicks.some((c) => c.ref === 'n2')).toBe(true)
  })

  it('uses answer bank when label fuzzy-matches prompt', () => {
    const snap = '- textbox "Tell us about your favorite project" [ref=t9]:'
    const pr = profile({
      answerBank: [{ prompt: 'favorite project', answer: 'Shipped a browser extension.' }]
    })
    const { actions } = matchSnapshotToProfile(snap, pr)
    expect(actions).toEqual([
      expect.objectContaining({
        kind: 'type',
        ref: 't9',
        text: 'Shipped a browser extension.'
      })
    ])
  })

  it('detects resume upload near Upload File button', () => {
    const snap = `
- generic "Resume" [ref=r0]:
- button "Upload File" [ref=uf]:
`
    const { actions } = matchSnapshotToProfile(snap, profile({}), '/tmp/r.pdf')
    expect(actions.some((a) => a.kind === 'file')).toBe(true)
    const file = actions.find((a) => a.kind === 'file')!
    expect(file.kind).toBe('file')
    if (file.kind === 'file') {
      expect(file.elementSelector).toBeUndefined()
      expect(file.ref).toBe('uf')
    }
  })

  it('reports unmatched textboxes', () => {
    const snap = '- textbox "Favorite ice cream flavor" [ref=x1]:'
    const { actions, unmatchedFields } = matchSnapshotToProfile(snap, profile({}), '')
    expect(actions).toHaveLength(0)
    expect(unmatchedFields).toContain('Favorite ice cream flavor')
  })

  it('fills combobox roles using same label heuristics as textbox', () => {
    const snap = '- combobox "Years of experience" [ref=c1]:'
    const { actions } = matchSnapshotToProfile(
      snap,
      profile({ yearsOfExperience: '7' }),
      ''
    )
    expect(actions).toEqual([
      expect.objectContaining({ kind: 'type', ref: 'c1', text: '7', inputRole: 'combobox' })
    ])
  })

  it('fills currently residing questions from currentResidenceAnswer', () => {
    const snap = '- textbox "Where are you currently residing?" [ref=r1]:'
    const { actions } = matchSnapshotToProfile(
      snap,
      profile({
        currentResidenceAnswer: 'I reside in Portland, OR.',
        city: 'Austin',
        cityStateComma: 'Austin, TX'
      }),
      ''
    )
    expect(actions).toEqual([
      expect.objectContaining({ kind: 'type', ref: 'r1', text: 'I reside in Portland, OR.' })
    ])
  })

  it('prefers currentLocationLine for Location / city-or-location labels', () => {
    const snap = '- combobox "Location" [ref=e20]:'
    const { actions } = matchSnapshotToProfile(
      snap,
      profile({
        currentLocationLine: 'Seattle, WA, USA',
        city: 'Austin',
        state: 'TX',
        cityStateComma: 'Austin, TX'
      }),
      ''
    )
    expect(actions).toEqual([
      expect.objectContaining({ kind: 'type', ref: 'e20', text: 'Seattle, WA, USA', inputRole: 'combobox' })
    ])
  })

  it('applies essayFill for long prompts without profile match', () => {
    const snap = '- textbox "Why are you interested in Acme?" [ref=e1]:'
    const key = 'why are you interested in acme'
    const { actions } = matchSnapshotToProfile(snap, profile({}), '', {
      essayFill: { [key]: 'I want to ship reliable infra.' }
    })
    expect(actions).toEqual([
      expect.objectContaining({
        kind: 'type',
        ref: 'e1',
        text: 'I want to ship reliable infra.',
        inputRole: 'textbox'
      })
    ])
  })

  it('skips refs listed in skipRefs', () => {
    const snap = '- textbox "Email" [ref=a3]:'
    const { actions } = matchSnapshotToProfile(snap, profile({ email: 'x@y.com' }), '', {
      skipRefs: new Set(['a3'])
    })
    expect(actions.filter((a) => a.kind === 'type')).toHaveLength(0)
  })
})

describe('snapshot helpers', () => {
  it('looksLikeEssayQuestion detects interrogative and long prompts', () => {
    expect(looksLikeEssayQuestion('Why Suno?')).toBe(true)
    expect(looksLikeEssayQuestion('Name')).toBe(false)
  })

  it('snapshotHasOptionLines finds option rows', () => {
    expect(snapshotHasOptionLines('- option "NYC" [ref=o1]:')).toBe(true)
    expect(snapshotHasOptionLines('- textbox "x" [ref=e1]:')).toBe(false)
  })

  it('findNextStepButtonRef finds Continue', () => {
    expect(findNextStepButtonRef('- button "Continue" [ref=n1]:')).toBe('n1')
  })

  it('findSelectedOptionRefs reads [selected] markers', () => {
    const snap = '- option "California" [ref=o7] [selected]:'
    expect(findSelectedOptionRefs(snap)).toEqual([{ label: 'California', ref: 'o7' }])
  })

  it('findSubmitButtonRef prefers submit/apply labels', () => {
    const snap = '- button "Submit application" [ref=s1]:'
    expect(findSubmitButtonRef(snap)).toBe('s1')
  })

  it('findNextStepButtonRef matches Review / preview as intermediate step', () => {
    expect(findNextStepButtonRef('- button "Review application" [ref=r1]:')).toBe('r1')
    expect(findNextStepButtonRef('- button "Preview application" [ref=p1]:')).toBe('p1')
    expect(findNextStepButtonRef('- button "Go to next step" [ref=g1]:')).toBe('g1')
  })

  it('findNextStepButtonRef does not take Review and submit (final)', () => {
    expect(findNextStepButtonRef('- button "Review and submit" [ref=x]:')).toBe(null)
    expect(findSubmitButtonRef('- button "Review and submit" [ref=x]:')).toBe('x')
  })

  it('findNextStepButtonRef matches Ashby-style apply entry CTA (button or link)', () => {
    expect(findNextStepButtonRef('- button "Apply for this Job" [ref=a1]:')).toBe('a1')
    expect(findNextStepButtonRef('- link "Apply for this Job" [ref=a2]:')).toBe('a2')
    expect(findNextStepButtonRef('- button "Start application" [ref=s0]:')).toBe('s0')
  })

  it('findSubmitButtonRef matches finish / done / confirm and submit', () => {
    expect(findSubmitButtonRef('- button "Finish" [ref=f1]:')).toBe('f1')
    expect(findSubmitButtonRef('- button "Done" [ref=d1]:')).toBe('d1')
    expect(findSubmitButtonRef('- button "Confirm and submit" [ref=c1]:')).toBe('c1')
  })
})

describe('required field detection', () => {
  it('parseSnapshotRows marks asterisk labels as required', () => {
    const snap = `- textbox "Email*" [ref=e1]:
- textbox "Phone" [ref=e2]:`
    const rows = parseSnapshotRows(snap)
    expect(rows.find((r) => r.ref === 'e1')?.required).toBe(true)
    expect(rows.find((r) => r.ref === 'e2')?.required).toBe(false)
  })

  it('parseSnapshotRows marks [required] attribute as required', () => {
    const snap = '- textbox "Name" [ref=e3] [required]:'
    const rows = parseSnapshotRows(snap)
    expect(rows.find((r) => r.ref === 'e3')?.required).toBe(true)
  })

  it('parseSnapshotRows marks [aria-required=true] as required', () => {
    const snap = '- textbox "Company" [ref=e4] [aria-required=true]:'
    const rows = parseSnapshotRows(snap)
    expect(rows.find((r) => r.ref === 'e4')?.required).toBe(true)
  })

  it('matchSnapshotToProfile returns requiredUnmatchedFields', () => {
    const snap = `- textbox "Email*" [ref=e1]:
- textbox "Favorite color*" [ref=e2]:
- textbox "Nickname" [ref=e3]:`
    const { unmatchedFields, requiredUnmatchedFields } = matchSnapshotToProfile(
      snap,
      profile({ email: 'a@b.com' }),
      ''
    )
    // Email matched, so not unmatched
    expect(unmatchedFields).toContain('Favorite color*')
    expect(unmatchedFields).toContain('Nickname')
    expect(unmatchedFields).not.toContain('Email*')
    // Only Favorite color is required AND unmatched
    expect(requiredUnmatchedFields).toContain('Favorite color*')
    expect(requiredUnmatchedFields).not.toContain('Nickname')
  })
})

describe('evaluateFormCompleteness', () => {
  it('returns ready:true when all required fields are filled', () => {
    const snap = `- textbox "Email*" [ref=e1]: user@example.com
- textbox "Name*" [ref=e2]: John
- textbox "Notes" [ref=e3]:`
    const result = evaluateFormCompleteness(snap)
    expect(result.ready).toBe(true)
    expect(result.requiredEmpty).toHaveLength(0)
    expect(result.filledFields).toBe(2)
    expect(result.totalFields).toBe(3)
    expect(result.allEmpty).toEqual(['Notes'])
  })

  it('returns ready:false when required fields are empty', () => {
    const snap = `- textbox "Email*" [ref=e1]:
- textbox "Name*" [ref=e2]: John
- textbox "Notes" [ref=e3]:`
    const result = evaluateFormCompleteness(snap)
    expect(result.ready).toBe(false)
    expect(result.requiredEmpty).toEqual(['Email*'])
    expect(result.filledFields).toBe(1)
    expect(result.totalFields).toBe(3)
  })

  it('scores 100 when all fields filled', () => {
    const snap = `- textbox "Email*" [ref=e1]: a@b.com
- textbox "Phone" [ref=e2]: 555-1234`
    const result = evaluateFormCompleteness(snap)
    expect(result.score).toBe(100)
    expect(result.ready).toBe(true)
  })

  it('weights required fields higher in score', () => {
    // 1 required empty, 1 optional filled → weighted score < 100
    const snap = `- textbox "Email*" [ref=e1]:
- textbox "Notes" [ref=e2]: some text`
    const result = evaluateFormCompleteness(snap)
    expect(result.score).toBeLessThan(50) // required worth 2x, so 1/3 of weight
    expect(result.ready).toBe(false)
  })

  it('handles empty snapshot gracefully', () => {
    const result = evaluateFormCompleteness('')
    expect(result.ready).toBe(true)
    expect(result.score).toBe(100)
    expect(result.totalFields).toBe(0)
  })
})

describe('new field matcher patterns (salary, education, notice, work location)', () => {
  it('matches "Desired Salary" to salaryMin/Max range', () => {
    const snap = '- textbox "Desired Salary" [ref=s1]:'
    const { actions } = matchSnapshotToProfile(
      snap,
      profile({ salaryMin: 120000, salaryMax: 150000, salaryCurrency: 'USD' })
    )
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: 'type', ref: 's1' })
    expect((actions[0] as any).text).toContain('120,000')
    expect((actions[0] as any).text).toContain('150,000')
  })

  it('matches "Salary Expectation" with single value', () => {
    const snap = '- textbox "Salary Expectation" [ref=s2]:'
    const { actions } = matchSnapshotToProfile(
      snap,
      profile({ salaryMin: 100000, salaryCurrency: 'USD' })
    )
    expect(actions).toHaveLength(1)
    expect((actions[0] as any).text).toBe('100,000')
  })

  it('matches "Education" / "Highest Education" to educationSummary', () => {
    const snap = `- textbox "Education" [ref=ed1]:
- textbox "Highest level of education" [ref=ed2]:`
    const { actions } = matchSnapshotToProfile(
      snap,
      profile({ educationSummary: 'MBA, Columbia Business School' })
    )
    // Only one match (deduplication by key)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: 'type', ref: 'ed1', text: 'MBA, Columbia Business School' })
  })

  it('matches "Notice Period" to noticePeriod', () => {
    const snap = '- textbox "Notice Period" [ref=np1]:'
    const { actions } = matchSnapshotToProfile(
      snap,
      profile({ noticePeriod: '2 weeks' })
    )
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: 'type', ref: 'np1', text: '2 weeks' })
  })

  it('falls back to startDatePreference when noticePeriod empty', () => {
    const snap = '- textbox "How soon can you start?" [ref=np2]:'
    const { actions } = matchSnapshotToProfile(
      snap,
      profile({ noticePeriod: '', startDatePreference: 'Immediately' })
    )
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: 'type', ref: 'np2', text: 'Immediately' })
  })

  it('matches "Work Location Preference" to workLocationPreference', () => {
    const snap = '- textbox "Work arrangement preference" [ref=wl1]:'
    const { actions } = matchSnapshotToProfile(
      snap,
      profile({ workLocationPreference: 'Remote' })
    )
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: 'type', ref: 'wl1', text: 'Remote' })
  })

  it('does not match salary when salaryMin is undefined', () => {
    const snap = '- textbox "Desired Salary" [ref=s3]:'
    const { actions, unmatchedFields } = matchSnapshotToProfile(snap, profile({}))
    expect(actions).toHaveLength(0)
    expect(unmatchedFields).toContain('Desired Salary')
  })
})
