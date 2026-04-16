import type { ApplicantBridgeSnapshot } from './applicant-bridge-snapshot'
import { normalizeFieldLabelForSnapshotMatch } from './field-name-aliases'

type MatchSnapshotOptions = {
  /** Refs already acted on — omit from next plan (volatile tree). */
  skipRefs?: Set<string>
  /** Pre-computed essay answers, keyed by norm(label). */
  essayFill?: Record<string, string>
}

type MatchTraceEntry = {
  fieldLabel: string
  matchedKey: string | null
  reason: string
}


type FillAction =
  | { kind: 'type'; ref: string; text: string; label: string; inputRole: string }
  | { kind: 'click'; ref: string; label: string }
  | { kind: 'file'; ref?: string; elementSelector?: string; label: string }
  | { kind: 'select-option'; ref: string; label: string }

type ParsedRow = {
  role: string
  label: string
  ref: string
  raw: string
  index: number
  required: boolean
}

/** Interactive line with optional quoted label (may be empty: `textbox [ref=e56]:`). */
const LINE_RE =
  /^\s*-\s*(\w+)\s+(?:"((?:[^"\\]|\\.)*)"\s*)?\[ref=([^\]]+)\](?:\s+\[[^\]]+\])*\s*:?\s*$/i

/** Detect required markers: trailing asterisk in label or [aria-required] attribute in raw line. */
function isFieldRequired(label: string, rawLine: string): boolean {
  if (/\*\s*$/.test(label)) return true
  if (/\[required\]|\[aria-required(?:=true)?\]/i.test(rawLine)) return true
  return false
}

/** Label-only generic: `- generic [ref=e55]: Name*` */
const GENERIC_COLON_RE =
  /^\s*-\s*generic\s+\[ref=[^\]]+\]\s*:\s*(.+?)\s*$/i

function normLabelKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s?']/g, '')
    .trim()
}

export function parseSnapshotRows(snapshot: string): ParsedRow[] {
  const lines = String(snapshot || '').split(/\r?\n/)
  const out: ParsedRow[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LINE_RE)
    if (!m) continue
    const label = m[2] != null ? unescapeLabel(m[2]) : ''
    out.push({
      role: m[1].toLowerCase(),
      label: label.trim(),
      ref: m[3].trim(),
      raw: lines[i],
      index: i,
      required: isFieldRequired(label.trim(), lines[i])
    })
  }
  return mergeGenericColonHints(lines, out)
}

function mergeGenericColonHints(lines: string[], rows: ParsedRow[]): ParsedRow[] {
  /** Map line index -> trailing label text from `generic [ref]: Label` */
  const byLine = new Map<number, string>()
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(GENERIC_COLON_RE)
    if (m) byLine.set(i, m[1].trim())
  }

  return rows.map((row) => {
    if (!isTextLikeRole(row.role)) return row
    let label = row.label
    if (!label || label.length < 2 || /^(edit|search|type)$/i.test(label)) {
      for (let i = row.index - 1; i >= 0 && i >= row.index - 8; i--) {
        const hint = byLine.get(i)
        if (hint) {
          label = hint
          break
        }
      }
    }
    return { ...row, label }
  })
}

function isTextLikeRole(role: string): boolean {
  return ['textbox', 'searchbox', 'spinbutton', 'combobox'].includes(role)
}

