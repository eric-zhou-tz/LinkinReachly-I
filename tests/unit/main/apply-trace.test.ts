import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/app-log', () => ({
  appLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('../../../src/main/apply-session-recorder', () => ({
  startSessionRecording: vi.fn(),
  endSessionRecording: vi.fn(),
  recordEvent: vi.fn(),
  isRecording: () => false
}))

import { summarizeFormFieldsStep } from '../../../src/main/apply-trace'

describe('summarizeFormFieldsStep', () => {
  it('redacts filled values from trace rows', () => {
    const summary = summarizeFormFieldsStep(2, [
      { label: 'Current city', type: 'text', value: 'Austin', required: true },
      { label: 'SSN', type: 'text', value: '123-45-6789', required: false }
    ])

    const rows = summary.rows as Array<{ valuePreview: string; valueLength: number }>
    expect(rows[0].valuePreview).toBe('[redacted]')
    expect(rows[0].valueLength).toBe(6)
    expect(JSON.stringify(summary)).not.toContain('123-45-6789')
  })
})
