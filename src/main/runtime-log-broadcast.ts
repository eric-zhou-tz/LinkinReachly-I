import type { WebContents } from 'electron'
import type logType from 'electron-log/main.js'
import { formatRuntimeLogMessage } from './app-log'

let target: WebContents | null = null
let hookInstalled = false
let sending = false

export function setRuntimeLogBroadcastTarget(wc: WebContents | null): void {
  if (!wc || wc.isDestroyed()) {
    target = null
    return
  }
  target = wc
}

export function installRuntimeLogBroadcastHook(log: typeof logType): void {
  if (hookInstalled) return
  hookInstalled = true
  log.hooks.push((message) => {
    if (!target || target.isDestroyed() || sending) return message
    sending = true
    try {
      const text = formatRuntimeLogMessage({
        date: message.date,
        level: message.level,
        scope: message.scope,
        data: message.data as unknown[]
      })
      target.send('runtime-log:line', {
        text,
        level: message.level,
        t: message.date.getTime()
      })
    } catch {
      target = null
    } finally {
      sending = false
    }
    return message
  })
}