function unescapeLabel(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

type FieldPatternEntry = {
  pattern: RegExp
  exclude?: RegExp
  profileKey: string
  transformer?: (profile: ApplicantBridgeSnapshot, L: string) => string | null
  /** When true, continue to the next entry if transformer/value returns null (original fall-through behavior). */
  fallThrough?: boolean
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

/**
 * Data-driven pattern table replacing the original if/else chain.
 * Order matters — first match wins (same semantics as the original).
 */
const TEXT_FIELD_PATTERNS: FieldPatternEntry[] = [
  // --- Name ---
  { pattern: /^first\s*name\b/i, profileKey: 'firstName' },
  { pattern: /^last\s*name\b/i, profileKey: 'lastName' },
  { pattern: /(?:^|\b)(?:legal\s*)?name\b/i, exclude: /first|last/i, profileKey: 'fullName' },
  { pattern: /(?:^|\b)(?:full\s*)?name\b/i, exclude: /first|last/i, profileKey: 'fullName' },

  // --- Email ---
  { pattern: /\bconfirm\s*e-?mail/i, profileKey: 'confirmEmail',
    transformer: (p) => p.email || null },
  { pattern: /e-?mail/i, profileKey: 'email' },
  // Login/signup pages: fill email into "Username" / "Sign in" fields
  { pattern: /\b(?:username|user\s*name|sign[\s-]*in|log[\s-]*in)\b/i, exclude: /password/i,
    profileKey: 'email' },

  // --- Phone (digits-only variant must come before general phone) ---
  { pattern: /\b(?:phone|mobile|telephone)\b/i, profileKey: 'phoneDigits',
    transformer: (p, L) => /\b(digits?|numeric|numbers?\s*only)\b/i.test(L) ? (p.phoneDigits || null) : null, fallThrough: true },
  { pattern: /\b(?:phone|mobile|telephone)\b/i, profileKey: 'phone' },

  // --- Address ---
  { pattern: /\b(address\s*(line)?\s*2|apt|suite|unit|apartment)\b/i, profileKey: 'addressLine2' },
  { pattern: /\b(address|street|mailing|residential|home\s+address)\b/i, profileKey: 'addressLine1',
    transformer: (p, L) => {
      const line1 = p.addressLine1 || ''
      if (!line1) return null
      const line2 = p.addressLine2 || ''
      return line2 && !/\bline\s*1\b/i.test(L) ? `${line1}, ${line2}` : line1
    }},

  // --- Zip / postal ---
  { pattern: /\b(zip|postal)\b/i, profileKey: 'postalCode' },

  // --- URLs ---
  { pattern: /\blinkedin\b/i, profileKey: 'linkedInUrl' },
  { pattern: /\bgithub\b/i, profileKey: 'githubUrl' },
  { pattern: /\bportfolio\b|\bpersonal\s+site\b/i, profileKey: 'portfolioUrl' },
  { pattern: /\bwebsite\b|(^|\b)url(\b|\?)/i, profileKey: 'websiteUrl',
    transformer: (p) => p.websiteUrl || p.portfolioUrl || null, fallThrough: true },

  // --- State / province ---
  { pattern: /(^|\b)state\b|province/i, exclude: /country\s*\/\s*state/i, profileKey: 'state',
    transformer: (p) => {
      const st = p.state || ''
      if (!st) return null
      const forms = p.stateVariants?.length ? p.stateVariants : [st]
      return [...forms].sort((a, b) => b.length - a.length)[0]
    }},

  // --- Current residence ---
  { pattern: /\bcurrently\s+resid|\bwhere\s+are\s+you\s+(currently\s+)?resid|\bwhere\s+do\s+you\s+(currently\s+)?(live|reside)\b|\bplace\s+of\s+residence\b|\bwhere\b.*\bresid/i, profileKey: 'currentResidence',
    transformer: (p, L) => {
      // Also match the "where ... resid" compound check from the original
      if (!(/\bcurrently\s+resid/i.test(L) ||
            /\bwhere\s+are\s+you\s+(currently\s+)?resid/i.test(L) ||
            /\bwhere\s+do\s+you\s+(currently\s+)?(live|reside)\b/i.test(L) ||
            (/\bwhere\b/i.test(L) && /\bresid/i.test(L)) ||
            /\bplace\s+of\s+residence\b/i.test(L))) return null
      return (
        p.currentResidenceAnswer?.trim() ||
        p.currentLocationLine?.trim() ||
        p.cityStateComma ||
        [p.city, p.state].filter(Boolean).join(', ') ||
        p.city ||
        null
      )
    }},

  // --- City / location ---
  { pattern: /\b(?:city|location)\b/i, exclude: /work\s*(?:location|arrangement)/i, profileKey: 'city',
    transformer: (p) => (
      p.currentLocationLine?.trim() ||
      p.currentResidenceAnswer?.trim() ||
      p.cityStateComma ||
      [p.city, p.state].filter(Boolean).join(', ') ||
      p.city ||
      null
    )},

  // --- Country ---
  { pattern: /\bcountry\b/i, profileKey: 'country',
    transformer: (p) => p.countryDisplay || p.country || null },

  // --- Start date ---
  { pattern: /\b(when\s*can\s*you\s*start|available\s*to\s*start|start\s*date|employment\s*start)\b/i, profileKey: 'startDate',
    transformer: (p, L) => {
      if (/\d{4}\s*-\s*\d{2}|yyyy|iso|year[\s-]*first/i.test(L) && p.startDateDashesYYYYMMDD) {
        return p.startDateDashesYYYYMMDD
      }
      if (/\d{1,2}\s*\/\s*\d{1,2}|mm\/?\s*dd|us\s*format/i.test(L) && p.startDateSlashesMMDDYYYY) {
        return p.startDateSlashesMMDDYYYY
      }
      return p.startDateSlashesMMDDYYYY || p.startDateDashesYYYYMMDD || p.startDatePreference || null
    }, fallThrough: true },

  // --- Years of experience ---
  { pattern: /\byears?\s*(?:of)?\s*experience\b/i, profileKey: 'yearsOfExperience' },

  // --- Willingness / eligibility ---
  { pattern: /\b(?:willing|able)\s+to\s+relocat|\brelocation\b/i, profileKey: 'willingToRelocate' },
  { pattern: /\b(?:willing|able)\s+to\s+travel|\btravel requirement\b/i, profileKey: 'willingToTravel' },
  { pattern: /\b(?:driver'?s?\s+license|valid\s+driver|driving\s+license)\b/i, profileKey: 'hasDriversLicense' },
  { pattern: /\bbackground\s+check\b/i, profileKey: 'canPassBackgroundCheck' },
  { pattern: /\bdrug\s+(?:screen|test)\b/i, profileKey: 'canPassDrugTest' },
  { pattern: /\bat\s+least\s+18\b|\bover\s+18\b|\b18\s+years\s+of\s+age\b/i, profileKey: 'over18' },

  // --- Salary / compensation ---
  { pattern: /\b(?:desired|expected|current|minimum|salary)\s*(?:salary|compensation|pay|wage|range)?\b|\b(?:compensation|pay)\s*(?:expectation|requirement|range)?\b|\b(?:salary)\b/i, profileKey: 'salaryMin',
    transformer: (p) => {
      if (p.salaryMin != null) {
        const currency = p.salaryCurrency || 'USD'
        return p.salaryMax != null && p.salaryMax !== p.salaryMin
          ? `${currency} ${p.salaryMin.toLocaleString()} - ${p.salaryMax.toLocaleString()}`
          : `${p.salaryMin.toLocaleString()}`
      }
      return null
    }},

  // --- Education ---
  { pattern: /\b(?:education|degree|highest\s+(?:level\s+of\s+)?education|academic|qualification)\b/i,
    exclude: /\byears?\b|\bmonth\b|\byear\s+of\b/i, profileKey: 'educationSummary' },

  // --- Education dates ---
  { pattern: /\bmonth\s+of\s+from\b|\bfrom.*month\b|\bstart\s*month\b/i, profileKey: 'educationStartMonth',
    transformer: (p) => {
      if (!p.educationStartMonth) return null
      return MONTH_NAMES[Number(p.educationStartMonth) - 1] || null
    }},
  { pattern: /\byear\s+of\s+from\b|\bfrom.*year\b|\bstart\s*year\b/i, profileKey: 'educationStartYear' },
  { pattern: /\bmonth\s+of\s+to\b|\bto.*month\b|\bend\s*month\b/i, profileKey: 'educationEndMonth',
    transformer: (p) => {
      if (!p.educationEndMonth) return null
      return MONTH_NAMES[Number(p.educationEndMonth) - 1] || null
    }},
  { pattern: /\byear\s+of\s+to\b|\bto.*year\b|\bend\s*year\b|\bgraduation\s*year\b/i, profileKey: 'educationEndYear' },
  { pattern: /\bcurrently\s+attend\b|\bpresently\s+attend\b|\bi\s+currently\s+attend\b/i, profileKey: 'currentlyAttending' },
  { pattern: /\bschool\b|\buniversity\b|\binstitution\b|\bcollege\b/i, exclude: /\byear\b|\bmonth\b/i, profileKey: 'schoolName' },
  { pattern: /\bdegree\s*type\b|\btype\s*of\s*degree\b|\blevel\s*of\s*education\b/i, profileKey: 'degreeType' },
  { pattern: /\bfield\s*of\s*study\b|\bmajor\b|\bdiscipline\b|\bconcentration\b/i, profileKey: 'fieldOfStudy' },
  { pattern: /\blanguage\b/i, exclude: /\bprogramming\b/i, profileKey: 'languages' },
  { pattern: /\bcertification\b|\blicense\b|\bcredential\b/i, exclude: /\bdriver/i, profileKey: 'certifications' },

  // --- Notice period ---
  { pattern: /\b(?:notice\s*period|how\s+(?:soon|quickly)\s+can\s+you\s+(?:start|join)|earliest\s+(?:start|join)\s*date)\b/i, profileKey: 'noticePeriod',
    transformer: (p) => p.noticePeriod || p.startDatePreference || null },

  // --- Work location preference (remote / hybrid / onsite) ---
  { pattern: /\b(?:work\s*(?:location|arrangement|mode|style)|remote|hybrid|on-?site|in-?office)\s*(?:preference)?\b/i,
    exclude: /address/i, profileKey: 'workLocationPreference' }
]

function matchTextField(
  label: string,
  profile: ApplicantBridgeSnapshot
): { key: string; text: string } | null {
  const L = normalizeFieldLabelForSnapshotMatch(label.trim())
  if (!L) return null

  for (const entry of TEXT_FIELD_PATTERNS) {
    if (!entry.pattern.test(L)) continue
    if (entry.exclude && entry.exclude.test(L)) continue
    if (entry.transformer) {
      const text = entry.transformer(profile, L)
      if (text) return { key: entry.profileKey, text }
      if (entry.fallThrough) continue
      return null
    }
    const val = (profile as Record<string, unknown>)[entry.profileKey]
    if (typeof val === 'string' && val) return { key: entry.profileKey, text: val }
    if (entry.fallThrough) continue
    return null
  }

  return null
}

/** Heuristic: long or interrogative prompts likely need essay / LLM / answer bank. */
export function looksLikeEssayQuestion(label: string): boolean {
  const L = String(label || '').trim()
  if (!L) return false
  if (/\?/.test(L)) return true
  if (L.length >= 48) return true
  if (
    /\b(why|describe|tell\s+us|explain|how\s+would|what\s+makes|in\s+what\s+ways)\b/i.test(L)
  ) {
    return true
  }
  return false
}

function questionAboveLine(snapshotLines: string[], buttonLineIndex: number): string {
  for (let i = buttonLineIndex - 1; i >= 0 && i >= buttonLineIndex - 25; i--) {
    const line = snapshotLines[i]
    const m = line.match(/^\s*-\s*\w+\s+"((?:[^"\\]|\\.)*)"/)
    const label = m ? unescapeLabel(m[1]) : ''
    const gm = line.match(GENERIC_COLON_RE)
    const fromGeneric = gm ? gm[1].trim() : ''
    const candidate = label || fromGeneric
    if (!candidate) continue
    if (
      /\?/.test(candidate) ||
      /authorized|authorization|sponsorship|visa|clearance|legally\s+eligible/i.test(candidate)
    ) {
      return candidate
    }
  }
  return ''
}

function booleanAnswerForQuestion(
  question: string,
  profile: ApplicantBridgeSnapshot
): 'Yes' | 'No' | null {
  const q = norm(question)
  if (!q) return null
  if (/authorized|legally\s+authorized|eligible\s+to\s+work|right\s+to\s+work/i.test(q)) {
    if (!profile.authorizedToWork) return null
    return profile.authorizedToWork.toLowerCase().startsWith('y') ? 'Yes' : 'No'
  }
  if (/sponsorship|visa\s+sponsorship|immigration/i.test(q)) {
    if (!profile.requiresSponsorship) return null
    return profile.requiresSponsorship.toLowerCase().startsWith('y') ? 'Yes' : 'No'
  }
  if (/clearance/i.test(q)) {
    if (!profile.clearanceEligible) return null
    return profile.clearanceEligible.toLowerCase().startsWith('y') ? 'Yes' : 'No'
  }
  if (/relocat|relocation/i.test(q)) {
    if (!profile.willingToRelocate) return null
    return profile.willingToRelocate.toLowerCase().startsWith('y') ? 'Yes' : 'No'
  }
  if (/willing\s+to\s+travel|travel\s+requirement/i.test(q)) {
    if (!profile.willingToTravel) return null
    return profile.willingToTravel.toLowerCase().startsWith('y') ? 'Yes' : 'No'
  }
  if (/driver'?s?\s+license|valid\s+driver|driving\s+license/i.test(q)) {
    if (!profile.hasDriversLicense) return null
    return profile.hasDriversLicense.toLowerCase().startsWith('y') ? 'Yes' : 'No'
  }
  if (/background\s+check/i.test(q)) {
    if (!profile.canPassBackgroundCheck) return null
    return profile.canPassBackgroundCheck.toLowerCase().startsWith('y') ? 'Yes' : 'No'
  }
  if (/drug\s+(screen|test)/i.test(q)) {
    if (!profile.canPassDrugTest) return null
    return profile.canPassDrugTest.toLowerCase().startsWith('y') ? 'Yes' : 'No'
  }
  if (/at\s+least\s+18|over\s+18|18\s+years\s+of\s+age/i.test(q)) {
    if (!profile.over18) return null
    return profile.over18.toLowerCase().startsWith('y') ? 'Yes' : 'No'
  }
  return null
}

function answerBankMatch(label: string, profile: ApplicantBridgeSnapshot): string | null {
  const nl = norm(label)
  if (!nl || !profile.answerBank?.length) return null
  if (nl.length > 15) {
    for (const row of profile.answerBank) {
      const p = norm(row.prompt)
      if (!p) continue
      if (nl.length > 15 && p.length > 15 && (nl.includes(p) || p.includes(nl))) {
        return String(row.answer ?? '')
      }
    }
  }
  return null
}

function essayFromOptions(label: string, essayFill?: Record<string, string>): string | null {
  if (!essayFill || !Object.keys(essayFill).length) return null
  const nk = normLabelKey(label)
  if (essayFill[nk]) return essayFill[nk]
  for (const [k, v] of Object.entries(essayFill)) {
    if (!k || !v) continue
    if (k.length > 15 && nk.length > 15 && (nk.includes(k) || k.includes(nk))) return v
  }
  return null
}

export function snapshotHasOptionLines(snapshot: string): boolean {
  return /^\s*-\s*option\s+"/im.test(String(snapshot || ''))
}

export function matchSnapshotToProfile(
  snapshot: string,
  profile: ApplicantBridgeSnapshot,
  resumePath?: string,
  opts?: MatchSnapshotOptions
): { actions: FillAction[]; unmatchedFields: string[]; requiredUnmatchedFields: string[]; matchTrace: MatchTraceEntry[] } {
  const skipRefs = opts?.skipRefs ?? new Set<string>()
  const essayFill = opts?.essayFill
  const rows = parseSnapshotRows(snapshot)
  const snapshotLines = String(snapshot || '').split(/\r?\n/)

  const typeActions: FillAction[] = []
  const clickActions: FillAction[] = []
  const fileActions: FillAction[] = []
  const usedRefs = new Set<string>()
  const matchedKeys = new Set<string>()
  const unmatched = new Set<string>()
  const requiredUnmatched = new Set<string>()
  const matchTrace: MatchTraceEntry[] = []

  for (const row of rows) {
    if (!isTextLikeRole(row.role)) continue
    if (skipRefs.has(row.ref)) continue

    const m = matchTextField(row.label, profile)
    if (m && m.text) {
      if (usedRefs.has(row.ref) || matchedKeys.has(m.key)) {
        matchTrace.push({ fieldLabel: row.label, matchedKey: m.key, reason: "duplicate ref or key" })
        continue
      }
      usedRefs.add(row.ref)
      matchedKeys.add(m.key)
      typeActions.push({
        kind: 'type',
        ref: row.ref,
        text: m.text,
        label: row.label,
        inputRole: row.role
      })
      matchTrace.push({ fieldLabel: row.label, matchedKey: m.key, reason: "profile field match" })
      continue
    }
    const bank = answerBankMatch(row.label, profile)
    if (bank) {
      if (usedRefs.has(row.ref)) continue
      usedRefs.add(row.ref)
      typeActions.push({
        kind: 'type',
        ref: row.ref,
        text: bank,
        label: row.label,
        inputRole: row.role
      })
      matchTrace.push({ fieldLabel: row.label, matchedKey: "answerBank", reason: "answer bank match" })
      continue
    }
    const essay = essayFromOptions(row.label, essayFill)
    if (essay) {
      if (usedRefs.has(row.ref)) continue
      usedRefs.add(row.ref)
      typeActions.push({
        kind: 'type',
        ref: row.ref,
        text: essay,
        label: row.label,
        inputRole: row.role
      })
      matchTrace.push({ fieldLabel: row.label, matchedKey: "essayFill", reason: "essay fill match" })
      continue
    }
    matchTrace.push({ fieldLabel: row.label, matchedKey: null, reason: m ? "profile field empty" : "no matching rule" })
    unmatched.add(row.label)
    if (row.required) requiredUnmatched.add(row.label)
  }

  const BOOLEAN_ANSWER_ROLES = new Set(['button', 'radio'])
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!BOOLEAN_ANSWER_ROLES.has(row.role)) continue
    if (skipRefs.has(row.ref)) continue
    if (row.label !== 'Yes' && row.label !== 'No') continue
    const q = questionAboveLine(snapshotLines, row.index)
    const want = booleanAnswerForQuestion(q, profile)
    if (!want) continue
    if (row.label === want && !usedRefs.has(row.ref)) {
      usedRefs.add(row.ref)
      clickActions.push({ kind: 'click', ref: row.ref, label: `${q.slice(0, 80)} → ${row.label}` })
    }
  }

  const resumeHint = /\bresume\b|\bcv\b/i
  const uploadHint = /\b(upload|attach|choose\s+file)\b/i
  const fileDedupe = new Set<string>()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.role === 'button' && uploadHint.test(row.label) && resumeHint.test(row.label)) {
      const k = row.ref || row.label
      if (fileDedupe.has(k) || (row.ref && skipRefs.has(row.ref))) continue
      fileDedupe.add(k)
      fileActions.push({
        kind: 'file',
        ref: row.ref,
        elementSelector: undefined,
        label: row.label
      })
      continue
    }
    if (resumeHint.test(row.label)) {
      for (let j = i + 1; j < Math.min(i + 8, rows.length); j++) {
        const r2 = rows[j]
        if (r2.role === 'button' && uploadHint.test(norm(r2.label))) {
          const k = r2.ref || `${i}-${j}`
          if (fileDedupe.has(k) || (r2.ref && skipRefs.has(r2.ref))) break
          fileDedupe.add(k)
          fileActions.push({
            kind: 'file',
            ref: r2.ref,
            elementSelector: undefined,
            label: `${row.label} / ${r2.label}`
          })
          break
        }
      }
    }
  }

  if (resumePath) {
    const hasFile = fileActions.length > 0
    if (!hasFile) {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (resumeHint.test(row.label)) {
          const k = `fallback-${row.label}`
          if (!fileDedupe.has(k)) {
            fileDedupe.add(k)
            fileActions.push({
              kind: 'file',
              ref: row.ref,
              elementSelector: undefined,
              label: `Resume upload (${row.label})`
            })
          }
          break
        }
      }
    }
  }

  return {
    actions: sortFillActions([...typeActions, ...clickActions, ...fileActions]),
    unmatchedFields: [...unmatched],
    requiredUnmatchedFields: [...requiredUnmatched],
    matchTrace
  }
}

