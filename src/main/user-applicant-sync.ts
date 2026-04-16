import type { ProfileEntry, UserProfile } from '@core/profile-db'
import type { ApplicantProfile } from '@core/application-types'
import { loadApplicantProfile, saveApplicantProfile } from './applicant-profile-store'

type WorkHistoryItem = NonNullable<ApplicantProfile['background']['workHistory']>[number]

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
}
/** Parse month number (1-12) from a date string like "Jan 2026" or "07/2024". Returns null if not found. */
function parseMonthFromDateStr(dateStr: string | undefined): number | null {
  if (!dateStr) return null
  const s = dateStr.trim().toLowerCase()
  // "Jan 2026" style
  const wordMatch = s.match(/^([a-z]+)/)
  if (wordMatch?.[1] && MONTH_NAMES[wordMatch[1]]) return MONTH_NAMES[wordMatch[1]]!
  // "01/2026" or "1/2026" style
  const numMatch = s.match(/^(\d{1,2})[/\-.]/)
  if (numMatch?.[1]) {
    const m = parseInt(numMatch[1], 10)
    if (m >= 1 && m <= 12) return m
  }
  return null
}

function extractPhoneFromResumeText(resumeText: string): string | undefined {
  const text = String(resumeText || '').trim()
  if (!text) return undefined
  const match = text.match(/(?:\+?\d{1,3}[\s().-]*)?(?:\(\d{3}\)|\d{3})[\s().-]*\d{3}[\s.-]*\d{4}/)
  if (!match?.[0]) return undefined
  const normalized = match[0].replace(/\s+/g, ' ').trim()
  return normalized || undefined
}

function parseResumeLocation(locationRaw: string): { city?: string; state?: string; country?: string } {
  const cleaned = String(locationRaw || '').replace(/\s+/g, ' ').trim()
  if (!cleaned || /^remote\b/i.test(cleaned)) return {}
  const parts = cleaned
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return {}
  if (parts.length === 1) return { city: parts[0] }
  if (parts.length === 2) return { city: parts[0], state: parts[1] }
  return {
    city: parts[0],
    state: parts[1],
    country: parts.slice(2).join(', ')
  }
}

/** Parse a 4-digit year from a date string like "Jan 2026" or "07/2024". */
function parseYearFromDateStr(dateStr: string | undefined): number | null {
  if (!dateStr) return null
  const m = dateStr.match(/\b(19|20)\d{2}\b/)
  return m ? parseInt(m[0], 10) : null
}

/**
 * Always re-extract work history from resume entries, but preserve user-edited
 * fields (description tweaks, manual location overrides) from existing items
 * when the title+company match.
 */
function buildFreshWorkHistory(
  entries: ProfileEntry[],
  existing: WorkHistoryItem[] | undefined
): WorkHistoryItem[] {
  const experienceEntries = entries.filter((e) => e.type === 'experience')
  if (experienceEntries.length === 0) return existing || []

  const existingMap = new Map<string, WorkHistoryItem>()
  if (existing) {
    for (const item of existing) {
      const key = `${(item.title || '').toLowerCase().trim()}::${(item.company || '').toLowerCase().trim()}`
      existingMap.set(key, item)
    }
  }

  return experienceEntries.map((entry): WorkHistoryItem => {
    const title = (entry.role || '').trim()
    const company = (entry.company || '').trim()
    const location = (entry.location || '').trim() || undefined
    const description = entry.bullets?.length ? entry.bullets.join('\n') : undefined
    const startMonth = parseMonthFromDateStr(entry.startDate) ?? undefined
    const startYear = parseYearFromDateStr(entry.startDate) ?? null
    const isPresent = /present|current/i.test(entry.endDate || '')
    const endMonth = isPresent ? undefined : (parseMonthFromDateStr(entry.endDate) ?? undefined)
    const endYear = isPresent ? null : (parseYearFromDateStr(entry.endDate) ?? null)
    const currentlyWorkHere = isPresent || undefined

    // Check if an existing user-edited item matches this entry
    const key = `${title.toLowerCase()}::${company.toLowerCase()}`
    const prev = existingMap.get(key)

    // Prefer fresh resume data, but let user overrides for description/location win
    // if they differ from what the resume had last time
    return {
      title,
      company,
      location: prev?.location && prev.location !== location ? prev.location : location,
      description: prev?.description && prev.description !== description ? prev.description : description,
      startMonth: startMonth ?? prev?.startMonth ?? undefined,
      startYear,
      endMonth: endMonth ?? prev?.endMonth ?? undefined,
      endYear,
      currentlyWorkHere,
    }
  })
}

