/**
 * Form field extraction with SDUI retry logic.
 * Extracted from fill-form.ts for modularity.
 */

import type { ApplicationCoverLetterMeta } from '@core/application-types'
import { applyTrace, getActiveEasyApplySessionId, summarizeFormFieldsStep } from '../apply-trace'
import { appendApplicationRecord } from '../application-history-store'
import { appLog } from '../app-log'
import {
  cdpAdvanceModalSingleShot,
  cdpClickModalAdvanceButton,
  cdpExtractFormFields,
  easyApplyBridgeCommand,
  historyDetailWithSession,
  isStaleExtensionResult
} from './shared'
import type { EasyApplyResult } from './shared'

export type FormField = {
  label: string
  type: string
  value?: string
  required?: boolean
  options?: string[]
}

type ExtractFieldsResult = {
  fields: FormField[]
  modalEverFound: boolean
  /** Non-null when extraction triggered a stale-extension early exit. */
  earlyExit: EasyApplyResult | null
  pausedReason: string | null
  /** True if SDUI navigation was attempted during extraction. */
  sduiNavigationAttempted: boolean
}

/**
 * Extract form fields from the current Easy Apply modal step.
 * Retries up to MAX_EXTRACT_RETRIES times with increasing delays for SDUI.
 * On step 0, falls back to SDUI URL navigation and early success check.
 */