// ---------------------------------------------------------------------------
// Pre-submit form completeness evaluation
// ---------------------------------------------------------------------------

type FormCompletenessReport = {
  /** Total interactive text-like fields detected on the current page. */
  totalFields: number
  /** Fields that appear to have a value (non-empty colon content in snapshot). */
  filledFields: number
  /** Required fields (asterisk / aria-required) that are still empty. */
  requiredEmpty: string[]
  /** All empty field labels (required + optional). */
  allEmpty: string[]
  /** 0–100 score: filled / total (required fields weighted 2×). */
  score: number
  /** True when no required fields are empty. */
  ready: boolean
}

/** Relaxed line regex that captures text-like fields WITH or WITHOUT trailing value content. */
const COMPLETENESS_LINE_RE =
  /^\s*-\s*(\w+)\s+(?:"((?:[^"\\]|\\.)*)"\s*)?\[ref=([^\]]+)\](?:\s+\[[^\]]+\])*\s*:\s*(.*?)\s*$/i

/**
 * Evaluate completeness of the current ATS form page from a fresh accessibility snapshot.
 * Parses text-like fields, checks whether each has content (non-empty value after the colon),
 * and flags required-but-empty fields.
 */
export function evaluateFormCompleteness(snapshot: string): FormCompletenessReport {
  const lines = String(snapshot || '').split(/\r?\n/)

  type FieldInfo = { label: string; required: boolean; filled: boolean }
  const fields: FieldInfo[] = []

  for (const line of lines) {
    const m = line.match(COMPLETENESS_LINE_RE)
    if (!m) continue
    const role = m[1].toLowerCase()
    if (!isTextLikeRole(role)) continue
    const label = m[2] != null ? unescapeLabel(m[2]).trim() : ''
    const valueAfterColon = (m[4] || '').trim()
    const required = isFieldRequired(label, line)
    fields.push({ label, required, filled: valueAfterColon.length > 0 })
  }

  const requiredEmpty: string[] = []
  const allEmpty: string[] = []
  let filledCount = 0

  for (const f of fields) {
    if (f.filled) {
      filledCount++
    } else {
      allEmpty.push(f.label)
      if (f.required) requiredEmpty.push(f.label)
    }
  }

  const total = fields.length
  const requiredTotal = fields.filter((f) => f.required).length
  const requiredFilled = requiredTotal - requiredEmpty.length
  const optionalTotal = total - requiredTotal
  const optionalFilled = filledCount - requiredFilled

  // Weighted score: required fields count 2×
  const weightedMax = requiredTotal * 2 + optionalTotal
  const weightedFilled = requiredFilled * 2 + optionalFilled
  const score = weightedMax > 0 ? Math.min(100, Math.round((100 * weightedFilled) / weightedMax)) : 100

  return {
    totalFields: total,
    filledFields: filledCount,
    requiredEmpty,
    allEmpty,
    score,
    ready: requiredEmpty.length === 0
  }
}