function extractEducationDates(profile: UserProfile): {
  educationStartMonth?: number
  educationStartYear?: number
  educationEndMonth?: number
  educationEndYear?: number
  schoolName?: string
  degreeType?: string
  fieldOfStudy?: string
} {
  if (!profile.education?.length) return {}
  const sorted = [...profile.education]
    .filter((e) => e.graduationYear > 0)
    .sort((a, b) => b.graduationYear - a.graduationYear)
  if (sorted.length === 0) return {}
  const latest = sorted[0]
  const endYear = latest.graduationYear
  const endMonth = 6
  const degreeText = (latest.degree || '').toLowerCase()
  const durationYears = /\bphd\b|\bdoctor/.test(degreeText)
    ? 5
    : /\bmba\b|\bmaster|\bms\b|\bma\b|\bmed\b/.test(degreeText)
      ? 2
      : 4
  const startYear = endYear - durationYears
  const startMonth = 9
  return {
    educationStartMonth: startMonth,
    educationStartYear: startYear,
    educationEndMonth: endMonth,
    educationEndYear: endYear,
    schoolName: latest.institution || undefined,
    degreeType: latest.degree || undefined,
    fieldOfStudy: latest.field || undefined
  }
}

function buildEducationSummary(profile: UserProfile): string | undefined {
  if (!profile.education?.length) return undefined
  return profile.education
    .map((e) => {
      const parts = [e.degree, e.field, e.institution].filter(Boolean)
      if (e.graduationYear) parts.push(String(e.graduationYear))
      return parts.join(', ')
    })
    .join('; ')
}

/**
 * Fills empty applicant basics/links/background from structured resume (`user-profile.json`)
 * and optional raw resume text (for phone regex). Does not overwrite non-empty applicant fields.
 */
