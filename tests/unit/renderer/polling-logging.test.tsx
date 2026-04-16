/** @vitest-environment jsdom */
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const applicationQueueState = vi.fn()
const applicationHistory = vi.fn()
const followUpState = vi.fn()
const applicantGet = vi.fn()

vi.mock('@/loa-client', () => ({
  getLoa: () => ({
    applicationQueueState,
    applicationHistory,
    followUpState,
    applicantGet,
  }),
}))

describe('useAppPolling failure logging', () => {
  beforeEach(() => {
    applicationQueueState.mockReset()
    applicationHistory.mockReset()
    followUpState.mockReset()
    applicantGet.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls console.warn when polling IPC calls reject', async () => {
    applicationQueueState.mockRejectedValue(new Error('queue down'))
    applicationHistory.mockRejectedValue(new Error('history down'))
    followUpState.mockRejectedValue(new Error('followup down'))
    applicantGet.mockRejectedValue(new Error('applicant down'))

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { useAppPolling } = await import('../../../src/renderer/src/hooks/useAppPolling')
    renderHook(() => useAppPolling())

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled()
    })

    const joined = warnSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
    expect(joined).toMatch(/fetchDaily failed/)
    expect(joined).toMatch(/applicationHistory failed/)
    expect(joined).toMatch(/followUpState failed/)
    expect(joined).toMatch(/applicantGet failed/)
    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(4)
  })
})
