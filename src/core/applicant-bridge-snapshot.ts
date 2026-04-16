import type { ApplicantProfile } from './application-types'
import { expandUsStateForms, primaryCountryLabel } from './geo-normalization'

/** Single answer-bank row for ATS assist (prompt → answer matching in the extension). */
type ApplicantBridgeAnswerRow = {
  prompt: string
  answer: string | number | boolean
}

/** Minimal applicant data sent to the extension for ATS assist (no file paths). */
export type ApplicantBridgeSnapshot = {
  fullName: string
  firstName: string
  lastName: string
  email: string
  phone: string
  /** Digits-only phone for "mobile number (digits only)" style fields. */
  phoneDigits: string
  addressLine1: string
  addressLine2: string
  linkedInUrl: string
  githubUrl: string
  portfolioUrl: string
  websiteUrl: string
  city: string
  state: string
  postalCode: string
  /** US state / province variants for dropdown matching (abbrev + full name). */
  stateVariants: string[]
  country: string
  /** Canonical-ish country label for full-name dropdowns. */
  countryDisplay: string
  /** "City, ST" when both set (legacy ATS layouts). */
  cityStateComma: string
  /** Single-line current residence for generic Location fields; preferred over {@link cityStateComma} when set. */
  currentLocationLine: string
  /** Longer answer for “currently residing” wording; preferred over the short current-location line when set. */
  currentResidenceAnswer: string
  yearsOfExperience: string
  educationSummary: string
  educationStartMonth: string
  educationStartYear: string
  educationEndMonth: string
  educationEndYear: string
  currentlyAttending: string
  schoolName: string
  degreeType: string
  fieldOfStudy: string
  languages: string
  certifications: string
  /** Yes / No / '' when unset — matches common ATS boolean prompts. */
  authorizedToWork: string
  requiresSponsorship: string
  clearanceEligible: string
  willingToRelocate: string
  willingToTravel: string
  over18: string
  hasDriversLicense: string
  canPassBackgroundCheck: string
  canPassDrugTest: string
  salaryMin: number | undefined
  salaryMax: number | undefined
  salaryCurrency: string
  noticePeriod: string
  startDatePreference: string
  /** Derived when `startDatePreference` parses as a calendar date. */
  startDateMMDDYYYY: string
  startDateDashesYYYYMMDD: string
  startDateSlashesMMDDYYYY: string
  workLocationPreference: string
  answerBank: ApplicantBridgeAnswerRow[]
}