export function syncApplicantFromUserProfile(profile: UserProfile, resumeText: string): ApplicantProfile {
  const current = loadApplicantProfile()
  const locationParts = parseResumeLocation(profile.location)
  const parsedPhone = extractPhoneFromResumeText(resumeText)
  const parsedYears = profile.totalYearsExperience > 0 ? String(profile.totalYearsExperience) : undefined
  const educationDates = extractEducationDates(profile)
  const educationSummary = buildEducationSummary(profile)

  const nextBasics = {
    ...current.basics,
    fullName: current.basics.fullName || String(profile.name || '').trim(),
    email: current.basics.email || String(profile.email || '').trim(),
    phone: current.basics.phone || parsedPhone || undefined,
    city: current.basics.city || locationParts.city || undefined,
    state: current.basics.state || locationParts.state || undefined,
    country: current.basics.country || locationParts.country || undefined
  }
  const nextLinks = {
    linkedInUrl: current.links.linkedInUrl || String(profile.linkedinUrl || '').trim() || undefined
  }
  const languages = profile.languages?.length ? profile.languages.join(', ') : undefined
  // Education detail fields are synced as an ATOMIC unit — all from the same
  // entry. Using per-field `||` fallbacks caused cross-entry mixing (e.g.
  // Columbia MBA school + Biotech field-of-study from a different degree).
  const hasCurrentEduDetails = !!(current.background.schoolName || current.background.degreeType || current.background.fieldOfStudy)
  const hasNewEduDetails = !!(educationDates.schoolName || educationDates.degreeType || educationDates.fieldOfStudy)
  const educationTupleDiffers =
    (educationDates.schoolName || undefined) !== (current.background.schoolName || undefined) ||
    (educationDates.degreeType || undefined) !== (current.background.degreeType || undefined) ||
    (educationDates.fieldOfStudy || undefined) !== (current.background.fieldOfStudy || undefined) ||
    educationDates.educationStartMonth !== current.background.educationStartMonth ||
    educationDates.educationStartYear !== current.background.educationStartYear ||
    educationDates.educationEndMonth !== current.background.educationEndMonth ||
    educationDates.educationEndYear !== current.background.educationEndYear
  const shouldReplaceEdu = hasNewEduDetails && (!hasCurrentEduDetails || educationTupleDiffers)

  const eduFields = shouldReplaceEdu && hasNewEduDetails
    ? {
        schoolName: educationDates.schoolName,
        degreeType: educationDates.degreeType,
        fieldOfStudy: educationDates.fieldOfStudy,
        educationStartMonth: educationDates.educationStartMonth,
        educationStartYear: educationDates.educationStartYear,
        educationEndMonth: educationDates.educationEndMonth,
        educationEndYear: educationDates.educationEndYear,
      }
    : {
        schoolName: current.background.schoolName,
        degreeType: current.background.degreeType,
        fieldOfStudy: current.background.fieldOfStudy,
        educationStartMonth: current.background.educationStartMonth,
        educationStartYear: current.background.educationStartYear,
        educationEndMonth: current.background.educationEndMonth,
        educationEndYear: current.background.educationEndYear,
      }

  // Always refresh educationHistory from resume (source of truth for multi-edu context)
  const freshEducationHistory = profile.education
    ?.map(e => ({
      school: String(e.institution || '').trim(),
      degree: String(e.degree || '').trim(),
      field: String(e.field || '').trim(),
      year: e.graduationYear || null,
    }))
    .filter((e) => e.school)

  const nextBackground = {
    yearsOfExperience: current.background.yearsOfExperience || parsedYears,
    educationSummary: current.background.educationSummary || educationSummary,
    ...eduFields,
    languages: current.background.languages || languages,
    educationHistory: freshEducationHistory,
    workHistory: buildFreshWorkHistory(profile.entries || [], current.background.workHistory),
  }

  const educationHistoryChanged =
    JSON.stringify(nextBackground.educationHistory || []) !== JSON.stringify(current.background.educationHistory || [])
  const workHistoryChanged =
    JSON.stringify(nextBackground.workHistory || []) !== JSON.stringify(current.background.workHistory || [])

  const changed =
    nextBasics.fullName !== current.basics.fullName ||
    nextBasics.email !== current.basics.email ||
    nextBasics.phone !== current.basics.phone ||
    nextBasics.city !== current.basics.city ||
    nextBasics.state !== current.basics.state ||
    nextBasics.country !== current.basics.country ||
    nextLinks.linkedInUrl !== current.links.linkedInUrl ||
    nextBackground.yearsOfExperience !== current.background.yearsOfExperience ||
    nextBackground.educationSummary !== current.background.educationSummary ||
    nextBackground.educationStartMonth !== current.background.educationStartMonth ||
    nextBackground.educationStartYear !== current.background.educationStartYear ||
    nextBackground.educationEndMonth !== current.background.educationEndMonth ||
    nextBackground.educationEndYear !== current.background.educationEndYear ||
    nextBackground.schoolName !== current.background.schoolName ||
    nextBackground.degreeType !== current.background.degreeType ||
    nextBackground.fieldOfStudy !== current.background.fieldOfStudy ||
    nextBackground.languages !== current.background.languages ||
    educationHistoryChanged ||
    workHistoryChanged

  if (!changed) return current

  return saveApplicantProfile({
    basics: nextBasics,
    links: nextLinks,
    background: nextBackground
  })
}
