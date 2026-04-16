/**
 * Pure helpers for the outreach chain: payload parsing, candidate selection,
 * hiring poster lookup, and LinkedIn search URL building.
 *
 * Orchestration lives in application-assistant-outreach.ts → handleOutreachRunChain.
 */
import type {
  HiringTeamMember,
  OutreachRunChainPayload,
  OutreachRunPayload,
  OutreachSearchHiringManagerPayload
} from '@core/application-types'
import type { PostApplyOutreachCandidate } from './apply-queue-helpers'
import { appLog } from './app-log'

/** Hiring contact resolved from stored job data (no bridge I/O). */
export type HiringManagerPick = {
  profileUrl: string
  firstName: string
  company: string
  headline: string
}

const DEFAULT_CHAIN_MAX = 10
const CHAIN_MAX_CAP = 100

/**
 * True when the URL is https and the host is LinkedIn (apex, www, or *.linkedin.com).
 * Used before extension NAVIGATE for outreach flows.
 * application-outreach-chain.ts:isPermittedLinkedInNavigationUrl
 */
export function isPermittedLinkedInNavigationUrl(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:') return false
    const h = u.hostname.toLowerCase()
    return h === 'linkedin.com' || h.endsWith('.linkedin.com')
  } catch (e) {
    appLog.debug(
      '[application-outreach-chain] isPermittedLinkedInNavigationUrl parse failed',
      e instanceof Error ? e.message : String(e)
    )
    return false
  }
}

/**
 * Normalizes untrusted IPC payload for outreach chain runs.
 * application-outreach-chain.ts:parseOutreachRunChainPayload
 */
/** IPC: application:outreach:markSent — validated ids/strings only. */
export function parseOutreachMarkSentPayload(payload: unknown): {
  applicationRecordId: string
  targetUrl?: string
  targetName?: string
} | null {
  if (payload == null || typeof payload !== 'object') return null
  const o = payload as Record<string, unknown>
  const applicationRecordId = String(o.applicationRecordId || '').trim()
  if (!applicationRecordId) return null
  return {
    applicationRecordId,
    targetUrl: typeof o.targetUrl === 'string' ? o.targetUrl : undefined,
    targetName: typeof o.targetName === 'string' ? o.targetName : undefined
  }
}

/** IPC: application:outreach:skip */
export function parseOutreachSkipPayload(payload: unknown): { applicationRecordId: string } | null {
  if (payload == null || typeof payload !== 'object') return null
  const o = payload as Record<string, unknown>
  const applicationRecordId = String(o.applicationRecordId || '').trim()
  if (!applicationRecordId) return null
  return { applicationRecordId }
}

export function parseOutreachRunChainPayload(payload: unknown): OutreachRunChainPayload {
  if (payload == null || typeof payload !== 'object') return {}
  const o = payload as Record<string, unknown>
  let candidateIds: string[] | undefined
  if (Array.isArray(o.candidateIds)) {
    candidateIds = o.candidateIds.map((id) => String(id || '').trim()).filter(Boolean)
  }
  let maxTargets: number | undefined
  const rawMax = o.maxTargets
  if (typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax >= 1) {
    maxTargets = Math.min(CHAIN_MAX_CAP, Math.floor(rawMax))
  }
  return { candidateIds, maxTargets }
}

/**
 * Validates IPC payload for single outreach runs (`application:outreach:run`).
 * application-outreach-chain.ts:parseOutreachRunPayload
 */
export function parseOutreachRunPayload(payload: unknown): OutreachRunPayload | null {
  if (payload == null || typeof payload !== 'object') return null
  const o = payload as Record<string, unknown>
  if (!Array.isArray(o.targets) || o.targets.length === 0) return null
  const targets: OutreachRunPayload['targets'] = []
  for (const item of o.targets) {
    if (item == null || typeof item !== 'object') return null
    const t = item as Record<string, unknown>
    const profileUrl = String(t.profileUrl || '').trim()
    if (!profileUrl) return null
    targets.push({
      profileUrl,
      firstName: String(t.firstName || '').trim(),
      company: String(t.company || '').trim(),
      headline: typeof t.headline === 'string' ? t.headline : undefined,
      jobTitle: typeof t.jobTitle === 'string' ? t.jobTitle : undefined,
      jobUrl: typeof t.jobUrl === 'string' ? t.jobUrl : undefined,
      applicationRecordId: typeof t.applicationRecordId === 'string' ? t.applicationRecordId : undefined
    })
  }
  return { targets }
}

/**
 * Same filtering/slicing rules as the chain runner (testable without Electron).
 * application-outreach-chain.ts:selectChainCandidates
 */
export function selectChainCandidates(
  candidates: PostApplyOutreachCandidate[],
  payload: OutreachRunChainPayload
): PostApplyOutreachCandidate[] {
  const requestedIds = payload.candidateIds?.length ? new Set(payload.candidateIds) : null
  const filtered = requestedIds
    ? candidates.filter((c) => requestedIds!.has(c.applicationRecordId))
    : candidates
  const max = payload.maxTargets ?? DEFAULT_CHAIN_MAX
  return filtered.slice(0, max)
}

/**
 * First LinkedIn profile URL on the hiring team from the job record, if any.
 * application-outreach-chain.ts:pickStoredHiringPoster
 */
export function pickStoredHiringPoster(candidate: PostApplyOutreachCandidate): HiringManagerPick | null {
  const storedHm = candidate.hiringTeam?.find((m) => typeof m?.profileUrl === 'string' && m.profileUrl.includes('/in/'))
  if (!storedHm?.profileUrl) return null
  return {
    profileUrl: storedHm.profileUrl,
    firstName: (storedHm.name || '').split(/\s+/)[0] || '',
    company: candidate.company,
    headline: storedHm.title || ''
  }
}

/**
 * LinkedIn people search URL for hiring-manager discovery.
 * application-outreach-chain.ts:buildHiringManagerPeopleSearch
 */
export function buildHiringManagerPeopleSearch(
  company: string,
  jobTitle: string | undefined,
  searchHint: string | undefined
): { query: string; searchUrl: string } {
  const query =
    searchHint || `"${company}" ${jobTitle || ''} hiring manager OR recruiter`.trim()
  return {
    query,
    searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`
  }
}

/**
 * Validates IPC payload for hiring-manager search (minimal shape check).
 * application-outreach-chain.ts:parseSearchHiringManagerPayload
 */
function normalizeHiringTeamFromPayload(raw: unknown): HiringTeamMember[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: HiringTeamMember[] = []
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    const title = typeof o.title === 'string' ? o.title : undefined
    const profileUrl = typeof o.profileUrl === 'string' ? o.profileUrl : undefined
    if (!name && !profileUrl) continue
    out.push({ name: name || '', title, profileUrl })
  }
  return out.length > 0 ? out : undefined
}

export function parseSearchHiringManagerPayload(
  payload: unknown
): OutreachSearchHiringManagerPayload | null {
  if (payload == null || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const company = String(p.company || '').trim()
  if (!company) return null
  return {
    company,
    jobTitle: typeof p.jobTitle === 'string' ? p.jobTitle : undefined,
    searchHint: typeof p.searchHint === 'string' ? p.searchHint : undefined,
    hiringTeam: normalizeHiringTeamFromPayload(p.hiringTeam)
  }
}
