// ---------------------------------------------------------------------------
// firestore-client.ts — Direct Firestore data layer for LinkinReachly.
// Replaces Supabase api-client.ts. Uses Firebase client SDK with the user's
// auth token for access control (enforced by Firestore security rules).
// ---------------------------------------------------------------------------

import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  increment,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore'
import { getAuth, signInWithCustomToken, signInWithCredential, GoogleAuthProvider } from 'firebase/auth'
import { appLog } from './app-log'
import { updatePlanState } from './auth-service'
import { PLAN_LIMITS, TRIAL_DAYS, type UserPlan } from '@core/plan-config'

let app: FirebaseApp | null = null
let db: Firestore | null = null

export function initFirestore(config: {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}): void {
  if (db) return
  if (!config.apiKey) return
  app = initializeApp(config, 'main-firestore')
  db = getFirestore(app)
  appLog.info('[firestore] initialized', { projectId: config.projectId })
}

function getDb(): Firestore {
  if (!db) throw new Error('Firestore not initialized')
  return db
}

function isConfigured(): boolean {
  return !!db
}

export async function authenticateFirestore(customToken: string): Promise<void> {
  if (!app) return
  const auth = getAuth(app)
  await signInWithCustomToken(auth, customToken)
  appLog.info('[firestore] authenticated main-process Firebase app via custom token')
}

export async function authenticateFirestoreWithGoogle(googleIdToken: string, googleAccessToken?: string): Promise<void> {
  if (!app) return
  const auth = getAuth(app)
  const credential = GoogleAuthProvider.credential(googleIdToken, googleAccessToken || undefined)
  await signInWithCredential(auth, credential)
  appLog.info('[firestore] authenticated main-process Firebase app via Google credential')
}

// -- User registration / profile -------------------------------------------

export interface FirestoreUser {
  firebase_uid: string
  email: string | null
  plan: UserPlan
  plan_started_at: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  credit_balance: number
  linkedin_profile_url: string | null
  created_at: string
}

export async function ensureUserExists(uid: string, email: string | null): Promise<FirestoreUser> {
  const firestore = getDb()
  const ref = doc(firestore, 'users', uid)
  const snap = await getDoc(ref)

  if (snap.exists()) {
    const data = snap.data() as FirestoreUser
    if (email && !data.email) {
      await updateDoc(ref, { email }).catch(() => {})
      data.email = email
    }
    return checkTrialExpiry(ref, data)
  }

  const newUser: FirestoreUser = {
    firebase_uid: uid,
    email,
    plan: 'free',
    plan_started_at: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    credit_balance: 0,
    linkedin_profile_url: null,
    created_at: new Date().toISOString(),
  }
  await setDoc(ref, newUser)

  void incrementCounterField('total_users')
  appLog.info(`[firestore] new user created (trial deferred until extension connect)`, { uid })

  updatePlanState({
    userId: uid,
    plan: 'free',
    creditBalance: 0,
    trialStartedAt: null,
  })

  return newUser
}

async function checkTrialExpiry(
  ref: ReturnType<typeof doc>,
  user: FirestoreUser
): Promise<FirestoreUser> {
  if (user.plan === 'plus' && user.plan_started_at && !user.stripe_subscription_id) {
    const daysSince = (Date.now() - new Date(user.plan_started_at).getTime()) / 86_400_000
    if (daysSince > TRIAL_DAYS) {
      await updateDoc(ref, { plan: 'free' })
      user.plan = 'free'
      appLog.info('[firestore] trial expired, downgraded to free', { uid: user.firebase_uid })
    }
  }
  return user
}

/**
 * Activate the Plus trial when the user first connects the Chrome extension.
 * No-op if the user already has an active subscription or trial.
 */
