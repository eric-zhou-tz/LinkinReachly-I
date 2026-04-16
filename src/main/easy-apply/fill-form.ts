/**
 * Phase 4: Form-fill step loop — multi-step form extraction, profile fill,
 * AI fallback, file uploads, and submit/next advancement.
 *
 * Heavy sub-phases are delegated to:
 *  - fill-form-extract.ts  (field extraction with SDUI retry)
 *  - fill-form-upload.ts   (resume + cover letter file uploads)
 */

import type { ApplicantProfile } from '@core/application-types'
import { easyApplyFieldAppearsFilled, pickHearAboutSelectOption } from '@core/easy-apply-field-state'
import {
  buildEasyApplyBehavioralContextPromptBlock,
  buildEasyApplyImmutableFactsPromptBlock,
  classifyApplicationQuestionIntent,
  coerceAiAnswerToProfileLocation,
  commutableDistanceScreeningAnswer,
  dedupeRepeatedScreeningLabel,
  isEasyApplyFactualRiskRadioLabel,
  profileFillValueForLabel
} from '@core/easy-apply-factual-helpers'
import { resolveEducationFieldOverridesByIndex } from '@core/easy-apply-field-map'
import { normalizeFieldLabelForSnapshotMatch } from '@core/field-name-aliases'
import { applyTrace, getActiveEasyApplySessionId, summarizeBridgeDataPreview } from '../apply-trace'
import { appendApplicationRecord } from '../application-history-store'
import { loadSettings } from '../settings'
import { appLog } from '../app-log'
import {
  cdpClickModalAdvanceButton,
  easyApplyBridgeCommand,
  historyDetailWithSession,
  isStaleExtensionResult
} from './shared'
import type { EasyApplyArgs, EasyApplyFormCounters, EasyApplyResult } from './shared'
import { extractFormFieldsWithRetry } from './fill-form-extract'
import type { FormField } from './fill-form-extract'
import { handleFileUploads } from './fill-form-upload'

// ────────────────────────────────────────────────────────────────────────────
// Humanized timing helpers
// ────────────────────────────────────────────────────────────────────────────

/** Human-like delay between filling form fields (1.5–3.5s with jitter). */
function humanFieldDelay(): Promise<void> {
  const ms = 1500 + Math.random() * 2000
  return new Promise((r) => setTimeout(r, ms))
}

