// ---------------------------------------------------------------------------
// auth.ts (renderer) — Firebase Auth client for the Electron renderer process.
// Handles login, logout, token refresh, and auth state observation.
// The Firebase ID token is sent to main process via IPC for server API calls.
// ---------------------------------------------------------------------------

import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  signInWithCredential,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth'

export interface AuthUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: AuthUser; idToken: string }

type AuthStateListener = (state: AuthState) => void

let firebaseApp: FirebaseApp | null = null
let auth: Auth | null = null
let currentState: AuthState = { status: 'loading' }
const listeners = new Set<AuthStateListener>()

function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  }
}

function setState(next: AuthState): void {
  currentState = next
  for (const fn of listeners) {
    try { fn(next) } catch { /* listener error — ignore */ }
  }
}

async function syncTokenToMain(user: User): Promise<string> {
  const idToken = await user.getIdToken()
  const setToken = window.loa?.authSetToken
    ?? (await import('./loa-client')).getLoa().authSetToken
  if (setToken) {
    await setToken(idToken)
  }
  return idToken
}

export function initAuth(config: {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}): void {
  if (firebaseApp) return
  if (!config.apiKey) {
    setState({ status: 'unauthenticated' })
    return
  }

  firebaseApp = initializeApp(config)
  // Use initializeAuth instead of getAuth to avoid the default
  // browserPopupRedirectResolver, which contacts authDomain on init.
  // Firebase Hosting isn't deployed, so authDomain returns 404 →
  // auth/internal-error. Electron doesn't need popup/redirect flows;
  // Google auth uses signInWithCredential via the main-process OAuth.
  auth = initializeAuth(firebaseApp, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  })

  onAuthStateChanged(auth, (user) => {
    if (user) {
      syncTokenToMain(user)
        .then((idToken) => setState({ status: 'authenticated', user: toAuthUser(user), idToken }))
        .catch((err) => {
          console.error('[auth] Token sync failed, falling back to unauthenticated:', err)
          setState({ status: 'unauthenticated' })
        })
    } else {
      setState({ status: 'unauthenticated' })
    }
  })
}

export function getAuthState(): AuthState {
  return currentState
}

export function onAuthChange(listener: AuthStateListener): () => void {
  listeners.add(listener)
  listener(currentState)
  return () => { listeners.delete(listener) }
}

export async function loginWithGoogle(): Promise<AuthUser> {
  if (!auth) throw new Error('Auth not initialized')

  // Try IPC preload first (Electron window), then HTTP bridge (browser tab)
  const invokeGoogleSignIn = window.loa?.authGoogleSignIn
    ?? (await import('./loa-client')).getLoa().authGoogleSignIn

  if (invokeGoogleSignIn) {
    const result = await invokeGoogleSignIn()
    if (!result.ok) throw new Error(result.error || 'Google sign-in failed')
    if (!result.idToken) throw new Error('Google sign-in did not return an ID token')
    const credential = GoogleAuthProvider.credential(result.idToken, result.accessToken || undefined)
    const userCredential = await signInWithCredential(auth, credential)
    return toAuthUser(userCredential.user)
  }

  throw new Error('Google sign-in requires the LinkinReachly desktop app')
}

export async function loginWithEmail(email: string, password: string): Promise<AuthUser> {
  if (!auth) throw new Error('Auth not initialized')
  const result = await signInWithEmailAndPassword(auth, email, password)
  return toAuthUser(result.user)
}

export async function registerWithEmail(email: string, password: string): Promise<AuthUser> {
  if (!auth) throw new Error('Auth not initialized')
  const result = await createUserWithEmailAndPassword(auth, email, password)
  return toAuthUser(result.user)
}

export async function logout(): Promise<void> {
  if (!auth) return
  await signOut(auth)
  const setToken = window.loa?.authSetToken
    ?? (await import('./loa-client')).getLoa().authSetToken
  if (setToken) {
    await setToken(null)
  }
  setState({ status: 'unauthenticated' })
}
