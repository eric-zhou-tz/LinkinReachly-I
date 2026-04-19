import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnqueue, mockSetEventQueueEnabled } = vi.hoisted(() => ({
  mockEnqueue: vi.fn(),
  mockSetEventQueueEnabled: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => 'test-version' }
}))

vi.mock('../../../src/main/event-queue', () => ({
  enqueue: mockEnqueue,
  getAnonymousId: () => 'anon-test',
  getSessionId: () => 'session-test',
  setEventQueueEnabled: mockSetEventQueueEnabled
}))

vi.mock('../../../src/main/auth-service', () => ({
  getFirebaseToken: () => null,
  getAuthHeaders: () => ({})
}))

vi.mock('../../../src/main/api-client', () => ({
  decodeTokenPayload: () => ({ uid: 'user-test' })
}))

vi.mock('../../../src/main/app-log', () => ({
  appLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import {
  setTelemetryEnabled,
  trackError,
  trackGenericEvent
} from '../../../src/main/telemetry'

describe('telemetry opt-in boundary', () => {
  beforeEach(() => {
    setTelemetryEnabled(false)
    mockEnqueue.mockClear()
    mockSetEventQueueEnabled.mockClear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not enqueue usage events while telemetry is disabled', () => {
    trackGenericEvent('Job Queued', { job_url: 'https://example.test/job/1' })

    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('does not send structured errors while telemetry is disabled', async () => {
    trackError('llm_error', 'model failed', {
      context: { job_url: 'https://example.test/job/1' }
    })
    await Promise.resolve()

    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('enables the event queue only after opt-in', () => {
    setTelemetryEnabled(true)
    trackGenericEvent('Settings Changed', { setting_name: 'telemetryOptIn' })

    expect(mockSetEventQueueEnabled).toHaveBeenCalledWith(true)
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
  })
})
