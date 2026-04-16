// ---------------------------------------------------------------------------
// llm-jobs.ts — Job search: screening, planning, URL building, batch matching.
// ---------------------------------------------------------------------------

import { isProfileUsableForJobFit, type UserProfile } from '@core/profile-db'
import { normalizeJobSearchInput } from '@core/job-search'
import type { AppSettings } from './settings'
import { getApiKey } from './settings'
import { appLog } from './app-log'
import { callLlm, classifyLlmError, extractErrorDetail } from './llm-core'

// ── Types ────────────────────────────────────────────────────────────────

export interface JobSearchUrlOptions {
  easyApplyOnly?: boolean
  recencySeconds?: number
  sortBy?: 'R' | 'DD'
  distanceMiles?: number
  experienceLevels?: string[]
  jobTypes?: string[]
  remoteTypes?: string[]
  salaryFloor?: number
  fewApplicants?: boolean
  verifiedOnly?: boolean
}

export type JobScreenResult = {
  title: string
  company: string
  location: string
  jobUrl: string
  applyUrl?: string
  easyApply?: boolean
  postedDate?: string
  score: number
  titleFit?: number
  seniorityMatch?: number
  locationFit?: number
  companyFit?: number
  reason: string
  nextStep?: string
  description?: string
  matchedSkills?: string[]
  missingSkills?: string[]
  userFeedback?: 'positive' | 'negative'
}

export type JobListingForLlmMatch = {
  jobUrl: string
  title: string
  company: string
  location: string
  description?: string
}

export type JobSearchPlan = {
  queries: string[]
  criteria: string
  summary: string
}

// ── Job search URL ───────────────────────────────────────────────────────

