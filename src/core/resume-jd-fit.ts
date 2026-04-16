/**
 * Heuristic résumé ↔ job-description keyword overlap (no proprietary keyword blobs).
 * Use for lightweight "fit" hints before apply; AI screening remains authoritative when enabled.
 */

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'you',
  'our',
  'are',
  'this',
  'that',
  'your',
  'from',
  'will',
  'have',
  'been',
  'were',
  'their',
  'they',
  'who',
  'but',
  'not',
  'all',
  'any',
  'can',
  'may',
  'into',
  'about',
  'also',
  'than',
  'then',
  'such',
  'via',
  'per',
  'using',
  'including',
  'etc',
  'we',
  'us',
  'as',
  'an',
  'a',
  'of',
  'in',
  'on',
  'at',
  'to',
  'is',
  'it',
  'or',
  'be',
  'by',
  'if',
  'so',
  'no',
  'do'
])

function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/gi, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 2 && !STOP.has(t))
}

/** Jaccard similarity on token sets, scaled 0–100. */
export function scoreResumeAgainstJobDescription(
  resumeText: string,
  jobDescription: string
): { score0to100: number; matchedTerms: string[]; resumeTokenCount: number; jobTokenCount: number } {
  const r = new Set(tokenize(resumeText))
  const j = new Set(tokenize(jobDescription))
  if (r.size === 0 || j.size === 0) {
    return { score0to100: 0, matchedTerms: [], resumeTokenCount: r.size, jobTokenCount: j.size }
  }
  const inter: string[] = []
  for (const t of r) {
    if (j.has(t)) inter.push(t)
  }
  const union = r.size + j.size - inter.length
  const jac = union > 0 ? inter.length / union : 0
  return {
    score0to100: Math.round(jac * 100),
    matchedTerms: inter.slice(0, 80).sort(),
    resumeTokenCount: r.size,
    jobTokenCount: j.size
  }
}
