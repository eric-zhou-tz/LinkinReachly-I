import log from 'electron-log/renderer.js'

const rendererLogRoot = log
const rendererLog = log.scope('renderer')

let rendererLoggingInstalled = false

function shouldInstallRendererLogging(targetWindow: Window & typeof globalThis): boolean {
  return targetWindow.loa != null
}

function handleWindowError(event: ErrorEvent): void {
  rendererLog.error('[renderer] window error', event.error || event.message)
}

function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  rendererLog.error('[renderer] unhandled rejection', event.reason)
}

export function installRendererLogging(
  targetWindow: (Window & typeof globalThis) | undefined = typeof window === 'undefined' ? undefined : window
): boolean {
  if (!targetWindow || !shouldInstallRendererLogging(targetWindow) || rendererLoggingInstalled) {
    return false
  }

  rendererLoggingInstalled = true
  Object.assign(console, rendererLogRoot.functions)
  targetWindow.addEventListener('error', handleWindowError)
  targetWindow.addEventListener('unhandledrejection', handleUnhandledRejection)
  return true
}
