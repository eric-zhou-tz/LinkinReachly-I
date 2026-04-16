import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { app } from 'electron'
import type { WebSocket } from 'ws'
import { WebSocketServer } from 'ws'
import { withRetry } from '@core/transport-retry'
import { defaultBridgePortForPackaging } from '@core/runtime-ports'
import { appLog } from './app-log'

export const bridgeEvents = new EventEmitter()

bridgeEvents.on('error', (err) => {
  appLog.warn('[loa-bridge] bridgeEvents error (handled):', err instanceof Error ? err.message : String(err))
})

let primaryWss: WebSocketServer | null = null
let discoveryWss: WebSocketServer | null = null
let primaryServer: http.Server | null = null
let discoveryServer: http.Server | null = null
let extensionSocket: WebSocket | null = null
/** Random secret; extension must send `{ type: 'auth', token }` before becoming the bridge socket. */
let bridgeAuthToken = ''
let connectionStartTime = 0
let lastBridgeReadySnapshot: { activeLinkedInTab: boolean; tabId: number | null; tabUrl: string } = {
  activeLinkedInTab: false,
  tabId: null,
  tabUrl: ''
}
const pending = new Map<
  string,
  { resolve: (v: BridgeResultMsg) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
>()

export type BridgeResultMsg = {
  type: 'result'
  id: string
  ok: boolean
  detail: string
  data?: unknown
}

function drainPending(reason: string): void {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer)
    entry.reject(new Error(reason))
  }
  pending.clear()
}

const DEFAULT_PORT = defaultBridgePortForPackaging(app?.isPackaged ?? false)
const MAX_PORT_RETRIES = 3
const PORT_RETRY_DELAY_MS = 1500
let bridgePort = DEFAULT_PORT
let portRetryCount = 0

export function getBridgePort(): number {
  return bridgePort
}

export function getBridgeAuthToken(): string {
  return bridgeAuthToken
}

export function isExtensionConnected(): boolean {
  return extensionSocket !== null && extensionSocket.readyState === 1
}

export function getActiveLinkedInTab(): boolean {
  return isExtensionConnected() && lastBridgeReadySnapshot.activeLinkedInTab
}

export function getActiveLinkedInTabId(): number | null {
  return lastBridgeReadySnapshot.tabId
}

export function getActiveLinkedInTabUrl(): string {
  return lastBridgeReadySnapshot.tabUrl
}

const BRIDGE_AUTH_TIMEOUT_MS = 5_000

export type StartBridgeOptions = {
  /** When false, skip the discovery redirect listener on the default port (used by unit tests). */
  enableDiscoveryRedirect?: boolean
}

let heartbeatInterval: ReturnType<typeof setInterval> | null = null
let pongReceived = true

function clearHeartbeat(): void {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null }
}

function startHeartbeat(ws: WebSocket): void {
  clearHeartbeat()
  pongReceived = true
  heartbeatInterval = setInterval(() => {
    if (!pongReceived) {
      appLog.warn('[loa-bridge] No pong received — terminating dead connection')
      try { ws.terminate() } catch {}
      return
    }
    pongReceived = false
    try { ws.ping() } catch {}
  }, 30_000)
}

