import { shell } from 'electron'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { appLog } from './app-log'
import { getServiceConfig } from './service-config'

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const PREFERRED_GOOGLE_AUTH_PORT = 19520
const GOOGLE_AUTH_FALLBACK_PORTS = [19521, 19522, 19523, 19524, 0]

function isDisconnectError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED' || code === 'ECONNRESET' || code === 'ERR_STREAM_PREMATURE_CLOSE'
}

function safeHtmlResponse(
  res: http.ServerResponse,
  status: number,
  html: string,
  headers: Record<string, string> = { 'Content-Type': 'text/html' }
): void {
  if (res.writableEnded || res.socket?.destroyed) return
  try {
    res.writeHead(status, headers)
    res.end(html)
  } catch (err) {
    if (isDisconnectError(err)) return
    appLog.warn('[google-auth] HTTP response error', err)
  }
}

/**
 * Google OAuth flow for Electron.
 *
 * signInWithPopup fails in Electron because Google blocks embedded Chromium
 * from completing OAuth (and BroadcastChannel cross-window messaging breaks
 * under context isolation + sandbox).
 *
 * This flow:
 * 1. Starts a temporary HTTP server on localhost for the OAuth callback
 * 2. Opens Google OAuth consent in the user's default browser
 * 3. Google redirects back to localhost with an auth code
 * 4. Exchanges the code for an ID token via the Google token endpoint
 * 5. Returns the token to the renderer, which uses signInWithCredential
 */
export async function googleSignInViaWindow(): Promise<
  { ok: true; idToken: string; accessToken: string } | { ok: false; error: string }
> {
  const config = getServiceConfig()
  const { apiKey, authDomain } = config.firebase

  if (!apiKey || !authDomain) {
    return { ok: false, error: 'Firebase not configured' }
  }

  const creds = await getGoogleOAuthCredentials(apiKey)
  if (!creds) {
    return { ok: false, error: 'Google sign-in is not configured. Set LR_GOOGLE_OAUTH_CLIENT_ID and LR_GOOGLE_OAUTH_CLIENT_SECRET, or enable Google as a sign-in provider in the Firebase Console.' }
  }
  const { clientId, clientSecret } = creds
  const oauthState = randomUUID()

  return new Promise((resolve) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const clearAuthTimeout = () => {
      if (!timeoutId) return
      clearTimeout(timeoutId)
      timeoutId = null
    }
    const finish = (result: { ok: true; idToken: string; accessToken: string } | { ok: false; error: string }) => {
      if (settled) return
      settled = true
      clearAuthTimeout()
      resolve(result)
    }

    const server = http.createServer(async (req, res) => {
      res.on('error', (err) => {
        if (isDisconnectError(err)) return
        appLog.warn('[google-auth] Response stream error', err)
      })
      const url = new URL(req.url || '/', `http://localhost`)
      if (url.pathname !== '/callback') {
        safeHtmlResponse(res, 404, '')
        return
      }

      const code = url.searchParams.get('code')
      const callbackState = url.searchParams.get('state')
      const error = url.searchParams.get('error')
      if (!callbackState || callbackState !== oauthState) {
        safeHtmlResponse(res, 400, '<html><body><h2>Invalid sign-in state</h2><p>Close this tab and try again.</p></body></html>')
        server.close()
        finish({ ok: false, error: 'Google sign-in state mismatch. Please try again.' })
        return
      }

      if (error) {
        safeHtmlResponse(res, 200, '<html><body><h2>Sign-in cancelled</h2><p>You can close this window.</p><script>window.close()</script></body></html>')
        server.close()
        finish({ ok: false, error: `Google sign-in was cancelled: ${error}` })
        return
      }

      if (!code) {
        safeHtmlResponse(res, 400, '<html><body><h2>Missing auth code</h2></body></html>')
        server.close()
        finish({ ok: false, error: 'No authorization code received from Google' })
        return
      }

      try {
        const addr = server.address() as { port: number }
        const redirectUri = `http://localhost:${addr.port}/callback`

        const tokenParams: Record<string, string> = {
          code,
          client_id: clientId,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }
        if (clientSecret) tokenParams.client_secret = clientSecret
        const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(tokenParams).toString(),
        })

        const tokenData = await tokenRes.json() as {
          id_token?: string
          access_token?: string
          error?: string
          error_description?: string
        }

        if (tokenData.error || !tokenData.id_token) {
          safeHtmlResponse(res, 200, '<html><body><h2>Sign-in didn\u2019t complete</h2><p>Close this tab and try again.</p><script>window.close()</script></body></html>')
          server.close()
          finish({ ok: false, error: tokenData.error_description || tokenData.error || 'Sign-in didn\u2019t complete' })
          return
        }

        safeHtmlResponse(res, 200, '<html><body><h2>Sign-in successful!</h2><p>You can close this window and return to LinkinReachly.</p><script>window.close()</script></body></html>')
        server.close()
        finish({ ok: true, idToken: tokenData.id_token, accessToken: tokenData.access_token || '' })
      } catch (err) {
        safeHtmlResponse(res, 500, '<html><body><h2>Sign-in error</h2><p>Close this tab and try again.</p></body></html>')
        server.close()
        finish({ ok: false, error: `Sign-in didn\u2019t complete: ${err instanceof Error ? err.message : String(err)}` })
      }
    })

    const tryListen = async (): Promise<number> => {
      const candidates = [PREFERRED_GOOGLE_AUTH_PORT, ...GOOGLE_AUTH_FALLBACK_PORTS]
      for (const candidate of candidates) {
        try {
          await new Promise<void>((resolveListen, rejectListen) => {
            const onError = (err: Error) => {
              server.removeListener('error', onError)
              rejectListen(err)
            }
            server.once('error', onError)
            server.listen(candidate, '127.0.0.1', () => {
              server.removeListener('error', onError)
              resolveListen()
            })
          })
          const addr = server.address()
          if (typeof addr === 'object' && addr?.port) return addr.port
          throw new Error('OAuth callback server did not return a bound port')
        } catch (err) {
          const code = (err as NodeJS.ErrnoException | undefined)?.code
          if (code === 'EADDRINUSE') continue
          throw err
        }
      }
      throw new Error('No available localhost port for Google OAuth callback')
    }

    void (async () => {
      try {
        const callbackPort = await tryListen()
        const redirectUri = `http://localhost:${callbackPort}/callback`

        const authUrl = `${GOOGLE_AUTH_ENDPOINT}?` + new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'openid email profile',
          prompt: 'select_account',
          access_type: 'offline',
          state: oauthState,
        }).toString()

        appLog.info('[google-auth] Opening system browser for Google sign-in', { port: callbackPort })
        shell.openExternal(authUrl).catch((err) => {
          server.close()
          finish({ ok: false, error: `Couldn\u2019t open the browser: ${err.message}` })
        })

        timeoutId = setTimeout(() => {
          server.close()
          finish({ ok: false, error: 'Google sign-in timed out. Try again.' })
        }, 120_000)
      } catch (err) {
        finish({ ok: false, error: `Couldn\u2019t start sign-in: ${err instanceof Error ? err.message : String(err)}` })
      }
    })()

    server.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException | undefined)?.code
      if (!server.listening && code === 'EADDRINUSE') return
      if (!settled && !server.listening) {
        finish({ ok: false, error: `Couldn\u2019t start sign-in: ${err.message}` })
        return
      }
      appLog.warn('[google-auth] OAuth callback server error', err)
    })
  })
}

