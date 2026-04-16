/**
 * File upload handling for Easy Apply forms (resume + cover letter).
 * Extracted from fill-form.ts for modularity.
 */

import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import type { ApplicantAsset, ApplicantProfile, ApplicationCoverLetterMeta } from '@core/application-types'
import { classifyEasyApplyFileFieldLabel, planEasyApplyFileUploads } from '@core/easy-apply-file-upload'
import { applyTrace } from '../apply-trace'
import { loadSettings } from '../settings'
import { appLog } from '../app-log'
import {
  bridgeDetailIsUnknownAction,
  easyApplyBridgeCommand,
  isStaleExtensionResult,
  staleExtensionEasyApplyResult
} from './shared'
import type { EasyApplyResult, EasyApplyArgs } from './shared'
import type { FormField } from './fill-form-extract'

/** Convert an applicant asset to a bridge upload payload (base64-encoded). */
function applicantAssetToBridgePayload(
  asset: ApplicantAsset
): { fileName: string; mimeType: string; base64: string } | null {
  if (!asset.storagePath || !existsSync(asset.storagePath)) return null
  try {
    const buf = readFileSync(asset.storagePath)
    const ext = (asset.fileName || asset.storagePath).split('.').pop()?.toLowerCase() || 'pdf'
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      txt: 'text/plain',
      rtf: 'application/rtf'
    }
    return {
      fileName: asset.fileName || `document.${ext}`,
      mimeType: mimeMap[ext] || 'application/octet-stream',
      base64: buf.toString('base64')
    }
  } catch (err) {
    appLog.warn("[easy-apply] Read asset file failed:", asset.storagePath, err instanceof Error ? err.message : String(err))
    return null
  }
}

type FileUploadResult = {
  /** Non-null when a stale extension or manual-upload pause triggers early exit. */
  earlyExit: EasyApplyResult | null
  pausedReason: string | null
  coverLetterMetaForHistory: ApplicationCoverLetterMeta | undefined
}

/**
 * Handle file uploads for the current form step.
 * Uploads resume and/or cover letter as needed, with optional AI cover tailoring.
 */
