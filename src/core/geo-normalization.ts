/**
 * Country / US-state normalization for ATS dropdowns (no proprietary third-party maps).
 * Expand profile tokens into common label variants to improve option matching.
 */

const US_STATE_NAME_TO_ABBREV: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'district of columbia': 'DC'
}

function titleCaseState(lower: string): string {
  return lower
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

const US_STATE_ABBREV_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATE_NAME_TO_ABBREV).map(([name, ab]) => [ab, titleCaseState(name)])
)

/** ISO2 and common aliases → canonical English short name for dropdowns. */
const COUNTRY_ALIASES_TO_NAME: Record<string, string> = {
  us: 'United States',
  usa: 'United States',
  'united states': 'United States',
  'united states of america': 'United States',
  uk: 'United Kingdom',
  gb: 'United Kingdom',
  'united kingdom': 'United Kingdom',
  ca: 'Canada',
  canada: 'Canada',
  de: 'Germany',
  germany: 'Germany',
  fr: 'France',
  france: 'France',
  in: 'India',
  india: 'India',
  cn: 'China',
  china: 'China',
  jp: 'Japan',
  japan: 'Japan',
  au: 'Australia',
  australia: 'Australia',
  nz: 'New Zealand',
  nl: 'Netherlands',
  netherlands: 'Netherlands',
  ie: 'Ireland',
  ireland: 'Ireland',
  es: 'Spain',
  spain: 'Spain',
  it: 'Italy',
  italy: 'Italy',
  br: 'Brazil',
  brazil: 'Brazil',
  mx: 'Mexico',
  mexico: 'Mexico',
  sg: 'Singapore',
  singapore: 'Singapore',
  kr: 'South Korea',
  'south korea': 'South Korea',
  se: 'Sweden',
  sweden: 'Sweden',
  ch: 'Switzerland',
  switzerland: 'Switzerland',
  pl: 'Poland',
  poland: 'Poland',
  il: 'Israel',
  israel: 'Israel',
  ae: 'United Arab Emirates',
  'united arab emirates': 'United Arab Emirates'
}

/** Distinct display strings to try against US-state dropdown options (abbrev vs full name). */
export function expandUsStateForms(raw: string): string[] {
  const t = String(raw || '').trim()
  if (!t) return []
  const lower = t.toLowerCase()
  const out = new Set<string>()
  out.add(t)
  if (lower.length === 2 && US_STATE_ABBREV_TO_NAME[t.toUpperCase()]) {
    out.add(t.toUpperCase())
    out.add(US_STATE_ABBREV_TO_NAME[t.toUpperCase()])
  }
  if (US_STATE_NAME_TO_ABBREV[lower]) {
    out.add(US_STATE_NAME_TO_ABBREV[lower])
    out.add(US_STATE_ABBREV_TO_NAME[US_STATE_NAME_TO_ABBREV[lower]] || titleCaseState(lower))
  }
  return [...out].filter(Boolean)
}

/** Primary country label for forms (full name when we can infer from ISO2 / alias). */
export function primaryCountryLabel(raw: string): string {
  const t = String(raw || '').trim()
  if (!t) return ''
  const key = t.toLowerCase()
  if (COUNTRY_ALIASES_TO_NAME[key]) return COUNTRY_ALIASES_TO_NAME[key]
  if (t.length === 2 && COUNTRY_ALIASES_TO_NAME[t.toLowerCase()])
    return COUNTRY_ALIASES_TO_NAME[t.toLowerCase()]
  if (/^[A-Za-z]{2}$/.test(t) && COUNTRY_ALIASES_TO_NAME[t.toLowerCase()])
    return COUNTRY_ALIASES_TO_NAME[t.toLowerCase()]
  const title = t.charAt(0).toUpperCase() + t.slice(1)
  return title
}

/** All plausible country strings worth matching in snapshots / options. */
export function expandCountryForms(raw: string): string[] {
  const t = String(raw || '').trim()
  if (!t) return []
  const primary = primaryCountryLabel(t)
  const out = new Set<string>([t, primary])
  const lower = t.toLowerCase()
  if (COUNTRY_ALIASES_TO_NAME[lower]) {
    out.add(COUNTRY_ALIASES_TO_NAME[lower])
    out.add(lower)
    out.add(lower.toUpperCase())
  }
  return [...out].filter(Boolean)
}