/** Prefer plain text fields, then combobox (async options), then file, then clicks. */
function sortFillActions(actions: FillAction[]): FillAction[] {
  const rank = (a: FillAction): number => {
    if (a.kind === 'click') return 4
    if (a.kind === 'file') return 3
    if (a.kind === 'type' && a.inputRole === 'combobox') return 2
    if (a.kind === 'type') return 1
    return 4 // fallback for unknown kinds (treated as click)
  }
  return [...actions].sort((x, y) => rank(x) - rank(y))
}

export function findSelectedOptionRefs(snapshot: string): Array<{ ref: string; label: string }> {
  const lines = String(snapshot || '').split(/\r?\n/)
  const out: Array<{ ref: string; label: string }> = []
  const optRe =
    /^\s*-\s*option\s+"((?:[^"\\]|\\.)*)"\s+\[ref=([^\]]+)\][^\n]*\[selected\]/i
  for (const line of lines) {
    const m = line.match(optRe)
    if (m) out.push({ label: unescapeLabel(m[1]), ref: m[2].trim() })
  }
  return out
}

/**
 * 6-level fuzzy option matching (from Simplify Copilot's approach).
 * Tries progressively looser matches until one hits:
 *   1. Exact match (case-insensitive)
 *   2. Option label equals query value
 *   3. Option label includes query
 *   4. Query includes option label
 *   5. Option label starts with query
 *   6. Query starts with option label
 */
