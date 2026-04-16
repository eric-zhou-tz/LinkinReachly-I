/**
 * Fringe case accessibility tree snapshots for Easy Apply form filling.
 * Each fixture represents an edge case encountered in real ATS forms.
 *
 * Format matches ATS_SNAPSHOTS in ats-snapshots.ts — same structure,
 * but organized by fringe case category instead of by vendor.
 *
 * Promotion model:
 *   - "layer: 1" = handled by regex matcher (fast, deterministic)
 *   - "layer: 2" = needs LLM fallback (slow, probabilistic)
 *   - "promotionTarget: true" = LLM-solved today, should become regex
 *
 * NOTE: Only text-like roles (textbox, searchbox, spinbutton, combobox) appear
 * in unmatchedFields. Radio, checkbox, generic roles are invisible to the
 * unmatched tracker — they need separate handling (click matching or LLM).
 */

export interface FringeCaseFixture {
  id: string
  category: string
  description: string
  layer: 1 | 2 | 3
  promotionTarget: boolean
  priority: 'P0' | 'P1' | 'P2'
  snapshot: string
  /** Profile overrides — merged with baseProfile for this test */
  profileOverrides?: Record<string, unknown>
  /** Refs that MUST be matched by type/click actions */
  expectedMatches: string[]
  /** Refs for click actions specifically (Yes/No buttons) */
  expectedClickMatches?: string[]
  /** Labels that SHOULD remain unmatched (text-like roles only) */
  expectedUnmatched?: string[]
  /** The value that should be filled for the primary matched field */
  expectedValues?: Record<string, string>
}