export async function extractFormFieldsWithRetry(opts: {
  step: number
  sduiApplyUrl: string | undefined
  sduiNavigationAttempted: boolean
  modalEverFound: boolean
  args: { company?: string; jobTitle?: string; location?: string; descriptionSnippet?: string; reasonSnippet?: string; jobUrl: string }
  counters: { totalFieldsAttempted: number; totalFieldsFilled: number; totalFieldsSkipped: number; pausedReason: string | null; coverLetterMetaForHistory: unknown }
}): Promise<ExtractFieldsResult> {
  const { step, sduiApplyUrl, args } = opts
  let { sduiNavigationAttempted, modalEverFound } = opts
  let pausedReason: string | null = null
  let formFields: FormField[] = []

  const MAX_EXTRACT_RETRIES = 6
  let extractResult: Awaited<ReturnType<typeof easyApplyBridgeCommand>> | null = null

  try {
    for (let exAttempt = 0; exAttempt < MAX_EXTRACT_RETRIES; exAttempt++) {
      if (exAttempt > 0) {
        const waitMs = exAttempt <= 2 ? 2000 : exAttempt <= 4 ? 3000 : 4000
        appLog.info('[easy-apply] retry EXTRACT_FORM_FIELDS', { step, attempt: exAttempt + 1, waitMs })
        applyTrace('easy_apply:extract_retry', { step, attempt: exAttempt + 1 })
        await new Promise((r) => setTimeout(r, waitMs))
      }

      // Expand repeatable cards on first attempt
      if (exAttempt === 0) {
        try {
          const expandRes = await easyApplyBridgeCommand(
            'EXPAND_REPEATABLE_CARDS', {}, 'fill_fields', 'expand_repeatables'
          )
          if (isStaleExtensionResult(expandRes)) {
            return { fields: [], modalEverFound, earlyExit: expandRes as EasyApplyResult, pausedReason: null, sduiNavigationAttempted }
          }
          const clicked = (expandRes.data as { clicked?: unknown } | undefined)?.clicked
          if (expandRes.ok && typeof clicked === 'number' && clicked > 0) {
            applyTrace('easy_apply:expand_repeatables', { step, clicked })
            await new Promise((r) => setTimeout(r, 500))
          }
        } catch (err) { appLog.warn("[easy-apply] Expand repeatables failed (step " + step + "):", err instanceof Error ? err.message : String(err)) }
      }

      extractResult = await easyApplyBridgeCommand(
        'EXTRACT_FORM_FIELDS', {}, 'fill_fields', 'extract_form'
      )
      if (isStaleExtensionResult(extractResult)) {
        return { fields: [], modalEverFound, earlyExit: extractResult as EasyApplyResult, pausedReason: null, sduiNavigationAttempted }
      }

      if (extractResult.ok && Array.isArray(extractResult.data)) {
        formFields = extractResult.data as FormField[]
        modalEverFound = true
        applyTrace('easy_apply:extract_ok', summarizeFormFieldsStep(step, formFields))

        // Modal found but 0 fields → this is likely a "Continue to next step" overview page.
        // Use CDP trusted click (isTrusted:true) to advance — LinkedIn's React buttons
        // silently ignore JavaScript .click() and dispatchEvent calls.
        if (formFields.length === 0 && exAttempt === 0) {
          appLog.info('[easy-apply] Modal found but 0 fields — single-shot CDP advance', { step })
          applyTrace('easy_apply:zero_fields_try_advance', { step })
          try {
            // Single-shot: click + extract in one debugger session (avoids race conditions)
            const singleShot = await cdpAdvanceModalSingleShot(4000)
            if (singleShot?.ok && singleShot.fields.length > 0) {
              formFields = singleShot.fields as FormField[]
              appLog.info('[easy-apply] Single-shot CDP advance found fields!', {
                step, button: singleShot.clickedButton, count: formFields.length
              })
              applyTrace('easy_apply:cdp_single_shot_ok', {
                step, button: singleShot.clickedButton, fields: formFields.length
              })
              break
            }
            // Single-shot clicked but got 0 fields — log diagnostic
            if (singleShot) {
              appLog.info('[easy-apply] Single-shot CDP advance: 0 fields after click', {
                step, button: singleShot.clickedButton,
                modalText: singleShot.modalText?.slice(0, 200),
                inputCount: singleShot.inputCount,
                detail: singleShot.detail
              })
              applyTrace('easy_apply:cdp_single_shot_empty', {
                step, button: singleShot.clickedButton,
                modalTextSnippet: singleShot.modalText?.slice(0, 200),
                inputCount: singleShot.inputCount
              })
            }
            // Fallback: multi-round-trip CDP click (different timing/approach)
            const cdpResult = await cdpClickModalAdvanceButton()
            if (cdpResult?.ok) {
              appLog.info('[easy-apply] Fallback CDP click', { step, button: cdpResult.buttonText })
              applyTrace('easy_apply:cdp_advance_clicked', { step, button: cdpResult.buttonText })
              await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000))
              const cdpFields = await cdpExtractFormFields()
              if (cdpFields?.ok && cdpFields.fields.length > 0) {
                formFields = cdpFields.fields as FormField[]
                appLog.info('[easy-apply] CDP fallback extraction found fields!', { step, count: formFields.length })
                applyTrace('easy_apply:cdp_fallback_ok', { step, fields: formFields.length })
                break
              }
            }
          } catch (e) {
            appLog.debug('[easy-apply] CDP advance past overview failed', e instanceof Error ? e.message : String(e))
          }
        }

        // If modal found but 0 fields, SDUI form may still be loading —
        // retry on step 0 (full retries + SDUI nav) or step > 0 (limited retries)
        // On retry 2+, try CDP extraction directly (content script may not see fields)
        if (formFields.length === 0 && exAttempt >= 1 && exAttempt <= 3) {
          try {
            const cdpFallback = await cdpExtractFormFields()
            if (cdpFallback?.ok && cdpFallback.fields.length > 0) {
              formFields = cdpFallback.fields as FormField[]
              appLog.info('[easy-apply] CDP fallback extraction found fields on retry', { step, attempt: exAttempt + 1, count: formFields.length })
              applyTrace('easy_apply:cdp_fallback_extract_ok', { step, attempt: exAttempt + 1, fields: formFields.length })
              break
            } else if (cdpFallback) {
              applyTrace('easy_apply:cdp_fallback_extract_empty', { step, attempt: exAttempt + 1, diagnostic: cdpFallback.diagnostic })
            }
          } catch (e) { appLog.debug('[easy-apply] CDP fallback extraction error', e instanceof Error ? e.message : String(e)) }
        }

        if (formFields.length === 0 && exAttempt < MAX_EXTRACT_RETRIES - 1) {
          const maxEmptyRetries = step === 0 ? MAX_EXTRACT_RETRIES - 1 : 2
          if (exAttempt < maxEmptyRetries) {
            applyTrace('easy_apply:extract_zero_fields_retry', { step, attempt: exAttempt + 1 })
            // After 3 retries with 0 fields on step 0, try SDUI URL navigation
            if (step === 0 && exAttempt === 2 && sduiApplyUrl && !sduiNavigationAttempted) {
              sduiNavigationAttempted = true
              appLog.info('[easy-apply] 0 fields after 3 retries — navigating to SDUI apply URL', { sduiApplyUrl })
              applyTrace('easy_apply:sdui_navigate_mid_retry', { sduiApplyUrl })
              try {
                const sduiNav = await easyApplyBridgeCommand('NAVIGATE', { url: sduiApplyUrl }, 'navigate', 'navigate')
                if (sduiNav.ok) await new Promise((r) => setTimeout(r, 5000))
              } catch (err) { appLog.warn("[easy-apply] SDUI navigate mid-retry failed (step " + step + "):", err instanceof Error ? err.message : String(err)) }
            }
            continue
          }
        }
        break
      }

      const detail = String(extractResult.detail || '')
      const retryModal = detail.includes('modal_not_found') && exAttempt < MAX_EXTRACT_RETRIES - 1
      applyTrace('easy_apply:extract_not_ok', {
        step, attempt: exAttempt + 1, willRetry: retryModal, detail: detail.slice(0, 400)
      })
      if (retryModal) continue

      // Step 0 modal-not-found: try SDUI fallback navigation
      if (detail.includes('modal_not_found') && step === 0) {
        if (sduiApplyUrl && !sduiNavigationAttempted) {
          sduiNavigationAttempted = true
          appLog.info('[easy-apply] Modal not found after click — navigating to SDUI apply URL', { sduiApplyUrl })
          applyTrace('easy_apply:sdui_navigate_fallback', { sduiApplyUrl })
          try {
            const sduiNav = await easyApplyBridgeCommand('NAVIGATE', { url: sduiApplyUrl }, 'navigate', 'navigate')
            if (sduiNav.ok) {
              await new Promise((r) => setTimeout(r, 5000))
              const retryExtract = await easyApplyBridgeCommand('EXTRACT_FORM_FIELDS', {}, 'fill_fields', 'extract_form')
              const retryData = 'data' in retryExtract ? retryExtract.data : undefined
              if (retryExtract.ok && Array.isArray(retryData)) {
                formFields = retryData as FormField[]
                modalEverFound = true
                applyTrace('easy_apply:sdui_extract_ok', summarizeFormFieldsStep(step, formFields))
              } else {
                applyTrace('easy_apply:sdui_extract_still_failed', {
                  detail: String(retryExtract.detail || '').slice(0, 400)
                })
              }
            }
          } catch (sduiErr) {
            applyTrace('easy_apply:sdui_navigate_error', {
              message: sduiErr instanceof Error ? sduiErr.message : String(sduiErr)
            })
          }
          if (formFields.length > 0) break
        }
        appLog.warn('[easy-apply] Modal not accessible after retries (SDUI/slow mount). Running diagnostic...')
        applyTrace('easy_apply:modal_not_found_step0', {
          hint: 'SDUI/COMEET — may need manual interaction or iframe handling'
        })

        // Capture page state diagnostic
        try {
          const stepDiag = await easyApplyBridgeCommand('DIAGNOSE_EASY_APPLY', {}, 'fill_fields', 'step0_modal_diag', 10_000)
          const stepDiagData = 'data' in stepDiag ? stepDiag.data as Record<string, unknown> : {}
          const stepUrl = String(stepDiagData.url || '')
          applyTrace('easy_apply:step0_page_diagnostic', {
            url: stepUrl.slice(0, 200),
            modalRootFound: stepDiagData.modalRootFound,
            sduiFormFieldCount: stepDiagData.sduiFormFieldCount,
            artdecoModals: stepDiagData.artdecoModals,
            roleDialogs: stepDiagData.roleDialogs,
            easyApplyModals: stepDiagData.easyApplyModals,
            hasInteropOutlet: stepDiagData.hasInteropOutlet,
            sduiTotalElements: stepDiagData.sduiTotalElements
          })
          if (stepUrl && !stepUrl.includes('linkedin.com')) {
            appLog.warn('[easy-apply] Page redirected away from LinkedIn', { url: stepUrl.slice(0, 200) })
            applyTrace('easy_apply:external_redirect_detected', { url: stepUrl.slice(0, 200) })
            pausedReason = `Easy Apply failed — page redirected to external site: ${new URL(stepUrl).hostname}`
            break
          }
        } catch (err) { appLog.warn("[easy-apply] Step-0 modal diagnostic failed:", err instanceof Error ? err.message : String(err)) }
        if (pausedReason) break

        // Early success check: single-step Easy Apply may have already submitted
        const earlyResult = await checkEarlySuccess(step, args, opts.counters)
        if (earlyResult) {
          return { fields: [], modalEverFound, earlyExit: earlyResult, pausedReason: null, sduiNavigationAttempted }
        }
      }
    }
  } catch (extractErr) {
    appLog.warn('[easy-apply] Could not extract form fields at step', step)
    applyTrace('easy_apply:extract_exception', {
      step, message: extractErr instanceof Error ? extractErr.message : String(extractErr)
    })
  }

  return { fields: formFields, modalEverFound, earlyExit: null, pausedReason, sduiNavigationAttempted }
}

