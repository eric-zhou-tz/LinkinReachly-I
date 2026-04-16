/**
 * Summaries and stuck-field extraction for the apply queue.
 *
 * `STUCK_FIELD_RE` must stay aligned with human-readable error strings in
 * `application-assistant.ts` → `handleEasyApply` that include `unfilled (...)` with a
 * comma-separated label list (e.g. the “Easy Apply stuck: … unfilled (…)” and
 * “Could not advance: … unfilled (…)” branches). If those formats change, update
 * the regex or parsing here accordingly.
 */
import type { ApplyQueueItem, ApplyQueueRunSummary, ApplyQueueState } from '@core/application-types'

const STUCK_FIELD_RE = /unfilled\s*\(([^)]+)\)/i

/**
 * Collects form labels mentioned in queue item error details (stuck unfilled fields).
 * apply-queue-run-summary.ts:collectStuckFieldLabelsFromQueueItems
 */
export function collectStuckFieldLabelsFromQueueItems(items: ApplyQueueItem[]): string[] {
  const stuckLabels = new Set<string>()
  const addLabel = (raw: unknown): void => {
    const label = String(raw || '').trim()
    if (!label || label === '...') return
    stuckLabels.add(label)
  }
  for (const item of items) {
    if (item.status !== 'error') continue

    // Prefer structured labels when available. Parsing from free-form detail text
    // can split labels on commas inside a single question.
    if (Array.isArray(item.stuckFieldLabels) && item.stuckFieldLabels.length > 0) {
      for (const label of item.stuckFieldLabels) addLabel(label)
      continue
    }

    if (item.detail) {
      const m = item.detail.match(STUCK_FIELD_RE)
      if (m) {
        for (const label of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
          addLabel(label)
        }
      }
    }
  }
  return stuckLabels.size > 0 ? [...stuckLabels] : []
}

type QueueStatusCounts = Record<string, number>

/**
 * Builds the persisted run summary after the queue runner goes idle.
 * apply-queue-run-summary.ts:buildApplyQueueRunSummary
 */
export function buildApplyQueueRunSummary(
  cur: ApplyQueueState,
  counts: QueueStatusCounts,
  answersLearned: number
): ApplyQueueRunSummary {
  const startedAt = cur.startedAt || new Date().toISOString()
  const finishedAt = new Date().toISOString()
  const durationSec = Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000)
  const stuck = collectStuckFieldLabelsFromQueueItems(cur.items)
  return {
    startedAt,
    finishedAt,
    durationSec,
    done: counts.done ?? 0,
    failed: counts.error ?? 0,
    skipped: counts.skipped ?? 0,
    pending: counts.pending ?? 0,
    total: cur.items.length,
    stoppedReason: cur.lastErrorCode,
    stuckFieldLabels: stuck.length > 0 ? stuck : undefined,
    answersLearned: Math.max(0, answersLearned)
  }
}
