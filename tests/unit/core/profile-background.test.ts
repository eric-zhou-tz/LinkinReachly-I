import { describe, expect, it } from 'vitest'
import { buildUserBackgroundFromLinkedInProfile } from '@core/profile-background'

describe('buildUserBackgroundFromLinkedInProfile', () => {
  it('builds a concise recruiter-style summary from structured profile fields', () => {
    const summary = buildUserBackgroundFromLinkedInProfile({
      headline: 'Staff infrastructure engineer',
      company: 'Anthropic',
      location: 'New York City',
      about:
        'I build distributed systems and internal platforms for ML teams. I have led reliability, developer tooling, and production operations work across fast-moving product organizations.',
      experienceHighlights: [
        'Staff infrastructure engineer - Anthropic',
        'Senior software engineer - Stripe',
        'Technical lead - developer productivity'
      ]
    })

    expect(summary).toContain('Staff infrastructure engineer at Anthropic.')
    expect(summary).toContain('Based in New York City.')
    expect(summary).toContain('Recent experience includes')
    expect(summary.length).toBeLessThanOrEqual(700)
  })

  it('falls back to raw profile text when structured fields are sparse', () => {
    const summary = buildUserBackgroundFromLinkedInProfile({
      rawText:
        'Engineering manager focused on AI products and infrastructure. Led teams shipping model-powered features and platform improvements.'
    })

    expect(summary).toContain('Engineering manager focused on AI products and infrastructure.')
  })
})