/** Check if the application was already auto-submitted (single-step Easy Apply). */
async function checkEarlySuccess(
  step: number,
  args: { company?: string; jobTitle?: string; location?: string; descriptionSnippet?: string; reasonSnippet?: string; jobUrl: string },
  counters: { totalFieldsAttempted: number; totalFieldsFilled: number; totalFieldsSkipped: number; coverLetterMetaForHistory: unknown }
): Promise<EasyApplyResult | null> {
  try {
    const earlyCheck = await easyApplyBridgeCommand(
      'CHECK_SUCCESS_SCREEN', {}, 'submit', 'early_success_check_modal_gone', 10_000
    )
    const earlyData = 'data' in earlyCheck ? earlyCheck.data : undefined
    const earlyDetail = String('detail' in earlyCheck ? earlyCheck.detail || '' : '').toLowerCase()
    const earlyHit =
      !isStaleExtensionResult(earlyCheck) &&
      earlyCheck.ok &&
      (earlyData === 'submit' || earlyDetail.includes('success_screen') || earlyDetail.includes('success_badge'))

    if (earlyHit) {
      appLog.info('[easy-apply] Early success: application was already submitted (modal gone)', {
        detail: 'detail' in earlyCheck ? earlyCheck.detail : ''
      })
      applyTrace('easy_apply:early_success_confirmed', {
        detail: String(earlyCheck.detail || '').slice(0, 200)
      })
      const sess = getActiveEasyApplySessionId()
      const clMeta = counters.coverLetterMetaForHistory as { mode?: string } | undefined
      const coverTag = clMeta?.mode === 'tailored' ? ' cover=tailored'
        : clMeta?.mode === 'generated' ? ' cover=generated'
        : clMeta?.mode === 'static' ? ' cover=static' : ''
      const baseDetail = `Application auto-submitted (single-step). Confirmed via early success check.`
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
        coverLetterMeta: clMeta as ApplicationCoverLetterMeta | undefined
      })
      return {
        ok: true,
        phase: 'done',
        detail: `Application submitted (auto). ${baseDetail}`,
        fieldsAttempted: counters.totalFieldsAttempted,
        fieldsFilled: counters.totalFieldsFilled,
        recordId: rec.id
      }
    }

    applyTrace('easy_apply:early_success_negative', {
      detail: String(earlyCheck.detail || '').slice(0, 200)
    })
  } catch (checkErr) {
    applyTrace('easy_apply:early_success_check_error', {
      message: checkErr instanceof Error ? checkErr.message : String(checkErr)
    })
  }
  return null
}
