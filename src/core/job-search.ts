import type { UserProfile } from './profile-db'
import { isProfileUsableForJobFit } from './profile-db'
import { rankJobsByFit, type JobPosting } from './job-scorer'

type JobLike = {
  title?: string
  company?: string
  location?: string
}

const JOB_QUERY_NOISE = new Set([
  'career',
  'careers',
  'job',
  'jobs',
  'opening',
  'openings',
  'opportunity',
  'opportunities',
  'position',
  'positions',
  'role',
  'roles'
])

const LOCATION_HINT_PHRASES = new Set([
  'alabama',
  'alaska',
  'arizona',
  'arkansas',
  'atlanta',
  'austin',
  'berlin',
  'boston',
  'brooklyn',
  'buffalo',
  'california',
  'canada',
  'chicago',
  'colorado',
  'connecticut',
  'dc',
  'delaware',
  'florida',
  'georgia',
  'hybrid',
  'illinois',
  'jersey city',
  'london',
  'los angeles',
  'manhattan',
  'massachusetts',
  'miami',
  'mountain view',
  'new jersey',
  'new york',
  'north carolina',
  'ny',
  'nyc',
  'on site',
  'on-site',
  'onsite',
  'pennsylvania',
  'philadelphia',
  'palo alto',
  'queens',
  'remote',
  'san jose',
  'san francisco',
  'seattle',
  'singapore',
  'south carolina',
  'texas',
  'toronto',
  'united kingdom',
  'united states',
  'usa',
  'washington',
  'washington dc'
])

const LOCATION_FORBIDDEN_TOKENS = new Set([
  'adtech',
  'ai',
  'analytics',
  'backend',
  'b2b',
  'b2c',
  'brand',
  'cloud',
  'consumer',
  'crypto',
  'data',
  'design',
  'designer',
  'developer',
  'developers',
  'development',
  'engineering',
  'engineer',
  'enterprise',
  'fintech',
  'finance',
  'frontend',
  'fullstack',
  'gaming',
  'go',
  'golang',
  'growth',
  'hardware',
  'healthcare',
  'hr',
  'infra',
  'infrastructure',
  'ios',
  'java',
  'javascript',
  'kotlin',
  'lab',
  'labs',
  'lead',
  'leader',
  'leadership',
  'learning',
  'intelligence',
  'machine',
  'management',
  'manager',
  'marketing',
  'market',
  'markets',
  'ml',
  'mobile',
  'office',
  'ops',
  'operations',
  'payments',
  'people',
  'platform',
  'principal',
  'product',
  'python',
  'recruiter',
  'recruiting',
  'reliability',
  'relations',
  'research',
  'saas',
  'sales',
  'science',
  'scientist',
  'security',
  'software',
  'staff',
  'startup',
  'startups',
  'strategy',
  'success',
  'support',
  'talent',
  'team',
  'teams',
  'tool',
  'tooling',
  'tools',
  'business',
  'policy'
])

const SEARCH_TERM_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'find',
  'for',
  'i',
  'in',
  'job',
  'jobs',
  'looking',
  'me',
  'my',
  'near',
  'of',
  'on',
  'opening',
  'openings',
  'opportunities',
  'opportunity',
  'or',
  'position',
  'positions',
  'role',
  'roles',
  'search',
  'seeking',
  'the',
  'to',
  'want',
  'with'
])

const LOCATION_ALIAS_GROUPS = [
  ['new york', 'new york city', 'nyc'],
  ['san francisco', 'sf', 'bay area'],
  ['los angeles', 'la'],
  ['washington dc', 'washington d.c.', 'dc']
]

const LOCATION_NAME_PREFIX_TOKENS = new Set([
  'east',
  'fort',
  'ft',
  'jersey',
  'las',
  'los',
  'mexico',
  'mount',
  'mt',
  'new',
  'north',
  'palo',
  'rio',
  'saint',
  'salt',
  'san',
  'santa',
  'south',
  'st',
  'west'
])