/** Shorter delay for skipped/pre-filled fields (0.5–1.2s). */
function humanSkipDelay(): Promise<void> {
  const ms = 500 + Math.random() * 700
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * "Reading the question" pause before filling a field.
 * Short fields (name, phone): 0.8–2s
 * Complex/long questions (screening): 2–5s
 * With ~15% chance of a "deep think" pause (4–8s) for hard questions.
 * Source: PMC 7701271 "fixation >4s = long pause"
 */
function humanReadDelay(fieldLabel?: string): Promise<void> {
  const label = String(fieldLabel || '').toLowerCase()
  const isComplexQuestion =
    label.length > 40 ||
    /\b(?:describe|explain|why|how many|experience|background|years of|tell us|what is your)\b/i.test(label)

  let ms: number
  if (isComplexQuestion) {
    // Complex screening question — longer read time
    ms = 2000 + Math.random() * 3000
    // 15% chance of "deep think" — reading carefully, considering the answer
    if (Math.random() < 0.15) {
      ms += 3000 + Math.random() * 5000
    }
  } else {
    // Simple field (name, phone, etc.)
    ms = 800 + Math.random() * 1200
  }
  return new Promise((r) => setTimeout(r, ms))
}

function extractLastJsonObject(text: string): string | null {
  const lastBrace = text.lastIndexOf('}')
  if (lastBrace < 0) return null
  for (let i = lastBrace; i >= 0; i--) {
    if (text[i] === '{') {
      const candidate = text.slice(i, lastBrace + 1)
      try { JSON.parse(candidate); return candidate } catch { /* try wider */ }
    }
  }
  return null
}

function sanitizeNumericValue(val: string): string {
  const stripped = val.replace(/[^\d.]/g, '')
  const dotIdx = stripped.indexOf('.')
  if (dotIdx < 0) return stripped
  return stripped.slice(0, dotIdx + 1) + stripped.slice(dotIdx + 1).replace(/\./g, '')
}

function resolveFieldIndex(formFields: FormField[], field: FormField): number | undefined {
  const idx = formFields.indexOf(field)
  return idx >= 0 ? idx : undefined
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers (screening question heuristics + coercion)
// ────────────────────────────────────────────────────────────────────────────

/** Detect consecutive modal steps that extract identical fields. */
function easyApplyStepSignature(
  fields: Array<{ label: string; type: string; options?: string[] }>
): string {
  if (!fields.length) return '__empty__'
  return [...fields]
    .map((f) => {
      const opts = (f.options || []).join('\x1e')
      return `${f.type}\x1f${f.label}\x1f${opts}`
    })
    .sort()
    .join('\n')
}

const EASY_APPLY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function optionsLookLikeUuids(options: string[] | undefined): boolean {
  if (!options?.length) return false
  return options.every((o) => EASY_APPLY_UUID_RE.test(String(o).trim()))
}

function guessBinaryYesNoForScreeningQuestion(
  rawLabel: string,
  jobTitle: string,
  profile?: ApplicantProfile
): 'Yes' | 'No' | null {
  const label = dedupeRepeatedScreeningLabel(rawLabel).toLowerCase()
  const title = String(jobTitle || '').toLowerCase()

  if (
    /\b(?:will you|do you)\b[\s\S]{0,120}\brequire\b[\s\S]{0,80}\b(?:visa|h-?1b|immigration)\b[\s\S]{0,40}\bsponsorship\b/i.test(label) ||
    /\bh-?1b\s+sponsorship\b/i.test(label)
  ) {
    if (profile?.workAuth?.requiresSponsorship === true) return 'Yes'
    if (profile?.workAuth?.requiresSponsorship === false) return 'No'
    return null
  }

  if (/\bcdl\s*[ab]\b|\bcommercial driver'?s?\s+license\b|\bdo you have cd\b/i.test(label) && /\bnon[-\s]?cdl\b/i.test(title)) return 'No'

  if (/\b(?:are you )?comfortable\b|\bcan you (?:safely )?lift\b|\b(?:able|willing) to lift\b|\blegally authorized|eligible to work|right to work\b|\bdo you have (?:at least )?\d+\s*(?:year|yr)s? of\b|\bdo you have (?:a )?valid\b|\bclear driving\b|\bvalid dot\b|\bcomfortable working around\b|\bmedical waste\b|\bneedles\b|\bchemo\b|\bbox truck\b/i.test(label)) return 'Yes'

  if (/\bare you at least 18\b|\bover 18\b|\bhigh school diploma\b|\bcan you pass a (?:drug|background)\b/i.test(label)) return 'Yes'

  if (/\b(?:us|u\.s\.)\s*citizen\b|\bpermanent\s*resident\b|\bgreen\s*card\b/i.test(label)) {
    if (profile?.workAuth?.authorizedToWork === true) return 'Yes'
    if (profile?.workAuth?.authorizedToWork === false) return 'No'
    return null
  }

  if (/\baligned with (?:the )?compensation\b|\bcomfortable with (?:the )?(?:salary|compensation|pay)\b|\baccept (?:the )?(?:salary|pay|compensation) range\b/i.test(label)) return 'Yes'
  if (/\bhave you (?:ever )?worked (?:for|at) /i.test(label)) return 'No'
  if (/\bcommut(?:ing|able|e)\s+distance\b|\bwithin\s+(?:a\s+)?commut/i.test(label)) return null
  if (/\bprotected veteran|veteran status|disability status|voluntary self.?identification|userra/i.test(label)) return null

  return null
}

function guessCdlTriRadioAnswer(rawLabel: string, jobTitle: string): 'Yes' | 'No' | null {
  const label = dedupeRepeatedScreeningLabel(rawLabel).toLowerCase()
  if (!/\bcdl\b/.test(label)) return null
  if (/\bnon[-\s]?cdl\b/i.test(String(jobTitle || '').toLowerCase())) return 'No'
  return null
}

function coerceEasyApplyRadioAiValue(
  field: { label: string; type: string; options?: string[] },
  raw: string,
  jobTitle: string,
  profile: ApplicantProfile,
  jobLocation?: string
): string {
  if (field.type !== 'radio') return raw
  const v = String(raw || '').trim()
  const opts = field.options || []
  const n = opts.length
  if (n < 2 || !optionsLookLikeUuids(opts) || !EASY_APPLY_UUID_RE.test(v)) return raw
  if (n !== 2) return guessCdlTriRadioAnswer(field.label, jobTitle) ?? raw

  const commute = commutableDistanceScreeningAnswer(field.label, profile, jobLocation)
  if (commute) return commute

  const label = dedupeRepeatedScreeningLabel(field.label).toLowerCase()
  const g = guessBinaryYesNoForScreeningQuestion(field.label, jobTitle, profile)
  if (g) return g
  if (isEasyApplyFactualRiskRadioLabel(field.label)) {
    appLog.warn('[easy-apply] Not defaulting factual-risk binary radio to Yes', { label: field.label.slice(0, 120) })
    return raw
  }
  appLog.warn('[easy-apply] Unknown binary radio — leaving AI answer as-is (no default)', { label: field.label.slice(0, 100) })
  return raw
}

// ────────────────────────────────────────────────────────────────────────────
// Phase type
// ────────────────────────────────────────────────────────────────────────────

/** Result of the form-fill loop. */
export type EasyApplyFormLoopResult = {
  earlyExit: EasyApplyResult | null
  counters: EasyApplyFormCounters
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-phase: profile-based field fill
// ────────────────────────────────────────────────────────────────────────────

/** Identity labels that the profile should always override, even if LinkedIn pre-filled them. */
const IDENTITY_OVERRIDE_RE = /^(?:phone|phone number|mobile phone number|email|email address|first name|last name|full name|full legal name|legal name|city|state|postal code|zip code|address|street address|address line 1|country|linkedin|linkedin url|linkedin profile url)$/i

function findProfileMatchKey(
  labelLower: string,
  labelNormLower: string,
  profileFieldMap: Record<string, string>
): string | undefined {
  let matchKey = Object.keys(profileFieldMap).find((k) => k.toLowerCase() === labelLower)
  if (!matchKey) matchKey = Object.keys(profileFieldMap).find((k) => k.toLowerCase() === labelNormLower)
  if (!matchKey) {
    matchKey = Object.keys(profileFieldMap).find((k) => {
      const kl = k.toLowerCase()
      const shorter = Math.min(kl.length, labelLower.length)
      const longer = Math.max(kl.length, labelLower.length)
      if (shorter < 6 || shorter / longer < 0.4) return false
      const wordBoundary = new RegExp(`\\b${kl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      return wordBoundary.test(labelLower) || wordBoundary.test(labelNormLower)
    })
  }
  return matchKey
}

/** Fill form fields using the applicant profile field map. Returns the set of filled label keys. */
async function profileFillFields(
  step: number,
  formFields: FormField[],
  profileFieldMap: Record<string, string>,
  profile: ApplicantProfile,
  counters: { totalFieldsAttempted: number; totalFieldsFilled: number; totalFieldsSkipped: number },
  opts?: { forcedValueByIndex?: Record<number, string> }
): Promise<Set<string>> {
  const filledLabels = new Set<string>()
  const profileFillAttempts: { label: string; ok: boolean }[] = []
  const skipLog: { label: string; currentValue: string; profileMatch: boolean; overridden: boolean }[] = []

  for (let idx = 0; idx < formFields.length; idx++) {
    const field = formFields[idx]!
    counters.totalFieldsAttempted++

    const labelLower = field.label.toLowerCase()
    const labelNorm = normalizeFieldLabelForSnapshotMatch(field.label)
    const labelNormLower = labelNorm.toLowerCase()
    const hasForcedOverride = !!(opts?.forcedValueByIndex && Object.prototype.hasOwnProperty.call(opts.forcedValueByIndex, idx))
    const forcedValue = hasForcedOverride ? String(opts?.forcedValueByIndex?.[idx] ?? '') : ''
    const matchKey = findProfileMatchKey(labelLower, labelNormLower, profileFieldMap)
    const rawProfileValue = hasForcedOverride ? forcedValue : (matchKey ? profileFieldMap[matchKey] : '')
    const profileValue = hasForcedOverride
      ? rawProfileValue
      : profileFillValueForLabel(field.label, rawProfileValue, profile)

    if (easyApplyFieldAppearsFilled(field)) {
      const isIdentity = IDENTITY_OVERRIDE_RE.test(field.label.trim())
      const currentValue = String(field.value ?? '').trim()
      const profileDiffers = hasForcedOverride
        ? profileValue !== currentValue
        : (!!profileValue && profileValue !== currentValue)

      if ((isIdentity || hasForcedOverride) && profileDiffers) {
        skipLog.push({ label: field.label.slice(0, 80), currentValue: currentValue.slice(0, 30), profileMatch: true, overridden: true })
        try {
          const fillRes = await easyApplyBridgeCommand(
            'FILL_APPLICATION_FIELD',
            { label: field.label, type: field.type, value: profileValue, allowEmpty: hasForcedOverride, fieldIndex: idx },
            'fill_fields',
            'fill_field_override'
          )
          if (isStaleExtensionResult(fillRes)) return filledLabels
          if (fillRes.ok) {
            counters.totalFieldsFilled++
            filledLabels.add(labelLower)
            profileFillAttempts.push({ label: field.label.slice(0, 80), ok: true })
            await humanFieldDelay()
          } else {
            profileFillAttempts.push({ label: field.label.slice(0, 80), ok: false })
          }
        } catch (err) {
          appLog.warn('[easy-apply] Profile override fill failed:', field.label, err instanceof Error ? err.message : String(err))
          profileFillAttempts.push({ label: field.label.slice(0, 80), ok: false })
        }
        continue
      }

      skipLog.push({ label: field.label.slice(0, 80), currentValue: currentValue.slice(0, 30), profileMatch: !!profileValue, overridden: false })
      counters.totalFieldsSkipped++
      filledLabels.add(labelLower)
      continue
    }

    const shouldFill = hasForcedOverride ? profileValue.length > 0 : !!profileValue
    if (shouldFill) {
      try {
        await humanReadDelay(field.label)
        const fillRes = await easyApplyBridgeCommand(
          'FILL_APPLICATION_FIELD',
          { label: field.label, type: field.type, value: profileValue, fieldIndex: idx },
          'fill_fields',
          'fill_field'
        )
        if (isStaleExtensionResult(fillRes)) {
          return filledLabels
        }
        if (fillRes.ok) {
          counters.totalFieldsFilled++
          filledLabels.add(labelLower)
          profileFillAttempts.push({ label: field.label.slice(0, 80), ok: true })
          await humanFieldDelay()
        } else {
          profileFillAttempts.push({ label: field.label.slice(0, 80), ok: false })
        }
      } catch (err) {
        appLog.warn('[easy-apply] Profile fill field failed:', field.label, err instanceof Error ? err.message : String(err))
        profileFillAttempts.push({ label: field.label.slice(0, 80), ok: false })
      }
    } else {
      applyTrace('easy_apply:profile_no_value_for_field', {
        step, label: field.label.slice(0, 120), type: field.type, required: !!field.required
      })
    }
  }

  applyTrace('easy_apply:profile_fill_round_done', {
    step,
    attemptedThisRound: formFields.length,
    profileFillAttempts: profileFillAttempts.slice(0, 40),
    profileFillAttemptsTruncated: profileFillAttempts.length > 40 ? profileFillAttempts.length - 40 : 0,
    filledLabelsCount: filledLabels.size,
    skippedFields: skipLog.slice(0, 30),
    overriddenCount: skipLog.filter(s => s.overridden).length
  })
  return filledLabels
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-phase: heuristic fill (UUID radios, "hear about" selects)
// ────────────────────────────────────────────────────────────────────────────

async function heuristicFillFields(
  step: number,
  formFields: FormField[],
  unfilledFields: FormField[],
  filledLabels: Set<string>,
  profile: ApplicantProfile,
  args: EasyApplyArgs,
  counters: { totalFieldsFilled: number }
): Promise<void> {
  const jobTitleHint = String(args.jobTitle || '')

  // UUID radio heuristic
  for (const field of unfilledFields) {
    if (field.type !== 'radio' || !optionsLookLikeUuids(field.options)) continue
    const n = field.options!.length
    let yn: 'Yes' | 'No' | null = null
    if (n === 2) {
      yn = commutableDistanceScreeningAnswer(field.label, profile, args.location)
      if (yn == null) yn = guessBinaryYesNoForScreeningQuestion(field.label, jobTitleHint, profile)
    } else if (n === 3) yn = guessCdlTriRadioAnswer(field.label, jobTitleHint)
    if (!yn) continue
    try {
      applyTrace('easy_apply:uuid_radio_heuristic', { step, label: field.label.slice(0, 120), value: yn, optionCount: n })
      await humanReadDelay(field.label)
      const fieldIndex = resolveFieldIndex(formFields, field)
      const fillPayload: { label: string; type: string; value: string; fieldIndex?: number } = {
        label: field.label,
        type: field.type,
        value: yn
      }
      if (fieldIndex != null) fillPayload.fieldIndex = fieldIndex
      const fillRes = await easyApplyBridgeCommand('FILL_APPLICATION_FIELD', fillPayload, 'fill_fields', 'fill_field_uuid_radio_heuristic')
      if (isStaleExtensionResult(fillRes)) return
      if (fillRes.ok) {
        counters.totalFieldsFilled++
        filledLabels.add(field.label.toLowerCase())
        await humanFieldDelay()
      }
    } catch (err) { appLog.warn('[easy-apply] UUID radio heuristic fill failed:', field.label, err instanceof Error ? err.message : String(err)) }
  }

  // "How did you hear about us?" select heuristic
  for (const field of unfilledFields) {
    if (filledLabels.has(field.label.toLowerCase())) continue
    if (field.type !== 'select') continue
    if (!/hear about|how did you (?:find|hear)|where did you hear|referral source|how did you locate/i.test(field.label)) continue
    try {
      const hearValue = pickHearAboutSelectOption(field.options)
      applyTrace('easy_apply:hear_about_select', { step, label: field.label.slice(0, 120), optionPreview: hearValue.slice(0, 60) })
      const fieldIndex = resolveFieldIndex(formFields, field)
      const fillPayload: { label: string; type: string; value: string; fieldIndex?: number } = {
        label: field.label,
        type: field.type,
        value: hearValue
      }
      if (fieldIndex != null) fillPayload.fieldIndex = fieldIndex
      const fillRes = await easyApplyBridgeCommand('FILL_APPLICATION_FIELD', fillPayload, 'fill_fields', 'fill_field_hear_about')
      if (isStaleExtensionResult(fillRes)) return
      if (fillRes.ok) {
        counters.totalFieldsFilled++
        filledLabels.add(field.label.toLowerCase())
        await humanFieldDelay()
      }
    } catch (err) { appLog.warn('[easy-apply] Hear-about select fill failed:', field.label, err instanceof Error ? err.message : String(err)) }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-phase: AI (LLM) batch fill
// ────────────────────────────────────────────────────────────────────────────

async function aiFillFields(
  step: number,
  formFields: FormField[],
  filledLabels: Set<string>,
  profile: ApplicantProfile,
  args: EasyApplyArgs,
  resumeTextForFit: string,
  counters: { totalFieldsFilled: number }
): Promise<void> {
  const unfilledFields = formFields.filter((f) => f.type !== 'file' && !filledLabels.has(f.label.toLowerCase()))
  const stillUnfilled = unfilledFields.filter((f) => !filledLabels.has(f.label.toLowerCase()))

  appLog.info('[easy-apply] AI fallback candidates:', stillUnfilled.length, 'of', formFields.length, 'fields. Labels:', stillUnfilled.map((f) => f.label).join(', '))
  applyTrace('easy_apply:ai_candidates', {
    step, unfilledCount: stillUnfilled.length,
    labels: stillUnfilled.map((f) => f.label.slice(0, 100)),
    requiredUnfilled: stillUnfilled.filter((f) => f.required).map((f) => f.label.slice(0, 100))
  })

  // Pre-fill from screening answer cache
  const answerCache = profile.screeningAnswerCache || {}
  if (stillUnfilled.length > 0 && Object.keys(answerCache).length > 0) {
    for (const field of stillUnfilled) {
      if (filledLabels.has(field.label.toLowerCase())) continue
      const dedupedLabel = dedupeRepeatedScreeningLabel(field.label)
      const normKey = normalizeFieldLabelForSnapshotMatch(dedupedLabel).toLowerCase().replace(/\s+/g, ' ').trim()
      let cached = answerCache[normKey] || answerCache[dedupedLabel.toLowerCase().replace(/\s+/g, ' ').trim()]
      if (!cached) continue
      if (field.type === 'text' && /^\d+[+\s]/.test(cached)) cached = sanitizeNumericValue(cached)
      try {
        await humanReadDelay(field.label)
        const fieldIndex = resolveFieldIndex(formFields, field)
        const fillPayload: { label: string; type: string; value: string; fieldIndex?: number } = {
          label: field.label,
          type: field.type,
          value: cached
        }
        if (fieldIndex != null) fillPayload.fieldIndex = fieldIndex
        const fillRes = await easyApplyBridgeCommand('FILL_APPLICATION_FIELD', fillPayload, 'fill_fields', 'fill_field_cached')
        if (isStaleExtensionResult(fillRes)) return
        if (fillRes.ok) {
          counters.totalFieldsFilled++
          filledLabels.add(field.label.toLowerCase())
          applyTrace('easy_apply:cached_answer_hit', { step, label: field.label.slice(0, 100) })
          await humanFieldDelay()
        }
      } catch (err) { appLog.warn("[easy-apply] Cached answer fill failed:", field.label, err instanceof Error ? err.message : String(err)) }
    }
  }

  const afterCacheUnfilled = stillUnfilled.filter((f) => !filledLabels.has(f.label.toLowerCase()))
  if (afterCacheUnfilled.length === 0) return

  const { getPlanState } = await import('../auth-service')
  const { PLUS_FEATURES } = await import('@core/plan-config')
  const planState = getPlanState()
  if (planState.plan === 'free' && !planState.isTrialing && PLUS_FEATURES.has('ai_vision_fill')) {
    appLog.info('[easy-apply] AI fill skipped — Free plan (profile + answer cache only)')
    applyTrace('easy_apply:ai_gated', { step, reason: 'free_plan', unfilledCount: afterCacheUnfilled.length })
    return
  }

  const llmCandidateFields = afterCacheUnfilled
  try {
    const { callLlmDirect } = await import('../llm')
    const fieldDescriptions = llmCandidateFields.map((f) => {
      let desc = `- "${f.label}" (type: ${f.type})`
      if (f.required) desc += ' [REQUIRED]'
      if (f.options && f.options.length > 0) {
        const uuidLike = optionsLookLikeUuids(f.options)
        if (uuidLike && (f.type === 'radio' || f.type === 'select')) {
          desc += ' [OPTIONS: binary/multiple choice - answer with Yes, No, or visible choice text only; do not use ids]'
        } else {
          desc += ` [OPTIONS: ${f.options.slice(0, 10).join(', ')}]`
        }
      }
      return desc
    }).join('\n')

    const systemPrompt = `${buildEasyApplyImmutableFactsPromptBlock(profile)}

${buildEasyApplyBehavioralContextPromptBlock(profile, resumeTextForFit)}

You are an AI job application assistant. Answer questions in the field list below using the applicant's profile and background.

Rules:
1. Experience/background questions: infer from the resume and work history. For Yes/No about experience, answer "Yes" if background suggests relevant experience.
2. EEO/voluntary disclosure fields (gender, disability, veteran status, ethnicity, USERRA): answer "Decline to self-identify" or "I choose not to self-identify" — whichever option is available.
3. Identity fields already filled by the profile (name, email, phone): use the profile value above. If the profile has the value, provide it. If not, omit.
4. Select/dropdown fields: pick the closest matching option from the provided list. Never invent options.
5. "How did you hear about us?" type fields: answer "LinkedIn" or "Job Board."

Reply ONLY with a JSON object mapping field labels to answer values. Keys MUST exactly match the field labels provided. If you truly cannot determine an answer, omit the key. Never return UUIDs, hashes, or opaque option ids.`

    const userPrompt = `Job: ${args.jobTitle || 'Unknown'} at ${args.company || 'Unknown'}
Location: ${args.location || 'Not specified'}
Description: ${(args.descriptionSnippet || '').slice(0, 300)}

Fill these form fields using the applicant's profile and background:
${fieldDescriptions}

Reply with ONLY a JSON object like: {"Field Label": "value", ...}`

    appLog.info('[easy-apply] Calling LLM for AI fill with', llmCandidateFields.length, 'fields')
    applyTrace('easy_apply:llm_request', { step, fieldCount: llmCandidateFields.length, timeoutMs: 60_000 })
    const raw = await callLlmDirect(systemPrompt, userPrompt, { timeoutMs: 60_000 })
    appLog.info('[easy-apply] LLM response received, length:', raw.length, 'preview:', raw.slice(0, 300))
    applyTrace('easy_apply:llm_response', { step, charLength: raw.length, preview: raw.slice(0, 400) })
    let aiAnswers: Record<string, string> = {}
    try {
      const jsonMatch = extractLastJsonObject(raw)
      if (jsonMatch) aiAnswers = JSON.parse(jsonMatch) as Record<string, string>
    } catch (err) { appLog.warn('[easy-apply] AI response JSON parse failed:', raw.slice(0, 200), err instanceof Error ? err.message : String(err)) }

    const aiAnswersLower: Record<string, string> = {}
    for (const [k, v] of Object.entries(aiAnswers)) aiAnswersLower[k.toLowerCase().trim()] = String(v)

    const jobTitleHint = String(args.jobTitle || '')
    for (const field of llmCandidateFields) {
      let aiValue = aiAnswers[field.label] || aiAnswersLower[field.label.toLowerCase().trim()]
      if (!aiValue) { appLog.info('[easy-apply] No AI answer for field:', field.label); continue }
      aiValue = coerceEasyApplyRadioAiValue(field, String(aiValue), jobTitleHint, profile, args.location)
      aiValue = coerceAiAnswerToProfileLocation(field.label, profile, String(aiValue))
      if (field.type === 'text' && /\b(?:how many years|years of)\b/i.test(field.label)) {
        const profileYears = sanitizeNumericValue(profile.background.yearsOfExperience || '')
        const cleaned = sanitizeNumericValue(String(aiValue))
        aiValue = profileYears || cleaned || String(aiValue)
      }
      if (field.type === 'text' && /^\d+[+\s]/.test(String(aiValue))) aiValue = sanitizeNumericValue(String(aiValue))
      try {
        appLog.info('[easy-apply] AI filling field:', field.label, '->', String(aiValue).slice(0, 50))
        await humanReadDelay(field.label)
        const fieldIndex = resolveFieldIndex(formFields, field)
        const fillPayload: { label: string; type: string; value: string; fieldIndex?: number } = {
          label: field.label,
          type: field.type,
          value: String(aiValue)
        }
        if (fieldIndex != null) fillPayload.fieldIndex = fieldIndex
        const fillRes = await easyApplyBridgeCommand('FILL_APPLICATION_FIELD', fillPayload, 'fill_fields', 'fill_field_ai')
        if (isStaleExtensionResult(fillRes)) return
        if (fillRes.ok) {
          counters.totalFieldsFilled++
          const cleanLabelForCache = dedupeRepeatedScreeningLabel(field.label)
          const cacheKey = normalizeFieldLabelForSnapshotMatch(cleanLabelForCache).toLowerCase().replace(/\s+/g, ' ').trim()
          const existingCached = (profile.screeningAnswerCache || {})[cacheKey]
          if (cacheKey && !existingCached && classifyApplicationQuestionIntent(field.label, field.type) !== 'unknown') {
            try {
              const { saveApplicantProfile } = await import('../applicant-profile-store')
              profile.screeningAnswerCache = { ...(profile.screeningAnswerCache || {}), [cacheKey]: String(aiValue) }
              saveApplicantProfile({ screeningAnswerCache: profile.screeningAnswerCache })
            } catch (err) { appLog.warn('[easy-apply] Save screening answer cache failed:', cacheKey, err instanceof Error ? err.message : String(err)) }
          }
          await humanFieldDelay()
        } else {
          appLog.warn('[easy-apply] AI fill bridge returned not ok for:', field.label, fillRes)
        }
      } catch (err) { appLog.warn('[easy-apply] AI fill failed for field:', field.label, err instanceof Error ? err.message : String(err)) }
    }
  } catch (llmErr) {
    appLog.warn('[easy-apply] AI fallback failed:', llmErr instanceof Error ? llmErr.message : String(llmErr))
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-phase: stuck-form detection + LLM escalation
// ────────────────────────────────────────────────────────────────────────────

type StuckFormResult = {
  action: 'continue' | 'break' | 'proceed'
  pausedReason?: string | null
  stuckFieldLabels?: string[]
}

async function handleStuckForm(
  step: number,
  formFields: FormField[],
  sameFormStreak: number,
  args: EasyApplyArgs,
  profile: ApplicantProfile,
  resumeTextForFit: string,
  counters: { totalFieldsFilled: number }
): Promise<StuckFormResult> {
  // Validation auto-fix on streak 2
  const fieldsWithErrors = formFields.filter((f) => {
    const val = String(f.value || '').trim()
    return val && /[^\d]/.test(val) && /^\d/.test(val) && f.type === 'text'
  })
  const filledRadiosToReclick = formFields.filter((f) => f.type === 'radio' && easyApplyFieldAppearsFilled(f) && f.required)
  if ((fieldsWithErrors.length > 0 || filledRadiosToReclick.length > 0) && sameFormStreak === 2) {
    appLog.info('[easy-apply] Attempting validation auto-fix:', fieldsWithErrors.length, 'numeric errors,', filledRadiosToReclick.length, 'radios to re-click')
    for (const field of fieldsWithErrors) {
      const cleaned = String(field.value).replace(/[^\d]/g, '')
      if (cleaned && cleaned !== String(field.value)) {
        try {
          applyTrace('easy_apply:validation_error_fix', { step, label: field.label.slice(0, 100), original: String(field.value).slice(0, 20), cleaned })
          const fieldIndex = resolveFieldIndex(formFields, field)
          const fillPayload: { label: string; type: string; value: string; fieldIndex?: number } = {
            label: field.label,
            type: field.type,
            value: cleaned
          }
          if (fieldIndex != null) fillPayload.fieldIndex = fieldIndex
          await easyApplyBridgeCommand('FILL_APPLICATION_FIELD', fillPayload, 'fill_fields', 'fill_field_validation_fix')
          await humanSkipDelay()
        } catch (err) { appLog.warn("[easy-apply] Validation fix fill failed (step " + step + "):", field.label, err instanceof Error ? err.message : String(err)) }
      }
    }
    for (const field of filledRadiosToReclick) {
      try {
        applyTrace('easy_apply:radio_reclick', { step, label: field.label.slice(0, 100), currentValue: String(field.value).slice(0, 20) })
        const fieldIndex = resolveFieldIndex(formFields, field)
        const fillPayload: { label: string; type: string; value: string; fieldIndex?: number } = {
          label: field.label,
          type: field.type,
          value: String(field.value)
        }
        if (fieldIndex != null) fillPayload.fieldIndex = fieldIndex
        await easyApplyBridgeCommand('FILL_APPLICATION_FIELD', fillPayload, 'fill_fields', 'fill_field_radio_reclick')
        await humanSkipDelay()
      } catch (err) { appLog.warn("[easy-apply] Radio reclick fill failed (step " + step + "):", field.label, err instanceof Error ? err.message : String(err)) }
    }
    return { action: 'continue' }
  }

  const unfilledRequired = formFields.filter((f) => f.required && !easyApplyFieldAppearsFilled(f) && f.type !== 'file')
  applyTrace('easy_apply:stuck_repeated_form', {
    step, sameFormStreak, signaturePreview: easyApplyStepSignature(formFields).slice(0, 240),
    unfilledRequiredLabels: unfilledRequired.map((f) => f.label.slice(0, 100)),
    unfilledRequiredCount: unfilledRequired.length
  })

  // LLM escalation on streaks 2-3
  const llmEscalationAllowed = unfilledRequired.length > 0 && sameFormStreak >= 2 && sameFormStreak <= 3
  if (llmEscalationAllowed) {
    const attemptNum = sameFormStreak - 1
    appLog.info('[easy-apply] Stuck form detected (attempt', attemptNum, '). LLM escalation for', unfilledRequired.length, 'required fields.')
    try {
      const { callLlmDirect } = await import('../llm')
      const fieldDescs = unfilledRequired.map((f) => {
        const cleanLabel = dedupeRepeatedScreeningLabel(f.label)
        let desc = `- "${cleanLabel}" (type: ${f.type})`
        if (f.options?.length) {
          const uuidLike = optionsLookLikeUuids(f.options)
          if (uuidLike && (f.type === 'radio' || f.type === 'select')) {
            desc += ' [OPTIONS: binary/multiple choice - answer with Yes, No, or visible choice text only; do not use ids]'
          } else {
            desc += ` [options: ${f.options.slice(0, 8).join(', ')}]`
          }
        }
        return desc
      }).join('\n')

      const escalationHint = attemptNum === 1
        ? 'If you truly cannot determine an answer, use a reasonable professional default rather than omitting the key.'
        : 'This is the SECOND attempt. The first answer did not work. Try harder to find answers in the resume and profile. For numeric questions, estimate from the resume. For yes/no, answer based on likely qualifications. If a factual/identity/legal field truly cannot be answered from the profile, respond with "__SKIP__" as the value.'

      const escalationSystem = `${buildEasyApplyImmutableFactsPromptBlock(profile)}

${buildEasyApplyBehavioralContextPromptBlock(profile, resumeTextForFit)}

You are an AI job application assistant. These required fields were not filled by previous attempts. You MUST provide an answer for every field listed.

For experience/background questions, infer from the resume and work history. Answer "Yes" if background suggests relevant experience. For numeric experience questions (e.g. "How many years..."), estimate a concrete number from the resume.

For select/dropdown fields, pick the closest matching option from the provided list.

For factual identity fields (name, address, phone, SSN, work authorization, disability, veteran status), do NOT guess or fabricate — respond with "__SKIP__" as the value so the user can fill it manually.

${escalationHint}

Reply ONLY with a JSON object mapping field labels to values.`
      const llmResponse = await callLlmDirect(
        escalationSystem,
        `Job: ${args.jobTitle || 'Unknown'} at ${args.company || 'Unknown'}\nLocation: ${args.location || 'Not specified'}\nDescription: ${(args.descriptionSnippet || '').slice(0, 300)}\n\nRequired fields (must fill all):\n${fieldDescs}\n\nReply with JSON: {"Field Label": "value"}`,
        { timeoutMs: 30_000, plainText: true }
      )
      const jsonMatch = extractLastJsonObject(llmResponse)
      if (jsonMatch) {
        const answers = JSON.parse(jsonMatch) as Record<string, string>
        let stuckFilled = 0
        for (const field of unfilledRequired) {
          const cleanLabel = dedupeRepeatedScreeningLabel(field.label)
          const val = answers[field.label]
            || answers[cleanLabel]
            || Object.entries(answers).find(([k]) => k.toLowerCase() === field.label.toLowerCase() || k.toLowerCase() === cleanLabel.toLowerCase())?.[1]
          if (!val || val === '__SKIP__') continue
          let cleanVal = String(val)
          if (field.type === 'text' && /^\d+[+\s]/.test(cleanVal)) cleanVal = sanitizeNumericValue(cleanVal)
          try {
            const fieldIndex = resolveFieldIndex(formFields, field)
            const fillPayload: { label: string; type: string; value: string; fieldIndex?: number } = {
              label: field.label,
              type: field.type,
              value: cleanVal
            }
            if (fieldIndex != null) fillPayload.fieldIndex = fieldIndex
            const fillRes = await easyApplyBridgeCommand('FILL_APPLICATION_FIELD', fillPayload, 'fill_fields', 'fill_field_stuck_llm')
            if (fillRes.ok) {
              stuckFilled++
              counters.totalFieldsFilled++
              const cacheKey = normalizeFieldLabelForSnapshotMatch(cleanLabel).toLowerCase().replace(/\s+/g, ' ').trim()
              const existingCachedStuck = (profile.screeningAnswerCache || {})[cacheKey]
              if (cacheKey && !existingCachedStuck) {
                try {
                  const { saveApplicantProfile } = await import('../applicant-profile-store')
                  profile.screeningAnswerCache = { ...(profile.screeningAnswerCache || {}), [cacheKey]: cleanVal }
                  saveApplicantProfile({ screeningAnswerCache: profile.screeningAnswerCache })
                } catch (err) { appLog.warn('[easy-apply] Save screening answer cache (stuck LLM) failed:', cacheKey, err instanceof Error ? err.message : String(err)) }
              }
              await humanFieldDelay()
            }
          } catch (err) { appLog.warn('[easy-apply] Stuck LLM fill field failed (step ' + step + '):', field.label, err instanceof Error ? err.message : String(err)) }
        }
        applyTrace('easy_apply:stuck_llm_escalation_result', { step, attempted: unfilledRequired.length, filled: stuckFilled, attempt: attemptNum })
        if (stuckFilled > 0) {
          appLog.info('[easy-apply] LLM escalation (attempt', attemptNum, ') filled', stuckFilled, 'stuck fields. Retrying advance.')
          return { action: 'continue' }
        }
      }
    } catch (llmErr) {
      applyTrace('easy_apply:stuck_llm_escalation_error', { step, attempt: attemptNum, error: llmErr instanceof Error ? llmErr.message : String(llmErr) })
    }
    if (sameFormStreak === 2) return { action: 'continue' }
  }

  if (unfilledRequired.length === 0 && sameFormStreak === 2) {
    applyTrace('easy_apply:stuck_no_required_unfilled', { step, totalFields: formFields.length, filledCount: formFields.filter(f => easyApplyFieldAppearsFilled(f)).length })
    return { action: 'continue' }
  }

  const escalationStatus = sameFormStreak > 3 ? 'exhausted after 2 attempts' : unfilledRequired.length === 0 ? 'form stuck despite all required fields filled' : 'failed'
  const stuckLabels = unfilledRequired.map(f => f.label)
  return {
    action: 'break',
    pausedReason: `Easy Apply stuck: ${unfilledRequired.length} required field${unfilledRequired.length !== 1 ? 's' : ''} unfilled${stuckLabels.length > 0 ? ` (${stuckLabels.join(', ')})` : ''}. AI form-fill ${escalationStatus}.`,
    stuckFieldLabels: stuckLabels.length > 0 ? stuckLabels : undefined
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-phase: submit / advance step
// ────────────────────────────────────────────────────────────────────────────

type SubmitResult = {
  action: 'return' | 'continue' | 'break'
  earlyExit?: EasyApplyResult | null
  counters?: EasyApplyFormCounters
  pausedReason?: string | null
  stuckFieldLabels?: string[]
}

async function submitOrAdvanceStep(
  step: number,
  formFields: FormField[],
  filledLabels: Set<string>,
  modalEverFound: boolean,
  consecutiveEmptyFieldSteps: number,
  args: EasyApplyArgs,
  counters: EasyApplyFormCounters
): Promise<SubmitResult> {
  if (!modalEverFound && formFields.length === 0) {
      return {
        action: 'break',
        pausedReason: `The Easy Apply form didn't open on this page. The job may have been removed or may not support Easy Apply.`
      }
  }

  // Review-before-submit
  if (loadSettings().reviewBeforeSubmit && step > 0 && formFields.length === 0 && consecutiveEmptyFieldSteps >= 1) {
    applyTrace('easy_apply:paused_for_review', { step, totalFieldsFilled: counters.totalFieldsFilled, totalFieldsAttempted: counters.totalFieldsAttempted })
    return {
      action: 'return',
      earlyExit: {
        ok: false, phase: 'review' as const,
        detail: `Paused for review: filled ${counters.totalFieldsFilled}/${counters.totalFieldsAttempted} fields. Review the form in Chrome, then retry this job to submit.`,
        fieldsAttempted: counters.totalFieldsAttempted, fieldsFilled: counters.totalFieldsFilled, recordId: undefined
      },
      counters
    }
  }

  try {
    applyTrace('easy_apply:submit_or_next_attempt', { step })
    const submitResult = await easyApplyBridgeCommand('SUBMIT_APPLICATION', {}, 'submit', 'submit_step', 60_000)
    if (isStaleExtensionResult(submitResult)) return { action: 'return', earlyExit: submitResult as EasyApplyResult, counters }
    if (submitResult.ok) {
      const marker = String(submitResult.data !== undefined && submitResult.data !== null ? submitResult.data : submitResult.detail || '').toLowerCase()
      const isConfirmedSubmit = submitResult.data === 'submit'
      const isUnconfirmedSubmit = submitResult.data === 'submit_unconfirmed'
      const isSubmit = isConfirmedSubmit || isUnconfirmedSubmit
      applyTrace('easy_apply:submit_result', {
        step, isSubmit, isConfirmedSubmit, isUnconfirmedSubmit,
        marker: marker.slice(0, 120),
        rawData: summarizeBridgeDataPreview('SUBMIT_APPLICATION', submitResult.data)
      })
      if (isSubmit) {
        const sess = getActiveEasyApplySessionId()
        const baseDetail = `Filled ${counters.totalFieldsFilled}/${counters.totalFieldsAttempted} fields (${counters.totalFieldsSkipped} pre-filled by LinkedIn).`
        const coverTag = counters.coverLetterMetaForHistory?.mode === 'tailored' ? ' cover=tailored'
          : counters.coverLetterMetaForHistory?.mode === 'generated' ? ' cover=generated'
          : counters.coverLetterMetaForHistory?.mode === 'static' ? ' cover=static' : ''

        if (isConfirmedSubmit) {
          appLog.info('[easy-apply] Application submitted — success screen confirmed')
          applyTrace('easy_apply:outcome_success', { step, totalFieldsAttempted: counters.totalFieldsAttempted, totalFieldsFilled: counters.totalFieldsFilled, totalFieldsSkipped: counters.totalFieldsSkipped })
          const rec = appendApplicationRecord({
            company: String(args.company || '').trim() || 'Unknown company',
            title: String(args.jobTitle || '').trim() || 'Unknown role',
            location: String(args.location || '').trim() || undefined,
            jobUrl: args.jobUrl, easyApply: true, atsId: 'linkedin_easy_apply', source: 'linkedin_easy_apply',
            outcome: counters.totalFieldsFilled > 0 || counters.totalFieldsSkipped > 0 ? 'autofilled' : 'submitted',
            detail: historyDetailWithSession(`${baseDetail}${coverTag}`, sess),
            descriptionSnippet: String(args.descriptionSnippet || '').trim() || undefined,
            reasonSnippet: String(args.reasonSnippet || '').trim() || undefined,
            easyApplySessionId: sess ?? undefined,
            coverLetterMeta: counters.coverLetterMetaForHistory
          })
          return {
            action: 'return',
            earlyExit: { ok: true, phase: 'done', detail: `Application submitted. ${baseDetail}`, fieldsAttempted: counters.totalFieldsAttempted, fieldsFilled: counters.totalFieldsFilled, recordId: rec.id },
            counters
          }
        }

        appLog.warn('[easy-apply] Submit clicked but success screen not confirmed — recording as needs_review')
        applyTrace('easy_apply:outcome_unconfirmed', { step, totalFieldsAttempted: counters.totalFieldsAttempted, totalFieldsFilled: counters.totalFieldsFilled, totalFieldsSkipped: counters.totalFieldsSkipped, submitDetail: String(submitResult.detail || '').slice(0, 200) })
        const rec = appendApplicationRecord({
          company: String(args.company || '').trim() || 'Unknown company',
          title: String(args.jobTitle || '').trim() || 'Unknown role',
          location: String(args.location || '').trim() || undefined,
          jobUrl: args.jobUrl, easyApply: true, atsId: 'linkedin_easy_apply', source: 'linkedin_easy_apply',
          outcome: 'needs_review',
          detail: historyDetailWithSession(`Submit clicked but not confirmed. ${baseDetail}${coverTag}`, sess),
          descriptionSnippet: String(args.descriptionSnippet || '').trim() || undefined,
          reasonSnippet: String(args.reasonSnippet || '').trim() || undefined,
          easyApplySessionId: sess ?? undefined,
          coverLetterMeta: counters.coverLetterMetaForHistory
        })
        return {
          action: 'return',
          earlyExit: { ok: false, phase: 'submit', detail: `We clicked submit but couldn't confirm the result. ${baseDetail} Check this job on LinkedIn to verify.`, fieldsAttempted: counters.totalFieldsAttempted, fieldsFilled: counters.totalFieldsFilled, recordId: rec.id },
          counters
        }
      }
      // LinkedIn's React buttons ignore JS .click() (isTrusted:false).
      // The content script found the button but may not have actually clicked it.
      // Reinforce with a CDP trusted click to ensure the form advances.
      try {
        const cdpResult = await cdpClickModalAdvanceButton()
        if (cdpResult?.ok) {
          appLog.info('[easy-apply] CDP reinforced advance click', { step, button: cdpResult.buttonText })
          applyTrace('easy_apply:cdp_advance_reinforced', { step, button: cdpResult.buttonText })
        }
      } catch (e) { appLog.debug('[easy-apply] CDP reinforce click failed (non-critical)', e instanceof Error ? e.message : String(e)) }
      const stepAdvanceMs = 2500 + Math.random() * 2000
      await new Promise((r) => setTimeout(r, stepAdvanceMs))
      applyTrace('easy_apply:step_advanced_next', { step, waitMs: Math.round(stepAdvanceMs) })
      return { action: 'continue' }
    }
    applyTrace('easy_apply:submit_not_ok', { step, detail: String(submitResult.detail || '').slice(0, 400) })
  } catch (advErr) {
    appLog.warn('[easy-apply] Could not advance form at step', step)
    applyTrace('easy_apply:advance_exception', { step, message: advErr instanceof Error ? advErr.message : String(advErr) })
  }

  // Could not advance — identify blockers (required + unfilled, regardless of fill attempts)
  const blockers = formFields.filter((f) => f.required && !easyApplyFieldAppearsFilled(f) && f.type !== 'file')
  let pausedReason: string
  let stuckLabels: string[] | undefined
  if (blockers.length > 0) {
    stuckLabels = blockers.map((f) => f.label)
    pausedReason = `${blockers.length} required field${blockers.length !== 1 ? 's' : ''} couldn't be filled automatically. Required field${blockers.length !== 1 ? 's' : ''} unfilled (${stuckLabels.join(', ')}). Open this job on LinkedIn to complete the application.`
  } else if (!modalEverFound && formFields.length === 0) {
    pausedReason = `The Easy Apply form didn't open on this page. The job may have been removed or may not support Easy Apply.`
  } else {
    pausedReason = `We may have submitted this application, but couldn't confirm it. Open this job on LinkedIn to verify.`
  }
  applyTrace('easy_apply:loop_break_no_advance', {
    step, lastFieldCount: formFields.length, pausedReason,
    hint: 'Compare emptyRequiredLabels / radiosUnset in prior easy_apply:extract_ok for this step'
  })
  return { action: 'break', pausedReason, stuckFieldLabels: stuckLabels }
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 4 orchestrator
// ────────────────────────────────────────────────────────────────────────────

/**
 * Multi-step form extraction, profile fill, AI fallback, file uploads, and
 * submit/next advancement.  This is the core loop that walks through each
 * modal step of the Easy Apply form.
 */
export async function easyApplyFillFormLoop(
  args: EasyApplyArgs,
  profile: ApplicantProfile,
  profileFieldMap: Record<string, string>,
  resumeTextForFit: string,
  sduiApplyUrl: string | undefined,
  onProgress?: (phase: string) => void
): Promise<EasyApplyFormLoopResult> {
  onProgress?.('Filling application fields...')
  const MAX_STEPS = 12
  let previousStepSignature: string | null = null
  let sameFormStreak = 0
  let consecutiveEmptyFieldSteps = 0
  let gaveEmptyExtractExtraSubmitPass = false
  let modalEverFound = false
  let sduiNavigationAttempted = false

  const counters: EasyApplyFormCounters = {
    totalFieldsAttempted: 0,
    totalFieldsFilled: 0,
    totalFieldsSkipped: 0,
    pausedReason: null,
    coverLetterMetaForHistory: undefined
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    applyTrace('easy_apply:step_begin', { step, maxSteps: MAX_STEPS })

    // ── Pre-check: did a previous step's button click actually submit? ──
    if (step > 0) {
      try {
        const preCheck = await easyApplyBridgeCommand('CHECK_SUCCESS_SCREEN', {}, 'submit', 'step_pre_success_check', 8_000)
        const preData = 'data' in preCheck ? preCheck.data : undefined
        const preDetail = String('detail' in preCheck ? preCheck.detail || '' : '').toLowerCase()
        const preHit = !isStaleExtensionResult(preCheck) && preCheck.ok &&
          (preData === 'submit' || preDetail.includes('success_screen') || preDetail.includes('success_badge') || preDetail.includes('application_success'))
        if (preHit) {
          appLog.info('[easy-apply] Step pre-check: application already submitted at previous step', { step, detail: preCheck.detail })
          applyTrace('easy_apply:step_pre_success_confirmed', { step, detail: String(preCheck.detail || '').slice(0, 200) })
          const sess = getActiveEasyApplySessionId()
          const baseDetail = `Filled ${counters.totalFieldsFilled}/${counters.totalFieldsAttempted} fields (${counters.totalFieldsSkipped} pre-filled by LinkedIn). Confirmed via step pre-check.`
          const coverTag = counters.coverLetterMetaForHistory?.mode === 'tailored' ? ' cover=tailored'
            : counters.coverLetterMetaForHistory?.mode === 'generated' ? ' cover=generated'
            : counters.coverLetterMetaForHistory?.mode === 'static' ? ' cover=static' : ''
          const rec = appendApplicationRecord({
            company: String(args.company || '').trim() || 'Unknown company',
            title: String(args.jobTitle || '').trim() || 'Unknown role',
            location: String(args.location || '').trim() || undefined,
            jobUrl: args.jobUrl, easyApply: true, atsId: 'linkedin_easy_apply', source: 'linkedin_easy_apply',
            outcome: counters.totalFieldsFilled > 0 || counters.totalFieldsSkipped > 0 ? 'autofilled' : 'submitted',
            detail: historyDetailWithSession(`${baseDetail}${coverTag}`, sess),
            descriptionSnippet: String(args.descriptionSnippet || '').trim() || undefined,
            reasonSnippet: String(args.reasonSnippet || '').trim() || undefined,
            easyApplySessionId: sess ?? undefined,
            coverLetterMeta: counters.coverLetterMetaForHistory
          })
          return {
            earlyExit: { ok: true, phase: 'done' as const, detail: `Application submitted (detected at step ${step} pre-check). ${baseDetail}`, fieldsAttempted: counters.totalFieldsAttempted, fieldsFilled: counters.totalFieldsFilled, recordId: rec.id },
            counters
          }
        }
      } catch (e) { applyTrace('fill_form:step_precheck_failed', { step, error: e instanceof Error ? e.message : String(e) }) }
    }

    // ── Phase A: Extract form fields ──
    const extraction = await extractFormFieldsWithRetry({
      step, sduiApplyUrl, sduiNavigationAttempted, modalEverFound, args, counters
    })
    modalEverFound = extraction.modalEverFound
    sduiNavigationAttempted = extraction.sduiNavigationAttempted
    if (extraction.earlyExit) return { earlyExit: extraction.earlyExit, counters }
    if (extraction.pausedReason) { counters.pausedReason = extraction.pausedReason; break }
    const formFields = extraction.fields

    // ── Stuck-form detection ──
    const stepSig = easyApplyStepSignature(formFields)
    if (formFields.length > 0) {
      consecutiveEmptyFieldSteps = 0
      if (previousStepSignature !== null && stepSig === previousStepSignature) sameFormStreak++
      else sameFormStreak = 0
      previousStepSignature = stepSig

      if (sameFormStreak >= 2) {
        const stuckResult = await handleStuckForm(step, formFields, sameFormStreak, args, profile, resumeTextForFit, counters)
        if (stuckResult.action === 'continue') { if (stuckResult.pausedReason === undefined) { sameFormStreak = 1 }; continue }
        if (stuckResult.action === 'break') { counters.pausedReason = stuckResult.pausedReason ?? null; counters.stuckFieldLabels = stuckResult.stuckFieldLabels; break }
      }
    } else {
      previousStepSignature = null
      sameFormStreak = 0
      consecutiveEmptyFieldSteps++
      if (consecutiveEmptyFieldSteps >= 3) {
        if (!gaveEmptyExtractExtraSubmitPass) {
          gaveEmptyExtractExtraSubmitPass = true
          consecutiveEmptyFieldSteps = 0
          applyTrace('easy_apply:empty_fields_grant_submit_pass', { step, hint: 'Retry loop so SUBMIT_APPLICATION can run on review-only markup' })
        } else {
          counters.pausedReason = 'The application form is open but we couldn\'t read the fields on this page. It may need manual interaction \u2014 open this job on LinkedIn to continue.'
          applyTrace('easy_apply:stuck_empty_field_steps', { step, consecutiveEmptyFieldSteps, hint: 'Modal found but collectApplicationFields returned [] for 3+ steps' })
          break
        }
      }
    }

    // ── Phase B: Profile-based fill ──
    // Resolve education context per school block (supports multi-education
    // repeaters and also corrects wrong pre-filled education values).
    const forcedEduValuesByIndex = resolveEducationFieldOverridesByIndex(formFields, profile.background.educationHistory)
    if (Object.keys(forcedEduValuesByIndex).length > 0) {
      applyTrace('easy_apply:education_context_resolved', {
        step,
        forcedFieldCount: Object.keys(forcedEduValuesByIndex).length,
      })
    }
    const filledLabels = await profileFillFields(
      step,
      formFields,
      profileFieldMap,
      profile,
      counters,
      { forcedValueByIndex: forcedEduValuesByIndex }
    )

    // ── Phase C: Heuristic fill (UUID radios, hear-about selects) ──
    const unfilledFields = formFields.filter((f) => f.type !== 'file' && !filledLabels.has(f.label.toLowerCase()))
    await heuristicFillFields(step, formFields, unfilledFields, filledLabels, profile, args, counters)

    // ── Phase D: AI (LLM) batch fill ──
    await aiFillFields(step, formFields, filledLabels, profile, args, resumeTextForFit, counters)

    // ── Phase E: File uploads ──
    const uploadResult = await handleFileUploads({ step, formFields, profile, args, resumeTextForFit, counters })
    if (uploadResult.earlyExit) return { earlyExit: uploadResult.earlyExit, counters }
    if (uploadResult.coverLetterMetaForHistory) counters.coverLetterMetaForHistory = uploadResult.coverLetterMetaForHistory
    if (uploadResult.pausedReason) { counters.pausedReason = uploadResult.pausedReason; break }

    // ── Phase F: Submit / advance ──
    if (counters.pausedReason) break

    // Pre-submit gate: refuse to advance when required fields are still empty.
    // Submitting with unfilled required fields just triggers LinkedIn validation
    // errors and wastes a round-trip. Pause immediately so the user can answer.
    //
    // NOTE: formFields holds the snapshot from Phase A extraction. Phases B/C/D
    // fill fields via bridge commands (updating the DOM) but do NOT mutate the
    // in-memory objects, so formFields[i].value is still "". We must exclude
    // fields that filledLabels already recorded as successfully filled.
    const unfilledBeforeSubmit = formFields.filter(
      (f) => f.required && !easyApplyFieldAppearsFilled(f) && f.type !== 'file'
            && !filledLabels.has(f.label.toLowerCase())
    )
    if (unfilledBeforeSubmit.length > 0) {
      const labels = unfilledBeforeSubmit.map((f) => f.label)
      applyTrace('easy_apply:pre_submit_gate_blocked', {
        step,
        unfilledCount: unfilledBeforeSubmit.length,
        labels: labels.map((l) => l.slice(0, 100))
      })
      counters.pausedReason = `${unfilledBeforeSubmit.length} required field${unfilledBeforeSubmit.length !== 1 ? 's' : ''} unfilled (${labels.join(', ')}). Answer ${unfilledBeforeSubmit.length === 1 ? 'this question' : 'these questions'} to continue.`
      counters.stuckFieldLabels = labels
      break
    }

    const submitRes = await submitOrAdvanceStep(step, formFields, filledLabels, modalEverFound, consecutiveEmptyFieldSteps, args, counters)
    if (submitRes.action === 'return') return { earlyExit: submitRes.earlyExit ?? null, counters: submitRes.counters ?? counters }
    if (submitRes.action === 'continue') continue
    if (submitRes.action === 'break') { counters.pausedReason = submitRes.pausedReason ?? null; counters.stuckFieldLabels = submitRes.stuckFieldLabels; break }
  }

  return { earlyExit: null, counters }
}
