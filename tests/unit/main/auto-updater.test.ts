import { describe, expect, it, vi } from 'vitest'
import { attachUpdateReadyNotifier } from '../../../src/main/auto-updater-ui'

describe('auto-updater IPC', () => {
  it('update-downloaded notifies renderer via app:update-ready', () => {
    const listeners = new Map<string, (info: { version: string }) => void>()
    const autoUpdater = {
      on: vi.fn((event: string, cb: (info: { version: string }) => void) => {
        listeners.set(event, cb)
      }),
    }

    const send = vi.fn()
    const mainWindow = {
      isDestroyed: () => false,
      webContents: { send },
    }

    const onDownloaded = vi.fn()
    attachUpdateReadyNotifier(autoUpdater as never, () => mainWindow, onDownloaded)

    expect(autoUpdater.on).toHaveBeenCalledWith('update-downloaded', expect.any(Function))

    const handler = listeners.get('update-downloaded')
    expect(handler).toBeDefined()
    handler!({ version: '9.9.9' })

    expect(onDownloaded).toHaveBeenCalledWith({ version: '9.9.9' })
    expect(send).toHaveBeenCalledWith('app:update-ready', { version: '9.9.9' })
  })

  it('does not throw when main window is null', () => {
    const listeners = new Map<string, (info: { version: string }) => void>()
    const autoUpdater = {
      on: vi.fn((event: string, cb: (info: { version: string }) => void) => {
        listeners.set(event, cb)
      }),
    }

    attachUpdateReadyNotifier(autoUpdater as never, () => null)

    expect(() => listeners.get('update-downloaded')!({ version: '1.0.1' })).not.toThrow()
  })

  it('skips send when window is destroyed', () => {
    const listeners = new Map<string, (info: { version: string }) => void>()
    const autoUpdater = {
      on: vi.fn((event: string, cb: (info: { version: string }) => void) => {
        listeners.set(event, cb)
      }),
    }

    const send = vi.fn()
    const mainWindow = {
      isDestroyed: () => true,
      webContents: { send },
    }

    attachUpdateReadyNotifier(autoUpdater as never, () => mainWindow)

    listeners.get('update-downloaded')!({ version: '2.0.0' })
    expect(send).not.toHaveBeenCalled()
  })
})