function findBestOptionRef(
  snapshot: string,
  targetValue: string
): { ref: string; label: string; matchLevel: number } | null {
  if (!targetValue.trim()) return null

  const options: Array<{ ref: string; label: string }> = []
  const optRe = /^\s*-\s*option\s+"((?:[^"\\]|\\.)*)"\s+\[ref=([^\]]+)\]/i
  for (const line of String(snapshot || '').split(/\r?\n/)) {
    const m = line.match(optRe)
    if (m) options.push({ ref: m[2].trim(), label: unescapeLabel(m[1]) })
  }
  if (!options.length) return null

  const q = targetValue.toLowerCase().trim()
  const qStripped = q.replace(/[^a-z0-9 ]/g, '').trim()

  for (let level = 1; level <= 6; level++) {
    for (const opt of options) {
      const ol = opt.label.toLowerCase().trim()
      const olStripped = ol.replace(/[^a-z0-9 ]/g, '').trim()
      let match = false
      switch (level) {
        case 1: match = ol === q; break
        case 2: match = olStripped === qStripped; break
        case 3: match = ol.includes(q) || olStripped.includes(qStripped); break
        case 4: match = q.includes(ol) || qStripped.includes(olStripped); break
        case 5: match = ol.startsWith(q) || olStripped.startsWith(qStripped); break
        case 6: match = q.startsWith(ol) || qStripped.startsWith(olStripped); break
      }
      if (match) return { ref: opt.ref, label: opt.label, matchLevel: level }
    }
  }
  return null
}

