import type { ApplicantProfile } from './application-types'
import { applicantProfileBridgeSnapshot } from './applicant-bridge-snapshot'
import { primaryCountryLabel } from './geo-normalization'

/** De-dupe repeated screening question text (Lever/OIT sometimes doubles the label). */
export function dedupeRepeatedScreeningLabel(label: string): string {
  const text = String(label || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length < 12) return text
  // Exact repetition: "LabelLabel" → "Label"
  for (let size = Math.floor(text.length / 2); size >= 8; size--) {
    if (text.length % size !== 0) continue
    const chunk = text.slice(0, size)
    if (chunk.repeat(text.length / size) === text) return chunk.trim()
  }
  // Prefix repetition with trailing noise: "Label?Label? Required" → "Label?"
  // LinkedIn sometimes duplicates the label text with extra DOM text appended
  const half = Math.floor(text.length / 2)
  for (let size = half; size >= 8; size--) {
    const chunk = text.slice(0, size).trim()
    if (text.startsWith(chunk + chunk)) return chunk
    if (text.startsWith(chunk + ' ' + chunk)) return chunk
  }
  // Strip trailing " Required" / " Optional" that LinkedIn appends to labels
  const stripped = text.replace(/\s+(?:Required|Optional)\s*$/i, '').trim()
  if (stripped.length > 8 && stripped !== text) return dedupeRepeatedScreeningLabel(stripped)
  return text
}

type MetroKey = 'sf_bay' | 'nyc' | 'la' | 'sea' | 'bos' | 'chi' | 'dal' | 'unknown'

function applicantHomeMetro(profile: ApplicantProfile): MetroKey | null {
  const city = (profile.basics.city || '').trim().toLowerCase()
  const state = (profile.basics.state || '').trim().toUpperCase()
  if (!city && !state) return null

  const blob = `${city} ${state}`

  if (
    state === 'CA' &&
    /\b(san francisco|^sf\b|oakland|san jose|palo alto|mountain view|berkeley|cupertino|sunnyvale|fremont|redwood|san mateo|santa clara|menlo park|walnut creek|daly city|south san francisco|san rafael|richmond ca|berkeley|alameda)\b/i.test(
      city
    )
  ) {
    return 'sf_bay'
  }
  if (
    (state === 'NY' || state === 'NJ' || state === 'CT') &&
    /\b(new york|nyc|manhattan|brooklyn|queens|bronx|staten|jersey city|hoboken|newark)\b/i.test(city)
  ) {
    return 'nyc'
  }
  if (state === 'CA' && /\b(los angeles|long beach|pasadena|santa monica|glendale ca)\b/i.test(city)) return 'la'
  if (state === 'WA' && /\b(seattle|bellevue|redmond|kirkland)\b/i.test(city)) return 'sea'
  if (
    (state === 'MA' || state === 'RI') &&
    /\b(boston|cambridge|somerville|quincy|brookline)\b/i.test(city)
  ) {
    return 'bos'
  }
  if (state === 'IL' && /\b(chicago|evanston|oak park il)\b/i.test(city)) return 'chi'
  if (state === 'TX' && /\b(dallas|austin|houston|fort worth|plano|irving)\b/i.test(city)) return 'dal'

  if (/\bnew york\b|\bnyc\b/.test(blob)) return 'nyc'
  if (/\bsan francisco\b/.test(blob)) return 'sf_bay'

  return 'unknown'
}

function employerOfficeMetroFromContext(label: string, jobLocationHint: string | undefined): MetroKey | null {
  const blob = `${label}\n${jobLocationHint || ''}`.toLowerCase()

  if (/\bsan francisco\b|\bbay area\b|\bsf office\b|\bsilicon valley\b/.test(blob)) return 'sf_bay'
  if (/\bnew york\b|\bnyc\b|\bmanhattan office\b/.test(blob)) return 'nyc'
  if (/\blos angeles\b|\bla office\b/.test(blob)) return 'la'
  if (/\bseattle\b/.test(blob)) return 'sea'
  if (/\bboston\b/.test(blob)) return 'bos'
  if (/\bchicago\b/.test(blob)) return 'chi'
  if (/\bdallas\b|\baustin\b|\bhouston\b/.test(blob)) return 'dal'

  return null
}

