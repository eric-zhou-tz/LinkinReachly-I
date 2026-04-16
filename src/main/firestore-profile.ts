// ---------------------------------------------------------------------------
// firestore-profile.ts — Sync UserProfile to/from Firestore via Cloud Functions.
// Best-effort: errors are logged, never thrown to callers.
// ---------------------------------------------------------------------------

import type { UserProfile } from '@core/profile-db'
import { getAuthHeaders, isAuthenticated } from './auth-service'
import { getServiceConfig } from './service-config'
import { appLog } from './app-log'

/**
 * Save the user's structured profile to Firestore via Cloud Function.
 * Fire-and-forget — errors are logged but don't propagate.
 */
export async function syncProfileToFirestore(profile: UserProfile): Promise<void> {
  const config = getServiceConfig()
  if (!config.cloudFunctions.url || !isAuthenticated()) return

  const url = `${config.cloudFunctions.url}/saveProfile`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ profile }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`)
      appLog.warn('[firestore-profile] save failed', { status: res.status, detail: text.slice(0, 200) })
      return
    }
    appLog.info('[firestore-profile] profile synced to Firestore')
  } catch (err) {
    appLog.warn('[firestore-profile] save error', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Load the user's profile from Firestore (for cross-device restore).
 * Returns null if unavailable or on any error.
 */
export async function loadProfileFromFirestore(): Promise<UserProfile | null> {
  const config = getServiceConfig()
  if (!config.cloudFunctions.url || !isAuthenticated()) return null

  const url = `${config.cloudFunctions.url}/getProfile`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { profile?: UserProfile | null }
    return data.profile ?? null
  } catch (err) {
    appLog.debug('[firestore-profile] load error', err instanceof Error ? err.message : String(err))
    return null
  }
}
