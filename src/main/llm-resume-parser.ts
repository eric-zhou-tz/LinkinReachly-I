// ---------------------------------------------------------------------------
// llm-resume-parser.ts — LLM-based resume parsing. Takes raw resume text,
// sends it to the LLM for structured extraction, and returns a UserProfile.
// Falls back to the heuristic parser on any failure (caller handles fallback).
// ---------------------------------------------------------------------------

import type { UserProfile, ProfileEntry, EducationEntry } from '@core/profile-db'
import {
  simpleHash,
  calculateDurationMonths,
  calculateRecencyWeight,
} from '@core/profile-db'
import {
  extractSkills,
  extractMetrics,
  classifyDomains,
  classifyExperienceType,
} from '@core/resume-parser'
import { callLlmDirect } from './llm-core'
import { appLog } from './app-log'

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a resume parser. Extract structured data from the resume text provided.

Return a single JSON object with these exact fields:

{
  "name": "Full name of the person",
  "email": "Email address or empty string",
  "phone": "Phone number or empty string",
  "location": "City, State or City, Country",
  "linkedinUrl": "LinkedIn URL or empty string",
  "summary": "Professional summary (1-3 sentences). If no explicit summary section, synthesize from experience.",
  "entries": [
    {
      "role": "Job title",
      "company": "Company name",
      "companyDescription": "Brief description of what the company does (1 sentence, optional)",
      "location": "City, State or empty string",
      "startDate": "Mon YYYY format, e.g. Jan 2023",
      "endDate": "Mon YYYY or Present",
      "skills": ["skill1", "skill2"],
      "bullets": ["Achievement or responsibility line 1", "Line 2"]
    }
  ],
  "education": [
    {
      "institution": "University or school name",
      "degree": "Degree type, e.g. MBA, BS, BA, MS, PhD",
      "field": "Field of study",
      "location": "City, State or empty string",
      "graduationYear": 2024,
      "highlights": ["Honor, award, or notable achievement"]
    }
  ],
  "languages": ["English", "Mandarin"],
  "countriesWorked": ["United States", "China"]
}

Rules:
- Extract ALL work experience entries, oldest to newest.
- Extract ALL education entries.
- For dates, always use "Mon YYYY" format (e.g. "Jan 2023", "Dec 2020"). Use "Present" for current roles.
- If a field is not found in the resume, use an empty string or empty array.
- For skills, extract specific technologies, methodologies, and domain expertise mentioned in each role.
- For bullets, preserve the original achievement/responsibility descriptions.
- Return ONLY the JSON object, no markdown fences, no explanation.`

// ── LLM output types (before enrichment) ────────────────────────────────────

interface RawLlmEntry {
  role?: string
  company?: string
  companyDescription?: string
  location?: string
  startDate?: string
  endDate?: string
  skills?: string[]
  bullets?: string[]
}

interface RawLlmEducation {
  institution?: string
  degree?: string
  field?: string
  location?: string
  graduationYear?: number
  highlights?: string[]
}

interface RawLlmProfile {
  name?: string
  email?: string
  phone?: string
  location?: string
  linkedinUrl?: string
  summary?: string
  entries?: RawLlmEntry[]
  education?: RawLlmEducation[]
  languages?: string[]
  countriesWorked?: string[]
}

// ── Normalization ───────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : []
}

function normalizeEntry(raw: RawLlmEntry): ProfileEntry {
  const role = str(raw.role)
  const company = str(raw.company)
  const startDate = str(raw.startDate)
  const endDate = str(raw.endDate) || 'Present'
  const bullets = strArr(raw.bullets)
  const llmSkills = strArr(raw.skills)

  // Merge LLM-extracted skills with keyword-based extraction from bullets
  const bulletSkills = extractSkills(bullets)
  const allSkills = [...new Set([...llmSkills, ...bulletSkills])]

  return {
    id: simpleHash(`${company}|${role}|${startDate}`),
    type: 'experience',
    role,
    company,
    companyDescription: str(raw.companyDescription) || undefined,
    location: str(raw.location) || undefined,
    startDate,
    endDate,
    durationMonths: calculateDurationMonths(startDate, endDate),
    skills: allSkills,
    metrics: extractMetrics(bullets),
    domain: classifyDomains(company, str(raw.companyDescription), bullets),
    experienceType: classifyExperienceType(role),
    bullets,
    recencyWeight: calculateRecencyWeight(endDate),
  }
}

function normalizeEducation(raw: RawLlmEducation): EducationEntry {
  const institution = str(raw.institution)
  const degree = str(raw.degree)
  const field = str(raw.field)
  return {
    id: simpleHash(`${institution}|${degree}|${field}`),
    institution,
    degree,
    field,
    location: str(raw.location),
    graduationYear: typeof raw.graduationYear === 'number' ? raw.graduationYear : 0,
    highlights: strArr(raw.highlights),
  }
}

function computeTotalYears(entries: ProfileEntry[]): number {
  if (entries.length === 0) return 0
  return Math.round(entries.reduce((sum, e) => sum + e.durationMonths, 0) / 12)
}

/**
 * Validate and normalize raw LLM JSON into a UserProfile.
 * Computes derived fields (ids, duration, recency, domains, metrics) that
 * the LLM should not be trusted to calculate.
 */
function normalizeAndEnrichLlmOutput(raw: RawLlmProfile): UserProfile {
  const entries = Array.isArray(raw.entries)
    ? raw.entries.map(normalizeEntry)
    : []
  const education = Array.isArray(raw.education)
    ? raw.education.map(normalizeEducation)
    : []

  return {
    name: str(raw.name),
    location: str(raw.location),
    email: str(raw.email),
    linkedinUrl: str(raw.linkedinUrl),
    summary: str(raw.summary),
    entries,
    education,
    languages: strArr(raw.languages),
    countriesWorked: strArr(raw.countriesWorked),
    totalYearsExperience: computeTotalYears(entries),
    lastUpdated: new Date().toISOString(),
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse resume text using the LLM. Returns a UserProfile.
 * Throws on any failure — caller is responsible for fallback.
 */
export async function parseResumeWithLlm(resumeText: string): Promise<UserProfile> {
  appLog.info('[llm-resume-parser] starting LLM-based resume parse', {
    inputChars: resumeText.length,
  })

  const t0 = Date.now()
  const jsonStr = await callLlmDirect(SYSTEM_PROMPT, resumeText, {
    maxOutputTokens: 4096,
    timeoutMs: 15_000,
  })

  let parsed: RawLlmProfile
  try {
    parsed = JSON.parse(jsonStr) as RawLlmProfile
  } catch {
    throw new Error(`LLM returned unparseable JSON: ${jsonStr.slice(0, 200)}`)
  }

  const profile = normalizeAndEnrichLlmOutput(parsed)
  const latencyMs = Date.now() - t0

  appLog.info('[llm-resume-parser] parse complete', {
    latencyMs,
    name: profile.name || '(empty)',
    entries: profile.entries.length,
    education: profile.education.length,
  })

  return profile
}
