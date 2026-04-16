import { describe, expect, it } from 'vitest'
import { BUILTIN_DEFAULT_TEMPLATES } from '@core/template-presets'

describe('BUILTIN_DEFAULT_TEMPLATES', () => {
  it('has several peer-appropriate variants', () => {
    expect(BUILTIN_DEFAULT_TEMPLATES.length).toBeGreaterThanOrEqual(6)
    for (const line of BUILTIN_DEFAULT_TEMPLATES) {
      expect(line.length).toBeGreaterThan(0)
      expect(line.length).toBeLessThanOrEqual(320)
    }
  })
})
