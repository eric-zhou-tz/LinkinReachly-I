export function isAllowedLinkedInHostname(hostname: string): boolean {
  const normalized = String(hostname || '').trim().toLowerCase()
  if (!normalized) return false
  return normalized === 'linkedin.com' || normalized.endsWith('.linkedin.com')
}

export function isLinkedInUrl(raw: string): boolean {
  try {
    const url = new URL(String(raw || '').trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    return isAllowedLinkedInHostname(url.hostname)
  } catch {
    return false
  }
}

export function canonicalProfileUrlKey(raw: string): string {
  const input = String(raw || '').trim()
  if (!input) return ''

  try {
    const url = new URL(input)
    return url.pathname.replace(/\/+$/, '').toLowerCase()
  } catch {
    return input.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase()
  }
}

export type LinkedInJobsUrlKind = 'search' | 'view'

export type ParsedLinkedInJobsUrl =
  | {
      ok: true
      kind: LinkedInJobsUrlKind
      normalizedUrl: string
      canonicalViewUrl?: string
      jobId?: string
    }
  | { ok: false; reason: string }

function stripWwwPrefix(hostname: string): string {
  return hostname.replace(/^www\./i, '')
}

function inferLinkedInJobsUrlKind(pathname: string): LinkedInJobsUrlKind | null {
  const path = String(pathname || '').toLowerCase()
  if (path.includes('/jobs/search')) return 'search'
  if (path.includes('/jobs/view/')) return 'view'
  return null
}

function extractLinkedInJobId(pathname: string, searchParams: URLSearchParams): string {
  const path = String(pathname || '')
  const fromPath = path.match(/\/jobs\/view\/(\d+)/i)?.[1]
  if (fromPath) return fromPath
  const fromCurrentJobId = String(searchParams.get('currentJobId') || '').trim()
  if (/^\d+$/.test(fromCurrentJobId)) return fromCurrentJobId
  return ''
}

export function parseLinkedInJobsUrl(raw: string): ParsedLinkedInJobsUrl {
  const input = String(raw || '').trim()
  if (!input) return { ok: false, reason: 'Paste a LinkedIn Jobs URL.' }
  try {
    const url = new URL(input)
    const protocol = String(url.protocol || '').toLowerCase()
    if (protocol !== 'https:' && protocol !== 'http:') {
      return { ok: false, reason: 'Use an http or https LinkedIn Jobs URL.' }
    }
    if (!isAllowedLinkedInHostname(url.hostname)) {
      return { ok: false, reason: 'Use a LinkedIn URL from linkedin.com.' }
    }
    const kind = inferLinkedInJobsUrlKind(url.pathname)
    if (!kind) {
      return {
        ok: false,
        reason: 'Use a LinkedIn Jobs URL like /jobs/search/... or /jobs/view/...'
      }
    }
    url.protocol = 'https:'
    url.hostname = stripWwwPrefix(url.hostname) === 'linkedin.com'
      ? 'www.linkedin.com'
      : url.hostname.toLowerCase()
    url.hash = ''

    if (kind === 'view') {
      const jobId = extractLinkedInJobId(url.pathname, url.searchParams)
      if (!jobId) {
        return { ok: false, reason: 'That LinkedIn job link is missing a job ID.' }
      }
      const canonicalViewUrl = `https://www.linkedin.com/jobs/view/${jobId}/`
      return {
        ok: true,
        kind,
        normalizedUrl: url.toString(),
        canonicalViewUrl,
        jobId
      }
    }

    return {
      ok: true,
      kind,
      normalizedUrl: url.toString()
    }
  } catch {
    return {
      ok: false,
      reason: 'Could not parse that URL. Paste the full LinkedIn job search or job link.'
    }
  }
}
