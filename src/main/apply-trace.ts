import { easyApplyFieldAppearsFilled } from '@core/easy-apply-field-state'
import { appLog } from './app-log'
import { startSessionRecording, endSessionRecording, recordEvent, isRecording } from './apply-session-recorder'

/** Correlates all `[apply-trace]` lines for one Easy Apply run. */
export type EasyApplyTraceContext = {
  jobUrl: string
  jobTitle: string
  company: string
}

let sessionCtx: EasyApplyTraceContext | null = null
let sessionId = 0
let sessionStartMs = 0
let lastStepMs = 0

export function easyApplyTraceBegin(c: EasyApplyTraceContext): number {
  sessionId += 1
  sessionCtx = c
  sessionStartMs = Date.now()
  lastStepMs = sessionStartMs
  startSessionRecording(sessionId, {
    jobUrl: c.jobUrl,
    jobTitle: c.jobTitle,
    company: c.company
  })
  applyTrace('easy_apply:session_begin', {
    sessionId,
    jobUrl: shortenUrl(c.jobUrl, 100),
    jobTitle: c.jobTitle,
    company: c.company
  })
  return sessionId
}

export function easyApplyTraceEnd(extra: Record<string, unknown> = {}): void {
  if (sessionCtx) {
    applyTrace('easy_apply:session_end', { sessionId, ...extra })
    const outcome = typeof extra['outcome'] === 'string' ? extra['outcome'] : 'unknown'
    endSessionRecording(outcome, extra)
  }
  sessionCtx = null
}

/**
 * High-signal structured log line for the Debug log panel.
 * Search for `[apply-trace]` to filter; each event includes `sessionId` while a run is active.
 */
export function applyTrace(stage: string, fields: Record<string, unknown> = {}): void {
  const now = Date.now()
  const base: Record<string, unknown> = { t: new Date().toISOString(), ...fields }
  if (sessionCtx) {
    base.sessionId = sessionId
    base.job = `${sessionCtx.company} — ${sessionCtx.jobTitle}`.slice(0, 140)
    base.jobUrl = shortenUrl(sessionCtx.jobUrl, 88)
    base.elapsedMs = now - sessionStartMs
    base.stepMs = now - lastStepMs
  }
  lastStepMs = now
  appLog.info(`[apply-trace] ${stage}`, base)
  if (isRecording()) {
    recordEvent({
      t: base.t as string,
      stage,
      sessionId: base.sessionId as number | undefined,
      elapsedMs: base.elapsedMs as number | undefined,
      stepMs: base.stepMs as number | undefined,
      data: fields
    })
  }
}

export function shortenUrl(url: string, max: number): string {
  const u = String(url || '').trim()
  if (u.length <= max) return u
  return `${u.slice(0, max - 1)}…`
}

/** Safe one-line summary of bridge payloads (no huge blobs). */
export function summarizeBridgePayload(action: string, payload: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(payload)
  if (action === 'FILL_APPLICATION_FIELD') {
    const label = String(payload['label'] || '').slice(0, 80)
    const type = String(payload['type'] || '')
    const val = payload['value']
    const len = typeof val === 'string' ? val.length : val != null ? String(val).length : 0
    return { keys, label, type, valueChars: len }
  }
  if (action === 'NAVIGATE') {
    return { keys, url: shortenUrl(String(payload['url'] || ''), 100) }
  }
  if (action === 'UPLOAD_RESUME_FILE') {
    return {
      keys,
      fileName: String(payload['fileName'] || '').slice(0, 80),
      hasPath: !!String(payload['filePath'] || '').trim(),
      hasBase64: !!String(payload['base64'] || '').trim()
    }
  }
  if (action === 'UPLOAD_EASY_APPLY_FILE') {
    const b64 = String(payload['base64'] || '')
    return {
      keys,
      target: String(payload['target'] || ''),
      fileName: String(payload['fileName'] || '').slice(0, 80),
      mimeType: String(payload['mimeType'] || '').slice(0, 48),
      base64Chars: b64.length
    }
  }
  return { keys, size: keys.length }
}

/** Active Easy Apply trace session id, or null if no run in progress. */
export function getActiveEasyApplySessionId(): number | null {
  return sessionCtx ? sessionId : null
}

export function summarizeBridgeDataPreview(action: string, data: unknown): string {
  if (data === undefined || data === null) return '(none)'
  if (typeof data === 'string') return data.length > 320 ? `${data.slice(0, 320)}…` : data
  try {
    const s = JSON.stringify(data)
    return s.length > 400 ? `${s.slice(0, 400)}…` : s
  } catch (e) {
    appLog.debug('[apply-trace] summarizeBridgeDataPreview stringify failed', e instanceof Error ? e.message : String(e))
    return String(data).slice(0, 400)
  }
}

/**
 * Rich field snapshot for a single wizard step (capped so logs stay usable).
 */
export function summarizeFormFieldsStep(
  step: number,
  fields: Array<{ label: string; type: string; value?: string; required?: boolean; options?: string[] }>,
  opts: { maxRows?: number } = {}
): Record<string, unknown> {
  const maxRows = opts.maxRows ?? 48
  const byType: Record<string, number> = {}
  for (const f of fields) {
    byType[f.type] = (byType[f.type] ?? 0) + 1
  }
  const emptyRequired = fields
    .filter((f) => f.required && !easyApplyFieldAppearsFilled(f))
    .map((f) => f.label.slice(0, 120))
  const radiosNoSelection = fields
    .filter((f) => f.type === 'radio' && !easyApplyFieldAppearsFilled(f))
    .map((f) => ({
      label: f.label.slice(0, 100),
      optionCount: f.options?.length ?? 0,
      optionsSample: (f.options || []).slice(0, 6)
    }))
  const rows = fields.slice(0, maxRows).map((f) => ({
    label: f.label.slice(0, 100),
    type: f.type,
    required: !!f.required,
    hasValue: easyApplyFieldAppearsFilled(f),
    valuePreview: easyApplyFieldAppearsFilled(f)
      ? String(f.value ?? '')
          .trim()
          .slice(0, 40) + (String(f.value ?? '').trim().length > 40 ? '…' : '')
      : '',
    optionCount: f.options?.length ?? 0
  }))
  return {
    step,
    fieldCount: fields.length,
    byType,
    emptyRequiredLabels: emptyRequired,
    radiosUnset: radiosNoSelection,
    rows,
    rowsTruncated: fields.length > maxRows ? fields.length - maxRows : 0
  }
}
