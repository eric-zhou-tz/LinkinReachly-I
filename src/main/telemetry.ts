// ---------------------------------------------------------------------------
// telemetry.ts — Privacy-first usage telemetry. Core events, onboarding
// funnel, and social proof counter increments. Local JSONL + batched server
// sync via event-queue.ts (Segment/Amplitude pattern).
// ---------------------------------------------------------------------------

import { app } from 'electron'
import { enqueue, getAnonymousId, getSessionId, type TrackedEvent } from './event-queue'
import { getFirebaseToken } from './auth-service'
import { decodeTokenPayload } from './api-client'
import { appLog } from './app-log'

export type OnboardingStep =
  | 'onboarding_started'
  | 'onboarding_resume_uploaded'
  | 'onboarding_resume_skipped'
  | 'onboarding_preferences_set'
  | 'onboarding_preferences_skipped'
  | 'onboarding_extension_prompt_seen'
  | 'onboarding_extension_folder_opened'
  | 'onboarding_extension_connected'
  | 'onboarding_completed'
  | 'onboarding_skipped'

let _telemetryEnabled = false

export function setTelemetryEnabled(enabled: boolean): void {
  _telemetryEnabled = enabled
  appLog.info('[telemetry] opt-in status changed', { enabled })
}

export function isTelemetryEnabled(): boolean {
  return _telemetryEnabled
}

// -- User identity ----------------------------------------------------------

function getUserId(): string | null {
  const token = getFirebaseToken()
  if (!token) return null
  return decodeTokenPayload(token).uid
}

function getAppVersion(): string {
  try { return app.getVersion() } catch { return 'dev' }
}

// -- Core tracking ----------------------------------------------------------

function track(event: string, properties: Record<string, unknown> = {}): void {
  const tracked: TrackedEvent = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    event,
    userId: getUserId(),
    anonymousId: getAnonymousId(),
    sessionId: getSessionId(),
    timestamp: new Date().toISOString(),
    properties,
    appVersion: getAppVersion(),
    platform: process.platform,
  }

  enqueue(tracked)

  if (_telemetryEnabled) {
    reportToSentry(tracked)
  }
}

type SentryLike = { addBreadcrumb: (bc: Record<string, unknown>) => void }
let _sentryCache: SentryLike | false | undefined

function reportToSentry(event: TrackedEvent): void {
  if (_sentryCache === false) return
  if (_sentryCache === undefined) {
    try { _sentryCache = require('@sentry/electron/main') as SentryLike } catch { _sentryCache = false; return }
  }
  const sentry = _sentryCache
  sentry.addBreadcrumb({
    category: 'telemetry',
    message: event.event,
    level: 'info',
    data: { ...event.properties },
  })
}

// -- Generic event (from renderer via IPC) ----------------------------------

export function trackGenericEvent(name: string, properties?: Record<string, unknown>): void {
  track(name, properties ?? {})
}

// -- Typed event helpers ----------------------------------------------------

export function trackAppOpened(): void {
  track('Session Started')
}

export function trackAppClosed(durationMs: number): void {
  track('Session Ended', { duration_ms: durationMs })
}

export function trackApplicationSent(): void {
  track('Application Sent')
}

export function trackApplicationFailed(errorType: string, jobUrl?: string, detail?: string): void {
  track('Application Failed', {
    error_type: errorType,
    ...(jobUrl ? { job_url: jobUrl } : {}),
    error_detail: String(detail || 'no detail captured').slice(0, 500)
  })
}

export function trackOutreachSent(): void {
  track('Outreach Sent')
}

export function trackUpgradeClicked(source: string): void {
  track('Upgrade Clicked', { source })
}

export function trackPaymentCompleted(product: string): void {
  track('Payment Completed', { product })
}

export function trackOnboardingStep(step: OnboardingStep, meta?: Record<string, unknown>): void {
  track('Onboarding Step', { step, ...(meta ?? {}) })
}

export function trackFirstJobSearch(): void {
  track('First Job Search')
}

export function trackFirstExtensionConnect(): void {
  track('First Extension Connect')
}

export function trackJobSearched(query: string, location: string, resultCount: number): void {
  track('Job Searched', { query, location, result_count: resultCount })
}

export function trackJobQueued(jobUrl: string, company: string, title: string): void {
  track('Job Queued', { job_url: jobUrl, company, title })
}

export function trackQueueStarted(pendingCount: number): void {
  track('Queue Started', { pending_count: pendingCount })
}

export function trackQueueCompleted(done: number, failed: number, skipped: number, durationMs: number): void {
  track('Queue Completed', { done, failed, skipped, duration_ms: durationMs })
}

export function trackExtensionConnected(): void {
  track('Extension Connected')
}

