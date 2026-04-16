/**
 * Global label normalizations for accessibility snapshot matching (external ATS / CDP).
 * Kept separate from per-vendor ATS registry.
 */

const NORMALIZATIONS: Array<{ re: RegExp; to: string }> = [
  { re: /^legal\s*name\s*[-–—]\s*/gi, to: '' },
  { re: /\bwhat\s+is\s+your\s+current\s+location\b/gi, to: 'What is your current location' },
  { re: /\bwhat\s+city\s*[&and]\s*state\b/gi, to: 'What city & state do you currently reside in' },
  { re: /\bwhere\s+do\s+you\s+(?:currently\s+)?(?:live|reside)\b/gi, to: 'Where do you currently live' },
  { re: /\bwork\s*auth(?:orization)?\b/gi, to: 'Work Authorization' },
  { re: /\bcountry\s*\/\s*region\b/gi, to: 'Country' },
  { re: /\blinkedin\s*profile\s*url\b/gi, to: 'LinkedIn' },
  { re: /\blinkedin\s*url\b/gi, to: 'LinkedIn' },
  { re: /^linkedin\b/gi, to: 'LinkedIn' },
  { re: /\bphone\s*number\b/gi, to: 'Phone' },
  { re: /\bmobile\s*phone\b/gi, to: 'Phone' },
  { re: /\be-?mail\s*address\b/gi, to: 'Email' },
  { re: /\bfull\s*legal\s*name\b/gi, to: 'Legal Name' },
  { re: /\bfirst\s*&\s*last\s*name\b/gi, to: 'Full Name' },
  { re: /\bvisa\s*sponsorship\b/gi, to: 'Sponsorship' },
  { re: /\bwork\s*authorization\b/gi, to: 'Work Authorization' },
  { re: /\bdesired\s*salary\b/gi, to: 'Desired Salary' },
  { re: /\bsalary\s*expect(?:ation|ed)?\b/gi, to: 'Salary Expectation' },
  { re: /\bcompensation\s*expect(?:ation|ed)?\b/gi, to: 'Compensation Expectation' },
  { re: /\bhighest\s*(?:level\s*of\s*)?(?:education|degree)\b/gi, to: 'Highest Education' },
  { re: /\beducational?\s*(?:background|level|qualification)\b/gi, to: 'Education' },
  { re: /\bnotice\s*period\b/gi, to: 'Notice Period' },
  { re: /\bwork\s*(?:location|arrangement)\s*prefer(?:ence|red)?\b/gi, to: 'Work Location Preference' },
  { re: /\bsign[\s-]*in\s*e?-?mail?\b/gi, to: 'Email' },
  { re: /\baccount\s*e?-?mail\b/gi, to: 'Email' },
  { re: /\b(?:school|university|college|institution)\s*name\b/gi, to: 'School' },
  { re: /\b(?:degree|diploma)\s*(?:type|level)\b/gi, to: 'Degree' },
  { re: /\bfield\s*of\s*study\b/gi, to: 'Field of study' },
  { re: /\barea\s*of\s*(?:study|concentration)\b/gi, to: 'Field of study' },
  { re: /\b(?:academic\s*)?major\b/gi, to: 'Field of study' },
  { re: /\bgraduation\s*year\b/gi, to: 'Year of To' }
]

export function normalizeFieldLabelForSnapshotMatch(raw: string): string {
  let s = String(raw || '').trim()
  if (!s) return s
  for (const { re, to } of NORMALIZATIONS) {
    s = s.replace(re, to)
  }
  return s.trim()
}
