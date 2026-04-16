import type {
  ApplicationAssistantDetectView,
  ApplicationHistoryView,
  ApplicationRecordInput,
  ApplicationRecordSaveView
} from '@core/application-types'
import { detectAts, getSupportedAtsLabels } from '@core/ats-detect'
import { getActiveLinkedInTabUrl } from './bridge'
import {
  appendApplicationRecord,
  computeInsights,
  deleteApplicationRecord,
  exportApplicationHistoryCsv,
  loadApplicationHistory,
  updateApplicationRecord
} from './application-history-store'
import { notifyApplyQueueTick } from './apply-queue-runner'

export function detectApplicationPage(payload: unknown): ApplicationAssistantDetectView {
  const urlArg = typeof payload === 'object' && payload !== null
    ? String((payload as Record<string, unknown>).url || '').trim()
    : ''

  const urlToCheck = urlArg || (getActiveLinkedInTabUrl() ?? '')

  if (!urlToCheck) {
    return {
      ok: false,
      featureEnabled: true,
      reason: 'no_active_tab',
      detail: 'No URL to check. Open a job application page in Chrome or paste a URL.'
    }
  }

  const result = detectAts(urlToCheck)

  if (result.matched) {
    return {
      ok: true,
      atsId: result.atsId,
      atsLabel: result.atsLabel,
      company: result.company,
      jobId: result.jobId,
      confidence: result.confidence,
      detail: `Detected ${result.atsLabel} application${result.company ? ` for ${result.company}` : ''}.`
    }
  }

  return {
    ok: false,
    featureEnabled: true,
    reason: 'no_ats_detected',
    detail: `No recognized ATS detected at ${urlToCheck}. Supported: ${getSupportedAtsLabels().join(', ')}.`
  }
}

export function getApplicationHistory(): ApplicationHistoryView {
  const records = loadApplicationHistory()
  return {
    ok: true,
    records,
    insights: computeInsights(records),
    detail: records.length ? 'Loaded application activity.' : 'No application activity recorded yet.'
  }
}

export function normalizeRecordInput(input: Partial<ApplicationRecordInput>): ApplicationRecordInput | null {
  const company = String(input.company || '').trim()
  const title = String(input.title || '').trim()
  if (!company || !title) return null
  return {
    company,
    title,
    location: String(input.location || '').trim() || undefined,
    jobUrl: String(input.jobUrl || '').trim() || undefined,
    easyApply: typeof input.easyApply === 'boolean' ? input.easyApply : undefined,
    atsId: String(input.atsId || '').trim() || undefined,
    source:
      input.source === 'linkedin_easy_apply' || input.source === 'manual' || input.source === 'simple_apply_open'
        ? input.source
        : 'manual',
    outcome:
      input.outcome === 'submitted' ||
      input.outcome === 'autofilled' ||
      input.outcome === 'needs_review' ||
      input.outcome === 'failed' ||
      input.outcome === 'blocked' ||
      input.outcome === 'opened'
        ? input.outcome
        : 'opened',
    detail: String(input.detail || '').trim() || undefined,
    descriptionSnippet: String(input.descriptionSnippet || '').trim() || undefined,
    reasonSnippet: String(input.reasonSnippet || '').trim() || undefined
  }
}

export function saveApplicationRecord(payload: unknown): ApplicationRecordSaveView {
  return appendApplicationFromPayload(payload)
}

export function appendApplicationFromPayload(payload: unknown): ApplicationRecordSaveView {
  const normalized = normalizeRecordInput((payload || {}) as Partial<ApplicationRecordInput>)
  if (!normalized) {
    return { ok: false, detail: 'Company and title are required.' }
  }
  const record = appendApplicationRecord(normalized)
  return {
    ok: true,
    record,
    insights: computeInsights(loadApplicationHistory()),
    detail: 'Application activity recorded.'
  }
}

export function patchApplicationRecord(payload: unknown): ApplicationRecordSaveView {
  const body = (payload || {}) as { id?: string } & Partial<ApplicationRecordInput>
  const id = String(body.id || '').trim()
  if (!id) {
    return { ok: false, detail: 'Record id is required.' }
  }
  const { id: _id, ...rest } = body
  const updated = updateApplicationRecord(id, rest)
  if (!updated) {
    return {
      ok: false,
      detail: 'Record not found.'
    }
  }
  notifyApplyQueueTick()
  return {
    ok: true,
    record: updated,
    insights: computeInsights(loadApplicationHistory()),
    detail: 'Application record updated.'
  }
}

export function deleteApplicationHistoryRecord(payload: unknown): ApplicationHistoryView {
  const id = String((payload as { id?: string } | undefined)?.id || '').trim()
  if (!id) {
    return { ok: false, detail: 'Record id is required.' }
  }
  const deleted = deleteApplicationRecord(id)
  if (!deleted) {
    return { ok: false, detail: 'Record not found.' }
  }
  const records = loadApplicationHistory()
  return {
    ok: true,
    records,
    insights: computeInsights(records),
    detail: 'Application record removed.'
  }
}

export function exportApplicationHistoryCsvHandler(): { ok: boolean; csv: string } {
  return { ok: true, csv: exportApplicationHistoryCsv() }
}
