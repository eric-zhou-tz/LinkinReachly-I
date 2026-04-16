import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({
  isExtensionConnected: vi.fn(() => true),
  sendCommand: vi.fn(),
  bridgeEvents: {
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn()
  }
}))

vi.mock('../../../src/main/bridge', () => ({
  isExtensionConnected: () => bridge.isExtensionConnected(),
  sendCommand: (...a: unknown[]) => bridge.sendCommand(...a) as ReturnType<typeof bridge.sendCommand>,
  bridgeEvents: bridge.bridgeEvents,
  getActiveLinkedInTab: () => true,
  getActiveLinkedInTabUrl: () => 'https://www.linkedin.com/jobs/view/1/'
}))

let prevDataDir: string | undefined

beforeEach(() => {
  prevDataDir = process.env['LOA_USER_DATA_DIR']
  process.env['LOA_USER_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'loa-easy-'))
  bridge.isExtensionConnected.mockReturnValue(true)
  bridge.sendCommand.mockReset()
})

afterEach(() => {
  const d = process.env['LOA_USER_DATA_DIR']
  if (d && existsSync(d)) rmSync(d, { recursive: true, force: true })
  if (prevDataDir === undefined) delete process.env['LOA_USER_DATA_DIR']
  else process.env['LOA_USER_DATA_DIR'] = prevDataDir
  vi.resetModules()
})

describe('handleEasyApply', () => {
  it('fails at navigate when Chrome bridge is not connected', async () => {
    bridge.isExtensionConnected.mockReturnValue(false)
    const { handleEasyApply } = await import('../../../src/main/application-assistant')
    const r = await handleEasyApply({ jobUrl: 'https://www.linkedin.com/jobs/view/1/' })
    expect(r.ok).toBe(false)
    expect(r.phase).toBe('navigate')
    expect(r.detail).toMatch(/not connected/i)
    expect(bridge.sendCommand).not.toHaveBeenCalled()
  })

  it('fails when job URL is missing', async () => {
    const { handleEasyApply } = await import('../../../src/main/application-assistant')
    const r = await handleEasyApply({ jobUrl: '   ' })
    expect(r.ok).toBe(false)
    expect(r.phase).toBe('navigate')
    expect(r.detail).toMatch(/no job url/i)
  })

  it('fails when applicant profile is missing name or email', async () => {
    const { handleEasyApply } = await import('../../../src/main/application-assistant')
    const r = await handleEasyApply({ jobUrl: 'https://www.linkedin.com/jobs/view/1/' })
    expect(r.ok).toBe(false)
    expect(r.phase).toBe('navigate')
    expect(r.detail).toMatch(/profile incomplete/i)
  })

  it('returns extension_stale when PING reports unknown_action', async () => {
    const { saveApplicantProfile } = await import('../../../src/main/applicant-profile-store')
    saveApplicantProfile({
      basics: { fullName: 'Test User', email: 'test@example.com' }
    })
    bridge.sendCommand.mockResolvedValue({ ok: false, detail: 'unknown_action: PING' })
    const { handleEasyApply } = await import('../../../src/main/application-assistant')
    const r = await handleEasyApply({ jobUrl: 'https://www.linkedin.com/jobs/view/1/' })
    expect(r.ok).toBe(false)
    expect(r.blockReason).toBe('extension_stale')
    expect(r.phase).toBe('preflight')
  })
})
