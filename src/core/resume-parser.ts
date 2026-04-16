// ---------------------------------------------------------------------------
// resume-parser.ts — Pure functions that parse a markdown resume into a
// UserProfile.  No Electron imports, no I/O.
// ---------------------------------------------------------------------------

import type { ProfileEntry, EducationEntry, UserProfile } from './profile-db'
import {
  simpleHash,
  parseFlexibleDate,
  calculateDurationMonths,
  calculateRecencyWeight
} from './profile-db'

// ── Skill & domain keyword sets ────────────────────────────────────────────

const SKILL_KEYWORDS: string[] = [
  'AI', 'machine learning', 'deep learning', 'NLP', 'LLM', 'GPT',
  'M&A', 'IPO', 'fundraise', 'fundraising', 'due diligence',
  'product', 'product management', 'engineering', 'software',
  'SEO', 'growth', 'marketing', 'GTM', 'go-to-market',
  'enterprise', 'SaaS', 'B2B', 'B2C',
  'biotech', 'pharma', 'pharmaceutical', 'FDA', 'clinical trials',
  'equity research', 'investment banking', 'venture capital', 'private equity',
  'financial modeling', 'valuation', 'DCF',
  'Python', 'TypeScript', 'React', 'Node', 'SQL',
  'data science', 'analytics', 'data pipeline',
  'strategy', 'operations', 'business development',
  'revenue', 'ARR', 'pipeline'
]

const DOMAIN_RULES: Array<{ domain: string; patterns: RegExp[] }> = [
  {
    domain: 'AI',
    patterns: [/\bAI\b/i, /machine learning/i, /deep learning/i, /\bLLM\b/i, /\bGPT\b/i, /\bNLP\b/i]
  },
  {
    domain: 'healthcare',
    patterns: [/health/i, /clinical/i, /hospital/i, /patient/i, /medical/i]
  },
  {
    domain: 'biotech',
    patterns: [/biotech/i, /pharma/i, /FDA/i, /therapeutic/i, /drug/i, /oncology/i]
  },
  {
    domain: 'finance',
    patterns: [/financ/i, /banking/i, /equity/i, /invest/i, /fund/i, /capital/i, /M&A/i, /IPO/i]
  },
  {
    domain: 'enterprise',
    patterns: [/enterprise/i, /\bSaaS\b/i, /\bB2B\b/i]
  },
  {
    domain: 'consumer',
    patterns: [/consumer/i, /\bB2C\b/i, /retail/i, /marketplace/i]
  },
  {
    domain: 'venture_capital',
    patterns: [/venture capital/i, /\bVC\b/, /seed stage/i, /series [A-D]/i]
  }
]

const EXPERIENCE_TYPE_MAP: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /founder|co-founder|ceo/i, type: 'founder' },
  { pattern: /chief of staff/i, type: 'chief_of_staff' },
  { pattern: /director/i, type: 'director' },
  { pattern: /senior.*analyst/i, type: 'senior_analyst' },
  { pattern: /analyst/i, type: 'analyst' },
  { pattern: /associate/i, type: 'associate' },
  { pattern: /engineer/i, type: 'engineer' },
  { pattern: /manager/i, type: 'manager' },
  { pattern: /partner/i, type: 'executive' },
  { pattern: /president|vp|vice president/i, type: 'executive' }
]

// ── Metric extraction regex ────────────────────────────────────────────────

const METRIC_PATTERNS: RegExp[] = [
  /\$[\d,.]+[MBKmb]?/g,              // dollar amounts
  /\d+(\.\d+)?%/g,                    // percentages
  /\d{1,3}(,\d{3})+/g,               // large numbers with commas
  /\b\d+[xX]\b/g,                     // multipliers like 3x
  /\b\d+\+?\s*(users?|customers?|clients?|employees?|team|engineers?|people)/gi,
  /top\s*\d+/gi,                       // rankings like "top 10"
  /#\d+/g                              // rankings like "#1"
]

