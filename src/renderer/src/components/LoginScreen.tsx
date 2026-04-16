import { useState, useCallback, useEffect, useRef } from 'react'
import { AppLogo } from './AppLogo'
import { ExternalLink } from './ExternalLink'
import {
  initAuth,
  loginWithGoogle,
  loginWithEmail,
  registerWithEmail,
  type AuthUser,
} from '../auth'
import { getLoa } from '../loa-client'

interface LoginScreenProps {
  firebaseConfig: {
    apiKey: string
    authDomain: string
    projectId: string
    appId: string
  }
  onLogin: (user: AuthUser) => void
  onSkip?: () => void
  onDevSkip?: () => void
}

export function LoginScreen({ firebaseConfig, onLogin, onSkip, onDevSkip }: LoginScreenProps) {
  const [mode, setMode] = useState<'main' | 'email-login' | 'email-register'>('main')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const shownTracked = useRef(false)

  useEffect(() => {
    if (!shownTracked.current) {
      shownTracked.current = true
      void getLoa().trackEvent('login_screen_shown').catch(() => {})
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (mode === 'email-login' || mode === 'email-register') {
          setMode('main')
          setError(null)
        } else if (onSkip) {
          onSkip()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode, onSkip])

  const ensureInit = useCallback(() => {
    initAuth(firebaseConfig)
  }, [firebaseConfig])

  const handleGoogleLogin = useCallback(async () => {
    ensureInit()
    setBusy(true)
    setError(null)
    void getLoa().trackEvent('login_attempted', { method: 'google' }).catch(() => {})
    try {
      const user = await loginWithGoogle()
      void getLoa().trackEvent('login_completed', { method: 'google' }).catch(() => {})
      onLogin(user)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in didn\u2019t complete'
      void getLoa().trackEvent('login_failed', { method: 'google', error: msg.slice(0, 200) }).catch(() => {})
      setError(msg)
    } finally {
      setBusy(false)
    }
  }, [ensureInit, onLogin])

  const handleEmailSubmit = useCallback(async () => {
    ensureInit()
    if (!email.trim() || !password.trim()) {
      setError('Enter both email and password.')
      return
    }
    setBusy(true)
    setError(null)
    const emailMethod = mode === 'email-register' ? 'email_register' : 'email_login'
    void getLoa().trackEvent('login_attempted', { method: emailMethod }).catch(() => {})
    try {
      const user = mode === 'email-register'
        ? await registerWithEmail(email.trim(), password)
        : await loginWithEmail(email.trim(), password)
      void getLoa().trackEvent('login_completed', { method: emailMethod }).catch(() => {})
      onLogin(user)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in didn\u2019t work'
      void getLoa().trackEvent('login_failed', { method: emailMethod, error: msg.slice(0, 200) }).catch(() => {})
      if (msg.includes('user-not-found') || msg.includes('wrong-password')) {
        setError('Invalid email or password')
      } else if (msg.includes('email-already-in-use')) {
        setError('An account with this email already exists. Try signing in.')
      } else if (msg.includes('weak-password')) {
        setError('Password must be at least 6 characters')
      } else {
        setError('Sign-in didn\u2019t work. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }, [ensureInit, email, password, mode, onLogin])

  if (mode === 'email-login' || mode === 'email-register') {
    return (
      <div className="login-screen" role="dialog" aria-labelledby="login-heading" aria-modal="true">
        <div className="login-card">
        <div className="login-hero login-hero--compact">
          <div className="login-logo-wrap">
            <AppLogo />
          </div>
          <h2 id="login-heading" className="login-title">
            {mode === 'email-register' ? 'Create account' : 'Sign in'}
          </h2>
        </div>

          <form className="login-form" onSubmit={(e) => { e.preventDefault(); void handleEmailSubmit() }}>
            <label className="login-field" htmlFor="login-email">
              Email
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="login-field" htmlFor="login-password">
              Password
              <input
                id="login-password"
                type="password"
                autoComplete={mode === 'email-register' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </label>

            {error && <p className="login-error" role="alert">{error}</p>}

            <button type="submit" className="btn btn-primary login-submit" disabled={busy} aria-busy={busy}>
              {busy ? 'Working\u2026' : mode === 'email-register' ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="login-switch">
            {mode === 'email-register' ? (
              <>Already have an account? <button type="button" className="btn-link" onClick={() => { setMode('email-login'); setError(null) }}>Sign in</button></>
            ) : (
              <>No account? <button type="button" className="btn-link" onClick={() => { setMode('email-register'); setError(null) }}>Create one</button></>
            )}
          </p>

          <button type="button" className="btn-link login-back" onClick={() => { setMode('main'); setError(null) }}>
            {'\u2190'} Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="login-screen" role="dialog" aria-labelledby="login-heading" aria-modal="true">
      <div className="login-card">
        <div className="login-hero">
          <div className="login-logo-wrap">
            <AppLogo />
          </div>
          <h2 id="login-heading" className="login-title">LinkinReachly</h2>
          <p className="login-lede">Apply to dozens of LinkedIn jobs while you sleep.</p>
          <p className="login-social-proof">7-day free trial {'\u00b7'} Full AI form fill {'\u00b7'} 100% local</p>
        </div>

        {error && <p className="login-error" role="alert">{error}</p>}

        <div className="login-actions">
          <button
            type="button"
            className="btn login-google"
            onClick={() => void handleGoogleLogin()}
            disabled={busy}
            aria-busy={busy}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {busy ? 'Signing in\u2026' : 'Continue with Google'}
          </button>

          <button
            type="button"
            className="btn login-email"
            onClick={() => setMode('email-login')}
            disabled={busy}
          >
            Continue with email
          </button>
        </div>

        {onSkip && (
          <>
            <div className="login-divider"><span>or</span></div>
            <button type="button" className="login-skip" onClick={() => {
              void getLoa().trackEvent('login_skipped').catch(() => {})
              onSkip()
            }}>
              Continue without account
              <span className="login-skip-note">{'\u2014'} free tier, limited features</span>
            </button>
          </>
        )}

        <p className="login-legal">
          By continuing, you agree to our<br />
          <a href="https://linkinreachly.com/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
          {' and '}
          <a href="https://linkinreachly.com/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
        </p>

        {onDevSkip && (
          <button type="button" className="login-dev-skip" onClick={onDevSkip}>
            Skip login (dev)
          </button>
        )}
      </div>
    </div>
  )
}
