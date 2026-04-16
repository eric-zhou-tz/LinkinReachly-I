// ---------------------------------------------------------------------------
// feedback.ts — Local feedback + survey persistence (JSONL) with best-effort
// server sync. Mirrors the telemetry.ts pattern: always write locally, attempt
// Cloud Function call if backend is configured.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { userDataDir } from './user-data-path'
import { submitFeedbackServer, submitSurveyServer } from './api-client'
import { isAuthenticated, getFirebaseToken } from './auth-service'
import { decodeTokenPayload } from './api-client'
import { appLog } from './app-log'

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

function feedbackDir(): string {
  const d = join(userDataDir(), 'feedback')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function feedbackFilePath(): string {
  return join(feedbackDir(), 'feedback.jsonl')
}

function surveyFilePath(): string {
  return join(feedbackDir(), 'surveys.jsonl')
}

function getUid(): string | null {
  const token = getFirebaseToken()
  if (!token) return null
  return decodeTokenPayload(token).uid
}

function getAppVersion(): string {
  try { return app.getVersion() } catch { return 'dev' }
}

export async function submitFeedback(payload: FeedbackPayload): Promise<{ ok: boolean; id?: string }> {
  const uid = getUid()
  const record = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: uid,
    type: payload.type,
    text: payload.text,
    rating: payload.rating ?? null,
    source: 'app',
    page: payload.page ?? '',
    appVersion: getAppVersion(),
    platform: process.platform,
    createdAt: new Date().toISOString(),
  }

  // Always persist locally
  try {
    appendFileSync(feedbackFilePath(), JSON.stringify(record) + '\n', 'utf8')
  } catch (err) {
    appLog.warn('[feedback] local write failed', err instanceof Error ? err.message : String(err))
  }

  // Best-effort server sync
  void submitFeedbackServer(record)

  appLog.info('[feedback] submitted', { id: record.id, type: payload.type })
  return { ok: true, id: record.id }
}

export async function submitSurvey(payload: SurveyPayload): Promise<{ ok: boolean; id?: string }> {
  const uid = getUid()
  const record = {
    id: `sv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: uid,
    surveyType: payload.surveyType,
    answers: payload.answers,
    score: payload.score ?? null,
    createdAt: new Date().toISOString(),
  }

  try {
    appendFileSync(surveyFilePath(), JSON.stringify(record) + '\n', 'utf8')
  } catch (err) {
    appLog.warn('[feedback] survey local write failed', err instanceof Error ? err.message : String(err))
  }

  void submitSurveyServer(record)

  appLog.info('[feedback] survey submitted', { id: record.id, surveyType: payload.surveyType })
  return { ok: true, id: record.id }
}

/** Check if a specific survey type has been submitted recently (within cooldownDays). */
export function hasSurveyBeenShown(surveyType: string, cooldownDays: number): boolean {
  try {
    const path = surveyFilePath()
    if (!existsSync(path)) return false
    const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
    const cutoff = Date.now() - cooldownDays * 86_400_000
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (entry.surveyType === surveyType && new Date(entry.createdAt).getTime() > cutoff) {
          return true
        }
      } catch { /* skip malformed lines */ }
    }
    return false
  } catch {
    return false
  }
}