// ── Header parsing ─────────────────────────────────────────────────────────

export function parseHeader(lines: string[]): {
  name: string
  location: string
  email: string
  linkedinUrl: string
  summary: string
} {
  let name = ''
  let location = ''
  let email = ''
  let linkedinUrl = ''
  const summaryLines: string[] = []

  let pastContactLine = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Name is the first H1 or the first line that looks like a person's name
    if (!name && /^#\s+/.test(trimmed)) {
      name = trimmed.replace(/^#\s+/, '').trim()
      continue
    }
    if (!name && !pastContactLine && !trimmed.includes('@') && !trimmed.includes('|') && !/^##/.test(trimmed) && /^[A-Z][a-z]+\s+[A-Z]/.test(trimmed) && trimmed.length < 60) {
      name = trimmed
      continue
    }

    // Contact line: contains | separators with location, email, linkedin
    if (!pastContactLine && trimmed.includes('|') && (trimmed.includes('@') || /linkedin/i.test(trimmed))) {
      const parts = trimmed.split('|').map((p) => p.trim())
      for (const part of parts) {
        if (part.includes('@')) {
          email = part
        } else if (/linkedin/i.test(part)) {
          linkedinUrl = part.startsWith('http') ? part : `https://${part}`
        } else if (part.length > 0 && !/^https?:\/\/|\.com$|\.org$|\.io$/i.test(part)) {
          location = part
        }
      }
      pastContactLine = true
      continue
    }

    // Standalone email line (common in raw PDF text)
    if (!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      email = trimmed
      pastContactLine = true
      continue
    }

    // Standalone LinkedIn URL line
    if (!linkedinUrl && /linkedin\.com\/in\//i.test(trimmed)) {
      linkedinUrl = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`
      continue
    }

    // Location-like line (City, ST or City, State format) before summary sections
    if (!pastContactLine && !location && /^[A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2}(?:\s+\d{5})?$/.test(trimmed)) {
      location = trimmed
      continue
    }

    // Everything after the contact line is summary until the section break
    if (pastContactLine) {
      summaryLines.push(trimmed)
    }
  }

  return {
    name,
    location,
    email,
    linkedinUrl,
    summary: summaryLines.join(' ').trim()
  }
}

// ── Experience parsing ─────────────────────────────────────────────────────

/**
 * Split a date range string into [startDate, endDate].
 * Handles: "Jan 2026 – Present", "Aug 2020 – Jul 2022", "Jan – May 2025"
 */
function splitDateRange(raw: string): [string, string] {
  const cleaned = raw.trim()

  // "Jan – May 2025" (compact range — both share the same year)
  const compact = cleaned.match(/^([A-Za-z]+)\s*[–—-]\s*([A-Za-z]+)\s+(\d{4})$/)
  if (compact) {
    return [`${compact[1]} ${compact[3]}`, `${compact[2]} ${compact[3]}`]
  }

  // "Jan 2026 – Present" or "Aug 2020 – Jul 2022"
  const parts = cleaned.split(/\s*[–—-]\s*/)
  if (parts.length === 2) return [parts[0].trim(), parts[1].trim()]

  return [cleaned, cleaned]
}

export function parseExperienceSection(section: string): ProfileEntry[] {
  const entries: ProfileEntry[] = []
  const lines = section.split('\n')

  let currentCompany = ''
  let currentCompanyDesc: string | undefined
  let currentLocation: string | undefined
  let currentRole = ''
  let currentStartDate = ''
  let currentEndDate = ''
  let currentBullets: string[] = []
  let hasPendingEntry = false

  const flushEntry = (): void => {
    if (!hasPendingEntry) return

    const bullets = currentBullets
    const skills = extractSkills(bullets)
    const metrics = extractMetrics(bullets)
    const domains = classifyDomains(currentCompany, currentCompanyDesc || '', bullets)
    const experienceType = classifyExperienceType(currentRole)
    const durationMonths = calculateDurationMonths(currentStartDate, currentEndDate)
    const recencyWeight = calculateRecencyWeight(currentEndDate)
    const id = simpleHash(`${currentCompany}|${currentRole}|${currentStartDate}`)

    entries.push({
      id,
      type: 'experience',
      role: currentRole,
      company: currentCompany,
      companyDescription: currentCompanyDesc,
      location: currentLocation,
      startDate: currentStartDate,
      endDate: currentEndDate,
      durationMonths,
      skills,
      metrics,
      domain: domains,
      experienceType,
      bullets,
      recencyWeight
    })

    hasPendingEntry = false
    currentBullets = []
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // Company line: **COMPANY NAME** — description | Location
    // or **COMPANY NAME** — Location
    // or plain text: COMPANY NAME — description | Location
    const companyMatch = trimmed.match(/^\*\*(.+?)\*\*\s*[–—-]\s*(.+)$/)
      || trimmed.match(/^([A-Z][A-Z\s/&.,']+(?:[A-Z]|\.|\)))\s*[–—-]\s*(.+)$/)
    if (companyMatch) {
      flushEntry()

      const companyName = companyMatch[1].trim()
      const rest = companyMatch[2].trim()

      // Check if rest has a pipe → description | location
      const pipeIdx = rest.lastIndexOf('|')
      if (pipeIdx !== -1) {
        const beforePipe = rest.slice(0, pipeIdx).trim()
        const afterPipe = rest.slice(pipeIdx + 1).trim()
        // If beforePipe looks like a location (short, has comma or state abbrev),
        // treat whole thing differently
        if (beforePipe.length > 60 || !/^[A-Z]/.test(beforePipe)) {
          // Long text before pipe → description | location
          currentCompanyDesc = beforePipe
          currentLocation = afterPipe
        } else if (/,\s*[A-Z]{2}$/.test(beforePipe) && beforePipe.length < 40) {
          // "New York, NY" before pipe — this is location | something
          currentCompanyDesc = undefined
          currentLocation = beforePipe
        } else {
          currentCompanyDesc = beforePipe
          currentLocation = afterPipe
        }
      } else {
        // No pipe — rest might be just a location like "New York, NY"
        if (/,\s*[A-Z]{2}$/.test(rest) || /^[A-Z][a-z]+,?\s/.test(rest)) {
          currentCompanyDesc = undefined
          currentLocation = rest
        } else {
          currentCompanyDesc = rest
          currentLocation = undefined
        }
      }

      currentCompany = companyName
      continue
    }

    // Role + date line: *Title* | Dates
    // or plain text: Title | Dates  (where Dates contains month/year pattern)
    const roleMatch = trimmed.match(/^\*(.+?)\*\s*\|\s*(.+)$/)
      || trimmed.match(/^([A-Z][A-Za-z &,/]+?)\s*\|\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2}\/)[\s\S]*\d{4}.*)$/i)
    if (roleMatch) {
      flushEntry()
      currentRole = roleMatch[1].trim()
      const [start, end] = splitDateRange(roleMatch[2].trim())
      currentStartDate = start
      currentEndDate = end
      hasPendingEntry = true
      continue
    }

    // Bullet point (markdown dash, bullet char, or plain text continuation for entries)
    if (trimmed.startsWith('-') || trimmed.startsWith('•')) {
      const bullet = trimmed.replace(/^[-•]\s*/, '').trim()
      if (bullet) currentBullets.push(bullet)
      continue
    }

    // Plain text line that looks like a bullet (sentence starting with verb, inside an entry)
    if (hasPendingEntry && trimmed.length > 20 && /^[A-Z][a-z]/.test(trimmed) && !trimmed.includes('|')) {
      currentBullets.push(trimmed)
      continue
    }
  }

  flushEntry()
  return entries
}

// ── Education parsing ──────────────────────────────────────────────────────

export function parseEducationSection(section: string): EducationEntry[] {
  const entries: EducationEntry[] = []
  const lines = section.split('\n')

  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()

    // **SCHOOL** — Location | Degree, Year
    // or plain text: SCHOOL NAME — Location | Degree, Year
    const eduMatch = trimmed.match(/^\*\*(.+?)\*\*\s*[–—-]\s*(.+)$/)
      || trimmed.match(/^([A-Z][A-Z\s/&.,']+(?:[A-Z]|\.|\)))\s*[–—-]\s*(.+)$/)
    if (eduMatch) {
      const institution = eduMatch[1].trim()
      const rest = eduMatch[2].trim()

      let location = ''
      let degree = ''
      let field = ''
      let graduationYear = 0

      // Split on | to separate location from degree info
      const pipeParts = rest.split('|').map((p) => p.trim())
      if (pipeParts.length >= 2) {
        location = pipeParts[0]
        const degreeStr = pipeParts.slice(1).join('|').trim()

        // Extract year
        const yearMatch = degreeStr.match(/\b(19|20)\d{2}\b/)
        if (yearMatch) graduationYear = parseInt(yearMatch[0], 10)

        // Extract degree and field — e.g. "MBA, 2025" or "BS Computer Science, 2020"
        const degreeParts = degreeStr.replace(/,?\s*\d{4}/, '').trim()
        const degreeFieldMatch = degreeParts.match(/^(MBA|MS|BS|BA|PhD|MD|JD|MFA|MEng|MPA|MA|DBA|EdD|LLM|MPH|MArch|MSW|MPP)\b,?\s*(.*)$/i)
        if (degreeFieldMatch) {
          degree = degreeFieldMatch[1]
          field = degreeFieldMatch[2].trim()
        } else {
          degree = degreeParts
        }
      } else {
        // No pipe — try to parse everything from rest
        const yearMatch = rest.match(/\b(19|20)\d{2}\b/)
        if (yearMatch) graduationYear = parseInt(yearMatch[0], 10)
        location = rest.replace(/,?\s*\d{4}/, '').trim()
      }

      // Collect highlights from subsequent non-header lines
      const highlights: string[] = []
      i++
      while (i < lines.length) {
        const next = lines[i].trim()
        if (!next || /^\*\*/.test(next) || /^##/.test(next) || /^[A-Z][A-Z\s/&.,']+[–—-]/.test(next)) break
        // Could be inline activities or bullet points
        if (next.startsWith('-') || next.startsWith('•')) {
          highlights.push(next.replace(/^[-•]\s*/, '').trim())
        } else {
          // Inline text like "Cluster Chair. Peer Advisor Lead."
          highlights.push(next)
        }
        i++
      }

      const id = simpleHash(`${institution}|${degree}|${graduationYear}`)
      entries.push({ id, institution, degree, field, location, graduationYear, highlights })
      continue
    }

    i++
  }

  return entries
}

// ── Additional section parsing ─────────────────────────────────────────────

export function parseAdditionalSection(section: string): {
  entries: ProfileEntry[]
  languages: string[]
  countriesWorked: string[]
} {
  const entries: ProfileEntry[] = []
  const languages: string[] = []
  const countriesWorked: string[] = []
  const lines = section.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Languages line
    const langMatch = trimmed.match(/^\*\*Languages?:?\*\*\s*(.+)$/i)
    if (langMatch) {
      const langStr = langMatch[1]
      // Parse "English (native), Mandarin (native)" or plain comma-separated
      const langItems = langStr.split(',').map((l) => l.trim().replace(/\s*\(.*?\)/, ''))
      languages.push(...langItems.filter(Boolean))
      continue
    }

    // Countries line
    const countryMatch = trimmed.match(/^\*\*Countries?\s*(lived\/worked|worked|lived):?\*\*\s*(.+)$/i)
    if (countryMatch) {
      const countryStr = countryMatch[2]
      countriesWorked.push(...countryStr.split(',').map((c) => c.trim()).filter(Boolean))
      continue
    }

    // Additional experience entry: **COMPANY** — Description text
    const entryMatch = trimmed.match(/^\*\*(.+?)\*\*\s*[–—-]\s*(.+)$/)
    if (entryMatch) {
      const company = entryMatch[1].trim()
      const description = entryMatch[2].trim()
      const id = simpleHash(`additional|${company}`)
      const domains = classifyDomains(company, description, [description])
      entries.push({
        id,
        type: 'additional',
        role: '',
        company,
        companyDescription: description,
        startDate: '',
        endDate: '',
        durationMonths: 0,
        skills: extractSkills([description]),
        metrics: extractMetrics([description]),
        domain: domains,
        experienceType: '',
        bullets: [description],
        recencyWeight: 0.3
      })
      continue
    }
  }

  return { entries, languages, countriesWorked }
}

// ── Extraction helpers ─────────────────────────────────────────────────────

export function extractSkills(bullets: string[]): string[] {
  const found = new Set<string>()
  const text = bullets.join(' ')

  for (const keyword of SKILL_KEYWORDS) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escaped}\\b`, 'i')
    if (regex.test(text)) found.add(keyword)
  }

  return Array.from(found)
}

