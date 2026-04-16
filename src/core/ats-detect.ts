/**
 * ATS / job-board detection via `ats-registry.json` (URL regex, exclusions, hostname hints).
 */

import type { AtsRegistryBoard, AtsRegistryVendor } from './ats-registry.schema'
import { getAtsRegistry } from './ats-registry'

/** Stable slug from registry (`unknown` when unmatched). */
export type AtsId = string

export type AtsDetectResult = {
  matched: boolean
  atsId: AtsId
  atsLabel: string
  company: string
  jobId: string
  confidence: 'high' | 'medium' | 'low'
  /** Job boards (SmartApply, etc.) vs ATS vendors. */
  surface?: 'ats' | 'board'
}

type CompiledRx = {
  positive: RegExp[]
  excluded: RegExp[]
}

function compileRx(patterns: string[]): RegExp[] {
  const out: RegExp[] = []
  for (const s of patterns) {
    if (!s || !s.trim()) continue
    try {
      out.push(new RegExp(s, 'i'))
    } catch (e) {
      console.warn('[ats-detect] invalid regex pattern skipped:', s, e)
    }
  }
  return out
}

function matchesAny(haystack: string, patterns: RegExp[]): boolean {
  for (const r of patterns) {
    if (r.test(haystack)) return true
  }
  return false
}

let _compiled: {
  vendors: Array<{ v: AtsRegistryVendor; rx: CompiledRx }>
  boards: Array<{ b: AtsRegistryBoard; rx: CompiledRx }>
} | null = null

function compiled(): {
  vendors: Array<{ v: AtsRegistryVendor; rx: CompiledRx }>
  boards: Array<{ b: AtsRegistryBoard; rx: CompiledRx }>
} {
  if (_compiled) return _compiled
  const reg = getAtsRegistry()
  _compiled = {
    vendors: reg.vendors.map((v) => ({
      v,
      rx: {
        positive: compileRx(v.urlRegex),
        excluded: compileRx(v.urlsExcluded)
      }
    })),
    boards: reg.boards.map((b) => ({
      b,
      rx: {
        positive: compileRx(b.urlRegex),
        excluded: compileRx(b.urlsExcluded)
      }
    }))
  }
  return _compiled
}

function extractCompanyJob(
  match: RegExpMatchArray | null,
  companyIdx: number,
  jobIdIdx: number
): { company: string; jobId: string } {
  if (!match) return { company: '', jobId: '' }
  const company = match[companyIdx] != null ? String(match[companyIdx]) : ''
  const jobId = match[jobIdIdx] != null ? String(match[jobIdIdx]) : ''
  return { company: company.replace(/-/g, ' '), jobId }
}

function urlCaptureIndices(item: AtsRegistryVendor | AtsRegistryBoard): [number, number] {
  const g = item.urlCaptureGroups
  if (
    Array.isArray(g) &&
    g.length >= 2 &&
    typeof g[0] === 'number' &&
    typeof g[1] === 'number' &&
    Number.isFinite(g[0]) &&
    Number.isFinite(g[1])
  ) {
    const a = Math.trunc(g[0])
    const b = Math.trunc(g[1])
    if (a >= 0 && b >= 0) return [a, b]
  }
  return [1, 2]
}

function hostnameIncludesFor(item: AtsRegistryVendor | AtsRegistryBoard): string[] {
  return item.hostnameIncludes ?? []
}

function detectFromEntries(
  href: string,
  hostname: string,
  entries: Array<{ item: AtsRegistryVendor | AtsRegistryBoard; rx: CompiledRx }>,
  surface: 'ats' | 'board'
): AtsDetectResult | null {
  for (const { item, rx } of entries) {
    if (matchesAny(href, rx.excluded)) continue
    for (const pattern of rx.positive) {
      const m = href.match(pattern)
      if (m) {
        const [ci, ji] = urlCaptureIndices(item)
        const { company, jobId } = extractCompanyJob(m, ci, ji)
        return {
          matched: true,
          atsId: item.id,
          atsLabel: item.label,
          company,
          jobId,
          confidence: 'high',
          surface
        }
      }
    }
  }

  for (const { item, rx } of entries) {
    if (matchesAny(href, rx.excluded)) continue
    for (const h of hostnameIncludesFor(item)) {
      if (h && hostname.includes(h.toLowerCase())) {
        return {
          matched: true,
          atsId: item.id,
          atsLabel: item.label,
          company: '',
          jobId: '',
          confidence: 'medium',
          surface
        }
      }
    }
  }

  return null
}

export function detectAts(urlString: string): AtsDetectResult {
  const noMatch: AtsDetectResult = {
    matched: false,
    atsId: 'unknown',
    atsLabel: 'Unknown',
    company: '',
    jobId: '',
    confidence: 'low'
  }

  if (!urlString) return noMatch

  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return noMatch
  }

  const href = url.href
  const hostname = url.hostname.toLowerCase()

  const { vendors, boards } = compiled()
  const vendorEntries = vendors.map((x) => ({ item: x.v, rx: x.rx }))
  const boardEntries = boards.map((x) => ({ item: x.b, rx: x.rx }))

  const fromVendor = detectFromEntries(href, hostname, vendorEntries, 'ats')
  if (fromVendor) return fromVendor

  const fromBoard = detectFromEntries(href, hostname, boardEntries, 'board')
  if (fromBoard) return fromBoard

  return noMatch
}

export function getSupportedAtsLabels(): string[] {
  const reg = getAtsRegistry()
  return [
    ...reg.vendors.map((v) => v.label),
    ...reg.boards.map((b) => b.label)
  ]
}
