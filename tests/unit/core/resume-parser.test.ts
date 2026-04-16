import { describe, expect, it } from 'vitest'
import { parseResumeMarkdown } from '@core/resume-parser'

// The parser expects: HR separator between header and body,
// **Bold** company lines, *Italic* role | date lines,
// **Bold** education lines, **Bold** labels in Additional section.
const SAMPLE_RESUME = `# Victor Bian

New York, NY | victor@example.com | linkedin.com/in/victorbian

AI founder with 8+ years spanning biotech, finance, and enterprise AI. Built products from 0 to 1, raised capital, and led cross-functional teams.

---

## Experience

**AiCo** — AI-powered enterprise platform | New York, NY
*Co-Founder & CEO* | Jan 2024 – Present

- Built AI copilot serving 50+ enterprise clients
- Raised $2M seed round from top-tier VCs
- Grew ARR from $0 to $500K in 12 months

**BioStart** — Series B biotech startup | San Francisco, CA
*Chief of Staff* | Jun 2021 – Dec 2023

- Led cross-functional initiatives across product, engineering, and BD
- Managed $15M budget and 3 direct reports
- Drove FDA submission strategy for lead therapeutic

**China Merchants Securities** — PE-backed global investment bank | Shanghai, China
*Equity Research Analyst* | Jul 2018 – May 2020

- Published 20+ equity research reports on healthcare sector
- Built financial models for IPO valuations
- Covered $5B+ in market cap across biotech names

## Education

**Columbia Business School** — New York, NY | MBA, 2023
- Dean's Fellow, Healthcare & Biotech Club Co-President

**University of Science** — Beijing, China | BS Biology, 2018

## Additional

**Languages:** English (native), Mandarin (native)
**Countries worked:** US, China, Singapore
`

describe('parseResumeMarkdown', () => {
  it('parses name from the header', () => {
    const profile = parseResumeMarkdown(SAMPLE_RESUME)
    expect(profile.name).toBe('Victor Bian')
  })

  it('parses location and email', () => {
    const profile = parseResumeMarkdown(SAMPLE_RESUME)
    expect(profile.location).toContain('New York')
    expect(profile.email).toContain('victor@example.com')
  })

  it('parses summary', () => {
    const profile = parseResumeMarkdown(SAMPLE_RESUME)
    expect(profile.summary).toContain('AI founder')
  })

  it('extracts all experience entries', () => {
    const profile = parseResumeMarkdown(SAMPLE_RESUME)
    expect(profile.entries.length).toBeGreaterThanOrEqual(3)
  })

  it('parses role and company correctly', () => {
    const profile = parseResumeMarkdown(SAMPLE_RESUME)
    const ceo = profile.entries.find(e => e.role.includes('CEO'))
    expect(ceo).toBeDefined()
    expect(ceo!.company).toContain('AiCo')
  })

  it('parses company descriptions', () => {
    const profile = parseResumeMarkdown(SAMPLE_RESUME)
    const cms = profile.entries.find(e => e.company.includes('China Merchants'))
    expect(cms).toBeDefined()
    expect(cms!.companyDescription).toContain('PE-backed')
  })

  it('parses dates and calculates duration', () => {
    const profile = parseResumeMarkdown(SAMPLE_RESUME)
    const cos = profile.entries.find(e => e.role.includes('Chief of Staff'))
    expect(cos).toBeDefined()
    expect(cos!.startDate).toContain('Jun 2021')
    expect(cos!.endDate).toContain('Dec 2023')
    expect(cos!.durationMonths).toBeGreaterThan(20)
  })

  it('extracts skills from bullets', () => {
    const profile = parseResumeMarkdown(SAMPLE_RESUME)
    const allSkills = profile.entries.flatMap(e => e.skills)
    expect(allSkills.length).toBeGreaterThan(0)
    // Should detect AI-related skills from the CEO role
    const ceoSkills = profile.entries.find(e => e.role.includes('CEO'))?.skills || []
    expect(ceoSkills.some(s => /AI/i.test(s))).toBe(true)
  })

  it('extracts metrics from bullets', () => {
    const profile = parseResumeMarkdown(SAMPLE_RESUME)
    const allMetrics = profile.entries.flatMap(e => e.metrics)
    expect(allMetrics.length).toBeGreaterThan(0)
    // "$2M seed round" or "$500K" should be captured
    expect(allMetrics.some(m => /\$/.test(m))).toBe(true)
  })

  it('classifies domains', () => {
    const profile = parseResumeMarkdown(SAMPLE_RESUME)
    const allDomains = profile.entries.flatMap(e => e.domain)
    expect(allDomains).toContain('AI')
  })

  it('assigns recency weights with present = 1.0', () => {
    const profile = parseResumeMarkdown(SAMPLE_RESUME)
    const current = profile.entries.find(e => e.endDate === 'Present')
    expect(current).toBeDefined()
    expect(current!.recencyWeight).toBe(1.0)
  })

  it('generates deterministic IDs', () => {
    const a = parseResumeMarkdown(SAMPLE_RESUME)
    const b = parseResumeMarkdown(SAMPLE_RESUME)
    expect(a.entries[0].id).toBe(b.entries[0].id)
  })

  it('parses education entries', () => {
    const profile = parseResumeMarkdown(SAMPLE_RESUME)
    expect(profile.education.length).toBeGreaterThanOrEqual(2)
    const mba = profile.education.find(e => e.degree.includes('MBA'))
    expect(mba).toBeDefined()
    expect(mba!.institution).toContain('Columbia')
  })

  it('parses languages', () => {
    const profile = parseResumeMarkdown(SAMPLE_RESUME)
    expect(profile.languages).toContain('English')
    expect(profile.languages).toContain('Mandarin')
  })

  it('parses countries', () => {
    const profile = parseResumeMarkdown(SAMPLE_RESUME)
    expect(profile.countriesWorked.length).toBeGreaterThan(0)
  })

  it('calculates total years of experience', () => {
    const profile = parseResumeMarkdown(SAMPLE_RESUME)
    expect(profile.totalYearsExperience).toBeGreaterThan(3)
  })

  it('handles empty input gracefully', () => {
    const profile = parseResumeMarkdown('')
    expect(profile.entries).toHaveLength(0)
    expect(profile.name).toBe('')
  })

  it('extracts name and email from raw PDF-like text (no pipe separators)', () => {
    const pdfText = `John Smith
john.smith@gmail.com
(555) 123-4567
San Francisco, CA

---

## Experience

**Acme Corp** — Software Company
*Senior Engineer* | Jan 2020 – Present

- Built distributed systems`
    const profile = parseResumeMarkdown(pdfText)
    expect(profile.name).toBe('John Smith')
    expect(profile.email).toBe('john.smith@gmail.com')
  })

  it('extracts standalone LinkedIn URL from header', () => {
    const text = `# Jane Doe

jane@example.com
linkedin.com/in/janedoe

---

## Experience`
    const profile = parseResumeMarkdown(text)
    expect(profile.email).toBe('jane@example.com')
    expect(profile.linkedinUrl).toContain('linkedin.com/in/janedoe')
  })
})
