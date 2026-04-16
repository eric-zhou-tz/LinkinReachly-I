import { isExtensionConnected } from '../bridge'
import {
  applyTrace,
  easyApplyTraceBegin,
  easyApplyTraceEnd,
  getActiveEasyApplySessionId
} from '../apply-trace'
import { appendApplicationRecord } from '../application-history-store'
import { appLog } from '../app-log'
import { detailSuggestsEasyApplyUnavailable } from '@core/apply-queue-heuristics'
import { easyApplyPreflight } from './preflight'
import { easyApplyNavigate } from './navigate'
import { easyApplyClickApplyButton } from './click-apply'
import { easyApplyFillFormLoop } from './fill-form'
import { easyApplyVerifySubmission } from './verify-submission'
import { easyApplyBridgeCommand, historyDetailWithSession } from './shared'
import type { EasyApplyResult, EasyApplyArgs } from './shared'

/**
 * Execute the LinkedIn Easy Apply pipeline for a single job.
 *
 * Steps:
 * 1. Navigate to the job page
 * 2. Click the Easy Apply button
 * 3. Extract form fields from the modal
 * 4. Fill fields from applicant profile
 * 5. Handle multi-step forms (Next → Next → Submit)
 * 6. Submit the application
 */
export async function handleEasyApply(
  payload: unknown,
  onProgress?: (phase: string) => void,
  shouldStop?: () => boolean
): Promise<EasyApplyResult> {
  if (!isExtensionConnected()) {
    return { ok: false, phase: 'navigate', detail: 'Chrome extension not connected.' }
  }

  const rawArgs = (payload || {}) as {
    jobUrl?: string
    jobTitle?: string
    company?: string
    location?: string
    descriptionSnippet?: string
    reasonSnippet?: string
  }
  const jobUrl = rawArgs.jobUrl?.trim()
  if (!jobUrl) {
    return { ok: false, phase: 'navigate', detail: 'No job URL provided.' }
  }

  const args: EasyApplyArgs = { ...rawArgs, jobUrl }

  const traceTitle = String(args.jobTitle || '').trim() || 'Unknown role'
  const traceCompany = String(args.company || '').trim() || 'Unknown company'
  easyApplyTraceBegin({ jobUrl, jobTitle: traceTitle, company: traceCompany })

  let totalFieldsAttempted = 0
  let totalFieldsFilled = 0
  let totalFieldsSkipped = 0
  let pausedReason: string | null = null

  const checkStop = (): EasyApplyResult | null => {
    if (shouldStop?.()) {
      return { ok: false, phase: 'navigate', detail: 'Stopped by user.' }
    }
    return null
  }

  try {
    // Phase 1: Preflight
    const preflightResult = await easyApplyPreflight(args)
    if (preflightResult.earlyExit) return preflightResult.earlyExit

    let stopped = checkStop()
    if (stopped) return stopped

    const { profile, profileFieldMap, resumeTextForFit } = preflightResult

    appLog.info('[easy-apply] Starting application:', jobUrl)

    // Phase 2: Navigate
    const navResult = await easyApplyNavigate(jobUrl, onProgress, traceTitle)
    if (navResult) return navResult

    stopped = checkStop()
    if (stopped) return stopped

    // Phase 3: Click Easy Apply button
    const clickResult = await easyApplyClickApplyButton(onProgress, jobUrl)
    if (clickResult.earlyExit) return clickResult.earlyExit

    stopped = checkStop()
    if (stopped) return stopped

    // Phase 4: Form-fill loop
    const formResult = await easyApplyFillFormLoop(
      args,
      profile,
      profileFieldMap,
      resumeTextForFit,
      clickResult.sduiApplyUrl,
      onProgress
    )

    // Update counters from form loop for use in post-loop logic and finally block
    totalFieldsAttempted = formResult.counters.totalFieldsAttempted
    totalFieldsFilled = formResult.counters.totalFieldsFilled
    totalFieldsSkipped = formResult.counters.totalFieldsSkipped
    pausedReason = formResult.counters.pausedReason
    const coverLetterMetaForHistory = formResult.counters.coverLetterMetaForHistory

    if (formResult.earlyExit) return formResult.earlyExit

    applyTrace('easy_apply:post_loop', {
      outcome: pausedReason ? 'paused' : 'stuck_or_incomplete',
      totalFieldsAttempted,
      totalFieldsFilled,
      totalFieldsSkipped,
      pausedReason: pausedReason ?? undefined
    })

    // Phase 5: Verify submission
    const verifyResult = await easyApplyVerifySubmission(args, formResult.counters, onProgress)
    if (verifyResult) return verifyResult

    // Final fallback: record as needs_review unless the detail is a non-actionable
    // Easy Apply unavailable case (then mark as failed for clearer UX).
    const sess = getActiveEasyApplySessionId()
    const finalUserDetail = pausedReason
      ? `${pausedReason} Filled ${totalFieldsFilled}/${totalFieldsAttempted} fields${totalFieldsSkipped > 0 ? ` (${totalFieldsSkipped} pre-filled by LinkedIn)` : ''}.`
      : `Auto-fill paused after ${totalFieldsFilled}/${totalFieldsAttempted} fields${totalFieldsSkipped > 0 ? ` (${totalFieldsSkipped} pre-filled by LinkedIn)` : ''}.`
    const markUnavailable = detailSuggestsEasyApplyUnavailable(finalUserDetail)
    const finalOutcome = markUnavailable ? 'failed' : 'needs_review'
    const coverTag =
      coverLetterMetaForHistory?.mode === 'tailored'
        ? ' cover=tailored'
        : coverLetterMetaForHistory?.mode === 'generated'
          ? ' cover=generated'
          : coverLetterMetaForHistory?.mode === 'static'
            ? ' cover=static'
            : ''
    const rec = appendApplicationRecord({
      company: String(args.company || '').trim() || 'Unknown company',
      title: String(args.jobTitle || '').trim() || 'Unknown role',
      location: String(args.location || '').trim() || undefined,
      jobUrl,
      easyApply: true,
      atsId: 'linkedin_easy_apply',
      source: 'linkedin_easy_apply',
      outcome: finalOutcome,
      detail: historyDetailWithSession(`${finalUserDetail}${coverTag}`, sess),
      descriptionSnippet: String(args.descriptionSnippet || '').trim() || undefined,
      reasonSnippet: String(args.reasonSnippet || '').trim() || undefined,
      easyApplySessionId: sess ?? undefined,
      coverLetterMeta: coverLetterMetaForHistory,
      stuckFieldLabels: formResult.counters.stuckFieldLabels
    })

    if (finalOutcome === 'needs_review') {
      applyTrace('easy_apply:final_needs_review', {
        recordId: rec.id,
        totalFieldsAttempted,
        totalFieldsFilled,
        totalFieldsSkipped,
        pausedReason: pausedReason ?? undefined
      })
    } else {
      applyTrace('easy_apply:final_failed_unavailable', {
        recordId: rec.id,
        totalFieldsAttempted,
        totalFieldsFilled,
        totalFieldsSkipped,
        pausedReason: pausedReason ?? undefined
      })
    }

    return {
      ok: false,
      phase: 'submit',
      detail: pausedReason ? finalUserDetail : `We may have submitted this application but couldn't confirm. Filled ${totalFieldsFilled}/${totalFieldsAttempted} fields${totalFieldsSkipped > 0 ? ` (${totalFieldsSkipped} pre-filled by LinkedIn)` : ''}. Check LinkedIn to verify.`,
      fieldsAttempted: totalFieldsAttempted,
      fieldsFilled: totalFieldsFilled,
      recordId: rec.id,
      stuckFieldLabels: formResult.counters.stuckFieldLabels
    }
  } finally {
    easyApplyTraceEnd({
      lastTotals: {
        attempted: totalFieldsAttempted,
        filled: totalFieldsFilled,
        skipped: totalFieldsSkipped
      },
      pausedReason: pausedReason ?? undefined
    })
    // Cleanup: dismiss the Easy Apply modal + any "Save this application?" dialog.
    // BUT: if the form is stuck on fields the user needs to answer, leave the modal open
    // so they can see which questions are unfilled on LinkedIn.
    if (pausedReason) {
      appLog.info('[assistant] form stuck — leaving Easy Apply modal open for user to review')
    } else {
      try {
        await easyApplyBridgeCommand('DISMISS_EASY_APPLY', {}, 'submit', 'cleanup_dismiss', 10_000)
      } catch (e) { appLog.debug('[assistant] dismiss easy-apply cleanup failed', e instanceof Error ? e.message : String(e)) }
      try {
        const { sendCommand: sc } = await import('../bridge')
        await sc('DISMISS_MODAL', {}, 5_000)
      } catch (e) { appLog.debug('[assistant] dismiss save dialog failed', e instanceof Error ? e.message : String(e)) }
    }
  }
}
