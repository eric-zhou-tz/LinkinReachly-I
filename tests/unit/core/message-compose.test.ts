import { describe, expect, it } from 'vitest'
import { fillTemplate, pickVariant, validateMessageBody } from '@core/message-compose'
import type { ProfileFacts, TargetRow } from '@core/types'

describe('fillTemplate', () => {
  const row: TargetRow = {
    profileUrl: 'https://www.linkedin.com/in/x/',
    firstName: 'Sam',
    company: 'Acme',
    headline: 'VP Sales'
  }

  it('replaces all supported placeholders from row', () => {
    const out = fillTemplate('Hi {firstName} at {company} — {headline}', row, {})
    expect(out).toBe('Hi Sam at Acme — VP Sales')
  })

  it('prefers facts over row for names', () => {
    const facts: ProfileFacts = { firstName: 'Pat', company: 'BetaCo', headline: 'CEO' }
    const out = fillTemplate('{firstName} / {company} / {headline}', row, facts)
    expect(out).toBe('Pat / BetaCo / CEO')
  })

  it('maps {name} to first name', () => {
    expect(fillTemplate('Hey {name}', row, {})).toBe('Hey Sam')
  })

  it('uses principal_name-derived first name when firstName missing', () => {
    const r: TargetRow = {
      profileUrl: 'https://www.linkedin.com/in/y/',
      principal_name: 'Jordan Lee'
    }
    expect(fillTemplate('Hi {firstName}', r, {})).toBe('Hi Jordan')
  })

  it('uses fallbacks when data missing', () => {
    const minimal: TargetRow = { profileUrl: 'https://www.linkedin.com/in/z/' }
    const out = fillTemplate('Hi {firstName}, {company}, {headline}', minimal, {})
    expect(out).toBe('Hi there, your firm, ')
  })
})

describe('pickVariant', () => {
  const templates = ['A', 'B', 'C']

  it('is deterministic for the same seed', () => {
    const a = pickVariant(templates, 'https://www.linkedin.com/in/seed-a/')
    const b = pickVariant(templates, 'https://www.linkedin.com/in/seed-a/')
    expect(a).toEqual(b)
  })

  it('returns variant index within range', () => {
    for (let i = 0; i < 20; i++) {
      const seed = `https://www.linkedin.com/in/u${i}/`
      const { body, variant } = pickVariant(templates, seed)
      expect(templates).toContain(body)
      expect(variant).toMatch(/^T[012]$/)
    }
  })

  it('handles empty template list', () => {
    expect(pickVariant([], 'x')).toEqual({ body: '', variant: 'T0' })
  })
})

describe('validateMessageBody', () => {
  it('passes short message without constraints', () => {
    expect(validateMessageBody('Hello', [])).toEqual({ ok: true, detail: '' })
  })

  it('fails when over max length', () => {
    const long = 'x'.repeat(301)
    const r = validateMessageBody(long, [], 300)
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('over_limit')
  })

  it('enforces mustInclude substrings', () => {
    expect(validateMessageBody('Hi', ['https://example.com'], 300).ok).toBe(false)
    expect(validateMessageBody('See https://example.com', ['https://example.com'], 300).ok).toBe(true)
  })

  it('ignores empty strings in mustInclude', () => {
    expect(validateMessageBody('ok', [''], 300)).toEqual({ ok: true, detail: '' })
  })
})
