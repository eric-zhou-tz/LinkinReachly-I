import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { defaultLoaHttpPortForPackaging } from '@core/runtime-ports'
import { appLog, readRuntimeLogTailLines } from './app-log'
import { getBridgeAuthToken } from './bridge'

/**
 * Deliberate allowlist for channels exposed via the loopback HTTP bridge.
 * New IPC channels are NOT HTTP-reachable until explicitly added here.
 */
const HTTP_ALLOWED_CHANNELS = new Set([
  'account:delete',
  'account:restorePurchases',
  'ai:generateFields',
  'applicant:get',
  'applicant:promoteScreeningAnswers',
  'applicant:remove-cover-letter',
  'applicant:remove-resume',
  'applicant:save',
  'applicant:upload-cover-letter',
  'applicant:upload-resume',
  'application:detect',
  'application:easyApply',
  'application:extensionHealth',
  'application:history',
  'application:history:delete',
  'application:history:exportCsv',
  'application:outreach:candidates',
  'application:outreach:markSent',
  'application:outreach:run',
  'application:outreach:runChain',
  'application:outreach:searchHiringManager',
  'application:outreach:skip',
  'application:queue:add',
  'application:queue:clear',
  'application:queue:remove',
  'application:queue:retry',
  'application:queue:skip',
  'application:queue:start',
  'application:queue:state',
  'application:queue:stop',
  'application:record',
  'application:save',
  'application:status',
  'application:update',
  'auth:getServiceConfig',
  'auth:getUser',
  'auth:googleSignIn',
  'auth:register',
  'auth:setToken',
  'backup:export',
  'backup:import',
  'bridge:ping',
  'bridge:reloadExtension',
  'bridge:reloadTab',
  'bridge:status',
  'cache:clearAll',
  'campaign:active',
  'campaign:archive',
  'campaign:create',
  'campaign:markSent',
  'campaign:resume',
  'compose:preview',
  'feedback:submit',
  'followup:archive',
  'followup:cancelQueued',
  'followup:clearAccepts',
  'followup:detectNow',
  'followup:markReplied',
  'followup:newAccepts',
  'followup:pendingQueue',
  'followup:sendDm',
  'followup:state',
  'jobs:cancelSearch',
  'jobs:loadMoreJobListings',
  'jobs:progressState',
  'jobs:screen',
  'jobs:search',
  'jobs:smartScreen',
  'jobs:smartSearch',
  'llm:testKey',
  'logs:clear',
  'logs:export',
  'logs:recent',
  'logs:runtime:tail',
  'mission:plan',
  'plan:canAct',
  'plan:createCheckout',
  'plan:devOverride',
  'plan:getCounters',
  'plan:getState',
  'profile:get',
  'profile:mine',
  'profile:parse',
  'profile:save',
  'prospects:collectFromPlan',
  'queue:start',
  'queue:state',
  'queue:stop',
  'resume:clear',
  'resume:importData',
  'resume:importPath',
  'resume:tailor',
  'resume:upload',
  'session:token',
  'settings:get',
  'settings:save',
  'settings:saveBundle',
  'settings:setApiKey',
  'shell:openExtensionFolder',
  'shell:openExternal',
  'shell:openLogsFolder',
  'shell:openUserData',
  'survey:canShow',
  'survey:submit',
  'telemetry:firstExtensionConnect',
  'telemetry:firstJobSearch',
  'telemetry:onboarding',
  'telemetry:track',
  'updater:checkForUpdates',
  'updater:quitAndInstall',
])
const MAX_HTTP_INVOKE_PAYLOAD_BYTES = 1_000_000

const sessionToken = randomUUID()
let lastBridgeTokenRequestMs = 0
const LOA_HTTP_PORT = defaultLoaHttpPortForPackaging(app.isPackaged)

export function getSessionToken(): string {
  return sessionToken
}

function isAllowedOrigin(origin: string): boolean {
  if (!origin || origin === 'null') return false
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

function isDisconnectError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED' || code === 'ECONNRESET' || code === 'ERR_STREAM_PREMATURE_CLOSE'
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.socket?.destroyed) return
  try {
    const raw = JSON.stringify(body)
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Length', Buffer.byteLength(raw))
    res.end(raw)
  } catch (err) {
    if (isDisconnectError(err)) return
    appLog.warn('[loa] HTTP sendJson error', err)
  }
}

function sendEmpty(res: http.ServerResponse, status: number): void {
  if (res.writableEnded || res.socket?.destroyed) return
  try {
    res.statusCode = status
    res.end()
  } catch (err) {
    if (isDisconnectError(err)) return
    appLog.warn('[loa] HTTP sendEmpty error', err)
  }
}

/**
 * Lets any local UI (Electron window, Vite tab in Chrome, etc.) call the same backend as preload IPC.
 * Listens only on 127.0.0.1. Bearer token required for /invoke.
 * Resolves once the port is accepting connections (avoids renderer race on startup).
 */