export async function activateTrial(uid: string): Promise<{ activated: boolean }> {
  if (!isConfigured()) return { activated: false }
  try {
    const ref = doc(getDb(), 'users', uid)
    const snap = await getDoc(ref)
    if (!snap.exists()) return { activated: false }
    const user = snap.data() as FirestoreUser
    // Already has a subscription or already trialing — skip
    if (user.stripe_subscription_id || (user.plan === 'plus' && user.plan_started_at)) {
      return { activated: false }
    }
    const now = new Date().toISOString()
    await updateDoc(ref, { plan: 'plus', plan_started_at: now })
    appLog.info(`[firestore] Plus trial activated on first extension connect`, { uid })
    updatePlanState({ plan: 'plus', trialStartedAt: now })
    return { activated: true }
  } catch (err) {
    appLog.warn('[firestore] activateTrial failed', err instanceof Error ? err.message : String(err))
    return { activated: false }
  }
}

export async function updateUserEmail(uid: string, email: string): Promise<void> {
  if (!isConfigured()) return
  try {
    const ref = doc(getDb(), 'users', uid)
    await updateDoc(ref, { email })
  } catch (err) {
    appLog.warn('[firestore] updateUserEmail failed', err instanceof Error ? err.message : String(err))
  }
}

export async function getUserProfile(uid: string): Promise<FirestoreUser | null> {
  if (!isConfigured()) return null
  try {
    const ref = doc(getDb(), 'users', uid)
    const snap = await getDoc(ref)
    if (!snap.exists()) return null
    const user = snap.data() as FirestoreUser
    const checked = await checkTrialExpiry(ref, user)

    updatePlanState({
      userId: uid,
      plan: checked.plan,
      creditBalance: checked.credit_balance,
      trialStartedAt: checked.plan_started_at,
    })

    return checked
  } catch (err) {
    appLog.warn('[firestore] getUserProfile failed', err instanceof Error ? err.message : String(err))
    return null
  }
}

// -- Usage tracking --------------------------------------------------------

function usageDocId(uid: string): string {
  const today = new Date().toISOString().split('T')[0]
  return `${uid}_${today}`
}

export async function incrementUsage(
  uid: string,
  actionType: 'apply' | 'outreach',
  useCredit = false
): Promise<void> {
  if (!isConfigured()) return
  try {
    const firestore = getDb()
    const docId = usageDocId(uid)
    const usageRef = doc(firestore, 'daily_usage', docId)
    const userRef = doc(firestore, 'users', uid)

    await runTransaction(firestore, async (tx) => {
      const snap = await tx.get(usageRef)
      const field = actionType === 'apply' ? 'applications_sent' : 'outreach_sent'

      if (snap.exists()) {
        tx.update(usageRef, {
          [field]: increment(1),
          ...(useCredit ? { credits_used: increment(1) } : {}),
        })
      } else {
        tx.set(usageRef, {
          user_id: uid,
          date: new Date().toISOString().split('T')[0],
          applications_sent: actionType === 'apply' ? 1 : 0,
          outreach_sent: actionType === 'outreach' ? 1 : 0,
          credits_used: useCredit ? 1 : 0,
        })
      }

      if (useCredit) {
        tx.update(userRef, { credit_balance: increment(-1) })
      }
    })

    if (useCredit) {
      updatePlanState({ creditBalance: Math.max(0, (await getUserProfile(uid))?.credit_balance ?? 0) })
    }
  } catch (err) {
    appLog.warn('[firestore] incrementUsage failed', err instanceof Error ? err.message : String(err))
  }
}

// -- Onboarding funnel tracking --------------------------------------------

export async function trackOnboardingEvent(
  uid: string,
  step: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  if (!isConfigured()) return
  try {
    const firestore = getDb()
    const ref = doc(firestore, 'users', uid)
    const fieldKey = `onboarding.${step}`
    await updateDoc(ref, {
      [fieldKey]: new Date().toISOString(),
      onboarding_last_step: step,
      onboarding_updated_at: new Date().toISOString(),
      ...(meta ? { [`onboarding_meta.${step}`]: meta } : {}),
    })
  } catch (err) {
    appLog.debug('[firestore] trackOnboardingEvent failed', err instanceof Error ? err.message : String(err))
  }
}

