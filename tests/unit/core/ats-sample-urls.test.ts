import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectAts } from '../../../src/core/ats-detect'

type SampleRow = {
  atsId: string
  applicationUrl?: string
  applicationUrls?: string[]
  formType?: string
}

function urlsForRow(row: SampleRow): string[] {
  const fromArr = Array.isArray(row.applicationUrls)
    ? row.applicationUrls.map((u) => String(u || '').trim()).filter(Boolean)
    : []
  const legacy = String(row.applicationUrl || '').trim()
  if (fromArr.length) return fromArr
  if (legacy) return [legacy]
  return []
}

const SAMPLE_FILE = path.resolve(
  __dirname,
  '../../../test-data/ats-vendor-sample-application-urls.json'
)

describe('ats-vendor-sample-application-urls.json', () => {
  const raw = JSON.parse(readFileSync(SAMPLE_FILE, 'utf8')) as {
    samples: SampleRow[]
  }
  const rows = Array.isArray(raw.samples) ? raw.samples : []

  it('has 3–5 URLs per sample (or legacy applicationUrl)', () => {
    for (const row of rows) {
      const urls = urlsForRow(row)
      expect(urls.length, `${row.atsId} needs applicationUrls`).toBeGreaterThanOrEqual(3)
      expect(urls.length, `${row.atsId} should have at most 5 URLs`).toBeLessThanOrEqual(5)
    }
  })

  it('every URL detects as the declared atsId', () => {
    for (const row of rows) {
      const expected = String(row.atsId || '').trim()
      const urls = urlsForRow(row)
      for (const url of urls) {
        const r = detectAts(url)
        expect(
          r.matched && r.atsId === expected,
          `expected ${expected} for ${url}, got ${JSON.stringify(r)}`
        ).toBe(true)
      }
    }
  })
})
