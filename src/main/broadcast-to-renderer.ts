import { BrowserWindow } from 'electron'
import { appLog } from './app-log'

/** Send a payload to every open renderer window (main → renderer IPC). */
export function broadcastToRenderer(channel: string, data: unknown): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, data)
    }
  } catch (e) {
    appLog.debug('[main] broadcastToRenderer failed', {
      channel,
      error: e instanceof Error ? e.message : e
    })
  }
}
