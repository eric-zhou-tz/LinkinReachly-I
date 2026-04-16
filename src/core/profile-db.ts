// ---------------------------------------------------------------------------
// profile-db.ts — Type definitions and pure utility functions for the user
// profile database.  No Electron imports, no I/O.
// ---------------------------------------------------------------------------

// ── Types ──────────────────────────────────────────────────────────────────

export interface ProfileEntry {
  id: string                   // deterministic hash of company+role+startDate
  type: 'experience' | 'education' | 'additional'
  role: string
  company: string
  companyDescription?: string
  location?: string
  startDate: string            // e.g. "Jan 2026" or "Jul 2018"
  endDate: string              // e.g. "Present" or "Dec 2023"
  durationMonths: number       // calculated
  skills: string[]             // extracted from bullets
  metrics: string[]            // quantified achievements
  domain: string[]             // "AI", "healthcare", "finance", etc.
  experienceType: string       // "founder", "analyst", "chief_of_staff", etc.
  bullets: string[]            // raw bullet points
  recencyWeight: number        // 0-1, auto-calculated
}

export interface EducationEntry {
  id: string
  institution: string
  degree: string
  field: string
  location: string
  graduationYear: number
  highlights: string[]
}

export interface UserProfile {
  name: string
  location: string
  email: string
  linkedinUrl: string
  summary: string
  entries: ProfileEntry[]
  education: EducationEntry[]
  languages: string[]
  countriesWorked: string[]
  totalYearsExperience: number
  lastUpdated: string
}

export interface RequirementMatch {
  requirement: string
  matched: boolean
  matchedEntryId?: string
  matchStrength: number        // 0-100
  recencyAdjusted: number      // 0-100
  detail: string
}

export interface JobFitReport {
  overallScore: number         // 0-100
  matchedRequirements: RequirementMatch[]
  gaps: string[]
  strengths: string[]
  recencyAdjustedScore: number
  recommendation: 'strong_fit' | 'good_fit' | 'stretch' | 'poor_fit'
  rationale: string
}

/**
 * Enough structured résumé/profile content to run heuristic job fit (listing match %, job-scorer).
 * Intentionally separate from the LLM: screening and Smart search use the model; this path does not.
 */
export function isProfileUsableForJobFit(profile: UserProfile | null | undefined): boolean {
  if (!profile) return false
  if (profile.entries.length > 0) return true
  if (profile.education.length > 0) return true
  const summary = profile.summary?.trim() ?? ''
  return summary.length > 40
}

// ── Utility functions ──────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
}

/**
 * Deterministic short hash for IDs.  Simple string hash (DJB2 variant),
 * returned as a hex string.
 */
export function simpleHash(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16)
}

/**
 * Parse flexible date strings like "Jan 2026", "Aug 2020", "Present", "2025".
 * Returns null when parsing fails.
 */
export function parseFlexibleDate(dateStr: string): Date | null {
  if (!dateStr) return null
  const trimmed = dateStr.trim()

  if (/^present$/i.test(trimmed)) return new Date()

  // "Jan 2026" or "January 2026"
  const monthYear = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (monthYear) {
    const month = MONTH_MAP[monthYear[1].toLowerCase()]
    const year = parseInt(monthYear[2], 10)
    if (month !== undefined && !isNaN(year)) return new Date(year, month, 1)
  }

  // Bare year "2025"
  const bareYear = trimmed.match(/^(\d{4})$/)
  if (bareYear) return new Date(parseInt(bareYear[1], 10), 0, 1)

  return null
}

/**
 * Calculate the number of months between two date strings.
 * Handles formats like "Jan 2026", "Present", and compact ranges like
 * "Jan – May 2025" (caller should pre-split).
 */
export function calculateDurationMonths(startDate: string, endDate: string): number {
  // Handle compact ranges like "Jan – May 2025"
  const compactRange = startDate.match(/^([A-Za-z]+)\s*[–—-]\s*([A-Za-z]+)\s+(\d{4})$/)
  if (compactRange) {
    const startMonth = MONTH_MAP[compactRange[1].toLowerCase()]
    const endMonth = MONTH_MAP[compactRange[2].toLowerCase()]
    const year = parseInt(compactRange[3], 10)
    if (startMonth !== undefined && endMonth !== undefined && !isNaN(year)) {
      return Math.max(1, endMonth - startMonth + 1)
    }
  }

  const start = parseFlexibleDate(startDate)
  const end = parseFlexibleDate(endDate)
  if (!start || !end) return 0

  const months = (end.getFullYear() - start.getFullYear()) * 12
    + (end.getMonth() - start.getMonth())
  return Math.max(1, months)
}

/**
 * Recency weight for a profile entry.  "Present" → 1.0.
 * Decays with a half-life of ~36 months (3 years).
 *   weight = exp(-0.693 * monthsAgo / 36)
 */
export function calculateRecencyWeight(
  endDate: string,
  referenceDate: Date = new Date()
): number {
  if (/^present$/i.test(endDate.trim())) return 1.0

  const end = parseFlexibleDate(endDate)
  if (!end) return 0.5 // fallback for unparseable dates

  const monthsAgo =
    (referenceDate.getFullYear() - end.getFullYear()) * 12
    + (referenceDate.getMonth() - end.getMonth())

  if (monthsAgo <= 0) return 1.0
  return Math.exp(-0.693 * monthsAgo / 36)
}

/**
 * Map a numeric score (0-100) to a recommendation bucket.
 */
export function recommendationFromScore(
  score: number
): JobFitReport['recommendation'] {
  if (score >= 75) return 'strong_fit'
  if (score >= 60) return 'good_fit'
  if (score >= 40) return 'stretch'
  return 'poor_fit'
}