export function trackExtensionDisconnected(): void {
  track('Extension Disconnected')
}

export function trackSettingsChanged(settingName: string): void {
  track('Settings Changed', { setting_name: settingName })
}

// -- Sprint 3 event helpers --------------------------------------------------

export function trackExtensionInstallLinkClicked(): void {
  track('Extension Install Link Clicked')
}

export function trackTabViewed(tabName: string): void {
  track('Tab Viewed', { tab_name: tabName })
}

export function trackTrialStarted(): void {
  track('Trial Started')
}

export function trackTrialExpired(plusFeaturesUsed: string[]): void {
  track('Trial Expired', { plus_features_used: plusFeaturesUsed })
}

export function trackTrialConverted(source: string): void {
  track('Trial Converted', { source })
}

export function trackApplicationStuckFormDetected(step: string, unfilledCount: number): void {
  track('Application Stuck Form Detected', { step, unfilled_count: unfilledCount })
}

export function trackApplicationAiFillAttempted(step: string, fieldsAttempted: number, fieldsFilled: number): void {
  track('Application AI Fill Attempted', { step, fields_attempted: fieldsAttempted, fields_filled: fieldsFilled })
}

export function trackOutreachBannerShown(applicationCount: number): void {
  track('Outreach Banner Shown', { application_count: applicationCount })
}

export function trackOutreachBannerSkipped(): void {
  track('Outreach Banner Skipped')
}

export function trackOutreachChainStarted(candidateCount: number): void {
  track('Outreach Chain Started', { candidate_count: candidateCount })
}

export function trackOutreachChainCompleted(sent: number, failed: number): void {
  track('Outreach Chain Completed', { sent, failed })
}

export function trackAnswerBankGrowth(totalAnswers: number, newAnswersThisSession: number): void {
  track('Answer Bank Growth', { total_answers: totalAnswers, new_answers_this_session: newAnswersThisSession })
}

// -- Structured error reporting -----------------------------------------------

export type ErrorSeverity = 'fatal' | 'error' | 'warning'

export type ErrorCategory =
  | 'apply_failed'
  | 'form_fill_failed'
  | 'llm_error'
  | 'extension_error'
  | 'renderer_crash'
  | 'network_error'
  | 'queue_error'
  | 'uncaught_exception'

/**
 * Report a structured error to server + Sentry + local telemetry.
 * This is the single entry point for all error reporting in the app.
 */
export function trackError(
  category: ErrorCategory,
  message: string,
  opts?: {
    severity?: ErrorSeverity
    stack?: string
    context?: Record<string, unknown>
  }
): void {
  const severity = opts?.severity ?? 'error'

  // 1. Track as telemetry event (local JSONL + server batch sync)
  track('Error Reported', {
    error_category: category,
    error_message: message.slice(0, 500),
    error_severity: severity,
    ...(opts?.context ?? {}),
  })

  // 2. Report to Sentry as an actual exception (not just a breadcrumb)
  reportErrorToSentry(category, message, severity, opts?.stack)

  // 3. Send to dedicated /recordError endpoint (fire-and-forget)
  void sendErrorToServer(category, message, severity, opts?.stack, opts?.context)
}

function reportErrorToSentry(
  category: ErrorCategory,
  message: string,
  severity: ErrorSeverity,
  stack?: string
): void {
  if (!_telemetryEnabled) return
  try {
    const Sentry = require('@sentry/electron/main') as {
      captureException: (err: Error, ctx?: Record<string, unknown>) => void
      withScope: (cb: (scope: { setTag: (k: string, v: string) => void; setLevel: (l: string) => void }) => void) => void
    }
    const err = new Error(`[${category}] ${message}`)
    if (stack) err.stack = stack
    Sentry.withScope((scope) => {
      scope.setTag('error_category', category)
      scope.setLevel(severity)
      Sentry.captureException(err)
    })
  } catch { /* Sentry not available */ }
}

async function sendErrorToServer(
  category: ErrorCategory,
  message: string,
  severity: ErrorSeverity,
  stack?: string,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    const { getServiceConfig } = await import('./service-config')
    const { getAuthHeaders } = await import('./auth-service')
    const { getAnonymousId, getSessionId } = await import('./event-queue')
    const config = getServiceConfig()
    if (!config.cloudFunctions.url) return

    await fetch(`${config.cloudFunctions.url}/recordError`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        category,
        message: message.slice(0, 2000),
        stack: stack?.slice(0, 4000),
        severity,
        context: context ?? {},
        anonymousId: getAnonymousId(),
        sessionId: getSessionId(),
        appVersion: getAppVersion(),
        platform: process.platform,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch { /* best effort */ }
}