export function extractMetrics(bullets: string[]): string[] {
  const found: string[] = []
  const text = bullets.join(' ')

  for (const pattern of METRIC_PATTERNS) {
    const matches = text.match(pattern)
    if (matches) found.push(...matches)
  }

  return Array.from(new Set(found))
}

export function classifyDomains(
  company: string,
  companyDesc: string,
  bullets: string[]
): string[] {
  const text = [company, companyDesc, ...bullets].join(' ')
  const domains = new Set<string>()

  for (const rule of DOMAIN_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        domains.add(rule.domain)
        break
      }
    }
  }

  return Array.from(domains)
}

export function classifyExperienceType(role: string): string {
  for (const mapping of EXPERIENCE_TYPE_MAP) {
    if (mapping.pattern.test(role)) return mapping.type
  }
  return 'other'
}

// ── Header normalization ──────────────────────────────────────────────────

/** Known section names to detect in raw resume text. */
const SECTION_NAMES: Record<string, string> = {
  experience: 'Experience',
  education: 'Education',
  additional: 'Additional',
  skills: 'Skills',
  certifications: 'Certifications',
  projects: 'Projects',
  publications: 'Publications',
  awards: 'Awards',
  languages: 'Languages',
  volunteer: 'Volunteer',
  interests: 'Interests',
  summary: 'Summary',
  professional: 'Professional',
}

