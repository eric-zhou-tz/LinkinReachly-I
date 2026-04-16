/**
 * First &lt;select&gt; options are often placeholders ("Select an option") with non-empty display text.
 * Those must not count as a real answer or we skip required dropdowns (Lever/Greenhouse on LinkedIn).
 */
export function easyApplySelectDisplayLooksPlaceholder(displayOrValue: string): boolean {
  const s = String(displayOrValue ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  if (!s) return true
  if (/^[-–—]+$/.test(s)) return true
  if (/^select(\s+an)?\s+option[s]?$/.test(s)) return true
  if (/^select\s*\.\.\.$/.test(s)) return true
  if (/^(selectionnez|choisissez)(\s+une?)?\s+option$/.test(s)) return true
  if (/^seleccione(\s+una?)?\s+opcion$/.test(s)) return true
  if (/^selecione(\s+uma?)?\s+opcao$/.test(s)) return true
  if (/^seleziona(\s+un[ao]?)?\s+opzione$/.test(s)) return true
  if (/^wahlen?\s+sie(\s+eine?)?\s+option$/.test(s)) return true
  if (/^choose(\s+(an|one))?\s*(option|one)?$/.test(s)) return true
  if (/^pick\s+(one|an\s+option)$/.test(s)) return true
  if (/^please\s+select/.test(s)) return true
  if (/^(veuillez\s+selectionner|por\s+favor\s+seleccione)\b/.test(s)) return true
  if (/^required$/.test(s)) return true
  return false
}

/**
 * The extension encodes checkbox/radio DOM state as value "true" | "false".
 * Those must not be treated like normal strings — "false" means unanswered/unchecked.
 */
export function easyApplyFieldAppearsFilled(field: { type: string; value?: string }): boolean {
  const raw = String(field.value ?? '').trim()
  if (!raw) return false
  const t = field.type
  if (t === 'radio' || t === 'checkbox') {
    return raw.toLowerCase() === 'true' || raw === '1'
  }
  if (t === 'select' && easyApplySelectDisplayLooksPlaceholder(raw)) {
    return false
  }
  return true
}

/**
 * Choose a concrete &lt;option&gt; label for "how did you hear" dropdowns (exact text for Lever, etc.).
 */
export function pickHearAboutSelectOption(options: string[] | undefined): string {
  const opts = (options || []).map((o) => String(o).trim()).filter(Boolean)
  const real = opts.filter((o) => !easyApplySelectDisplayLooksPlaceholder(o))
  const linked = real.find((o) => o.replace(/\s+/g, '').toLowerCase().includes('linkedin'))
  if (linked) return linked
  const careers = real.find((o) => /careers?\s+page|join\s+our|company\s+site/i.test(o))
  if (careers) return careers
  const search = real.find((o) => /search\s+engine|google|yahoo/i.test(o))
  if (search) return search
  return real[0] || 'LinkedIn'
}