/**
 * Honest Yes/No for "commutable distance" / hybrid office questions when the label names a metro
 * and the applicant profile lists city/state. Returns null when we cannot derive a defensible answer.
 */
export function commutableDistanceScreeningAnswer(
  rawLabel: string,
  profile: ApplicantProfile,
  jobLocationHint: string | undefined
): 'Yes' | 'No' | null {
  const label = dedupeRepeatedScreeningLabel(rawLabel).toLowerCase()
  const asksLocal =
    /\bcommut|commutable\b/.test(label) ||
    /\bwithin a commutable\b/.test(label) ||
    /\breside within.{0,30}(?:distance|travel)\b/.test(label) ||
    (/\breporting to our\b/.test(label) && /\boffice\b/.test(label) && /\bdays per week\b/.test(label))

  if (!asksLocal) return null

  const office = employerOfficeMetroFromContext(rawLabel, jobLocationHint)
  const home = applicantHomeMetro(profile)
  if (!office || !home) return null
  if (office === home) return 'Yes'
  if (home === 'unknown') return null
  return 'No'
}

/** Binary radio labels where a blind default "Yes" is unsafe. */
export function isEasyApplyFactualRiskRadioLabel(rawLabel: string): boolean {
  const label = dedupeRepeatedScreeningLabel(rawLabel).toLowerCase()
  return (
    /\bcommut|commutable\b/.test(label) ||
    /\brelocate|relocation\b/.test(label) ||
    /\bwhere do you live\b/.test(label) ||
    /\bcurrent locat\b|\breside\b|\bcity\b.*\bstate\b/.test(label) ||
    /\bvisa\b|\bsponsorship\b|\bh-?1b\b/.test(label)
  )
}

type ApplicationQuestionIntent = 'behavioral' | 'factual' | 'unknown'

const BEHAVIORAL_PROMPT_RE =
  /\b(describe|tell us about|share an example|example of|walk us through|what motivates|why (?:are|do|would)|how would|how do you|challenge|conflict|leadership|work style|communication style|problem[-\s]?solving|biggest achievement|proud of|lessons? learned|cover letter|additional information|anything else)\b/i

const FACTUAL_PROMPT_RE =
  /\b(name|first name|last name|email|phone|mobile|address|street|city|state|province|postal|zip|country|location|resid|work authorization|authorized to work|right to work|eligible to work|sponsorship|visa|h-?1b|clearance|salary|compensation|pay|rate|notice period|start date|availability|weekend|overtime|shift|years? of experience|degree|education|gpa|graduat|school|university|license|certification|background check|drug test|driver|transportation|relocat|travel|citizenship|veteran|disability|gender|ethnicity|date of birth|linkedin|github|portfolio|website|url)\b/i