function splitFullName(full: string): { first: string; last: string } {
  const t = String(full || '').trim()
  if (!t) return { first: '', last: '' }
  const parts = t.split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

function yesNo(work: boolean | undefined): string {
  if (work === true) return 'Yes'
  if (work === false) return 'No'
  return ''
}

function digitsOnlyPhone(phone: string): string {
  return String(phone || '').replace(/\D/g, '')
}

function deriveStartDateVariants(pref: string): {
  startDateMMDDYYYY: string
  startDateDashesYYYYMMDD: string
  startDateSlashesMMDDYYYY: string
} {
  const raw = String(pref || '').trim()
  const empty = { startDateMMDDYYYY: '', startDateDashesYYYYMMDD: '', startDateSlashesMMDDYYYY: '' }
  if (!raw) return empty
  if (/^immediately|asap|any\s*time|flexible|negotiable|now\b/i.test(raw)) {
    return { startDateMMDDYYYY: raw, startDateDashesYYYYMMDD: raw, startDateSlashesMMDDYYYY: raw }
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const [, y, m, d] = iso
    const mmddyyyy = `${m}/${d}/${y}`
    return { startDateDashesYYYYMMDD: `${y}-${m}-${d}`, startDateMMDDYYYY: mmddyyyy, startDateSlashesMMDDYYYY: mmddyyyy }
  }
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (us) {
    const mm = us[1].padStart(2, '0')
    const dd = us[2].padStart(2, '0')
    const y = us[3]
    const slash = `${mm}/${dd}/${y}`
    return {
      startDateMMDDYYYY: slash,
      startDateSlashesMMDDYYYY: slash,
      startDateDashesYYYYMMDD: `${y}-${mm}-${dd}`
    }
  }
  return { startDateMMDDYYYY: raw, startDateDashesYYYYMMDD: raw, startDateSlashesMMDDYYYY: raw }
}

export function applicantProfileBridgeSnapshot(profile: ApplicantProfile): ApplicantBridgeSnapshot {
  const { first, last } = splitFullName(profile.basics.fullName)
  const wa = profile.workAuth || ({} as ApplicantProfile['workAuth'])
  const comp = profile.compensation || ({} as ApplicantProfile['compensation'])
  const city = profile.basics.city || ''
  const state = profile.basics.state || ''
  const countryRaw = profile.basics.country || ''
  const stateVariants = expandUsStateForms(state)
  const dates = deriveStartDateVariants(comp.startDatePreference || '')
  const cityStateComma =
    city && state ? `${city}, ${state}` : city || state ? `${city}${state}` : ''
  const currentLocationLine = String(profile.basics.currentLocationLine || '').trim()
  const currentResidenceAnswer = String(profile.basics.currentResidenceAnswer || '').trim()

  return {
    fullName: profile.basics.fullName || '',
    firstName: first,
    lastName: last,
    email: profile.basics.email || '',
    phone: profile.basics.phone || '',
    phoneDigits: digitsOnlyPhone(profile.basics.phone || ''),
    addressLine1: profile.basics.addressLine1 || '',
    addressLine2: profile.basics.addressLine2 || '',
    linkedInUrl: profile.links.linkedInUrl || '',
    githubUrl: profile.links.githubUrl || '',
    portfolioUrl: profile.links.portfolioUrl || '',
    websiteUrl: profile.links.websiteUrl || '',
    city,
    state,
    postalCode: profile.basics.postalCode || '',
    stateVariants,
    country: countryRaw,
    countryDisplay: primaryCountryLabel(countryRaw),
    cityStateComma,
    currentLocationLine,
    currentResidenceAnswer,
    yearsOfExperience: profile.background.yearsOfExperience || '',
    educationSummary: profile.background.educationSummary || '',
    educationStartMonth: profile.background.educationStartMonth ? String(profile.background.educationStartMonth) : '',
    educationStartYear: profile.background.educationStartYear ? String(profile.background.educationStartYear) : '',
    educationEndMonth: profile.background.educationEndMonth ? String(profile.background.educationEndMonth) : '',
    educationEndYear: profile.background.educationEndYear ? String(profile.background.educationEndYear) : '',
    currentlyAttending: profile.background.currentlyAttending ? 'Yes' : '',
    schoolName: profile.background.schoolName || '',
    degreeType: profile.background.degreeType || '',
    fieldOfStudy: profile.background.fieldOfStudy || '',
    languages: profile.background.languages || '',
    certifications: profile.background.certifications || '',
    authorizedToWork: yesNo(wa.authorizedToWork),
    requiresSponsorship: yesNo(wa.requiresSponsorship),
    clearanceEligible: yesNo(wa.clearanceEligible),
    willingToRelocate: yesNo(wa.willingToRelocate),
    willingToTravel: yesNo(wa.willingToTravel),
    over18: yesNo(wa.over18),
    hasDriversLicense: yesNo(wa.hasDriversLicense),
    canPassBackgroundCheck: yesNo(wa.canPassBackgroundCheck),
    canPassDrugTest: yesNo(wa.canPassDrugTest),
    salaryMin: comp.salaryMin,
    salaryMax: comp.salaryMax,
    salaryCurrency: comp.salaryCurrency || '',
    noticePeriod: comp.noticePeriod || '',
    startDatePreference: comp.startDatePreference || '',
    startDateMMDDYYYY: dates.startDateMMDDYYYY,
    startDateDashesYYYYMMDD: dates.startDateDashesYYYYMMDD,
    startDateSlashesMMDDYYYY: dates.startDateSlashesMMDDYYYY,
    workLocationPreference: comp.workLocationPreference || '',
    answerBank: (profile.answerBank || []).map((row) => ({
      prompt: row.prompt || '',
      answer: row.answer
    }))
  }
}
