import { describe, expect, it } from 'vitest'
import { expandUsStateForms, primaryCountryLabel, expandCountryForms } from '@core/geo-normalization'

describe('expandUsStateForms', () => {
  it('expands abbreviation to include full state name', () => {
    const v = expandUsStateForms('TX')
    expect(v).toContain('TX')
    expect(v.some((x) => /texas/i.test(x))).toBe(true)
  })

  it('expands full state name to include abbreviation', () => {
    const v = expandUsStateForms('california')
    expect(v).toContain('CA')
    expect(v.some((x) => /california/i.test(x))).toBe(true)
  })

  it('handles multi-word states', () => {
    const v = expandUsStateForms('new york')
    expect(v).toContain('NY')
    expect(v.some((x) => /New York/i.test(x))).toBe(true)
  })

  it('handles DC', () => {
    const v = expandUsStateForms('DC')
    expect(v).toContain('DC')
    expect(v.some((x) => /district of columbia/i.test(x))).toBe(true)
  })

  it('returns empty for empty input', () => {
    expect(expandUsStateForms('')).toEqual([])
    expect(expandUsStateForms('   ')).toEqual([])
  })

  it('returns the raw input when no match found', () => {
    const v = expandUsStateForms('Unknown')
    expect(v).toContain('Unknown')
    expect(v.length).toBe(1)
  })
})

describe('primaryCountryLabel', () => {
  it('normalizes ISO2 codes', () => {
    expect(primaryCountryLabel('US')).toBe('United States')
    expect(primaryCountryLabel('GB')).toBe('United Kingdom')
    expect(primaryCountryLabel('CA')).toBe('Canada')
    expect(primaryCountryLabel('DE')).toBe('Germany')
  })

  it('normalizes lowercase aliases', () => {
    expect(primaryCountryLabel('usa')).toBe('United States')
    expect(primaryCountryLabel('uk')).toBe('United Kingdom')
    expect(primaryCountryLabel('united states of america')).toBe('United States')
  })

  it('returns title-cased input for unknown countries', () => {
    expect(primaryCountryLabel('zanzibar')).toBe('Zanzibar')
  })

  it('handles empty input', () => {
    expect(primaryCountryLabel('')).toBe('')
  })
})

describe('expandCountryForms', () => {
  it('expands US to multiple variants', () => {
    const v = expandCountryForms('US')
    expect(v).toContain('United States')
    expect(v.length).toBeGreaterThanOrEqual(2)
  })

  it('expands full name to include ISO2', () => {
    const v = expandCountryForms('united kingdom')
    expect(v).toContain('United Kingdom')
  })

  it('returns empty for empty input', () => {
    expect(expandCountryForms('')).toEqual([])
  })

  it('returns at least the raw input for unknown countries', () => {
    const v = expandCountryForms('Atlantis')
    expect(v).toContain('Atlantis')
  })
})
