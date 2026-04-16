/**
 * Notifies the renderer when a packaged build has downloaded an update.
 */

type UpdateInfo = { version: string }

type AutoUpdaterLike = {
  on(event: 'update-downloaded', listener: (info: UpdateInfo) => void): void
}

type MainWindowLike = {
  isDestroyed(): boolean
  webContents: { send(channel: string, ...args: unknown[]): void }
}

export function attachUpdateReadyNotifier(
  autoUpdater: AutoUpdaterLike,
  getMainWindow: () => MainWindowLike | null,
  onDownloaded?: (info: UpdateInfo) => void
): void {
  autoUpdater.on('update-downloaded', (info) => {
    onDownloaded?.(info)
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:update-ready', { version: info.version })
    }
  })
}
