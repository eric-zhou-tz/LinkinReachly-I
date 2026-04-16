import { describe, expect, it } from 'vitest'
import { scoreResumeAgainstJobDescription } from '@core/resume-jd-fit'

describe('scoreResumeAgainstJobDescription', () => {
  it('scores overlap on shared substantive tokens', () => {
    const resume = 'Senior TypeScript engineer with React and distributed systems experience.'
    const jd = 'We need a TypeScript developer familiar with React and system design.'
    const r = scoreResumeAgainstJobDescription(resume, jd)
    expect(r.score0to100).toBeGreaterThan(15)
    expect(r.matchedTerms).toContain('typescript')
    expect(r.matchedTerms).toContain('react')
  })

  it('returns zero for empty inputs', () => {
    expect(scoreResumeAgainstJobDescription('', 'a b c').score0to100).toBe(0)
  })
})