export function startLoaHttpBridge(
  invoke: (channel: string, payload: unknown) => Promise<unknown>
): Promise<http.Server | null> {
  const server = http.createServer(async (req, res) => {
    // Suppress EPIPE / socket errors when the client disconnects mid-request
    res.on('error', (err) => {
      if (isDisconnectError(err)) return
      appLog.warn('[loa] HTTP response error', err)
    })
    let requestAborted = false
    req.on('aborted', () => {
      requestAborted = true
    })
    req.on('error', (err) => {
      if (isDisconnectError(err)) return
      appLog.warn('[loa] HTTP request error', err)
    })

    const origin = req.headers.origin || ''
    const allowedOrigin = isAllowedOrigin(origin) ? origin : ''

    res.setHeader('Access-Control-Allow-Origin', allowedOrigin || 'null')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    res.setHeader('Vary', 'Origin')

    if (req.method === 'OPTIONS') {
      sendEmpty(res, 204)
      return
    }

    const url = req.url || ''
    if (origin && !isAllowedOrigin(origin)) {
      sendJson(res, 403, { error: 'origin not allowed' })
      return
    }

    if (url === '/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true })
      return
    }

    if (url === '/session-token' && req.method === 'GET') {
      if (app.isPackaged) {
        sendJson(res, 403, { error: 'not available in production' })
        return
      }
      sendJson(res, 200, { token: sessionToken })
      return
    }

    if (url === '/bridge-token' && req.method === 'GET') {
      const now = Date.now()
      if (now - lastBridgeTokenRequestMs < 2000) {
        sendJson(res, 429, { error: 'rate limited' })
        return
      }
      lastBridgeTokenRequestMs = now
      const token = getBridgeAuthToken()
      if (!token) {
        sendJson(res, 503, { error: 'bridge not ready' })
        return
      }
      sendJson(res, 200, { token })
      return
    }

    if (req.method === 'GET' && url.startsWith('/runtime-log-tail')) {
      const authHeader = req.headers.authorization || ''
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
      if (bearerToken !== sessionToken) {
        sendJson(res, 401, { error: 'unauthorized' })
        return
      }
      let maxLines = 400
      try {
        const q = new URL(url, 'http://127.0.0.1').searchParams.get('maxLines')
        if (q != null && q !== '') {
          const n = Math.floor(Number(q))
          if (Number.isFinite(n)) maxLines = n
        }
      } catch (e) {
        appLog.warn('[loa-http] maxLines URL param parse failed, using default', e instanceof Error ? e.message : String(e))
      }
      sendJson(res, 200, { ok: true, lines: readRuntimeLogTailLines(maxLines) })
      return
    }

    if (url !== '/invoke' || req.method !== 'POST') {
      sendEmpty(res, 404)
      return
    }

    const authHeader = req.headers.authorization || ''
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    const hasValidToken = bearerToken === sessionToken

    if (!hasValidToken) {
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }

    let raw = ''
    let rawBytes = 0
    try {
      for await (const chunk of req) {
        if (requestAborted) return
        const chunkText = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
        rawBytes += Buffer.byteLength(chunkText)
        if (rawBytes > MAX_HTTP_INVOKE_PAYLOAD_BYTES) {
          sendJson(res, 413, { error: 'payload too large' })
          return
        }
        raw += chunkText
      }
      if (requestAborted) return
      const parsed = JSON.parse(raw || '{}') as { channel?: string; payload?: unknown }
      const channel = typeof parsed.channel === 'string' ? parsed.channel : ''
      if (!channel) {
        sendJson(res, 400, { error: 'missing channel' })
        return
      }
      if (!HTTP_ALLOWED_CHANNELS.has(channel)) {
        sendJson(res, 403, { error: 'channel not available over HTTP' })
        return
      }
      const result = await invoke(channel, parsed.payload)
      sendJson(res, 200, { result })
    } catch (e) {
      if (requestAborted || isDisconnectError(e)) return
      const msg = e instanceof Error ? e.message : String(e)
      sendJson(res, 500, { error: msg })
    }
  })

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 1500

  return new Promise((resolve) => {
    let settled = false
    let retryCount = 0

    function tryListen(): void {
      server.once('error', onError)
      server.listen(LOA_HTTP_PORT, '127.0.0.1', () => {
        if (settled) return
        settled = true
        server.removeListener('error', onError)
        appLog.info(`[loa] Local HTTP API http://127.0.0.1:${LOA_HTTP_PORT} (browser or second UI)`)
        server.on('error', (err) => {
          appLog.warn('[loa] Local HTTP API error', err)
        })
        resolve(server)
      })
    }

    function onError(err: Error): void {
      if (settled) {
        appLog.warn('[loa] Local HTTP API error', err)
        return
      }
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EADDRINUSE' && retryCount < MAX_RETRIES) {
        retryCount++
        appLog.warn(`[loa] Port ${LOA_HTTP_PORT} in use, retrying (${retryCount}/${MAX_RETRIES}) in ${RETRY_DELAY_MS}ms`)
        setTimeout(tryListen, RETRY_DELAY_MS)
        return
      }
      settled = true
      appLog.warn('[loa] Local HTTP API failed to start', err)
      resolve(null)
    }

    tryListen()
  })
}