const LOCATION_NAME_SUFFIX_TOKENS = new Set([
  'area',
  'bay',
  'beach',
  'borough',
  'city',
  'county',
  'harbor',
  'harbour',
  'heights',
  'hill',
  'hills',
  'island',
  'lake',
  'metro',
  'metropolitan',
  'park',
  'state',
  'valley',
  'village'
])

function collapseWhitespace(value: string): string {
  return String(value || '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanLocationText(value: string): string {
  return collapseWhitespace(value).replace(/[.,;:!?]+$/g, '').trim()
}

function normalizeSearchToken(value: string): string {
  return value.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
}

function tokenizePhrase(value: string): string[] {
  return collapseWhitespace(value)
    .toLowerCase()
    .split(/[\s/]+/)
    .map(normalizeSearchToken)
    .filter(Boolean)
}

function hasForbiddenLocationTokens(tokens: string[]): boolean {
  return tokens.some((token) => LOCATION_FORBIDDEN_TOKENS.has(token))
}

function stripLeadingQueryScaffolding(keywords: string): string {
  let text = collapseWhitespace(keywords)
  const patterns = [
    /^i(?:'m| am)?\s+looking\s+for\s+/i,
    /^looking\s+for\s+/i,
    /^i(?:'m| am)?\s+interested\s+in\s+/i,
    /^interested\s+in\s+/i,
    /^find\s+me\s+/i,
    /^search(?:ing)?\s+for\s+/i,
    /^show\s+me\s+/i,
    /^help\s+me\s+find\s+/i,
    /^i\s+want\s+/i,
    /^want\s+/i
  ]
  for (const pattern of patterns) {
    text = text.replace(pattern, '').trim()
  }
  return text
}

function extractSearchTerms(value: string): string[] {
  return tokenizePhrase(value).filter((token) => token.length > 1 && !SEARCH_TERM_STOPWORDS.has(token))
}

function includesTokenSequence(haystackTokens: string[], needleTokens: string[]): boolean {
  if (needleTokens.length === 0 || haystackTokens.length < needleTokens.length) return false

  outer: for (let start = 0; start <= haystackTokens.length - needleTokens.length; start++) {
    for (let offset = 0; offset < needleTokens.length; offset++) {
      if (haystackTokens[start + offset] !== needleTokens[offset]) continue outer
    }
    return true
  }

  return false
}

function hasStructuredLocationName(tokens: string[]): boolean {
  if (tokens.length < 2) return false

  const first = tokens[0]!
  const last = tokens[tokens.length - 1]!
  if (LOCATION_NAME_PREFIX_TOKENS.has(first) || LOCATION_NAME_SUFFIX_TOKENS.has(last)) return true

  for (let size = Math.min(3, tokens.length); size >= 1; size--) {
    for (let start = 0; start <= tokens.length - size; start++) {
      if (LOCATION_HINT_PHRASES.has(tokens.slice(start, start + size).join(' '))) {
        return true
      }
    }
  }

  return false
}

function locationAliasNeedles(value: string): string[] {
  const normalized = cleanLocationText(value).toLowerCase()
  if (!normalized) return []

  const needles = new Set<string>([normalized])
  for (const group of LOCATION_ALIAS_GROUPS) {
    if (group.includes(normalized)) {
      for (const alias of group) needles.add(alias)
    }
  }
  return [...needles]
}

function countLocationMatches(jobLocation: string, requestedLocation?: string): number {
  if (!jobLocation || !requestedLocation) return 0

  const jobLocationTokens = tokenizePhrase(jobLocation)
  const requestedTerms = extractSearchTerms(requestedLocation)
  let matches = requestedTerms.filter((term) => jobLocationTokens.includes(term)).length
  const aliasNeedles = locationAliasNeedles(requestedLocation)
  if (aliasNeedles.some((alias) => includesTokenSequence(jobLocationTokens, tokenizePhrase(alias)))) {
    matches = Math.max(matches, requestedTerms.length || 1)
  }
  return matches
}

function isGenericJobPrefix(value: string): boolean {
  const tokens = collapseWhitespace(stripLeadingQueryScaffolding(value))
    .split(/\s+/)
    .map(normalizeSearchToken)
    .filter(Boolean)
  return tokens.length > 0 && tokens.every((token) => JOB_QUERY_NOISE.has(token) || SEARCH_TERM_STOPWORDS.has(token))
}

function looksLikeLocation(
  value: string,
  options?: { bareSuffix?: boolean; allowSingleWordBareSuffix?: boolean }
): boolean {
  const normalized = collapseWhitespace(value).toLowerCase()
  if (!normalized) return false
  if (LOCATION_HINT_PHRASES.has(normalized)) return true
  if (/\b(?:remote|hybrid|on-site|on site|onsite)\b/i.test(normalized)) return true

  const tokens = tokenizePhrase(normalized)
  if (tokens.length === 0 || tokens.length > 5) return false
  if (hasForbiddenLocationTokens(tokens)) return false
  if (/\b(?:and|or|with|for|at|using)\b/i.test(normalized)) return false
  const structuredLocationName = hasStructuredLocationName(tokens)

  const commaParts = normalized
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (commaParts.length > 2) return false
  if (commaParts.length === 2) {
    const [left, right] = commaParts
    const leftTokens = tokenizePhrase(left)
    const rightTokens = tokenizePhrase(right)
    return leftTokens.length > 0 && leftTokens.length <= 4 && rightTokens.length > 0 && rightTokens.length <= 3
  }

  if (options?.bareSuffix) {
    if (tokens.length === 1) {
      return !!options.allowSingleWordBareSuffix && tokens[0]!.length >= 3
    }
    return structuredLocationName
  }

  if (tokens.length === 1) return tokens[0]!.length >= 3
  return structuredLocationName
}

function splitTrailingLocation(
  rawKeywords: string,
  explicitLocation?: string | null
): { keywords: string; location?: string } {
  const keywords = collapseWhitespace(rawKeywords)
  const location = collapseWhitespace(String(explicitLocation || ''))
  if (!keywords) return { keywords: '', location: location || undefined }
  if (location) return { keywords, location }

  const separators = [/\s+in\s+/gi, /\s+near\s+/gi]
  let splitIndex = -1
  let splitLength = 0
  for (const separator of separators) {
    separator.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = separator.exec(keywords)) !== null) {
      splitIndex = match.index
      splitLength = match[0].length
    }
  }

  if (splitIndex < 0) return splitBareTrailingLocation(keywords)

  const maybeKeywords = keywords.slice(0, splitIndex).trim()
  const maybeLocation = keywords.slice(splitIndex + splitLength).trim()
  if (!maybeKeywords || !maybeLocation) return { keywords }
  if (!looksLikeLocation(maybeLocation)) return { keywords }
  return { keywords: maybeKeywords, location: maybeLocation }
}

function splitBareTrailingLocation(keywords: string): { keywords: string; location?: string } {
  const tokens = collapseWhitespace(keywords)
    .split(/\s+/)
    .filter(Boolean)

  if (tokens.length < 2) return { keywords }

  // Keep full trailing city phrases for generic searches like "jobs new york".
  // Without this, smallest-window parsing can incorrectly split to "new" + "york".
  let genericPrefixLength = 0
  for (const token of tokens) {
    const normalized = normalizeSearchToken(token)
    if (!normalized) break
    if (!JOB_QUERY_NOISE.has(normalized) && !SEARCH_TERM_STOPWORDS.has(normalized)) break
    genericPrefixLength += 1
  }

  if (genericPrefixLength > 0 && genericPrefixLength < tokens.length) {
    const maybeKeywords = tokens.slice(0, genericPrefixLength).join(' ').trim()
    const locationTokens = tokens.slice(genericPrefixLength)
    const maybeLocation = locationTokens.join(' ').trim()
    const allowSingleWordBareSuffix =
      locationTokens.length > 1 ||
      LOCATION_HINT_PHRASES.has(collapseWhitespace(maybeLocation).toLowerCase())

    if (
      maybeKeywords &&
      maybeLocation &&
      looksLikeLocation(maybeLocation, {
        bareSuffix: true,
        allowSingleWordBareSuffix
      })
    ) {
      return { keywords: maybeKeywords, location: maybeLocation }
    }
  }

  for (let size = 1; size <= Math.min(4, tokens.length - 1); size++) {
    const maybeKeywords = tokens.slice(0, -size).join(' ').trim()
    const maybeLocation = tokens.slice(-size).join(' ').trim()
    if (!maybeKeywords || !maybeLocation) continue
    const prefixTerms = extractSearchTerms(maybeKeywords)
    const genericPrefix = isGenericJobPrefix(maybeKeywords)
    const allowSingleWordBareSuffix =
      genericPrefix || (prefixTerms.length === 1 && !hasForbiddenLocationTokens(prefixTerms))
    if (prefixTerms.length === 0 && !genericPrefix) continue
    if (
      !looksLikeLocation(maybeLocation, {
        bareSuffix: true,
        allowSingleWordBareSuffix
      })
    ) {
      continue
    }
    return { keywords: maybeKeywords, location: maybeLocation }
  }

  return { keywords }
}

function stripJobNoise(keywords: string): string {
  const cleanedKeywords = stripLeadingQueryScaffolding(keywords)
  const tokens = collapseWhitespace(cleanedKeywords)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
  if (tokens.length <= 1) return collapseWhitespace(cleanedKeywords || keywords)

  const filtered = tokens.filter((token) => !JOB_QUERY_NOISE.has(normalizeSearchToken(token)))
  const stripped = collapseWhitespace(filtered.join(' '))
    .replace(/^(?:at|for|in|near|to)\s+/i, '')
    .trim()
  return stripped || collapseWhitespace(cleanedKeywords || keywords)
}

function scoreJob(job: JobLike, keywords: string, location?: string): number {
  const terms = extractSearchTerms(keywords)
  const company = collapseWhitespace(job.company || '').toLowerCase()
  const title = collapseWhitespace(job.title || '').toLowerCase()
  const jobLocation = collapseWhitespace(job.location || '').toLowerCase()

  const companyMatches = terms.filter((term) => company.includes(term)).length
  const titleMatches = terms.filter((term) => title.includes(term)).length
  const locationMatches = countLocationMatches(jobLocation, location)

  let score = titleMatches * 4
  if (location && jobLocation) {
    const requestedLocationTerms = extractSearchTerms(location)
    const matchedAllLocationTerms =
      requestedLocationTerms.length > 0 && locationMatches === requestedLocationTerms.length
    if (matchedAllLocationTerms) {
      score += 12 + locationMatches * 6
    } else if (locationMatches > 0) {
      score += locationMatches * 4
    } else {
      score -= 12
    }
  }
  if (terms.length === 0) return score
  if (companyMatches > 0) score += 20 + companyMatches * 12
  if (companyMatches === terms.length) score += 100
  return score
}

export function normalizeJobSearchInput(
  rawKeywords: string,
  rawLocation?: string | null
): { keywords: string; location?: string } {
  const parsed = splitTrailingLocation(rawKeywords, rawLocation)
  const keywords = stripJobNoise(parsed.keywords)
  const location = parsed.location ? cleanLocationText(parsed.location) : undefined
  return {
    keywords,
    location: location || undefined
  }
}


export type ScoreBreakdown = {
  titleScore: number
  companyScore: number
  locationScore: number
  total: number
}

export type RankJobsOptions<T> = {
  onScoreDebug?: (job: T, breakdown: ScoreBreakdown) => void
}

export function rankJobsForSearch<T extends JobLike>(
  jobs: T[],
  rawKeywords: string,
  rawLocation?: string | null,
  options?: RankJobsOptions<T>
): T[] {
  if (!Array.isArray(jobs) || jobs.length < 2) return Array.isArray(jobs) ? [...jobs] : []

  const normalized = normalizeJobSearchInput(rawKeywords, rawLocation)
  return jobs
    .map((job, index) => {
      const score = scoreJob(job, normalized.keywords, normalized.location)
      if (options?.onScoreDebug) {
        const terms = extractSearchTerms(normalized.keywords)
        const title = collapseWhitespace(job.title || '').toLowerCase()
        const company = collapseWhitespace(job.company || '').toLowerCase()
        const jobLocation = collapseWhitespace(job.location || '').toLowerCase()
        const titleScore = terms.filter((t) => title.includes(t)).length * 4
        const companyMatches = terms.filter((t) => company.includes(t)).length
        const companyScore = companyMatches > 0 ? 20 + companyMatches * 12 + (companyMatches === terms.length ? 100 : 0) : 0
        const locationScore = score - titleScore - companyScore
        options.onScoreDebug(job, { titleScore, companyScore, locationScore, total: score })
      }
      return { job, index, score }
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return left.index - right.index
    })
    .map((entry) => entry.job)
}

export function rankJobsForQueries<T extends JobLike>(
  jobs: T[],
  rawQueries: string[],
  rawLocation?: string | null
): T[] {
  if (!Array.isArray(jobs) || jobs.length < 2) return Array.isArray(jobs) ? [...jobs] : []

  const queries = rawQueries
    .map((query) => normalizeJobSearchInput(query, rawLocation).keywords)
    .filter(Boolean)

  if (queries.length === 0) return rankJobsForSearch(jobs, '', rawLocation)

  const location = normalizeJobSearchInput('', rawLocation).location
  return jobs
    .map((job, index) => ({
      job,
      index,
      score: Math.max(...queries.map((query) => scoreJob(job, query, location)))
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return left.index - right.index
    })
    .map((entry) => entry.job)
}

export function rerankScoredJobsForSearch<T extends JobLike & { score: number }>(
  jobs: T[],
  rawKeywords: string,
  rawLocation?: string | null
): T[] {
  if (!Array.isArray(jobs) || jobs.length < 2) return Array.isArray(jobs) ? [...jobs] : []

  const normalized = normalizeJobSearchInput(rawKeywords, rawLocation)
  return jobs
    .map((job, index) => {
      const alignment = scoreJob(job, normalized.keywords, normalized.location)
      const jobLocation = collapseWhitespace(job.location || '').toLowerCase()
      const locationTerms = normalized.location ? extractSearchTerms(normalized.location) : []
      const locationMatches = countLocationMatches(jobLocation, normalized.location)
      const exactLocationMatch =
        locationTerms.length > 0 && locationMatches === locationTerms.length
      const locationMismatch =
        locationTerms.length > 0 &&
        jobLocation &&
        locationMatches === 0
      const alignmentBoost = alignment >= 100 ? 2 : alignment >= 32 ? 1 : 0
      const locationBoost = exactLocationMatch ? 2 : locationMatches > 0 ? 1 : 0
      const nextScore = Math.max(
        1,
        Math.min(10, job.score + alignmentBoost + locationBoost - (locationMismatch ? 3 : 0))
      )
      return {
        job: { ...job, score: nextScore },
        index,
        alignment,
        locationMismatch,
        exactLocationMatch
      }
    })
    .sort((left, right) => {
      if (right.job.score !== left.job.score) return right.job.score - left.job.score
      if (left.exactLocationMatch !== right.exactLocationMatch) {
        return left.exactLocationMatch ? -1 : 1
      }
      if (left.locationMismatch !== right.locationMismatch) {
        return left.locationMismatch ? 1 : -1
      }
      if (right.alignment !== left.alignment) return right.alignment - left.alignment
      return left.index - right.index
    })
    .map((entry) => entry.job)
}

function hasUsableProfile(profile: UserProfile | null): profile is UserProfile {
  return isProfileUsableForJobFit(profile)
}

function addSearchAlignmentMatchPercents<T extends JobLike>(
  jobs: T[],
  rawKeywords: string,
  rawLocation?: string | null
): Array<T & { resumeMatchPercent?: number; resumeMatchReason?: string }> {
  if (!Array.isArray(jobs) || jobs.length === 0) return []

  const normalized = normalizeJobSearchInput(rawKeywords, rawLocation)
  const scored = jobs.map((job) => ({
    job,
    alignment: scoreJob(job, normalized.keywords, normalized.location)
  }))

  const alignments = scored.map((entry) => entry.alignment)
  const minAlignment = Math.min(...alignments)
  const maxAlignment = Math.max(...alignments)
  const spread = maxAlignment - minAlignment
  const hasKeywords = normalized.keywords.trim().length > 0
  const hasLocation = Boolean(normalized.location)
  const reason =
    hasKeywords && hasLocation
      ? 'Search relevance from keyword/title and location alignment. Add resume text in Settings for personalized ranking.'
      : hasKeywords
        ? 'Search relevance from keyword/title alignment. Add resume text in Settings for personalized ranking.'
        : hasLocation
          ? 'Search relevance from location alignment. Add resume text in Settings for personalized ranking.'
          : 'Search relevance estimate. Add resume text in Settings for personalized ranking.'

  if (spread === 0) {
    return scored.map(({ job }) => ({
      ...job,
      resumeMatchPercent: undefined,
      resumeMatchReason: reason
    }) as T & { resumeMatchPercent?: number; resumeMatchReason?: string })
  }

  return scored.map(({ job, alignment }) => {
    const scaled = (alignment - minAlignment) / spread
    const matchPercent = Math.round(25 + scaled * 70)
    return {
      ...job,
      resumeMatchPercent: Math.max(10, Math.min(95, matchPercent)),
      resumeMatchReason: reason
    } as T & { resumeMatchPercent?: number; resumeMatchReason?: string }
  })
}

/**
 * Reorder jobs by resume heuristic fit (0–100, best first) and attach match fields.
 * Jobs without `jobUrl` are kept at the end without scores.
 */
export function sortJobsByResumeFit<T extends JobLike & { jobUrl?: string }>(
  jobs: T[],
  profile: UserProfile | null
): Array<T & { resumeMatchPercent?: number; resumeMatchReason?: string }> {
  if (!Array.isArray(jobs) || jobs.length === 0) return []
  if (!hasUsableProfile(profile)) {
    return jobs.map((j) => ({ ...j }))
  }

  const withUrl = jobs.filter((j) => j.jobUrl && String(j.jobUrl).length > 2)
  const withoutUrl = jobs.filter((j) => !j.jobUrl || String(j.jobUrl).length < 2)

  if (withUrl.length === 0) {
    return jobs.map((j) => ({ ...j }))
  }

  const postings: JobPosting[] = withUrl.map((j) => ({
    title: String(j.title || ''),
    company: String(j.company || ''),
    location: String(j.location || ''),
    jobUrl: String(j.jobUrl),
    postedDate: 'postedDate' in j ? String((j as { postedDate?: string }).postedDate || '') : undefined
  }))

  const fitted = rankJobsByFit(profile, postings)
  const byUrl = new Map(withUrl.map((j) => [String(j.jobUrl), j]))

  const ranked = fitted.map((f) => {
    const base = byUrl.get(f.jobUrl) as T
    return {
      ...base,
      resumeMatchPercent: f.heuristicScore.overall,
      resumeMatchReason:
        f.heuristicScore.strengths.slice(0, 2).join(' · ') || undefined
    } as T & { resumeMatchPercent?: number; resumeMatchReason?: string }
  })

  return [...ranked, ...withoutUrl.map((j) => ({ ...j }))]
}

/** Keyword/location relevance, then resume fit (best-first) when a profile is available. */
export function rankJobsWithResumeFit<T extends JobLike & { jobUrl?: string }>(
  jobs: T[],
  rawKeywords: string,
  rawLocation: string | null | undefined,
  profile: UserProfile | null
): Array<T & { resumeMatchPercent?: number; resumeMatchReason?: string }> {
  const keywordRanked = rankJobsForSearch(jobs, rawKeywords, rawLocation)
  if (!hasUsableProfile(profile)) {
    return addSearchAlignmentMatchPercents(keywordRanked, rawKeywords, rawLocation)
  }
  return sortJobsByResumeFit(keywordRanked, profile)
}
