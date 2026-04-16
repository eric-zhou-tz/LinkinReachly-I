/**
 * Heuristics for Easy Apply steps with multiple file inputs (resume vs cover letter).
 */

type EasyApplyFileFieldKind = 'resume' | 'cover_letter' | 'unknown'

export function classifyEasyApplyFileFieldLabel(label: string): EasyApplyFileFieldKind {
  const l = String(label || '').toLowerCase()
  if (
    /\bcover\b|\bcover\s*letter\b|letter\s+of\s+(?:intent|interest)|supporting\s+(?:statement|document|doc)/i.test(
      l
    )
  ) {
    return 'cover_letter'
  }
  if (/\bresume\b|\bcv\b|curriculum vitae|résumé|upload\s*cv|c\.v\./i.test(l)) {
    return 'resume'
  }
  return 'unknown'
}

/**
 * Decide which assets to upload and in what order (resume before cover when both).
 */
export function planEasyApplyFileUploads(
  fileFields: { label: string }[],
  hasResume: boolean,
  hasCover: boolean
): Array<'resume' | 'cover_letter'> {
  const kinds = fileFields.map((f) => classifyEasyApplyFileFieldLabel(f.label))
  const ordered: Array<'resume' | 'cover_letter'> = []
  const add = (t: 'resume' | 'cover_letter') => {
    if (!ordered.includes(t)) ordered.push(t)
  }

  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i]
    if (k === 'resume' && hasResume) add('resume')
    if (k === 'cover_letter' && hasCover) add('cover_letter')
  }

  if (fileFields.length === 1 && kinds[0] === 'unknown' && hasResume) {
    add('resume')
  }

  if (fileFields.length >= 2) {
    for (const k of kinds) {
      if (k !== 'unknown') continue
      if (hasResume && !ordered.includes('resume')) add('resume')
      else if (hasCover && !ordered.includes('cover_letter')) add('cover_letter')
    }
  }

  if (!ordered.length && fileFields.length > 0 && hasResume) {
    add('resume')
  }

  return (['resume', 'cover_letter'] as const).filter((t) => ordered.includes(t)) as Array<'resume' | 'cover_letter'>
}
