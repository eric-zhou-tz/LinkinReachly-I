import type { ApplyQueueState, ApplicationRecord } from '@core/application-types'
import { loadApplicationHistory, updateApplicationRecord } from './application-history-store'
import { loadQueue, saveQueue } from './apply-queue-store'
import { loadSettings } from './settings'
import { isStaleExtensionResult } from './easy-apply/shared'
import { appLog } from './app-log'
import { broadcastToRenderer } from './broadcast-to-renderer'

export type PostApplyOutreachCandidate = {
  applicationRecordId: string
  jobTitle: string
  company: string
  jobUrl: string
  createdAt?: string
  hiringTeam?: ApplicationRecord['hiringTeam']
  hiringTeamSearchHint?: string
}

/** Same eligibility rules as `handleOutreachCandidates` in application-assistant (single source of truth). */
export function buildOutreachCandidatesFromHistory(history: ApplicationRecord[]): PostApplyOutreachCandidate[] {
  return history
    .filter(
      (r) =>
        (r.outreachStatus === 'pending' || r.outreachStatus === 'none' || !r.outreachStatus) &&
        (r.outcome === 'submitted' || r.outcome === 'autofilled') &&
        r.easyApply &&
        // Allow outreach when we have stored hiring contact OR a job URL the chain can revisit
        (r.hiringTeam?.some((m) => m.profileUrl?.includes('/in/')) || !!r.jobUrl)
    )
    .map((r) => ({
      applicationRecordId: r.id,
      jobTitle: r.title,
      company: r.company,
      jobUrl: r.jobUrl || '',
      createdAt: r.createdAt,
      hiringTeam: r.hiringTeam,
      hiringTeamSearchHint:
        r.hiringTeamSearchHint || `"${r.company}" "${r.title}" hiring manager OR recruiter`
    }))
}

function qlog(event: string, fields: Record<string, unknown> = {}): void {
  appLog.info(`[apply-queue] ${event}`, { at: new Date().toISOString(), ...fields })
}

const CATCHUP_THRESHOLD = 20
const CATCHUP_MAX = 10
const NORMAL_MAX = 3

export async function verifyNeedsReviewRecords(
  isStopRequested: () => boolean,
  emit: () => void
): Promise<void> {
  try {
    // Dynamic import: optional bridge dependency so this module stays loadable in tests without full bridge init.
    const { isExtensionConnected, sendCommand } = await import('./bridge')
    if (!isExtensionConnected()) return

    const history = loadApplicationHistory()
    const allNeedsReview = history
      .filter(r => r.outcome === 'needs_review' && r.jobUrl && r.source === 'linkedin_easy_apply')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const maxVerify = allNeedsReview.length > CATCHUP_THRESHOLD ? CATCHUP_MAX : NORMAL_MAX
    const needsReview = allNeedsReview.slice(0, maxVerify)

    if (needsReview.length === 0) return
    qlog('verify.start', { count: needsReview.length, backlog: allNeedsReview.length, catchupMode: allNeedsReview.length > CATCHUP_THRESHOLD })

    for (const record of needsReview) {
      if (isStopRequested()) break
      const cur = loadQueue()
      saveQueue({ ...cur, lastDetail: `Checking prior application: ${record.title} at ${record.company}...` })
      emit()

      try {
        const navResult = await sendCommand('NAVIGATE', { url: record.jobUrl }, 15_000)
        if (!navResult.ok) {
          qlog('verify.skipped_nav_failed', { recordId: record.id, title: record.title })
          continue
        }
        await new Promise(r => setTimeout(r, 3000))

        const checkResult = await sendCommand('CHECK_SUCCESS_SCREEN', {}, 10_000)
        const detailLower = String(checkResult.detail || '').toLowerCase()
        const dataStr = String(checkResult.data ?? '')
        const successProbeHit =
          !isStaleExtensionResult(checkResult) &&
          checkResult.ok &&
          (dataStr === 'submit' ||
            detailLower.includes('success_screen') ||
            detailLower.includes('success_badge') ||
            detailLower.includes('application_success'))
        if (successProbeHit) {
          updateApplicationRecord(record.id, {
            outcome: 'submitted',
            detail: `${record.detail || ''} [auto-verified: Applied badge confirmed]`
          })
          qlog('verify.promoted', { recordId: record.id, title: record.title })
        } else {
          qlog('verify.inconclusive', { recordId: record.id, title: record.title })
        }
      } catch (err) {
        qlog('verify.error', { recordId: record.id, error: String(err) })
      }
      await new Promise(r => setTimeout(r, 2000))
    }
  } catch (e) {
    appLog.info('[apply-queue] verification error', {
      error: e instanceof Error ? e.message : e
    })
  }
}

/** Auto-run outreach for eligible candidates after the apply queue finishes. */
export async function autoRunPostApplyOutreach(queueState: ApplyQueueState): Promise<void> {
  try {
    const settings = loadSettings()
    if (!settings.autoSuggestOutreachAfterApply) return
  } catch (e) { appLog.debug('[apply-queue] auto-outreach settings check failed', e instanceof Error ? e.message : String(e)); return }

  try {
    const { isExtensionConnected } = await import('./bridge')
    if (!isExtensionConnected()) {
      qlog('auto_outreach.skipped', { reason: 'bridge_disconnected' })
      return
    }
  } catch (e) { appLog.debug('[apply-queue] auto-outreach bridge check failed', e instanceof Error ? e.message : String(e)); return }

  const doneItems = queueState.items.filter(
    (i) => i.status === 'done' && i.applicationRecordId && i.surface === 'linkedin_easy_apply'
  )
  if (doneItems.length === 0) return

  const history = loadApplicationHistory()
  const doneById = new Map(doneItems.map((i) => [i.applicationRecordId!, i]))
  const pool = buildOutreachCandidatesFromHistory(history)
  const ids: string[] = []

  for (const c of pool) {
    if (ids.length >= 5) break
    const item = doneById.get(c.applicationRecordId)
    if (!item) continue
    const record = history.find((r) => r.id === c.applicationRecordId)
    if (!record || (record.outreachStatus && record.outreachStatus !== 'none')) continue
    ids.push(c.applicationRecordId)
  }
  if (ids.length === 0) return

  qlog('auto_outreach.start', { count: ids.length })
  broadcastToRenderer('app:toast', {
    message: `Connecting with ${ids.length} hiring manager${ids.length > 1 ? 's' : ''}\u2026`,
    tone: 'info'
  })

  try {
    const { handleApplicationAssistantChannel } = await import('./application-assistant')
    const result = await handleApplicationAssistantChannel(
      'application:outreach:runChain',
      { candidateIds: ids, maxTargets: ids.length }
    ) as { ok: boolean; sent: number; skipped: number; detail?: string }
    qlog('auto_outreach.complete', { sent: result.sent, skipped: result.skipped })
    if (result.sent > 0) {
      broadcastToRenderer('app:toast', {
        message: `Connected with ${result.sent} hiring manager${result.sent > 1 ? 's' : ''}.`,
        tone: 'ok'
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    qlog('auto_outreach.error', { message: msg })
  }
}