// -- Counters (anonymous, social proof) ------------------------------------

async function incrementCounterField(key: string): Promise<void> {
  if (!isConfigured()) return
  try {
    const ref = doc(getDb(), 'counters', 'global')
    await setDoc(ref, { [key]: increment(1) }, { merge: true })
  } catch {
    // best-effort
  }
}

export async function incrementCounter(
  key: 'total_applications' | 'total_outreach' | 'total_users'
): Promise<void> {
  await incrementCounterField(key)
}

export async function deleteUserAccount(uid: string): Promise<void> {
  if (!isConfigured()) return
  const firestore = getDb()
  const today = new Date().toISOString().split('T')[0]
  const usageRef = doc(firestore, 'daily_usage', `${uid}_${today}`)

  try {
    await updateDoc(usageRef, {}).catch(() => {})
  } catch { /* best-effort usage cleanup */ }

  const userRef = doc(firestore, 'users', uid)
  await updateDoc(userRef, {
    email: null,
    linkedin_profile_url: null,
    plan: 'free',
    credit_balance: 0,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    _deleted: true,
    _deleted_at: new Date().toISOString(),
  })
  appLog.info('[firestore] user account marked deleted', { uid })
}

// -- Feedback & survey collection ---------------------------------------------

export interface FeedbackPayload {
  type: 'bug' | 'feature' | 'general'
  text: string
  rating?: number | null
  page?: string
}

export interface SurveyPayload {
  surveyType: 'csat' | 'pmf' | 'nps' | 'onboarding'
  answers: Record<string, unknown>
  score?: number | null
}

export async function submitFeedback(
  uid: string,
  payload: FeedbackPayload,
  appVersion: string,
): Promise<{ ok: boolean; id?: string }> {
  if (!isConfigured()) return { ok: false }
  try {
    const firestore = getDb()
    const ref = await addDoc(collection(firestore, 'feedback'), {
      userId: uid,
      type: payload.type,
      category: payload.type,
      text: payload.text,
      rating: payload.rating ?? null,
      source: 'app',
      page: payload.page ?? '',
      appVersion,
      platform: process.platform,
      screenshotUrl: null,
      status: 'new',
      createdAt: new Date().toISOString(),
    })
    appLog.info('[firestore] feedback submitted', { id: ref.id, type: payload.type })
    return { ok: true, id: ref.id }
  } catch (err) {
    appLog.warn('[firestore] submitFeedback failed', err instanceof Error ? err.message : String(err))
    return { ok: false }
  }
}

export async function submitSurvey(
  uid: string,
  payload: SurveyPayload,
): Promise<{ ok: boolean; id?: string }> {
  if (!isConfigured()) return { ok: false }
  try {
    const firestore = getDb()
    const ref = await addDoc(collection(firestore, 'surveys'), {
      userId: uid,
      surveyType: payload.surveyType,
      answers: payload.answers,
      score: payload.score ?? null,
      createdAt: new Date().toISOString(),
    })
    appLog.info('[firestore] survey submitted', { id: ref.id, surveyType: payload.surveyType })
    return { ok: true, id: ref.id }
  } catch (err) {
    appLog.warn('[firestore] submitSurvey failed', err instanceof Error ? err.message : String(err))
    return { ok: false }
  }
}

export async function getCounters(): Promise<{
  total_applications: number
  total_outreach: number
  total_users: number
} | null> {
  if (!isConfigured()) return null
  try {
    const snap = await getDoc(doc(getDb(), 'counters', 'global'))
    if (!snap.exists()) return { total_applications: 0, total_outreach: 0, total_users: 0 }
    const d = snap.data()
    return {
      total_applications: d.total_applications ?? 0,
      total_outreach: d.total_outreach ?? 0,
      total_users: d.total_users ?? 0,
    }
  } catch {
    return null
  }
}
