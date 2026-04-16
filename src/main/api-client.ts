// ---------------------------------------------------------------------------
// api-client.ts — Unified API client for LinkinReachly.
// User profile, usage, counters, and account lifecycle go through Firebase
// Cloud Functions (Admin SDK). Stripe checkout + LLM proxy use other CFs.
// Falls back gracefully when backend is not configured (local-only mode).
// ---------------------------------------------------------------------------

import { getAuthHeaders, isAuthenticated, getFirebaseToken, updatePlanState } from './auth-service'
import { getServiceConfig, isBackendConfigured } from './service-config'
import { appLog } from './app-log'
type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function cloudFunctionCall<T>(
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
  options?: { requireAuth?: boolean }
): Promise<ApiResult<T>> {
  const requireAuth = options?.requireAuth !== false
  const config = getServiceConfig()
  if (!config.cloudFunctions.url) {
    return { ok: false, error: 'Cloud Functions not configured' }
  }
  if (requireAuth && !isAuthenticated()) {
    return { ok: false, error: 'Not authenticated' }
  }

  const url = `${config.cloudFunctions.url}${path}`
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    }
    const init: RequestInit = { method, headers }
    if (body && method === 'POST') {
      init.body = JSON.stringify(body)
    }
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`)
      appLog.warn('[api] cloud function call failed', { path, status: res.status, detail: text.slice(0, 200) })
      return { ok: false, error: text.slice(0, 200) }
    }
    const data = (await res.json()) as T
    return { ok: true, data }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    appLog.warn('[api] cloud function error', { path, error: msg })
    return { ok: false, error: msg }
  }
}

function applyUserMeToPlanState(data: UserMeResponse): void {
  updatePlanState({
    userId: data.firebase_uid,
    plan: data.plan,
    creditBalance: data.credit_balance,
    trialStartedAt: data.plan_started_at,
  })
}

// -- Auth / profile (Cloud Functions) --------------------------------------

export interface UserMeResponse {
  id: string
  firebase_uid: string
  email: string | null
  plan: 'free' | 'plus'
  plan_started_at: string | null
  credit_balance: number
  linkedin_profile_url: string | null
  created_at: string
}

function normalizeUserMePayload(raw: Record<string, unknown>, fallbackUid: string): UserMeResponse {
  const firebaseUid = typeof raw.firebase_uid === 'string' ? raw.firebase_uid : fallbackUid
  return {
    id: firebaseUid,
    firebase_uid: firebaseUid,
    email: typeof raw.email === 'string' || raw.email === null ? (raw.email as string | null) : null,
    plan: raw.plan === 'plus' || raw.plan === 'free' ? raw.plan : 'free',
    plan_started_at: typeof raw.plan_started_at === 'string' ? raw.plan_started_at : null,
    credit_balance: typeof raw.credit_balance === 'number' && Number.isFinite(raw.credit_balance) ? raw.credit_balance : 0,
    linkedin_profile_url:
      typeof raw.linkedin_profile_url === 'string' || raw.linkedin_profile_url === null
        ? (raw.linkedin_profile_url as string | null)
        : null,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
  }
}

export function decodeTokenPayload(token: string): { uid: string | null; email: string | null } {
  try {
    const payload = token.split('.')[1]
    if (!payload) return { uid: null, email: null }
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return {
      uid: decoded.user_id || decoded.sub || null,
      email: decoded.email || null,
    }
  } catch {
    return { uid: null, email: null }
  }
}

export async function registerUser(): Promise<ApiResult<UserMeResponse>> {
  return getUserMe()
}

export async function getUserMe(): Promise<ApiResult<UserMeResponse>> {
  if (!isBackendConfigured() || !isAuthenticated()) {
    return { ok: false, error: 'Not configured or not authenticated' }
  }
  const token = getFirebaseToken()
  if (!token) return { ok: false, error: 'No auth token' }
  const { uid } = decodeTokenPayload(token)
  if (!uid) return { ok: false, error: 'Could not extract UID' }

  const result = await cloudFunctionCall<Record<string, unknown>>('/getUserMe', 'POST')
  if (!result.ok) return result

  const data = normalizeUserMePayload(result.data, uid)
  applyUserMeToPlanState(data)
  return { ok: true, data }
}

export async function activateTrialOnExtensionConnect(): Promise<ApiResult<{ activated: boolean }>> {
  if (!isBackendConfigured() || !isAuthenticated()) {
    return { ok: false, error: 'Not configured or not authenticated' }
  }
  const result = await cloudFunctionCall<{ activated: boolean; plan?: string; plan_started_at?: string }>('/activateTrial', 'POST')
  if (!result.ok) return result
  if (result.data.activated && result.data.plan_started_at) {
    updatePlanState({ plan: 'plus', trialStartedAt: result.data.plan_started_at })
  }
  return { ok: true, data: { activated: result.data.activated } }
}

// -- Usage (Cloud Functions) ------------------------------------------------

export interface CanActResult {
  allowed: boolean
  reason?: string
  useCredit?: boolean
  used?: number
  limit?: number
}

let _serverApplyUsed = 0
let _serverOutreachUsed = 0
let _serverUsageFetchedAt = 0

export function getServerUsage(): { applyUsed: number; outreachUsed: number; fetchedAt: number } {
  return { applyUsed: _serverApplyUsed, outreachUsed: _serverOutreachUsed, fetchedAt: _serverUsageFetchedAt }
}

export async function checkCanAct(
  actionType: 'apply' | 'outreach'
): Promise<ApiResult<CanActResult>> {
  if (!isBackendConfigured() || !isAuthenticated()) {
    return { ok: true, data: { allowed: true } }
  }
  const result = await cloudFunctionCall<CanActResult>('/checkCanAct', 'POST', { actionType })
  if (!result.ok) {
    appLog.warn('[api] checkCanAct error, allowing', result.error)
    return { ok: true, data: { allowed: true } }
  }
  if (typeof result.data.used === 'number') {
    if (actionType === 'apply') _serverApplyUsed = result.data.used
    else _serverOutreachUsed = result.data.used
    _serverUsageFetchedAt = Date.now()
  }
  return { ok: true, data: result.data }
}

export async function syncServerUsage(): Promise<void> {
  if (!isBackendConfigured() || !isAuthenticated()) return
  await Promise.all([
    checkCanAct('apply'),
    checkCanAct('outreach'),
  ])
}

export async function incrementUsage(
  actionType: 'apply' | 'outreach',
  useCredit = false
): Promise<ApiResult<{ success: boolean; creditBalance?: number }>> {
  if (!isBackendConfigured() || !isAuthenticated()) {
    return { ok: true, data: { success: true } }
  }
  const result = await cloudFunctionCall<{ success: boolean; creditBalance?: number }>(
    '/recordUsage',
    'POST',
    { actionType, useCredit }
  )
  if (!result.ok) {
    appLog.warn('[api] incrementUsage error', result.error)
    return { ok: false, error: result.error }
  }
  if (typeof result.data.creditBalance === 'number') {
    updatePlanState({ creditBalance: result.data.creditBalance })
  }
  return { ok: true, data: result.data }
}

// -- Counters (public Cloud Function) --------------------------------------

interface CountersResponse {
  total_applications: number
  total_outreach: number
  total_users: number
}

export async function getCounters(): Promise<ApiResult<CountersResponse>> {
  const result = await cloudFunctionCall<CountersResponse>('/getCounters', 'GET', undefined, {
    requireAuth: false,
  })
  if (!result.ok) return result
  return { ok: true, data: result.data }
}

export async function trackOnboardingServer(
  step: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await cloudFunctionCall('/trackOnboarding', 'POST', { step, meta, timestamp: new Date().toISOString() }, { requireAuth: false }).catch(() => {})
}

/**
 * Global totals are incremented server-side by `recordUsage`. This stub avoids
 * double-counting with telemetry (`trackApplicationSent` / `trackOutreachSent`).
 */
export async function incrementCounter(
  _key: 'total_applications' | 'total_outreach' | 'total_users'
): Promise<void> {
  void _key
}

// -- Checkout (Firebase Cloud Function) ------------------------------------

interface CheckoutSessionResponse {
  url: string
  session_id: string
}

export async function deleteAccount(): Promise<ApiResult<{ success: boolean }>> {
  if (!isBackendConfigured() || !isAuthenticated()) {
    return { ok: false, error: 'Not configured or not authenticated' }
  }
  return cloudFunctionCall<{ success: boolean }>('/deleteAccount', 'POST')
}

export async function restorePurchases(): Promise<ApiResult<UserMeResponse>> {
  return getUserMe()
}

export async function createCheckoutSession(
  product: 'plus' | 'boost' | 'bundle' | 'blitz'
): Promise<ApiResult<CheckoutSessionResponse>> {
  return cloudFunctionCall<CheckoutSessionResponse>('/createCheckoutSession', 'POST', { product })
}

// -- Feedback collection (local + best-effort Cloud Function) -----------------

async function retryCloudCall(path: string, payload: Record<string, unknown>, maxRetries = 2): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await cloudFunctionCall(path, 'POST', payload).catch(() => ({ ok: false as const, error: 'network' }))
    if (result.ok) return
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)))
    }
  }
}

export async function submitFeedbackServer(
  payload: Record<string, unknown>,
): Promise<void> {
  await retryCloudCall('/submitFeedback', payload).catch(() => {})
}

export async function submitSurveyServer(
  payload: Record<string, unknown>,
): Promise<void> {
  await retryCloudCall('/submitSurvey', payload).catch(() => {})
}