export const FRINGE_CASES: FringeCaseFixture[] = [
  // ─── Category 1: Name Fields ───
  {
    id: 'FC-1.2',
    category: 'name',
    description: 'Suffix in last name (Jr., III, etc.)',
    layer: 1,
    promotionTarget: false,
    priority: 'P2',
    snapshot: `- textbox "First Name*" [ref=e1]:
- textbox "Last Name*" [ref=e2]:`,
    profileOverrides: { fullName: 'Robert Chen Jr.', firstName: 'Robert', lastName: 'Chen Jr.' },
    expectedMatches: ['e1', 'e2'],
    expectedValues: { e1: 'Robert', e2: 'Chen Jr.' }
  },
  {
    id: 'FC-1.5',
    category: 'name',
    description: 'Preferred name vs legal name (two separate fields)',
    layer: 2,
    promotionTarget: true,
    priority: 'P2',
    snapshot: `- textbox "Legal First Name*" [ref=e1]:
- textbox "Preferred First Name" [ref=e2]:
- textbox "Last Name*" [ref=e3]:`,
    expectedMatches: ['e1', 'e3'],
    expectedUnmatched: ['Preferred First Name']
  },

  // ─── Category 2: Email ───
  {
    id: 'FC-2.2',
    category: 'email',
    description: 'Confirmation email field (promoted: confirm email → separate key)',
    layer: 1,
    promotionTarget: false,
    priority: 'P1',
    snapshot: `- textbox "Email Address*" [ref=e1]:
- textbox "Confirm Email Address*" [ref=e2]:`,
    expectedMatches: ['e1', 'e2'],
    expectedValues: { e2: 'alex.chen@example.com' }
  },

  // ─── Category 3: Phone ───
  {
    id: 'FC-3.1',
    category: 'phone',
    description: 'Separate country code + phone number fields',
    layer: 2,
    promotionTarget: true,
    priority: 'P1',
    snapshot: `- combobox "Country Code*" [ref=c1]: +1
- textbox "Phone Number*" [ref=e1]:`,
    profileOverrides: { phone: '+1 415-555-0199', phoneDigits: '14155550199' },
    // "Country Code" combobox: /\bcountry\b/ matches → fills with countryDisplay (wrong!)
    // "Phone Number" textbox: phone key already used → silently skipped
    // This is a mis-match: country regex grabs a phone-related field
    expectedMatches: ['c1'],
    expectedUnmatched: []
  },
  {
    id: 'FC-3.2',
    category: 'phone',
    description: 'Phone type dropdown (Mobile/Home/Work)',
    layer: 2,
    promotionTarget: true,
    priority: 'P2',
    snapshot: `- combobox "Phone Type" [ref=c1]:
- option "Mobile" [ref=o1]:
- option "Home" [ref=o2]:
- option "Work" [ref=o3]:
- textbox "Phone Number*" [ref=e1]:`,
    // "Phone Type" combobox: /\bphone\b/ matches → fills phone value (wrong!)
    // "Phone Number" textbox: phone key already used → silently skipped
    expectedMatches: ['c1'],
    expectedUnmatched: []
  },

  // ─── Category 4: Address ───
  {
    id: 'FC-4.2',
    category: 'address',
    description: 'Country with non-standard display name',
    layer: 1,
    promotionTarget: false,
    priority: 'P1',
    snapshot: `- combobox "Country / Region*" [ref=c1]:
- option "United States of America" [ref=o1]:
- option "Canada" [ref=o2]:
- option "United Kingdom of Great Britain and Northern Ireland" [ref=o3]:`,
    profileOverrides: { country: 'US', countryDisplay: 'United States', stateVariants: ['CA', 'California'] },
    expectedMatches: ['c1']
  },
  {
    id: 'FC-4.3',
    category: 'address',
    description: 'State dropdown with mixed abbreviation formats',
    layer: 1,
    promotionTarget: false,
    priority: 'P1',
    snapshot: `- combobox "State*" [ref=c1]:
- option "AL - Alabama" [ref=o1]:
- option "CA - California" [ref=o2]:
- option "NY - New York" [ref=o3]:`,
    profileOverrides: { state: 'CA', stateVariants: ['CA', 'California'] },
    expectedMatches: ['c1'],
    expectedValues: { c1: 'California' }
  },
  {
    id: 'FC-4.5',
    category: 'address',
    description: 'Unicode city names with diacritics',
    layer: 1,
    promotionTarget: false,
    priority: 'P2',
    snapshot: `- textbox "City*" [ref=e1]:
- textbox "State" [ref=e2]:`,
    // City matcher returns currentLocationLine first, so override it too
    profileOverrides: {
      city: 'São Paulo',
      state: 'SP',
      stateVariants: ['SP'],
      currentLocationLine: 'São Paulo, SP',
      currentResidenceAnswer: '',
      cityStateComma: 'São Paulo, SP'
    },
    expectedMatches: ['e1'],
    expectedValues: { e1: 'São Paulo, SP' }
  },

  // ─── Category 5: Work Authorization ───
  {
    id: 'FC-5.2',
    category: 'work-auth',
    description: 'Radio buttons instead of clickable buttons for work auth',
    layer: 1,
    promotionTarget: false,
    priority: 'P1',
    snapshot: `- generic "Are you authorized to work in the US?*" [ref=q1]:
- radio "Yes" [ref=r1]:
- radio "No" [ref=r2]:`,
    profileOverrides: { authorizedToWork: 'Yes' },
    expectedMatches: [],
    expectedClickMatches: ['r1']
  },
  {
    id: 'FC-5.4',
    category: 'work-auth',
    description: 'Multi-choice work auth (beyond Yes/No)',
    layer: 2,
    promotionTarget: true,
    priority: 'P0',
    snapshot: `- generic "What is your work authorization status in the United States?*" [ref=q1]:
- radio "US Citizen" [ref=r1]:
- radio "Green Card Holder" [ref=r2]:
- radio "H-1B Visa" [ref=r3]:
- radio "EAD / OPT" [ref=r4]:
- radio "Other" [ref=r5]:`,
    profileOverrides: { authorizedToWork: 'Yes', requiresSponsorship: 'No' },
    // Radio/generic roles aren't text-like — nothing in unmatchedFields
    expectedMatches: [],
    expectedUnmatched: []
  },
  {
    id: 'FC-5.5',
    category: 'work-auth',
    description: 'Combined auth + sponsorship in one dropdown',
    layer: 2,
    promotionTarget: true,
    priority: 'P0',
    snapshot: `- generic "Work authorization / visa sponsorship*" [ref=q1]:
- combobox "" [ref=c1]:
- option "Authorized to work, no sponsorship needed" [ref=o1]:
- option "Authorized to work, will need future sponsorship" [ref=o2]:
- option "Not currently authorized" [ref=o3]:`,
    profileOverrides: { authorizedToWork: 'Yes', requiresSponsorship: 'No' },
    // Empty-label combobox — not matched by any regex, appears in unmatched as ''
    expectedMatches: [],
    expectedUnmatched: []
  },

  // ─── Category 6: Education ───
  {
    id: 'FC-6.1',
    category: 'education',
    description: 'Degree level dropdown with non-standard labels',
    layer: 2,
    promotionTarget: true,
    priority: 'P1',
    snapshot: `- combobox "Highest Level of Education*" [ref=c1]:
- option "High School Diploma" [ref=o1]:
- option "Associate's Degree" [ref=o2]:
- option "Bachelor's Degree" [ref=o3]:
- option "Master's Degree" [ref=o4]:
- option "Doctorate" [ref=o5]:
- option "Professional Degree (JD, MD)" [ref=o6]:`,
    profileOverrides: { degreeType: 'MBA' },
    // Combobox matched by education regex → fills educationSummary (not ideal)
    // The real gap: MBA should map to "Master's Degree" option, not raw text
    expectedMatches: ['c1'],
    expectedUnmatched: []
  },
  {
    id: 'FC-6.3',
    category: 'education',
    description: 'Graduation year only (no month)',
    layer: 1,
    promotionTarget: false,
    priority: 'P2',
    snapshot: `- combobox "Graduation Year*" [ref=c1]:
- option "2020" [ref=o1]:
- option "2021" [ref=o2]:
- option "2022" [ref=o3]:
- option "2023" [ref=o4]:
- option "2024" [ref=o5]:`,
    profileOverrides: { educationEndYear: '2024' },
    expectedMatches: ['c1'],
    expectedValues: { c1: '2024' }
  },

  // ─── Category 7: Experience ───
  {
    id: 'FC-7.2',
    category: 'experience',
    description: 'Years of experience as dropdown with ranges',
    layer: 2,
    promotionTarget: true,
    priority: 'P1',
    snapshot: `- combobox "Years of Professional Experience*" [ref=c1]:
- option "0-1 years" [ref=o1]:
- option "2-3 years" [ref=o2]:
- option "4-5 years" [ref=o3]:
- option "6-10 years" [ref=o4]:
- option "10+ years" [ref=o5]:`,
    profileOverrides: { yearsOfExperience: '7' },
    // Combobox matched by experience regex → fills raw '7' (not ideal for dropdown)
    // Real gap: should pick "6-10 years" option based on range matching
    expectedMatches: ['c1'],
    expectedUnmatched: []
  },

  // ─── Category 8: Compensation ───
  {
    id: 'FC-8.2',
    category: 'compensation',
    description: 'Salary with separate currency dropdown',
    layer: 2,
    promotionTarget: true,
    priority: 'P2',
    snapshot: `- combobox "Currency" [ref=c1]:
- option "USD" [ref=o1]:
- option "EUR" [ref=o2]:
- option "GBP" [ref=o3]:
- textbox "Expected Annual Salary*" [ref=e1]:`,
    profileOverrides: { salaryMin: 150000, salaryCurrency: 'USD' },
    expectedMatches: ['e1'],
    expectedUnmatched: ['Currency']
  },

  // ─── Category 10: Screening Questions ───
  {
    id: 'FC-10.5',
    category: 'screening',
    description: 'Essay field with character limit hint',
    layer: 2,
    promotionTarget: false,
    priority: 'P1',
    snapshot: `- textbox "Why are you interested in this role? (max 500 characters)*" [ref=e1]:`,
    expectedMatches: [],
    expectedUnmatched: ['Why are you interested in this role? (max 500 characters)*']
  },

  // ─── Category 11: Navigation ───
  {
    id: 'FC-11.2',
    category: 'navigation',
    description: 'Non-standard advancement button labels',
    layer: 1,
    promotionTarget: false,
    priority: 'P1',
    snapshot: `- textbox "First Name*" [ref=e1]:
- textbox "Last Name*" [ref=e2]:
- button "Save & Continue" [ref=b1]:`,
    expectedMatches: ['e1', 'e2']
  },

  // ─── Category 12: Dropdown Edge Cases ───
  {
    id: 'FC-12.4',
    category: 'dropdown',
    description: 'Multi-select checkbox group for locations',
    layer: 2,
    promotionTarget: true,
    priority: 'P1',
    snapshot: `- generic "Which locations would you consider working from?*" [ref=q1]:
- checkbox "San Francisco, CA" [ref=cb1]:
- checkbox "New York, NY" [ref=cb2]:
- checkbox "Remote" [ref=cb3]:
- checkbox "Seattle, WA" [ref=cb4]:
- checkbox "Austin, TX" [ref=cb5]:`,
    profileOverrides: { workLocationPreference: 'Remote' },
    // Checkbox/generic roles aren't text-like — nothing in unmatchedFields
    expectedMatches: [],
    expectedUnmatched: []
  },

  // ─── Category 13: EEO ───
  {
    id: 'FC-13.2',
    category: 'eeo',
    description: 'Non-standard EEO decline wording',
    layer: 2,
    promotionTarget: true,
    priority: 'P1',
    snapshot: `- combobox "Do you identify as having a disability?*" [ref=c1]:
- option "Yes, I have a disability" [ref=o1]:
- option "No, I do not have a disability" [ref=o2]:
- option "I don't wish to answer" [ref=o3]:`,
    expectedMatches: [],
    expectedUnmatched: ['Do you identify as having a disability?*']
  },

  // ─── Category 16: Failure Modes ───
  {
    id: 'FC-16.1',
    category: 'stuck-form',
    description: 'Form with required unfilled fields blocking Next',
    layer: 2,
    promotionTarget: false,
    priority: 'P0',
    snapshot: `- textbox "First Name*" [ref=e1]: Alex
- textbox "Last Name*" [ref=e2]: Chen
- textbox "Email*" [ref=e3]: alex@example.com
- textbox "Why are you interested in this role?*" [ref=e4]:
- combobox "Years of experience with Python*" [ref=c1]:
- checkbox "I agree to the terms and conditions*" [ref=cb1]:
- button "Next" [ref=n1]:`,
    // e4: essay question → unmatched (text-like)
    // c1: "Years of experience with Python" → matched by experience regex (fills raw number)
    // cb1: checkbox → not text-like, not tracked
    expectedMatches: [],
    expectedUnmatched: [
      'Why are you interested in this role?*'
    ]
  }
]