function normalizeQuestionLabel(rawLabel: string): string {
  return dedupeRepeatedScreeningLabel(rawLabel).toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Behavioral prompts are narrative prompts where synthesis is useful.
 * Factual prompts are identity/eligibility/address/compliance prompts where guessing is unsafe.
 */
export function classifyApplicationQuestionIntent(rawLabel: string, fieldType?: string): ApplicationQuestionIntent {
  const label = normalizeQuestionLabel(rawLabel)
  if (!label) return 'unknown'

  const lowerType = String(fieldType || '').toLowerCase()
  if (BEHAVIORAL_PROMPT_RE.test(label)) return 'behavioral'
  if (FACTUAL_PROMPT_RE.test(label)) return 'factual'

  const EXPERIENCE_QUESTION_RE = /\b(do you have experience|have you (?:worked|been)|are you (?:comfortable|familiar|experienced)|how many years|experience with|experience in|proficien)/i
  if (EXPERIENCE_QUESTION_RE.test(label)) return 'behavioral'

  if (lowerType === 'radio' || lowerType === 'checkbox' || lowerType === 'select') {
    if (/\?/.test(label) && label.length >= 30) return 'behavioral'
    return 'factual'
  }
  if (/\?/.test(label) && label.length >= 48) return 'behavioral'
  if (label.length >= 90) return 'behavioral'
  return 'unknown'
}

/** Behavioral context for LLM essay-style answers; all values are user-provided profile data. */
export function buildEasyApplyBehavioralContextPromptBlock(
  profile: ApplicantProfile,
  resumeText?: string
): string {
  const snap = applicantProfileBridgeSnapshot(profile)
  const lines: string[] = [
    'USER-PROVIDED CONTEXT FOR BEHAVIORAL QUESTIONS (use this for narrative answers only):',
    `- Years of experience: ${snap.yearsOfExperience || '(not set)'}`,
    `- Education summary: ${snap.educationSummary || '(not set)'}`,
    `- Work location preference: ${snap.workLocationPreference || '(not set)'}`,
    `- Notice period: ${snap.noticePeriod || '(not set)'}`,
    `- Start date preference: ${snap.startDatePreference || '(not set)'}`
  ]

  const coverTemplate = String(profile.coverLetterTemplate || '').trim()
  if (coverTemplate) {
    lines.push(`- Cover letter template excerpt: ${coverTemplate.replace(/\s+/g, ' ').slice(0, 1400)}`)
  }

  const answerRows = (profile.answerBank || [])
    .filter((row) => row.prompt.trim() && String(row.answer).trim())
    .slice(0, 8)
    .map((row) => `  • Q: ${row.prompt.trim().slice(0, 180)} | A: ${String(row.answer).trim().slice(0, 220)}`)
  if (answerRows.length) {
    lines.push('- Saved user-provided screening answers:')
    lines.push(...answerRows)
  }

  const resumeExcerpt = String(resumeText || '').replace(/\s+/g, ' ').trim().slice(0, 2800)
  if (resumeExcerpt) {
    lines.push(`- Resume excerpt: ${resumeExcerpt}`)
  }

  lines.push('Behavioral rules:')
  lines.push('- You may synthesize only for behavioral prompts (e.g., "tell us about", "describe", "why").')
  lines.push('- Never invent factual details such as addresses, legal status, degrees, employer names, or compensation numbers.')
  lines.push('- If supporting facts are thin, keep the answer brief, honest, and general.')
  return lines.join('\n')
}

/** Paragraph for Easy Apply LLM prompts — must not be contradicted by generated answers. */
export function buildEasyApplyImmutableFactsPromptBlock(profile: ApplicantProfile): string {
  const snap = applicantProfileBridgeSnapshot(profile)
  const lines: string[] = [
    'IMMUTABLE FACTS — you MUST NOT contradict these; use them verbatim for eligibility, location, and work-authorization fields:',
    `- Full name: ${snap.fullName}`,
    `- Email: ${snap.email}`,
    `- Phone: ${snap.phone || '(not set)'}`,
    `- Address line 1: ${snap.addressLine1 || '(not set)'}`,
    `- Address line 2: ${snap.addressLine2 || '(not set)'}`,
    `- Current city: ${snap.city || '(not set — do not invent a city)'}`,
    `- Current state/region: ${snap.state || '(not set)'}`,
    `- Postal code: ${snap.postalCode || '(not set)'}`,
    `- Current country: ${snap.countryDisplay || snap.country || '(not set)'}`,
    `- City, State (combined): ${snap.cityStateComma || '(not set until user fills city+state in Application Assistant)'}`,
    `- LinkedIn URL: ${snap.linkedInUrl || '(not set)'}`,
    `- Legally authorized to work (US-style Yes/No): ${snap.authorizedToWork || '(unknown — do not guess)'}`,
    `- Will require visa / immigration sponsorship (Yes/No): ${snap.requiresSponsorship || '(unknown — do not guess)'}`,
    `- Security clearance eligible (Yes/No): ${snap.clearanceEligible || '(unknown — do not guess)'}`,
    `- Willing to relocate (Yes/No): ${snap.willingToRelocate || '(unknown — do not guess)'}`,
    `- Willing to travel (Yes/No): ${snap.willingToTravel || '(unknown — do not guess)'}`,
    `- Over 18 years old (Yes/No): ${snap.over18 || '(unknown — do not guess)'}`,
    `- Has valid driver's license (Yes/No): ${snap.hasDriversLicense || '(unknown — do not guess)'}`,
    `- Can pass background check (Yes/No): ${snap.canPassBackgroundCheck || '(unknown — do not guess)'}`,
    `- Can pass drug test (Yes/No): ${snap.canPassDrugTest || '(unknown — do not guess)'}`,
    `- Salary minimum: ${snap.salaryMin != null ? String(snap.salaryMin) : '(not set)'}`,
    `- Salary maximum: ${snap.salaryMax != null ? String(snap.salaryMax) : '(not set)'}`,
    `- Work / relocation note from profile: ${snap.workLocationPreference || '(none)'}`,
    `- Education summary (only verifiable facts for essays): ${snap.educationSummary || '(not set)'}`,
    `- Years of experience (string): ${snap.yearsOfExperience || '(not set)'}`,
    'Rules:',
    '- For "current location", "city & state", "where do you reside", etc.: use City, State (combined) exactly when set; never substitute the job posting location.',
    '- For address fields: only use address lines and postal code above; if missing, do not infer.',
    '- For "commutable distance" to a specific office: if the applicant\'s city/state are set and are not in that metro, answer "No" unless the combined line clearly indicates they already live there.',
    '- For long essay prompts: do not invent employers, dollar amounts, program names, or degrees not implied by the education summary. Prefer cautious, general professional language if facts are thin.',
    '- Never output UUIDs or opaque option ids.'
  ]
  return lines.join('\n')
}

export function locatedInUnitedStatesAnswer(profile: ApplicantProfile): string {
  const raw = (profile.basics.country || '').trim()
  if (!raw) return ''
  const disp = primaryCountryLabel(raw).toLowerCase()
  if (/\bunited states\b|^(us|usa)\b/.test(disp) || /^(us|usa)$/i.test(raw)) return 'Yes'
  return 'No'
}

/**
 * Force-fill value for obvious location free-text fields after LLM (prevents SF-from-JD hallucinations).
 */
/**
 * When the profile matcher picks a city-only value but the label asks for city + state (or “current location”),
 * use the combined line from the applicant profile instead.
 */
export function profileFillValueForLabel(
  fieldLabel: string,
  matchedValue: string,
  profile: ApplicantProfile
): string {
  const label = fieldLabel.toLowerCase()
  const city = (profile.basics.city || '').trim()
  const state = (profile.basics.state || '').trim()
  const combo = city && state ? `${city}, ${state}` : city || state || ''
  if (!combo) return matchedValue
  if (
    /\bcity\b.{0,60}\bstate\b|\bstate\b.{0,60}\bcity\b|\bcity\s*&\s*state\b|\bcity and state\b|\bwhat city.{0,40}state\b|\breside in\b/i.test(
      label
    ) ||
    /\bcurrent location\b|\bwhere do you (?:currently )?(?:live|reside)\b/i.test(label)
  ) {
    return combo
  }
  return matchedValue
}

export function coerceAiAnswerToProfileLocation(fieldLabel: string, profile: ApplicantProfile, aiValue: string): string {
  const label = dedupeRepeatedScreeningLabel(fieldLabel).toLowerCase()
  const snap = applicantProfileBridgeSnapshot(profile)
  const hasLoc = !!(snap.city?.trim() && snap.state?.trim())
  if (!hasLoc) return aiValue

  const isLocField =
    /\bcurrent location\b/.test(label) ||
    /\bwhat city\b/.test(label) ||
    /\bcity\b.*\bstate\b.*\b(reside|live|located)\b/.test(label) ||
    /\bwhere do you (?:currently )?(?:live|reside)\b/.test(label) ||
    /^city\s*[,&]\s*state\b/.test(label)

  if (!isLocField) return aiValue
  return snap.cityStateComma.trim() || aiValue
}