export function findSubmitButtonRef(snapshot: string): string | null {
  const lines = String(snapshot || '').split(/\r?\n/)
  for (const line of lines) {
    const m = line.match(/^\s*-\s*button\s+"((?:[^"\\]|\\.)*)"\s+\[ref=([^\]]+)\]/i)
    if (!m) continue
    const label = unescapeLabel(m[1]).toLowerCase()
    if (
      /\bsubmit\b/.test(label) ||
      /\bapply\b/.test(label) ||
      /send\s+application/.test(label) ||
      /\breview\s+and\s+submit\b/.test(label) ||
      /\bsubmit\s+application\b/.test(label) ||
      /\bsubmit\s+my\s+application\b/.test(label) ||
      /\bconfirm\s+and\s+submit\b/.test(label) ||
      /\bapply\s+now\b/.test(label) ||
      /\bcomplete\b/.test(label) ||
      /\bfinish\b/.test(label) ||
      /\bdone\b/.test(label) ||
      /\bsend\s+request\b/.test(label) ||
      /\bsave\s+and\s+submit\b/.test(label) ||
      /\bplace\s+order\b/.test(label) ||
      /\bconfirm\b/.test(label) ||
      /\bfinalize\b/.test(label)
    ) {
      return m[2].trim()
    }
  }
  return null
}