export function startBridge(port = DEFAULT_PORT, options?: StartBridgeOptions): number {
  if (primaryWss) return bridgePort

  bridgePort = port
  const enableDiscoveryRedirect = options?.enableDiscoveryRedirect !== false
  bridgeAuthToken = randomUUID()

  const attachAuthenticatedExtensionSocket = (ws: WebSocket) => {
    if (extensionSocket && extensionSocket !== ws && extensionSocket.readyState === 1) {
      try { extensionSocket.close(1000, 'Replaced by new connection') } catch (e) { appLog.debug('[bridge] close old socket failed', e instanceof Error ? e.message : String(e)) }
      drainPending('Replaced by new extension connection')
    }
    clearHeartbeat()
    extensionSocket = ws
    appLog.info('[loa-bridge] Connection authenticated')
    connectionStartTime = Date.now()
    bridgeEvents.emit('connected')

    ws.on('pong', () => { pongReceived = true })
    startHeartbeat(ws)

    ws.on('message', (buf) => {
      const raw = String(buf)
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(raw) as Record<string, unknown>
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        appLog.error('[loa-bridge] Invalid JSON from extension:', err)
        bridgeEvents.emit('invalid-message', { reason: 'json_parse', detail: err })
        return
      }
      if (msg.type === 'result') {
        const id = String(msg.id || '')
        if (!id || typeof msg.ok !== 'boolean' || typeof msg.detail !== 'string') {
          appLog.warn('[loa-bridge] Malformed result — missing id/ok/detail:', JSON.stringify(msg).slice(0, 200))
          bridgeEvents.emit('invalid-message', { reason: 'malformed_result', detail: id })
          return
        }
        const p = pending.get(id)
        if (p) {
          clearTimeout(p.timer)
          pending.delete(id)
          p.resolve({ type: 'result', id, ok: msg.ok as boolean, detail: msg.detail as string, data: msg.data })
        } else {
          appLog.warn('[loa-bridge] Orphan result (no pending command):', id)
          bridgeEvents.emit('orphan-result', { id })
        }
        return
      }
      if (msg.type === 'enrich_progress') {
        bridgeEvents.emit('enrich-progress', {
          completed: Number(msg.completed) || 0,
          total: Number(msg.total) || 0
        })
        return
      }
      if (msg.type === 'external_form_request') {
        bridgeEvents.emit('external-form-request', {
          tabId: msg.tabId as number | null,
          frameId: typeof msg.frameId === 'number' ? (msg.frameId as number) : 0,
          url: String(msg.url || ''),
          fields: msg.fields as Record<string, unknown>
        })
        return
      }
      if (msg.type === 'bridge-ready') {
        lastBridgeReadySnapshot = {
          activeLinkedInTab: !!(msg.activeLinkedInTab as boolean),
          tabId: (msg.tabId as number) ?? null,
          tabUrl: String(msg.tabUrl || '')
        }
        appLog.info(`[loa-bridge] Bridge ready — tab=${lastBridgeReadySnapshot.tabId ?? 'none'} url=${lastBridgeReadySnapshot.tabUrl.slice(0, 80)}`)
        bridgeEvents.emit('bridge-ready', msg)
      }
    })

    ws.on('close', () => {
      if (extensionSocket === ws) {
        clearHeartbeat()
        const durationSec = connectionStartTime ? Math.round((Date.now() - connectionStartTime) / 1000) : 0
        appLog.info(`[loa-bridge] Connection disconnected — pending=${pending.size} duration=${durationSec}s`)
        extensionSocket = null
        lastBridgeReadySnapshot = { activeLinkedInTab: false, tabId: null, tabUrl: '' }
        drainPending('Extension disconnected')
        bridgeEvents.emit('disconnected')
      }
    })

    try {
      ws.send(JSON.stringify({ type: 'hello', app: 'linkedin-outreach-automation', version: 1, port: bridgePort }))
    } catch (e) {
      appLog.debug('[bridge] ws hello send failed', e instanceof Error ? e.message : String(e))
    }
  }

  const pendingPrimaryConnection = (ws: WebSocket) => {
    appLog.info("[loa-bridge] Connection accepted from extension")
    let authed = false
    const authTimer = setTimeout(() => {
      if (!authed) {
        try {
          ws.close(4401, 'Bridge auth timeout')
        } catch (e) {
          appLog.debug('[bridge] auth timeout close failed', e instanceof Error ? e.message : String(e))
        }
      }
    }, BRIDGE_AUTH_TIMEOUT_MS)

    const onEarlyClose = () => {
      clearTimeout(authTimer)
    }
    ws.once('close', onEarlyClose)

    ws.once('message', (buf) => {
      clearTimeout(authTimer)
      ws.removeListener('close', onEarlyClose)
      const raw = String(buf)
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(raw) as Record<string, unknown>
      } catch (e) {
        appLog.debug('[bridge] auth message parse failed', e instanceof Error ? e.message : String(e))
        try {
          ws.close(1008, 'Expected auth message')
        } catch (e2) {
          appLog.debug('[bridge] auth reject close failed', e2 instanceof Error ? e2.message : String(e2))
        }
        return
      }
      if (msg.type !== 'auth' || typeof msg.token !== 'string' || msg.token !== bridgeAuthToken) {
        try {
          ws.close(1008, 'Bridge auth failed')
        } catch (e) {
          appLog.debug('[bridge] auth reject close failed', e instanceof Error ? e.message : String(e))
        }
        return
      }
      authed = true
      attachAuthenticatedExtensionSocket(ws)
    })
  }

  primaryWss = new WebSocketServer({ noServer: true })
  primaryWss.on('error', (err) => {
    bridgeEvents.emit('error', err)
  })
  primaryServer = http.createServer()
  primaryServer.on('upgrade', (req, socket, head) => {
    try {
      primaryWss?.handleUpgrade(req, socket, head, pendingPrimaryConnection)
    } catch (err) {
      try {
        socket.destroy()
      } catch (e) {
        appLog.debug('[bridge] socket destroy failed', e instanceof Error ? e.message : String(e))
      }
      bridgeEvents.emit('error', err)
    }
  })
  primaryServer.on('error', (err) => {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EADDRINUSE') {
      appLog.error(`[loa-bridge] Port ${bridgePort} is already in use`)
      safeClose(primaryWss); primaryWss = null
      safeClose(primaryServer); primaryServer = null
      safeClose(discoveryWss); discoveryWss = null
      safeClose(discoveryServer); discoveryServer = null

      if (bridgePort !== DEFAULT_PORT) {
        appLog.info(`[loa-bridge] Falling back: restarting bridge on default port ${DEFAULT_PORT}`)
        bridgePort = DEFAULT_PORT
        portRetryCount = 0
        setTimeout(() => startBridge(DEFAULT_PORT), 50)
      } else if (portRetryCount < MAX_PORT_RETRIES) {
        portRetryCount++
        appLog.info(`[loa-bridge] Retrying port ${DEFAULT_PORT} (attempt ${portRetryCount}/${MAX_PORT_RETRIES}) in ${PORT_RETRY_DELAY_MS}ms`)
        setTimeout(() => startBridge(DEFAULT_PORT), PORT_RETRY_DELAY_MS)
      } else {
        appLog.error(`[loa-bridge] Port ${DEFAULT_PORT} unavailable after ${MAX_PORT_RETRIES} retries — bridge disabled. Kill the process holding the port or restart the app.`)
        bridgeEvents.emit('port-unavailable', { port: DEFAULT_PORT })
      }
    } else {
      appLog.error('[loa-bridge] Primary server error:', err)
      bridgeEvents.emit('error', err)
    }
  })
  primaryServer.listen(bridgePort, '127.0.0.1', () => {
    portRetryCount = 0
    appLog.info(`[loa-bridge] Listening on 127.0.0.1:${bridgePort}`)
  })

  if (enableDiscoveryRedirect && bridgePort !== DEFAULT_PORT) {
    discoveryWss = new WebSocketServer({ noServer: true })
    discoveryWss.on('error', (err) => {
      bridgeEvents.emit('error', err)
    })
    discoveryServer = http.createServer()
    discoveryServer.on('upgrade', (req, socket, head) => {
      try {
        discoveryWss?.handleUpgrade(req, socket, head, (ws) => {
          try {
            ws.send(
              JSON.stringify({
                type: 'hello',
                app: 'linkedin-outreach-automation',
                version: 1,
                redirectPort: bridgePort
              })
            )
          } catch (e) {
            appLog.debug('[bridge] response relay failed', e instanceof Error ? e.message : String(e))
          }
          setTimeout(() => {
            try {
              ws.close()
            } catch (e) {
              appLog.debug('[bridge] ws close failed', e instanceof Error ? e.message : String(e))
            }
          }, 250)
        })
      } catch (err) {
        try {
          socket.destroy()
        } catch (e) {
          appLog.debug('[bridge] socket destroy failed', e instanceof Error ? e.message : String(e))
        }
        bridgeEvents.emit('error', err)
      }
    })
    discoveryServer.on('error', (err) => {
      bridgeEvents.emit('error', err)
    })
    discoveryServer.listen(DEFAULT_PORT, '127.0.0.1')
  }

  return bridgePort
}

