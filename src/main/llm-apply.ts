// ---------------------------------------------------------------------------
// llm-apply.ts — Application assistance: essay generation, resume tailoring,
// form field matching via accessibility snapshots.
// ---------------------------------------------------------------------------

import { classifyApplicationQuestionIntent } from '@core/easy-apply-factual-helpers'
import type { ApplicantBridgeSnapshot } from '@core/applicant-bridge-snapshot'
import type { AppSettings } from './settings'
import { getApiKey } from './settings'
import { appLog } from './app-log'
import { callLlm, classifyLlmError, extractErrorDetail } from './llm-core'

// ── Types ────────────────────────────────────────────────────────────────

export type LlmFieldMapping = {
  ref: string
  profileKey: string
  label: string
  confidence: number
}

export type LlmMatchResult = {
  mappings: LlmFieldMapping[]
  error?: string
}

// ── Profile key descriptions ─────────────────────────────────────────────

const PROFILE_KEY_DESCRIPTIONS: Record<string, string> = {
  fullName: 'Full name',
  firstName: 'First name only',
  lastName: 'Last name / surname only',
  email: 'Email address',
  phone: 'Phone number (formatted)',
  phoneDigits: 'Phone digits only (no dashes/spaces)',
  addressLine1: 'Street address line 1',
  addressLine2: 'Apartment / suite / unit',
  postalCode: 'ZIP / postal code',
  linkedInUrl: 'LinkedIn profile URL',
  githubUrl: 'GitHub profile URL',
  portfolioUrl: 'Portfolio / personal site URL',
  websiteUrl: 'Website URL',
  city: 'City',
  state: 'State / province',
  country: 'Country',
  cityStateComma: 'City, State (combined)',
  currentLocationLine: 'Current location (single line)',
  currentResidenceAnswer: 'Where do you currently reside (longer answer)',
  yearsOfExperience: 'Total years of professional experience',
  educationSummary: 'Highest education level',
  authorizedToWork: 'Authorized to work (Yes/No)',
  requiresSponsorship: 'Requires visa sponsorship (Yes/No)',
  clearanceEligible: 'Security clearance eligible (Yes/No)',
  willingToRelocate: 'Willing to relocate (Yes/No)',
  willingToTravel: 'Willing to travel (Yes/No)',
  over18: 'Over 18 years old (Yes/No)',
  hasDriversLicense: 'Has valid driver\'s license (Yes/No)',
  canPassBackgroundCheck: 'Can pass background check (Yes/No)',
  canPassDrugTest: 'Can pass drug test (Yes/No)',
  salaryExpectation: 'Salary expectation (formatted range or number)',
  noticePeriod: 'Notice period',
  startDatePreference: 'Available start date',
  workLocationPreference: 'Work arrangement preference (remote/hybrid/onsite)'
}

// ── Profile helpers ──────────────────────────────────────────────────────

function buildProfileKeyList(profile: ApplicantBridgeSnapshot): string {
  const lines: string[] = []
  for (const [key, desc] of Object.entries(PROFILE_KEY_DESCRIPTIONS)) {
    let hasValue = false
    if (key === 'salaryExpectation') {
      hasValue = profile.salaryMin != null
    } else {
      const v = (profile as Record<string, unknown>)[key]
      hasValue = v != null && String(v).trim() !== ''
    }
    lines.push(`- ${key}: ${desc}${hasValue ? '' : ' [EMPTY]'}`)
  }
  return lines.join('\n')
}

function resolveProfileValue(
  key: string,
  profile: ApplicantBridgeSnapshot
): string | null {
  if (key === 'salaryExpectation') {
    if (profile.salaryMin == null) return null
    const currency = profile.salaryCurrency || 'USD'
    return profile.salaryMax != null && profile.salaryMax !== profile.salaryMin
      ? `${currency} ${profile.salaryMin.toLocaleString()} - ${profile.salaryMax.toLocaleString()}`
      : `${profile.salaryMin.toLocaleString()}`
  }
  const v = (profile as Record<string, unknown>)[key]
  if (v == null) return null
  const s = String(v).trim()
  return s || null
}