/** Multi-step forms: Next / Continue / Review (before final submit). */
export function findNextStepButtonRef(snapshot: string): string | null {
  const lines = String(snapshot || '').split(/\r?\n/)
  const lineRe =
    /^\s*-\s*(button|link)\s+"((?:[^"\\]|\\.)*)"\s+\[ref=([^\]]+)\]/i

  for (const line of lines) {
    const m = line.match(lineRe)
    if (!m) continue
    const label = unescapeLabel(m[2]).toLowerCase()
    const ref = m[3].trim()
    // Final-submit labels belong in findSubmitButtonRef, not advance
    if (
      /\breview\s+and\s+submit\b/.test(label) ||
      /\bsubmit\s+application\b/.test(label) ||
      /\bsubmit\s+my\s+application\b/.test(label) ||
      /\bconfirm\s+and\s+submit\b/.test(label)
    ) {
      continue
    }
    // Job board landing pages (Ashby, etc.): CTA before the application form is in the tree
    if (
      /apply for this job/.test(label) ||
      /apply to this job/.test(label) ||
      /apply for the job/.test(label) ||
      /start application/.test(label) ||
      /begin application/.test(label) ||
      /start your application/.test(label) ||
      /continue to application/.test(label) ||
      /continue application/.test(label) ||
      /^i['\u2019]m interested$/i.test(label.trim()) ||
      /^(interested|sign up to apply)$/i.test(label.trim())
    ) {
      return ref
    }
    if (
      /\bnext\b/.test(label) ||
      /\bcontinue\b/.test(label) ||
      /save\s+and\s+continue/.test(label) ||
      /\bproceed\b/.test(label) ||
      /\bforward\b/.test(label) ||
      /go\s+to\s+next/.test(label) ||
      /save\s*&\s*continue/.test(label) ||
      /save\s*&\s*next/.test(label) ||
      /\bnext\s+step\b/.test(label) ||
      /\badvance\b/.test(label) ||
      /move\s+forward/.test(label) ||
      (/\breview\b/.test(label) && !/\bsubmit\b/.test(label)) ||
      /\breview\s+application\b/.test(label) ||
      /\breview\s+my\s+application\b/.test(label) ||
      (/\bpreview\b/.test(label) && !/\bsubmit\b/.test(label))
    ) {
      return ref
    }
  }
  return null
}

