/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const scopedLogger = {
  error: vi.fn()
}

const rendererLog = {
  functions: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    silly: vi.fn()
  },
  scope: vi.fn(() => scopedLogger)
}

vi.mock('electron-log/renderer', () => ({
  default: rendererLog
}))

describe('renderer logging setup', () => {
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug
  }

  beforeEach(() => {
    vi.resetModules()
    delete window.loa
    scopedLogger.error.mockReset()
    rendererLog.scope.mockClear()
    for (const fn of Object.values(rendererLog.functions)) {
      fn.mockReset()
    }
    console.log = originalConsole.log
    console.error = originalConsole.error
    console.warn = originalConsole.warn
    console.info = originalConsole.info
    console.debug = originalConsole.debug
  })

  afterEach(() => {
    delete window.loa
    console.log = originalConsole.log
    console.error = originalConsole.error
    console.warn = originalConsole.warn
    console.info = originalConsole.info
    console.debug = originalConsole.debug
    vi.restoreAllMocks()
  })

  it('skips electron-log wiring in browser-tab mode', async () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')

    const { installRendererLogging } = await import('../../../src/renderer/src/app-log')

    expect(installRendererLogging()).toBe(false)
    expect(addEventListener).not.toHaveBeenCalled()
    expect(console.error).toBe(originalConsole.error)
  })

  it('installs electron-log wiring once when preload bridge is available', async () => {
    window.loa = {} as Window['loa']
    const addEventListener = vi.spyOn(window, 'addEventListener')

    const { installRendererLogging } = await import('../../../src/renderer/src/app-log')

    expect(installRendererLogging()).toBe(true)
    expect(installRendererLogging()).toBe(false)
    expect(addEventListener).toHaveBeenCalledTimes(2)
    expect(addEventListener).toHaveBeenNthCalledWith(1, 'error', expect.any(Function))
    expect(addEventListener).toHaveBeenNthCalledWith(2, 'unhandledrejection', expect.any(Function))
    expect(console.error).toBe(rendererLog.functions.error)
  })
})
