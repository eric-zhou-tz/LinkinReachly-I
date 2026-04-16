/**
 * Phase 5: Verify submission — post-loop safety net that checks if the page
 * shows a success screen after the form-fill loop completes.
 */

import { applyTrace, getActiveEasyApplySessionId } from '../apply-trace'
import { appendApplicationRecord } from '../application-history-store'
import { appLog } from '../app-log'
import {
  easyApplyBridgeCommand,
  historyDetailWithSession,
  isStaleExtensionResult
} from './shared'
import type { EasyApplyArgs, EasyApplyFormCounters, EasyApplyResult } from './shared'

/**
 * After the form-fill loop completes without a confirmed submission, check
 * the page one more time for success indicators.  Returns a success
 * EasyApplyResult when the page shows a success screen, or null.
 */
export async function easyApplyVerifySubmission(
  args: EasyApplyArgs,
  counters: EasyApplyFormCounters,
  onProgress?: (phase: string) => void
): Promise<EasyApplyResult | null> {
  onProgress?.('Verifying submission...')
  // ── Post-loop safety net: check if the page actually shows success ──
  // The step loop may fail to detect success (timing, SDUI rendering, etc.)
  // but the application may have gone through on LinkedIn's side.
  // Retry up to 4 times with increasing delays — LinkedIn's confirmation page
  // can take several seconds to render, especially on slow connections.
  const VERIFY_ATTEMPTS = 4
  const VERIFY_DELAYS = [0, 2000, 3000, 4000]

  for (let verifyAttempt = 0; verifyAttempt < VERIFY_ATTEMPTS; verifyAttempt++) {
    if (verifyAttempt > 0) {
      await new Promise((r) => setTimeout(r, VERIFY_DELAYS[verifyAttempt] ?? 3000))
    }
    try {
      applyTrace('easy_apply:post_loop_success_check', { hint: 'safety net', attempt: verifyAttempt })
      const successCheck = await easyApplyBridgeCommand(
        'CHECK_SUCCESS_SCREEN',
        {},
        'submit',
        'post_loop_success_check',
        15_000
      )
      const successData = 'data' in successCheck ? successCheck.data : undefined
      const detailLower = String(
        'detail' in successCheck ? successCheck.detail || '' : ''
      ).toLowerCase()
      const successProbeHit =
        !isStaleExtensionResult(successCheck) &&
        successCheck.ok &&
        (successData === 'submit' ||
          detailLower.includes('success_screen') ||
          detailLower.includes('success_badge') ||
          detailLower.includes('application_success'))
      if (successProbeHit) {
        appLog.info('[easy-apply] Post-loop success check: application WAS submitted', {
          detail: 'detail' in successCheck ? successCheck.detail : '',
          attempt: verifyAttempt
        })
        applyTrace('easy_apply:post_loop_success_confirmed', {
          detail: String(successCheck.detail || '').slice(0, 200),
          attempt: verifyAttempt
        })
        const sess = getActiveEasyApplySessionId()
        const baseDetail = `Filled ${counters.totalFieldsFilled}/${counters.totalFieldsAttempted} fields (${counters.totalFieldsSkipped} pre-filled by LinkedIn). Confirmed via post-loop check (attempt ${verifyAttempt + 1}).`
        const coverTag =
          counters.coverLetterMetaForHistory?.mode === 'tailored'
            ? ' cover=tailored'
            : counters.coverLetterMetaForHistory?.mode === 'generated'
              ? ' cover=generated'
              : counters.coverLetterMetaForHistory?.mode === 'static'
                ? ' cover=static'
                : ''
        const rec = appendApplicationRecord({
          company: String(args.company || '').trim() || 'Unknown company',
          title: String(args.jobTitle || '').trim() || 'Unknown role',
          location: String(args.location || '').trim() || undefined,
          jobUrl: args.jobUrl,
          easyApply: true,
          atsId: 'linkedin_easy_apply',
          source: 'linkedin_easy_apply',
          outcome: counters.totalFieldsFilled > 0 || counters.totalFieldsSkipped > 0 ? 'autofilled' : 'submitted',
          detail: historyDetailWithSession(`${baseDetail}${coverTag}`, sess),
          descriptionSnippet: String(args.descriptionSnippet || '').trim() || undefined,
          reasonSnippet: String(args.reasonSnippet || '').trim() || undefined,
          easyApplySessionId: sess ?? undefined,
          coverLetterMeta: counters.coverLetterMetaForHistory
        })
        return {
          ok: true,
          phase: 'done',
          detail: `Application submitted (confirmed via post-loop check). ${baseDetail}`,
          fieldsAttempted: counters.totalFieldsAttempted,
          fieldsFilled: counters.totalFieldsFilled,
          recordId: rec.id
        }
      }
      applyTrace('easy_apply:post_loop_success_negative', {
        detail: String(successCheck.detail || '').slice(0, 200),
        attempt: verifyAttempt
      })
    } catch (checkErr) {
      applyTrace('easy_apply:post_loop_success_check_error', {
        message: checkErr instanceof Error ? checkErr.message : String(checkErr),
        attempt: verifyAttempt
      })
    }
  }
  return null
}