function safeClose(closeable: { close(): void } | null): void {
  try { closeable?.close() } catch (e) { appLog.debug('[bridge] safeClose failed', e instanceof Error ? e.message : String(e)) }
}

export function stopBridge(): void {
  bridgeAuthToken = ''
  clearHeartbeat()
  drainPending('Bridge stopped')
  safeClose(extensionSocket)
  extensionSocket = null
  safeClose(primaryWss)
  primaryWss = null
  safeClose(primaryServer)
  primaryServer = null
  safeClose(discoveryWss)
  discoveryWss = null
  safeClose(discoveryServer)
  discoveryServer = null
}

export function sendCommand(
  action: string,
  payload?: Record<string, unknown>,
  timeoutMs = 120_000
): Promise<BridgeResultMsg> {
  return new Promise((resolve, reject) => {
    if (!extensionSocket || extensionSocket.readyState !== 1) {
      reject(new Error('Extension not connected — load the bridge extension and open LinkedIn.'))
      return
    }
    const id = randomUUID()
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Command timeout: ${action}`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    try {
      if (!extensionSocket || extensionSocket.readyState !== 1) {
        clearTimeout(timer)
        pending.delete(id)
        reject(new Error('Extension disconnected before send.'))
        return
      }
      extensionSocket.send(JSON.stringify({ type: 'command', id, action, payload: payload ?? {} }))
    } catch (e) {
      clearTimeout(timer)
      pending.delete(id)
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

/**
 * sendCommand with OpenHarness-style centralized transport retry.
 * Retries on timeouts and transient socket errors; does NOT retry
 * "Extension not connected" (the extension is gone, retrying won't help).
 */
export function sendCommandWithRetry(
  action: string,
  payload?: Record<string, unknown>,
  timeoutMs = 120_000,
  maxRetries = 2
): Promise<BridgeResultMsg> {
  return withRetry(
    () => sendCommand(action, payload, timeoutMs),
    {
      maxRetries,
      baseDelayMs: 1500,
      maxDelayMs: 8000,
      isRetryable: (e) => {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('not connected') || msg.includes('disconnected')) return false
        return msg.includes('timeout') || msg.includes('ECONNRESET') || msg.includes('socket')
      },
      onRetry: (attempt, error, delay) => {
        appLog.warn(`[bridge] retrying ${action} (attempt ${attempt}, delay ${Math.round(delay)}ms)`, error)
      }
    }
  )
}
