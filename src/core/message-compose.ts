import type { ProfileFacts, TargetRow } from './types'

function extractTemplateVars(tpl: string): string[] {
  const matches = tpl.match(/\{(\w+)\}/g)
  if (!matches) return []
  return [...new Set(matches.map((m) => m.slice(1, -1)))]
}


export function fillTemplate(tpl: string, row: TargetRow, facts: ProfileFacts, customVars?: Record<string, string>): string {
  const first =
    facts.firstName ||
    row.firstName ||
    (row.principal_name ? String(row.principal_name).split(/\s+/)[0] : '') ||
    'there'
  const company = facts.company || row.company || row.firm_name || 'your firm'
  const headline = facts.headline || row.headline || ''
  const firmName = row.firm_name || company
  const principalName = row.principal_name || row.firstName || first
  const crd = row.crd_number || row.crd || ''
  const ticker = (row.ticker || row.symbol || '').trim() || 'a few'
  const messageVariant =
    (row.message_variant || row.variant_note || '').trim() ||
    'I wanted to connect as a peer in the allocator space — no formal ask on my side.'
  const jobTitle = (row.jobTitle || row.job_title || '').trim() || 'the open role'
  const jobUrl = (row.jobUrl || row.job_url || '').trim()
  let result = tpl
    .replaceAll('{firstName}', first)
    .replaceAll('{name}', first)
    .replaceAll('{company}', company)
    .replaceAll('{headline}', headline)
    .replaceAll('{firm_name}', firmName)
    .replaceAll('{principal_name}', principalName)
    .replaceAll('{crd_number}', crd)
    .replaceAll('{ticker}', ticker)
    .replaceAll('{message_variant}', messageVariant)
    .replaceAll('{jobTitle}', jobTitle)
    .replaceAll('{job_title}', jobTitle)
    .replaceAll('{jobUrl}', jobUrl)
    .replaceAll('{job_url}', jobUrl)

  // Fill any custom user-defined {variables}
  if (customVars) {
    for (const [key, value] of Object.entries(customVars)) {
      if (value != null) {
        result = result.replaceAll(`{${key}}`, value)
      }
    }
  }

  // Fill any remaining {key} from the row's extra fields
  for (const [key, value] of Object.entries(row)) {
    if (value != null && typeof value === 'string' && result.includes(`{${key}}`)) {
      result = result.replaceAll(`{${key}}`, value)
    }
  }

  return result
}

export function pickVariant(templates: string[], seed: string): { body: string; variant: string } {
  if (templates.length === 0) {
    return { body: '', variant: 'T0' }
  }
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const idx = h % templates.length
  return { body: templates[idx] || templates[0], variant: `T${idx}` }
}

export function validateMessageBody(
  body: string,
  mustInclude: string[],
  maxLen = 300
): { ok: boolean; detail: string } {
  if (body.length > maxLen) return { ok: false, detail: `over_limit:${body.length}` }
  for (const s of mustInclude) {
    if (s && !body.includes(s)) return { ok: false, detail: `missing:${s}` }
  }
  return { ok: true, detail: '' }
}
