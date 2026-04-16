import { describe, expect, it } from 'vitest'
import { DEMO_SEED_CSV, DEMO_STARTER_TEMPLATES, SAMPLE_CONNECTION_NOTE } from '@core/demo-presets'
import { parseTargetsCsv } from '@core/csv-targets'

describe('SAMPLE_CONNECTION_NOTE', () => {
  it('is a single short template under LinkedIn invite length', () => {
    expect(SAMPLE_CONNECTION_NOTE.length).toBeGreaterThan(0)
    expect(SAMPLE_CONNECTION_NOTE.length).toBeLessThanOrEqual(320)
    expect(SAMPLE_CONNECTION_NOTE).toContain('{firstName}')
  })
})

describe('DEMO_STARTER_TEMPLATES', () => {
  it('ships exactly one starter template', () => {
    expect(DEMO_STARTER_TEMPLATES).toEqual([SAMPLE_CONNECTION_NOTE])
  })
})

describe('DEMO_SEED_CSV', () => {
  it('parses to one fictional demo-* profile', () => {
    const rows = parseTargetsCsv(DEMO_SEED_CSV)
    expect(rows.length).toBe(1)
    expect(rows[0].profileUrl).toContain('/in/demo-')
  })
})
