const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:'])
const SAFE_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export const SAFE_EXTERNAL_URL_ERROR =
  'Only secure https:// links, mailto: links, and local http:// URLs are allowed.'

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

export function parseSafeExternalUrl(url: string): URL | null {
  const raw = String(url || '').trim()
  if (!raw) return null

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }

  if (SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    return parsed
  }

  if (parsed.protocol === 'http:' && SAFE_LOOPBACK_HOSTS.has(normalizeHostname(parsed.hostname))) {
    return parsed
  }

  return null
}