interface GoogleOAuthCredentials {
  clientId: string
  clientSecret: string
}

let _cachedCredentials: GoogleOAuthCredentials | null = null

async function getGoogleOAuthCredentials(apiKey: string): Promise<GoogleOAuthCredentials | null> {
  if (_cachedCredentials) return _cachedCredentials

  // 1. Check env vars first (recommended for Electron desktop apps)
  const envClientId = process.env.LR_GOOGLE_OAUTH_CLIENT_ID?.trim()
  const envClientSecret = process.env.LR_GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  if (envClientId && envClientSecret) {
    _cachedCredentials = { clientId: envClientId, clientSecret: envClientSecret }
    return _cachedCredentials
  }

  // 2. Try the v3 getProjectConfig API (works for some Firebase projects)
  try {
    const res = await fetch(
      `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${apiKey}`
    )
    const data = await res.json() as { idpConfig?: Array<{ provider: string; clientId?: string; clientSecret?: string }> }
    const googleIdp = data.idpConfig?.find((c) => c.provider === 'google.com')
    if (googleIdp?.clientId) {
      _cachedCredentials = { clientId: googleIdp.clientId, clientSecret: googleIdp.clientSecret || '' }
      return _cachedCredentials
    }
  } catch (e) {
    appLog.debug('[google-auth] v3 getProjectConfig failed', e instanceof Error ? e.message : String(e))
  }

  // 3. Try the public Firebase Auth handler (requires Firebase Hosting deployed)
  try {
    const config = getServiceConfig()
    const res = await fetch(`https://${config.firebase.authDomain}/__/firebase/init.json`)
    if (res.ok) {
      const data = await res.json() as { authDomain?: string; [key: string]: unknown }
      // Parse google client ID from the firebase config
      const cfg = data as Record<string, unknown>
      if (typeof cfg.google === 'object' && cfg.google && 'clientId' in cfg.google) {
        const g = cfg.google as { clientId?: string }
        if (g.clientId) {
          _cachedCredentials = { clientId: g.clientId, clientSecret: '' }
          return _cachedCredentials
        }
      }
    }
  } catch (e) {
    appLog.debug('[google-auth] Firebase Hosting init.json failed', e instanceof Error ? e.message : String(e))
  }

  return null
}