export function linkedInJobsSearchUrl(keywords: string, location?: string, easyApplyOnlyOrOpts: boolean | JobSearchUrlOptions = true): string {
  const opts: JobSearchUrlOptions = typeof easyApplyOnlyOrOpts === 'boolean'
    ? { easyApplyOnly: easyApplyOnlyOrOpts }
    : easyApplyOnlyOrOpts
  const normalized = normalizeJobSearchInput(keywords, location)
  const params = new URLSearchParams({
    keywords: normalized.keywords.slice(0, 220) || 'jobs',
    origin: 'JOB_SEARCH_PAGE_JOB_FILTER'
  })
  if (normalized.location?.trim()) params.set('location', normalized.location.trim().slice(0, 100))
  if (opts.easyApplyOnly !== false) params.set('f_AL', 'true')
  if (opts.recencySeconds && opts.recencySeconds > 0) {
    params.set('f_TPR', `r${Math.round(opts.recencySeconds)}`)
  }
  if (opts.sortBy) params.set('sortBy', opts.sortBy)
  if (opts.distanceMiles && opts.distanceMiles > 0) {
    params.set('distance', String(Math.round(opts.distanceMiles)))
  }
  if (opts.experienceLevels?.length) {
    params.set('f_E', opts.experienceLevels.join(','))
  }
  if (opts.jobTypes?.length) {
    params.set('f_JT', opts.jobTypes.join(','))
  }
  if (opts.remoteTypes?.length) {
    params.set('f_WT', opts.remoteTypes.join(','))
  }
  if (opts.salaryFloor && opts.salaryFloor >= 1 && opts.salaryFloor <= 9) {
    params.set('f_SB2', String(opts.salaryFloor))
  }
  if (opts.fewApplicants) {
    params.set('f_JIYN', 'true')
  }
  if (opts.verifiedOnly) {
    params.set('f_VJ', 'true')
  }
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`
}

// ── Screen jobs ──────────────────────────────────────────────────────────

export async function screenJobs(
  settings: AppSettings,
  criteria: string,
  jobs: Array<{
    title: string
    company: string
    location: string
    jobUrl: string
    applyUrl?: string
    easyApply?: boolean
    postedDate?: string
    description?: string
  }>,
  apiKeyOverride?: string | null,
  resumeText?: string | null
): Promise<{ ok: boolean; results: JobScreenResult[]; detail: string }> {
  const key = apiKeyOverride?.trim() || getApiKey()
  if (!key || !settings.llmEnabled) {
    return {
      ok: true,
      results: jobs.map((j) => ({ ...j, score: 5, reason: 'No AI screening — showing all results.' })),
      detail: key ? 'llm_disabled' : 'no_api_key'
    }
  }

  const hasDescriptions = jobs.some(j => j.description && j.description.length > 50)
  const hasResume = !!(resumeText?.trim())

  const system = `You are a senior career advisor screening job listings for a specific person.

## Task
Score each job on multiple dimensions and provide an overall fit assessment.
${hasDescriptions ? '\nFull job descriptions are provided — use them for deep analysis of requirements, responsibilities, and qualifications. Match specific skills and experience from the candidate\'s background against the JD.' : ''}
${hasResume ? '\nThe candidate\'s resume is provided — use it to assess specific skill overlap, years of experience, education fit, and qualification match. Reference specific resume details in your reasoning.' : ''}

## Scoring (1-10 each)
- **titleFit**: How well does the job title match what the person is looking for?
- **seniorityMatch**: Is the seniority level appropriate for their experience?
- **locationFit**: Does the location/remote status match their preferences?
- **companyFit**: Does the company type/stage/industry match their goals?
- **overall**: Weighted overall fit score.

## Rules
- Consider TWO-WAY fit: does the job match the person AND is the person likely qualified?
${hasDescriptions ? `- When a job description is provided, assess SPECIFIC skill overlap. Extract the key required skills from the JD, then compare against the candidate's background.
- Populate "matchedSkills" with skills the candidate demonstrably has (from resume/background).
- Populate "missingSkills" with critical required skills the candidate lacks. Omit nice-to-haves.` : ''}
- If the criteria names a specific city, metro, or location preference, non-matching jobs should get a low locationFit. Unless the role is clearly remote-compatible, cap overall at 6 for wrong-location jobs.
- If the criteria clearly target one company, treat other companies as lower-priority alternatives, not equivalent matches.
- In "reason", explain both pros and cons in 1-2 sentences. Reference specific dimension scores when a dimension is unusually high or low.
- In "nextStep", suggest a concrete action for high-scoring jobs (score >= 7): "Apply directly", "Find the hiring manager on LinkedIn", "Research the team first", etc. For lower scores, set to "".
- If background is provided, use it to assess qualification fit.

## Output
Strict JSON: {"results": [{"index": number, "overall": number, "titleFit": number, "seniorityMatch": number, "locationFit": number, "companyFit": number, "reason": string, "nextStep": string, "matchedSkills": string[], "missingSkills": string[]}]}`

  const userPayload: Record<string, unknown> = {
    criteria,
    jobs: jobs.map((j, i) => {
      const entry: Record<string, unknown> = { index: i, title: j.title, company: j.company, location: j.location }
      if (j.description && j.description.length > 50) entry.description = j.description.slice(0, 2000)
      return entry
    })
  }
  if (resumeText?.trim()) {
    userPayload.candidateResume = resumeText.trim().slice(0, 4000)
  }
  const user = JSON.stringify(userPayload)

  try {
    const body = await callLlm(settings, system, user, key, { timeoutMs: 90_000 })
    const parsed = JSON.parse(body) as { results?: unknown }
    const results = Array.isArray(parsed.results) ? parsed.results as Array<{ index: number | string; overall?: number; score?: number; titleFit?: number; seniorityMatch?: number; locationFit?: number; companyFit?: number; reason: string; nextStep?: string; matchedSkills?: string[]; missingSkills?: string[] }> : []
    const scoreMap = new Map<number, { score: number; titleFit?: number; seniorityMatch?: number; locationFit?: number; companyFit?: number; reason: string; nextStep?: string; matchedSkills?: string[]; missingSkills?: string[] }>()
    const clampDim = (v: number | undefined) => v != null ? Math.max(1, Math.min(10, v)) : undefined
    for (const r of results) {
      const idx = Number(r.index)
      if (!Number.isInteger(idx) || idx < 0 || idx >= jobs.length) continue
      scoreMap.set(idx, {
        score: Math.max(1, Math.min(10, r.overall || r.score || 5)),
        titleFit: clampDim(r.titleFit),
        seniorityMatch: clampDim(r.seniorityMatch),
        locationFit: clampDim(r.locationFit),
        companyFit: clampDim(r.companyFit),
        reason: r.reason || '',
        nextStep: r.nextStep || '',
        matchedSkills: Array.isArray(r.matchedSkills) ? r.matchedSkills.filter((s): s is string => typeof s === 'string') : undefined,
        missingSkills: Array.isArray(r.missingSkills) ? r.missingSkills.filter((s): s is string => typeof s === 'string') : undefined
      })
    }
    const scored: JobScreenResult[] = jobs.map((job, i) => {
      const entry = scoreMap.get(i)
      return {
        ...job,
        score: entry?.score ?? 5,
        titleFit: entry?.titleFit,
        seniorityMatch: entry?.seniorityMatch,
        locationFit: entry?.locationFit,
        companyFit: entry?.companyFit,
        reason: entry?.reason ?? 'Not individually scored.',
        nextStep: entry?.nextStep,
        matchedSkills: entry?.matchedSkills,
        missingSkills: entry?.missingSkills
      }
    })
    scored.sort((a, b) => b.score - a.score)
    return { ok: true, results: scored, detail: `provider:${settings.llmProvider}` }
  } catch (error) {
    const detail = extractErrorDetail(error)
    return {
      ok: false,
      results: jobs.map((j) => ({ ...j, score: 5, reason: 'AI screening failed — showing unscored.' })),
      detail: `${classifyLlmError(detail)}:${detail}`
    }
  }
}

// ── Candidate context builder ────────────────────────────────────────────

export function buildCandidateContextForJobsMatch(
  settings: AppSettings,
  profile: UserProfile | null
): string {
  if (profile && isProfileUsableForJobFit(profile)) {
    const recentEntries = [...profile.entries]
      .sort((a, b) => b.recencyWeight - a.recencyWeight)
      .slice(0, 8)
    const parts: string[] = []
    if (profile.name.trim()) parts.push(`Name: ${profile.name.trim()}`)
    if (profile.location.trim()) parts.push(`Location: ${profile.location.trim()}`)
    const sum = profile.summary.trim()
    if (sum) parts.push(`Summary:\n${sum.slice(0, 2000)}`)
    if (recentEntries.length > 0) {
      parts.push('Experience:')
      for (const e of recentEntries) {
        const bullets = e.bullets
          .slice(0, 2)
          .map((b) => b.trim().slice(0, 200))
          .filter(Boolean)
          .join(' | ')
        const skills = e.skills.slice(0, 14).join(', ')
        parts.push(
          `- ${e.role} at ${e.company} (${e.startDate} – ${e.endDate})${skills ? `. Skills: ${skills}` : ''}${bullets ? `. ${bullets}` : ''}`
        )
      }
    }
    if (profile.education.length > 0) {
      parts.push(
        `Education: ${profile.education
          .map((ed) => `${ed.degree} ${ed.field}, ${ed.institution} (${ed.graduationYear})`)
          .join('; ')}`
      )
    }
    return parts.join('\n').trim()
  }
  const resume = (settings.resumeText || '').trim()
  const bg = (settings.userBackground || '').trim()
  if (resume.length >= 200) return resume.slice(0, 16_000)
  if (resume.length > 0 && bg.length > 0) {
    return `${resume.slice(0, 12_000)}\n\nAdditional context:\n${bg.slice(0, 4000)}`.trim()
  }
  if (bg.length >= 200) return bg.slice(0, 16_000)
  if (resume.length > 0) return resume.slice(0, 16_000)
  return ''
}

// ── Batch job match ──────────────────────────────────────────────────────

const MAX_JOBS_LLM_MATCH_BATCH = 35

export async function llmBatchJobMatchPercents(
  settings: AppSettings,
  jobs: JobListingForLlmMatch[],
  candidateContext: string,
  apiKeyOverride?: string | null
): Promise<Map<string, { matchPercent: number; reason: string }> | null> {
  const key = apiKeyOverride?.trim() || getApiKey()
  const ctx = candidateContext.trim()
  if (!key || !settings.llmEnabled || ctx.length < 40) return null
  const eligible = jobs.slice(0, MAX_JOBS_LLM_MATCH_BATCH).filter((j) => j.jobUrl && j.title)
  if (eligible.length === 0) return null

  const slice = eligible

  const hasDescriptions = slice.some(j => j.description && j.description.length > 50)

  const system = `You rank job listings for ONE candidate. For each job, output matchPercent 0-100 (100 = excellent fit; 0 = poor fit).

## Scoring rubric
- 80-100: Strong match — role function, seniority, AND domain all align with the candidate's background.
- 60-79: Decent fit — at least two of function/seniority/domain align. Some stretch.
- 40-59: Partial fit — one dimension aligns but significant gaps exist.
- 20-39: Weak fit — role is in a different function or requires very different experience.
- 0-19: No fit — completely unrelated field, wrong seniority direction, or requires skills the candidate clearly lacks.

## Rules
- DIFFERENTIATE: each job should get a distinct score reflecting its unique fit. Avoid giving the same score to multiple jobs unless they are truly equivalent matches.
- Assess TWO-WAY fit: does the role match the candidate AND would the candidate plausibly qualify?
- Compare the candidate's specific skills, titles, and seniority against each job's requirements.
- If a job title implies a completely different function than the candidate's background (e.g., sales role for an engineer), score below 30.
- If seniority is off by 2+ levels (e.g., intern role for a director-level candidate), penalize by 15-25 points.
${hasDescriptions ? '- When a job description is provided, use it for deeper skill and qualification matching.' : '- You only see title, company, location — infer requirements from the title and company context.'}

## Output
Strict JSON only (no markdown fences):
{"scores":[{"jobUrl":"exact URL from input","matchPercent":72,"reason":"max 90 chars, concrete"}]}

Include exactly one object per job in the SAME ORDER as input.jobs; copy jobUrl exactly from input.`

  const user = JSON.stringify({
    candidateBackground: ctx.slice(0,14_000),
    jobs: slice.map((j) => {
      const entry: Record<string, string> = {
        jobUrl: j.jobUrl,
        title: j.title,
        company: j.company,
        location: j.location
      }
      if (j.description && j.description.length > 50) {
        entry.description = j.description.slice(0, 600)
      }
      return entry
    })
  })

  try {
    const jsonText = await callLlm(settings, system, user, key, {
      maxOutputTokens: 4096,
      timeoutMs: 120_000
    })
    const parsed = JSON.parse(jsonText) as {
      scores?: Array<{ jobUrl?: string; matchPercent?: number; reason?: string }>
    }
    if (!Array.isArray(parsed.scores)) return null
    const urlSet = new Set(slice.map((j) => j.jobUrl))
    const result = new Map<string, { matchPercent: number; reason: string }>()
    for (const row of parsed.scores) {
      const u = String(row.jobUrl || '').trim()
      if (!urlSet.has(u)) continue
      const pct = Math.max(0, Math.min(100, Math.round(Number(row.matchPercent) || 0)))
      const reason = String(row.reason || 'AI estimate').trim().slice(0, 200)
      result.set(u, { matchPercent: pct, reason: reason || 'AI estimate' })
    }
    if (result.size > 0) {
      const pcts = [...result.values()].map((v) => v.matchPercent)
      if (pcts.length > 0) {
        const min = Math.min(...pcts)
        const max = Math.max(...pcts)
        const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length
        const stddev = Math.sqrt(pcts.reduce((s, p) => s + (p - avg) ** 2, 0) / pcts.length)
        appLog.info('[llm] batch job match distribution', { n: result.size, min, max, avg: Math.round(avg), stddev: Math.round(stddev) })
      }
      return result
    }
    return null
  } catch (err) {
    appLog.warn('[llm] batch job match failed', { error: extractErrorDetail(err) })
    return null
  }
}

// ── Plan job search ──────────────────────────────────────────────────────

export async function planJobSearch(
  settings: AppSettings,
  request: string,
  apiKeyOverride?: string | null,
  profileBackground?: string | null
): Promise<{ ok: true; plan: JobSearchPlan } | { ok: false; detail: string }> {
  const key = apiKeyOverride?.trim() || getApiKey()
  const trimmedRequest = request.trim()
  const trimmedProfileBackground = String(profileBackground || '').trim()
  if (!key || !settings.llmEnabled) {
    const normalized = normalizeJobSearchInput(trimmedRequest)
    const words = normalized.keywords.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 2).slice(0, 5)
    const fallbackCriteria = trimmedProfileBackground
      ? `${trimmedRequest}\n\nCandidate background: ${trimmedProfileBackground}`
      : trimmedRequest
    return {
      ok: true,
      plan: {
        queries: [words.join(' ') || normalized.keywords || 'jobs'],
        criteria: fallbackCriteria,
        summary: 'Using your request as keywords (no AI key configured).'
      }
    }
  }

  const normalizedRequest = normalizeJobSearchInput(trimmedRequest)

  const system = `You are a career search strategist. Given a person's background and what they're looking for, plan an intelligent multi-angle LinkedIn job search.

## Task
Generate search queries, screening criteria, and a summary.

## Core priorities
- Treat the user's request as the source of truth. If the request names a company, role family, seniority, or location, preserve those constraints.
- Use profile background only as a secondary signal to calibrate fit, seniority, adjacent titles, and screening criteria.
- If the request and profile background point in different directions, follow the request and use the profile only to explain likely fit or likely mismatch.

## Rules for queries
- If a specific company is mentioned: generate 4-6 company-targeted queries covering every plausible role the person could fill. Include the company name paired with different titles, departments, and levels. Also include the company name alone as one query to catch any listings. Think broadly, but do not replace the requested role family with unrelated profile-driven functions.
- If no specific company: 2-4 LinkedIn job search keyword sets covering different angles: job titles, industry verticals, technologies, adjacent roles.
- Each query should be 2-5 words, plain keywords only (no quotes, no operators).
- Think about what a recruiter would title the role, not just what the person calls themselves.
- Infer suitable roles from the person's background only when that inference stays inside the requested role family.
- If the request includes a location, assume the app will pass that location through LinkedIn's location field. Do not append the city/state to every query unless it is needed to disambiguate the company or role.
- If the request names a role family, at least half of the queries must stay in that exact role family or a very close adjacent title.
- For broad requests, you may use the profile background to choose angles, but do not narrow into a specific vertical unless the request also points there.

## Rules for criteria
- Write screening criteria as if briefing a recruiter: seniority range, must-have skills, preferred company types, deal-breakers.
- Include both "what the job should offer" and "what qualifies this person."
- Start from the request, then use the profile background to explain qualification fit.
- Reference the person's specific experience, projects, and skills when writing criteria.

## Output
Strict JSON:
{"queries": ["query 1", "query 2", ...], "criteria": "...", "summary": "..."}

## Examples
Input: "I'm a senior ML engineer at a FAANG company, 6 years experience. Looking for a startup where I can lead a small team."
Output: {"queries": ["ML engineering lead startup", "head of machine learning", "AI team lead series A B", "staff ML engineer"], "criteria": "Senior ML/AI role (staff, lead, or head level) at a startup (seed through Series C). Must involve hands-on technical work plus team leadership. Ideal candidate has 5-8 years ML experience at a top tech company. Remote or major tech hub preferred.", "summary": "Searching for ML leadership roles at early-to-mid stage startups."}

Input: "I've built 10 products including a SaaS analytics platform, a mobile payments app, and a developer tools CLI. Looking for a role at Northwind Labs."
Output: {"queries": ["Northwind Labs", "Northwind Labs software engineer", "Northwind Labs product manager", "Northwind developer tools", "Northwind Labs engineering lead", "Northwind platform"], "criteria": "Role at Northwind Labs. Ideal: product engineering, developer tools, CLI/platform engineering, or product management. Candidate has extensive product-building experience across SaaS, mobile, and developer tools — strong fit for a builder-culture team. Any seniority from senior IC to lead.", "summary": "Searching all roles at Northwind Labs matching your product-building background."}`

  const user = JSON.stringify({
    request: trimmedRequest,
    normalizedRequest: {
      keywords: normalizedRequest.keywords,
      location: normalizedRequest.location || ''
    },
    ...(trimmedProfileBackground ? { profileBackground: trimmedProfileBackground } : {})
  })

  try {
    const body = await callLlm(settings, system, user, key)
    const parsed = JSON.parse(body) as { queries?: string[]; criteria?: string; summary?: string }
    const queries = (parsed.queries || []).map(q => q.trim()).filter(Boolean).slice(0, 6)
    if (queries.length === 0) {
      return { ok: false, detail: 'AI could not generate search queries from your description.' }
    }
    return {
      ok: true,
      plan: {
        queries,
        criteria: parsed.criteria || trimmedRequest,
        summary: parsed.summary || `Searching for: ${queries.join(', ')}`
      }
    }
  } catch (error) {
    const detail = extractErrorDetail(error)
    return { ok: false, detail: `AI planning failed (${classifyLlmError(detail)}): ${detail}` }
  }
}
