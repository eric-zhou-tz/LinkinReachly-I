import * as Sentry from '@sentry/electron/renderer'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || '',
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0.5,
  beforeSend(event) {
    const msg = event.exception?.values?.[0]?.value ?? ''
    if (msg.includes('Should have a queue')) return null
    if (msg.includes('not available in production')) return null
    const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? []
    if (frames.some(f => f.filename?.includes('@react-refresh'))) return null
    return event
  },
})

import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { installRendererLogging } from './app-log'
import { ErrorBoundary } from './components/ErrorBoundary'
import './theme.css'

const App = lazy(() => import('./App'))

installRendererLogging()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<div className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }} />}>
        <App />
      </Suspense>
    </ErrorBoundary>
  </React.StrictMode>
)