export { resolveProfileValue as resolveProfileValueForKey }

// ── Essay answer generation ──────────────────────────────────────────────

export async function generateApplicationEssayAnswer(
  settings: AppSettings,
  profile: ApplicantBridgeSnapshot,
  questionLabel: string,
  resumeText?: string | null
): Promise<string | null> {
  if (!settings.llmEnabled) return null
  const key = getApiKey()
  if (!key) return null
  const q = String(questionLabel || '').trim()
  if (!q) return null
  if (classifyApplicationQuestionIntent(q, 'text') !== 'behavioral') {
    return null
  }

  const resume = (resumeText?.trim() || settings.resumeText?.trim() || '').slice(0, 4000)

  const system = `You complete behavioral job application questions. Output ONLY the answer text.
Rules: 2-5 sentences max. No markdown, bullets, or quotation marks around the whole answer. Be specific and professional. CRITICAL: Only reference experiences, skills, achievements, and facts that appear in the provided resume. Do not invent company names, fund names, investment amounts, certifications, degrees, locations, legal status, or compensation numbers. If the resume does not contain relevant experience for the question, stay honest and general — never fabricate.`

  const user = JSON.stringify({
    question: q,
    intent: 'behavioral',
    applicant: {
      fullName: profile.fullName,
      yearsOfExperience: profile.yearsOfExperience,
      educationSummary: profile.educationSummary,
      linkedInUrl: profile.linkedInUrl,
      githubUrl: profile.githubUrl,
      portfolioUrl: profile.portfolioUrl,
      city: profile.city,
      state: profile.state,
      country: profile.country,
      currentLocationLine: profile.currentLocationLine,
      currentResidenceAnswer: profile.currentResidenceAnswer,
      authorizedToWorkUs: profile.authorizedToWork,
      requiresVisaSponsorship: profile.requiresSponsorship,
      workLocationPreference: profile.workLocationPreference,
      noticePeriod: profile.noticePeriod,
      startDatePreference: profile.startDatePreference,
      savedAnswerBank: (profile.answerBank || []).slice(0, 8)
    },
    resume: resume || undefined,
    instruction:
      'Answer only the behavioral question using ONLY facts from the resume. If the prompt asks for factual/legal/contact data, return an empty string. Never fabricate experiences.'
  })

  try {
    const raw = await callLlm(settings, system, user, key, { maxOutputTokens: 400, timeoutMs: 22_000 })
    let text = String(raw || '').trim()
    if (/^\s*\{/.test(text)) {
      try {
        const p = JSON.parse(text) as { answer?: string; text?: string; body?: string }
        text = String(p.answer || p.text || p.body || text).trim()
      } catch (e) {
        appLog.warn('[llm-apply] JSON parse of behavioral answer failed, using raw text', e instanceof Error ? e.message : String(e))
      }
    }
    text = text.replace(/^["'\s]+|["'\s]+$/g, '').trim()
    return text.slice(0, 2000) || null
  } catch (e) {
    appLog.warn('[llm-apply] generateApplicationEssayAnswer failed', e instanceof Error ? e.message : String(e))
    return null
  }
}

// ── Resume headline/summary tailoring ────────────────────────────────────

export async function tailorResumeHeadlineSummary(
  settings: AppSettings,
  currentHeadline: string,
  currentSummary: string,
  jobDescription: string,
  jobTitle: string,
  company: string,
  apiKeyOverride?: string | null
): Promise<{ headline: string; summary: string; tailored: boolean }> {
  const key = apiKeyOverride?.trim() || getApiKey()
  if (!key || !settings.llmEnabled) {
    return { headline: currentHeadline, summary: currentSummary, tailored: false }
  }

  const system = `You rewrite a candidate's LinkedIn headline and professional summary to better match a target job. Keep it honest — emphasize relevant experience, don't fabricate.

Rules:
- Headline: max 120 chars, emphasize skills/experience relevant to this role
- Summary: 2-4 sentences, highlight transferable experience and genuine interest
- Use the candidate's real background — do NOT invent experience
- Mirror keywords from the job description naturally
- Sound like a real person, not a bot

Output ONLY valid JSON (no markdown fences):
{"headline":"rewritten headline","summary":"rewritten summary"}`

  const user = `Current headline: ${currentHeadline}
Current summary: ${currentSummary}

Target job: ${jobTitle} at ${company}
Job description (first 2000 chars): ${jobDescription.slice(0, 2000)}`

  try {
    const raw = await callLlm(settings, system, user, key, { maxOutputTokens: 512, timeoutMs: 15_000 })
    const parsed = JSON.parse(raw.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim())
    const headline = String(parsed.headline || '').trim()
    const summary = String(parsed.summary || '').trim()
    if (headline.length > 10 && summary.length > 20) {
      return { headline: headline.slice(0, 220), summary: summary.slice(0, 1000), tailored: true }
    }
  } catch (e) { appLog.warn('[llm-apply] headline/summary tailoring failed', e instanceof Error ? e.message : String(e)) }
  return { headline: currentHeadline, summary: currentSummary, tailored: false }
}

// ── Snapshot-to-profile matching ─────────────────────────────────────────

export async function llmMatchSnapshotToProfile(
  settings: AppSettings,
  snapshot: string,
  profile: ApplicantBridgeSnapshot,
  unmatchedLabels: string[]
): Promise<LlmMatchResult> {
  if (!settings.llmEnabled) return { mappings: [] }
  const key = getApiKey()
  if (!key) return { mappings: [] }
  if (!unmatchedLabels.length) return { mappings: [] }
  const snapText = String(snapshot || '').trim()
  if (snapText.length < 40) return { mappings: [] }

  const profileKeys = buildProfileKeyList(profile)

  const system = `You map job application form fields to applicant profile keys.

## Task
Given an accessibility snapshot of a form and a list of unmatched field labels, determine which profile key each field should be filled with.

## Available profile keys
${profileKeys}

## Rules
- Return ONLY profile keys from the list above. Do not invent keys.
- Skip fields marked [EMPTY] — those have no value to fill.
- Each mapping must include the exact ref from the accessibility tree (e.g. "e12" from [ref=e12]).
- For Yes/No questions about work authorization, sponsorship, relocation, etc., map to the corresponding boolean profile key.
- For salary/compensation fields, use "salaryExpectation".
- For location/city/residence, choose the most appropriate key (city, state, currentLocationLine, currentResidenceAnswer, cityStateComma).
- If a field does not map to any profile key, omit it entirely.
- confidence: 0.0-1.0 indicating how certain you are about the mapping.

## Output
Strict JSON only: {"mappings": [{"ref": "e12", "profileKey": "email", "label": "Email Address", "confidence": 0.95}]}`

  const user = `## Accessibility snapshot (relevant section)
${snapText.slice(0, 12_000)}

## Unmatched field labels to resolve
${unmatchedLabels.map((l) => `- ${l}`).join('\n')}

Return {"mappings": [...]} only.`

  try {
    const raw = await callLlm(settings, system, user, key, {
      maxOutputTokens: 2048,
      timeoutMs: 25_000
    })
    const parsed = JSON.parse(raw) as { mappings?: unknown[] }
    if (!Array.isArray(parsed.mappings)) return { mappings: [] }

    const validKeys = new Set(Object.keys(PROFILE_KEY_DESCRIPTIONS))
    const result: LlmFieldMapping[] = []

    for (const row of parsed.mappings) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const ref = String(r.ref || '').trim()
      const profileKey = String(r.profileKey || '').trim()
      if (!ref || !profileKey || !validKeys.has(profileKey)) continue
      if (resolveProfileValue(profileKey, profile) == null) continue
      let conf = Number(r.confidence)
      if (!Number.isFinite(conf)) conf = 0.7
      conf = Math.max(0, Math.min(1, conf))
      result.push({
        ref,
        profileKey,
        label: String(r.label || '').trim().slice(0, 200) || profileKey,
        confidence: conf
      })
    }

    return { mappings: result }
  } catch (e) {
    const detail = extractErrorDetail(e)
    appLog.warn('[llm-match] llmMatchSnapshotToProfile failed', { error: detail, kind: classifyLlmError(detail) })
    return { mappings: [], error: detail }
  }
}
