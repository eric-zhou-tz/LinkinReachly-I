/**
 * Phase 1: Preflight — validate extension health, profile readiness, and build
 * the profile-to-field mapping.
 */

import { existsSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'
import type { ApplicantProfile } from '@core/application-types'
import { buildEasyApplyProfileFieldMap } from '@core/easy-apply-field-map'
import { scoreResumeAgainstJobDescription } from '@core/resume-jd-fit'
import { loadApplicantProfile } from '../applicant-profile-store'
import { loadSettings } from '../settings'
import { applyTrace } from '../apply-trace'
import { appLog } from '../app-log'
import { runEasyApplyExtensionPreflight } from './shared'
import type { EasyApplyArgs, EasyApplyResult } from './shared'

/** Result of the preflight phase — either an early exit or all data needed for subsequent phases. */
export type EasyApplyPreflightOk = {
  earlyExit: null
  profile: ApplicantProfile
  profileFieldMap: Record<string, string>
  resumeTextForFit: string
}
export type EasyApplyPreflightResult =
  | EasyApplyPreflightOk
  | { earlyExit: EasyApplyResult }

/**
 * Validate extension health, profile readiness, and build the profile→field
 * mapping. Returns an early-exit EasyApplyResult when a blocking condition is
 * detected, or the data bag needed by the later phases.
 */
export async function easyApplyPreflight(
  args: EasyApplyArgs
): Promise<EasyApplyPreflightResult> {
  const profile = loadApplicantProfile()
  if (!profile.basics.fullName || !profile.basics.email) {
    applyTrace('easy_apply:blocked', { reason: 'profile_incomplete' })
    const missing = [!profile.basics.fullName && 'name', !profile.basics.email && 'email'].filter(Boolean).join(' and ')
    return { earlyExit: { ok: false, phase: 'navigate', detail: `Profile incomplete — ${missing} required. Open Settings → Application profile to add.` } }
  }

  const preflight = await runEasyApplyExtensionPreflight()
  if (preflight) {
    applyTrace('easy_apply:blocked', { reason: 'preflight', phase: preflight.phase, detail: preflight.detail?.slice(0, 200) })
    return { earlyExit: preflight }
  }

  const profileFieldMap = buildEasyApplyProfileFieldMap(profile)
  applyTrace('easy_apply:profile_map_ready', { mappedKeys: Object.keys(profileFieldMap).length })

  const jdSnippet = String(args.descriptionSnippet || '').trim()
  let resumeTextForFit = ''
  const resumeAsset = profile.assets.find((a) => a.kind === 'resume')
  if (resumeAsset?.storagePath && existsSync(resumeAsset.storagePath)) {
    const ext = extname(resumeAsset.storagePath).toLowerCase()
    if (ext === '.md' || ext === '.txt' || ext === '.markdown') {
      try {
        resumeTextForFit = readFileSync(resumeAsset.storagePath, 'utf8').slice(0, 50_000)
      } catch (err) {
        appLog.warn("[easy-apply] Read resume text file failed:", resumeAsset?.storagePath, err instanceof Error ? err.message : String(err))
      }
    }
  }
  const settingsPreview = loadSettings()
  if (!resumeTextForFit.trim() && settingsPreview.resumeText?.trim()) {
    resumeTextForFit = settingsPreview.resumeText.trim().slice(0, 50_000)
  }
  if (jdSnippet.length > 40 && resumeTextForFit.length > 80) {
    const fit = scoreResumeAgainstJobDescription(resumeTextForFit, jdSnippet)
    applyTrace('easy_apply:resume_jd_overlap', {
      score0to100: fit.score0to100,
      matchedSample: fit.matchedTerms.slice(0, 16)
    })
  }

  return { earlyExit: null, profile, profileFieldMap, resumeTextForFit }
}