/**
 * Collapse spaced-out text like "E X P E R I E N C E" → "EXPERIENCE",
 * then recognize known section names (spaced-out or plain ALL-CAPS)
 * that appear alone on a line and convert them to `## Section` headers.
 * Also inserts a `---` separator before the first section if missing.
 */
function normalizeRawResumeHeaders(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let insertedHr = false
  const hasMarkdownHeaders = /^##\s+/m.test(text)
  if (hasMarkdownHeaders) return text // already markdown-formatted

  for (const line of lines) {
    const trimmed = line.trim()

    // Collapse "E X P E R I E N C E" → "EXPERIENCE"
    const collapsed = trimmed.replace(/\s+/g, '').toLowerCase()

    if (collapsed && SECTION_NAMES[collapsed] && trimmed.length > 0) {
      if (!insertedHr) {
        result.push('---')
        insertedHr = true
      }
      result.push(`## ${SECTION_NAMES[collapsed]}`)
    } else {
      result.push(line)
    }
  }
  return result.join('\n')
}

// ── Main parser ────────────────────────────────────────────────────────────

/**
 * Parse a full markdown resume into a structured UserProfile.
 */
export function parseResumeMarkdown(
  markdown: string,
  onDiagnostic?: (msg: string) => void
): UserProfile {
  // Pre-process: normalize spaced-out section headers (e.g. "E X P E R I E N C E" → "## Experience")
  // and ALL-CAPS headers without ## prefix (e.g. "EXPERIENCE" → "## Experience")
  const normalized = normalizeRawResumeHeaders(markdown)

  // Split on section headers (## Experience, ## Education, ## Additional, etc.)
  // First, separate the header (everything before first ---)
  const hrSplit = normalized.split(/\n---+\n/)
  const headerBlock = hrSplit[0] || ''
  const bodyBlock = hrSplit.slice(1).join('\n---\n')

  let header: ReturnType<typeof parseHeader> = { name: '', location: '', email: '', linkedinUrl: '', summary: '' }
  try {
    header = parseHeader(headerBlock.split('\n'))
  } catch (e) {
    onDiagnostic?.(`[warn] header parse failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  // Split body into sections by ## headers
  const sectionRegex = /^##\s+(.+)$/gm
  const sections: Record<string, string> = {}
  const bodyLines = bodyBlock
  let match: RegExpExecArray | null

  const sectionStarts: Array<{ key: string; index: number }> = []
  while ((match = sectionRegex.exec(bodyLines)) !== null) {
    sectionStarts.push({ key: match[1].trim().toLowerCase(), index: match.index })
  }

  for (let s = 0; s < sectionStarts.length; s++) {
    const start = sectionStarts[s]
    const endIdx = s + 1 < sectionStarts.length
      ? sectionStarts[s + 1].index
      : bodyLines.length
    // Skip the header line itself
    const headerEnd = bodyLines.indexOf('\n', start.index)
    sections[start.key] = bodyLines.slice(
      headerEnd !== -1 ? headerEnd + 1 : start.index,
      endIdx
    )
  }

  // Parse each section — error boundaries return partial results on failure
  let experienceEntries: ProfileEntry[] = []
  try {
    experienceEntries = sections['experience']
      ? parseExperienceSection(sections['experience'])
      : []
  } catch (e) {
    onDiagnostic?.(`[warn] experience section parse failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  onDiagnostic?.(`section:experience entries=${experienceEntries.length}`)
  let educationEntries: EducationEntry[] = []
  try {
    educationEntries = sections['education']
      ? parseEducationSection(sections['education'])
      : []
  } catch (e) {
    onDiagnostic?.(`[warn] education section parse failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  onDiagnostic?.(`section:education entries=${educationEntries.length}`)
  let additional: { entries: ProfileEntry[]; languages: string[]; countriesWorked: string[] } = { entries: [], languages: [], countriesWorked: [] }
  try {
    additional = sections['additional']
      ? parseAdditionalSection(sections['additional'])
      : { entries: [], languages: [], countriesWorked: [] }
  } catch (e) {
    onDiagnostic?.(`[warn] additional section parse failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  onDiagnostic?.(`section:additional entries=${additional.entries.length} languages=${additional.languages.length} countries=${additional.countriesWorked.length}`)
  onDiagnostic?.(`sections_found=${Object.keys(sections).join(',')}`)

  // Calculate total years of experience
  const totalMonths = experienceEntries.reduce((sum, e) => sum + e.durationMonths, 0)

  const allEntries = [...experienceEntries, ...additional.entries]
  const allSkills = new Set(allEntries.flatMap(e => e.skills))
  onDiagnostic?.(`totals: entries=${allEntries.length} education=${educationEntries.length} skills=${allSkills.size}`)

  return {
    name: header.name,
    location: header.location,
    email: header.email,
    linkedinUrl: header.linkedinUrl,
    summary: header.summary,
    entries: allEntries,
    education: educationEntries,
    languages: additional.languages,
    countriesWorked: additional.countriesWorked,
    totalYearsExperience: Math.round((totalMonths / 12) * 10) / 10,
    lastUpdated: new Date().toISOString()
  }
}
