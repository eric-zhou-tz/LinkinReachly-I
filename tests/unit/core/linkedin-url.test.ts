import { describe, expect, it } from 'vitest'
import {
  canonicalProfileUrlKey,
  isAllowedLinkedInHostname,
  isLinkedInUrl
} from '@core/linkedin-url'

describe('isAllowedLinkedInHostname', () => {
  it('accepts linkedin hosts only', () => {
    expect(isAllowedLinkedInHostname('www.linkedin.com')).toBe(true)
    expect(isAllowedLinkedInHostname('fr.linkedin.com')).toBe(true)
    expect(isAllowedLinkedInHostname('linkedin.com')).toBe(true)
    expect(isAllowedLinkedInHostname('linkedin.com.evil.test')).toBe(false)
    expect(isAllowedLinkedInHostname('notlinkedin.com')).toBe(false)
  })
})

describe('isLinkedInUrl', () => {
  it('requires a real LinkedIn URL', () => {
    expect(isLinkedInUrl('https://www.linkedin.com/in/alice/')).toBe(true)
    expect(isLinkedInUrl('https://fr.linkedin.com/in/alice/')).toBe(true)
    expect(isLinkedInUrl('https://linkedin.com.evil.test/in/alice/')).toBe(false)
    expect(isLinkedInUrl('https://example.com/linkedin.com/in/alice/')).toBe(false)
  })
})

describe('canonicalProfileUrlKey', () => {
  it('normalizes trailing slash, case, and querystring noise', () => {
    expect(
      canonicalProfileUrlKey('https://www.linkedin.com/in/Alice-Smith/?trk=public_profile')
    ).toBe('/in/alice-smith')
  })
})
