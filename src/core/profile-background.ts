export type LinkedInProfileSnapshot = {
  profileUrl?: string
  displayName?: string
  firstName?: string
  headline?: string
  company?: string
  location?: string
  about?: string
  experienceHighlights?: string[]
  rawText?: string
}

function clean(value: unknown): string {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const text = clean(value)
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

function ensureSentence(text: string): string {
  const value = clean(text)
  if (!value) return ''
  return /[.!?]$/.test(value) ? value : `${value}.`
}

function truncate(text: string, max = 320): string {
  const value = clean(text)
  if (value.length <= max) return value
  const slice = value.slice(0, Math.max(40, max - 1))
  const boundary = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('; '), slice.lastIndexOf(', '), slice.lastIndexOf(' '))
  const trimmed = (boundary > 40 ? slice.slice(0, boundary) : slice).trim()
  return `${trimmed}...`
}

export function buildUserBackgroundFromLinkedInProfile(profile: LinkedInProfileSnapshot): string {
  const headline = clean(profile.headline)
  const company = clean(profile.company)
  const location = clean(profile.location)
  const about = clean(profile.about)
  const highlights = dedupe(Array.isArray(profile.experienceHighlights) ? profile.experienceHighlights : []).slice(0, 3)

  const parts: string[] = []
  if (headline && company && !headline.toLowerCase().includes(company.toLowerCase())) {
    parts.push(ensureSentence(`${headline} at ${company}`))
  } else if (headline) {
    parts.push(ensureSentence(headline))
  } else if (company) {
    parts.push(ensureSentence(`Works at ${company}`))
  }

  if (location) {
    parts.push(ensureSentence(`Based in ${location}`))
  }

  if (about) {
    parts.push(ensureSentence(truncate(about, 360)))
  }

  if (highlights.length > 0) {
    parts.push(ensureSentence(`Recent experience includes ${highlights.join('; ')}`))
  }

  if (parts.length === 0) {
    const raw = truncate(clean(profile.rawText), 420)
    if (raw) parts.push(ensureSentence(raw))
  }

  return truncate(parts.join(' '), 700)
}