export async function handleFileUploads(opts: {
  step: number
  formFields: FormField[]
  profile: ApplicantProfile
  args: EasyApplyArgs
  resumeTextForFit: string
  counters: { totalFieldsAttempted: number; totalFieldsFilled: number; totalFieldsSkipped: number; pausedReason: string | null; coverLetterMetaForHistory: ApplicationCoverLetterMeta | undefined }
}): Promise<FileUploadResult> {
  const { step, formFields, profile, args, resumeTextForFit, counters } = opts
  let coverLetterMetaForHistory = counters.coverLetterMetaForHistory
  let pausedReason: string | null = null

  const fileFieldsAll = formFields.filter((f) => f.type === 'file')
  if (fileFieldsAll.length === 0) {
    return { earlyExit: null, pausedReason: null, coverLetterMetaForHistory }
  }

  const coverFileFields = fileFieldsAll.filter(
    (f) => classifyEasyApplyFileFieldLabel(f.label) === 'cover_letter'
  )
  const formHasCoverFileSlot = coverFileFields.length > 0
  const coverFileRequired = coverFileFields.some((f) => f.required)
  const resumeUp = profile.assets.find((a) => a.kind === 'resume')
  const coverUp = profile.assets.find((a) => a.kind === 'cover_letter')
  const hasResumePath = !!(resumeUp?.storagePath && existsSync(resumeUp.storagePath))
  const hasCoverPath = !!(coverUp?.storagePath && existsSync(coverUp.storagePath))

  const settingsStep = loadSettings()
  let tailoredCoverLocal: string | null = null

  const tailorAllowed =
    formHasCoverFileSlot &&
    settingsStep.easyApplyTailorCoverLetter &&
    !settingsStep.reviewBeforeSubmit &&
    settingsStep.llmEnabled

  const generateFromScratchAllowed =
    formHasCoverFileSlot &&
    !hasCoverPath &&
    !tailorAllowed &&
    settingsStep.llmEnabled &&
    !settingsStep.reviewBeforeSubmit &&
    (resumeTextForFit.trim().length > 40 || String(args.descriptionSnippet || '').trim().length > 40)

  try {
    if (tailorAllowed || generateFromScratchAllowed) {
      const { tailorCoverLetterToPdf } = await import('../cover-letter-tailor')
      const tailored = await tailorCoverLetterToPdf({
        profile,
        coverAsset: coverUp,
        jobTitle: String(args.jobTitle || '').trim(),
        company: String(args.company || '').trim(),
        jdSnippet: String(args.descriptionSnippet || '').trim(),
        resumeSummary: resumeTextForFit,
        settings: settingsStep,
        modelLabel: settingsStep.llmModel
      })
      if (tailored) {
        tailoredCoverLocal = tailored.path
        coverLetterMetaForHistory = tailored.meta
      }
    } else if (
      formHasCoverFileSlot &&
      settingsStep.easyApplyTailorCoverLetter &&
      settingsStep.reviewBeforeSubmit
    ) {
      applyTrace('easy_apply:cover_tailor_skipped_review_before_submit', {})
    }

    const hasCoverEffective = hasCoverPath || !!tailoredCoverLocal
    if (formHasCoverFileSlot && !hasCoverEffective && coverFileRequired) {
      applyTrace('easy_apply:cover_required_no_source', {
        step, hasCoverPath, tailorOn: settingsStep.easyApplyTailorCoverLetter, llmOn: settingsStep.llmEnabled
      })
      if (!pausedReason) {
        pausedReason =
          'This step requires a cover letter file. In Application Assistant: upload a cover PDF and/or save a "Base letter for AI tailoring" and enable "Tailor cover per job" for automatic PDF generation.'
      }
    }
    const uploadTargets = planEasyApplyFileUploads(fileFieldsAll, hasResumePath, hasCoverEffective)
    applyTrace('easy_apply:file_upload_plan', { step, targets: uploadTargets.join(',') })

    for (const target of uploadTargets) {
      if (target === 'resume') {
        if (!resumeUp?.storagePath || !existsSync(resumeUp.storagePath)) continue
        const payload = applicantAssetToBridgePayload(resumeUp)
        if (!payload) continue
        try {
          applyTrace('easy_apply:resume_upload_send', {
            step, fileName: resumeUp.fileName, target: 'resume', base64Chars: payload.base64.length
          })
          const u0 = Date.now()
          const uploadResult = await easyApplyBridgeCommand(
            'UPLOAD_EASY_APPLY_FILE', { ...payload, target: 'resume' }, 'fill_fields', 'upload_resume', 120_000
          )
          if (isStaleExtensionResult(uploadResult)) {
            return { earlyExit: uploadResult as EasyApplyResult, pausedReason: null, coverLetterMetaForHistory }
          }
          applyTrace('easy_apply:resume_upload_recv', {
            step, ms: Date.now() - u0, ok: uploadResult.ok, detail: String(uploadResult.detail || '').slice(0, 400)
          })
          if (bridgeDetailIsUnknownAction(uploadResult.detail)) {
            return {
              earlyExit: staleExtensionEasyApplyResult('fill_fields', 'upload_resume'),
              pausedReason: null, coverLetterMetaForHistory
            }
          }
          if (!uploadResult.ok) {
            const uploadDetail = String(uploadResult.detail || '').trim().toLowerCase()
            if (uploadDetail.includes('manual')) {
              pausedReason = 'Resume upload needs manual confirmation in the browser file picker.'
              appLog.warn('[easy-apply] Resume upload requires manual confirmation.')
              applyTrace('easy_apply:resume_upload_manual_required', { step })
              break
            }
          }
        } catch (upErr) {
          applyTrace('easy_apply:resume_upload_exception', {
            step, message: upErr instanceof Error ? upErr.message : String(upErr)
          })
        }
      } else if (target === 'cover_letter') {
        let payload: { fileName: string; mimeType: string; base64: string } | null = null
        let staticBytes: number | undefined
        if (tailoredCoverLocal) {
          try {
            const buf = readFileSync(tailoredCoverLocal)
            payload = { fileName: 'Cover-letter-tailored.pdf', mimeType: 'application/pdf', base64: buf.toString('base64') }
          } catch (err) { appLog.warn('[easy-apply] Read tailored cover letter failed:', err instanceof Error ? err.message : String(err)); payload = null }
        }
        if (!payload && coverUp?.storagePath && existsSync(coverUp.storagePath)) {
          payload = applicantAssetToBridgePayload(coverUp)
          if (payload) {
            try { staticBytes = statSync(coverUp.storagePath).size } catch (err) { appLog.warn("[easy-apply] Stat cover letter file failed:", err instanceof Error ? err.message : String(err)); staticBytes = undefined }
          }
        }
        if (!payload) {
          if (tailoredCoverLocal) { try { unlinkSync(tailoredCoverLocal) } catch (err) { appLog.warn('[easy-apply] Cover letter temp cleanup failed:', err instanceof Error ? err.message : String(err)) } tailoredCoverLocal = null }
          continue
        }
        try {
          applyTrace('easy_apply:cover_upload_send', {
            step, fileName: payload.fileName, target: 'cover_letter', base64Chars: payload.base64.length
          })
          const u0 = Date.now()
          const uploadResult = await easyApplyBridgeCommand(
            'UPLOAD_EASY_APPLY_FILE', { ...payload, target: 'cover_letter' }, 'fill_fields', 'upload_cover', 120_000
          )
          if (isStaleExtensionResult(uploadResult)) {
            return { earlyExit: uploadResult as EasyApplyResult, pausedReason: null, coverLetterMetaForHistory }
          }
          applyTrace('easy_apply:cover_upload_recv', {
            step, ms: Date.now() - u0, ok: uploadResult.ok, detail: String(uploadResult.detail || '').slice(0, 400)
          })
          if (bridgeDetailIsUnknownAction(uploadResult.detail)) {
            return {
              earlyExit: staleExtensionEasyApplyResult('fill_fields', 'upload_cover'),
              pausedReason: null, coverLetterMetaForHistory
            }
          }
          if (uploadResult.ok && !coverLetterMetaForHistory && staticBytes != null) {
            coverLetterMetaForHistory = { mode: 'static', fileBytes: staticBytes }
          }
        } catch (upErr) {
          applyTrace('easy_apply:cover_upload_exception', {
            step, message: upErr instanceof Error ? upErr.message : String(upErr)
          })
        } finally {
          if (tailoredCoverLocal) { try { unlinkSync(tailoredCoverLocal) } catch (err) { appLog.warn('[easy-apply] Cover letter temp cleanup failed:', err instanceof Error ? err.message : String(err)) } tailoredCoverLocal = null }
        }
      }

      await new Promise((r) => setTimeout(r, 450 + Math.random() * 200))
    }
  } catch (e) {
    appLog.warn('[easy-apply] file upload block:', e instanceof Error ? e.message : String(e))
    if (tailoredCoverLocal) { try { unlinkSync(tailoredCoverLocal) } catch (err) { appLog.warn('[easy-apply] Cover letter temp cleanup failed:', err instanceof Error ? err.message : String(err)) } }
  }

  return { earlyExit: null, pausedReason, coverLetterMetaForHistory }
}