/**
 * Find an "Apply" CTA button on a job description page (before the form loads).
 * Matches: "Apply", "Apply Now", "Apply for this job", "Start Application", etc.
 * This is broader than findNextStepButtonRef and also matches links.
 */
function findApplyButtonRef(snapshot: string): string | null {
  const lines = String(snapshot || '').split(/\r?\n/)
  const lineRe = /^\s*-\s*(button|link)\s+"((?:[^"\\]|\\.)*)"\s+\[ref=([^\]]+)\]/i

  for (const line of lines) {
    const m = line.match(lineRe)
    if (!m) continue
    const label = unescapeLabel(m[2]).toLowerCase().trim()
    const ref = m[3].trim()
    if (
      /^apply$/i.test(label) ||
      /^apply\s+now$/i.test(label) ||
      /^apply\s+for\s+(this|the)\s+job$/i.test(label) ||
      /^apply\s+to\s+(this|the)\s+job$/i.test(label) ||
      /^apply\s+for\s+(this|the)\s+(position|role)$/i.test(label) ||
      /^start\s+(your\s+)?application$/i.test(label) ||
      /^begin\s+(your\s+)?application$/i.test(label) ||
      /^continue\s+to\s+appli/i.test(label) ||
      /^i['\u2019]m\s+interested$/i.test(label) ||
      /^apply\s+on\s+company\s+site$/i.test(label) ||
      /^apply\s+with\s+/i.test(label) ||
      /^easy\s+apply$/i.test(label)
    ) {
      return ref
    }
  }
  return null
}
