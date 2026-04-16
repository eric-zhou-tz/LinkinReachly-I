import { app, type Session, type WebContents } from 'electron'
import { appLog } from './app-log'

const ALLOWED_DEV_RENDERER_PROTOCOLS = new Set(['http:'])
const ALLOWED_DEV_RENDERER_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function buildCSP(): string {
  const isDev = !app.isPackaged
  const connectSrc = [
    "'self'",
    'http://127.0.0.1:*',
    'http://localhost:*',
    'ws://127.0.0.1:*',
    'ws://localhost:*',
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://www.googleapis.com',
    'https://*.firebaseapp.com',
    'https://*.cloudfunctions.net'
  ].join(' ')
  const scriptSrc = isDev ? "'self' 'unsafe-inline'" : "'self'"
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: file:",
    `connect-src ${connectSrc}`
  ].join('; ')
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

export function parseAllowedRendererDevUrl(url: string | undefined): string | null {
  const raw = String(url || '').trim()
  if (!raw) return null

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch (e) {
    appLog.debug('[electron-security] parseAllowedRendererDevUrl invalid URL', e instanceof Error ? e.message : String(e))
    return null
  }

  if (!ALLOWED_DEV_RENDERER_PROTOCOLS.has(parsed.protocol)) return null
  if (!ALLOWED_DEV_RENDERER_HOSTS.has(normalizeHostname(parsed.hostname))) return null
  return parsed.toString()
}

const FIREBASE_AUTH_ORIGINS = [
  'https://accounts.google.com',
  'https://www.googleapis.com',
]

function isFirebaseAuthOrigin(origin: string): boolean {
  return FIREBASE_AUTH_ORIGINS.some((ao) => origin.startsWith(ao)) ||
    /^https:\/\/[a-z0-9-]+\.firebaseapp\.com$/.test(origin)
}

export function hardenSession(targetSession: Session): void {
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    headers['Content-Security-Policy'] = [buildCSP()]
    callback({ responseHeaders: headers })
  })

  targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const url = webContents?.getURL() || ''
    try {
      const origin = new URL(url).origin
      if (isFirebaseAuthOrigin(origin)) {
        callback(true)
        return
      }
    } catch { /* invalid URL — deny */ }
    callback(false)
  })
  targetSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (isFirebaseAuthOrigin(requestingOrigin)) return true
    return false
  })
}

export function hardenWebContents(contents: WebContents): void {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

export function registerElectronSecurityHooks(): void {
  app.on('session-created', hardenSession)
  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents)
  })
}
