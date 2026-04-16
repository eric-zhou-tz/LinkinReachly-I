import { useEffect, useMemo, useRef, useState } from 'react'
import type { UserProfileView } from '../../vite-env'
import type { AnswerBankItem, ApplicantProfile, ApplicationInsightsBucket } from '@core/application-types'
import {
  mergeLocalBackupOverProfile,
  readLocalApplicantDraftBackup,
  shouldRestoreFromLocalBackup,
  writeLocalApplicantDraftBackup
} from './applicant-draft-local-backup'
import { useApplicationAssistant } from './useApplicationAssistant'

function nextId(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`
    }
  } catch {
    // ignore and fall back
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function emptyProfile(): ApplicantProfile {
  return {
    version: 1,
    basics: {
      fullName: '',
      email: ''
    },
    links: {},
    workAuth: {
      countryCode: 'US',
      over18: true
    },
    compensation: {},
    background: {},
    assets: [],
    answerBank: [],
    coverLetterTemplate: undefined,
    updatedAt: new Date(0).toISOString()
  }
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ')
}

const INSIGHT_META: Record<string, { icon: string; accent: string }> = {
  'Company types': { icon: '\u25A0', accent: 'var(--brand-500, #3b82f6)' },
  Stages: { icon: '\u25B2', accent: 'var(--emerald-600, #059669)' },
  Industries: { icon: '\u2261', accent: 'var(--amber-500, #f59e0b)' },
  'Work models': { icon: '\u25C6', accent: 'var(--indigo-500, #6366f1)' }
}

function InsightCard({ title, buckets }: { title: string; buckets: ApplicationInsightsBucket[] | undefined }) {
  const meta = INSIGHT_META[title] || { icon: '\u2022', accent: 'var(--neutral-400)' }
  const visible = (buckets || []).filter((b) => b.key !== 'unknown').slice(0, 4)
  return (
    <div className="insight-card" style={{ '--insight-accent': meta.accent } as React.CSSProperties}>
      <div className="insight-card__header">
        <span className="insight-card__icon" aria-hidden="true">{meta.icon}</span>
        <span className="insight-card__title">{title}</span>
      </div>
      {visible.length === 0 ? (
        <span className="insight-card__empty">No data yet</span>
      ) : (
        <div className="insight-card__tags">
          {visible.map((b) => (
            <span key={b.key} className="insight-card__tag">
              {humanize(b.label)}
              <span className="insight-card__count">{b.count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ExtractedProfile({ profile }: { profile: UserProfileView }) {
  const recent = profile.entries?.[0]
  return (
    <details className="extracted-profile">
      <summary className="extracted-profile__summary">
        Resume intelligence
        <span className="extracted-profile__badge">
          {profile.entries?.length || 0} roles, {profile.education?.length || 0} schools
        </span>
      </summary>
      <div className="extracted-profile__body">
        {profile.entries?.length > 0 && (
          <div className="extracted-profile__section">
            <h4 className="extracted-profile__heading">Work experience</h4>
            <ul className="extracted-profile__list">
              {profile.entries.map((e, i) => (
                <li key={i} className="extracted-profile__item">
                  <strong>{e.role}</strong> at {e.company}
                  <span className="extracted-profile__dates">{e.startDate} – {e.endDate}</span>
                  {e.skills?.length > 0 && (
                    <span className="extracted-profile__skills">
                      {e.skills.slice(0, 4).join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {profile.education?.length > 0 && (
          <div className="extracted-profile__section">
            <h4 className="extracted-profile__heading">Education</h4>
            <ul className="extracted-profile__list">
              {profile.education.map((e, i) => (
                <li key={i} className="extracted-profile__item">
                  <strong>{e.degree}{e.field ? `, ${e.field}` : ''}</strong> — {e.institution}
                  {e.graduationYear > 0 && <span className="extracted-profile__dates">{e.graduationYear}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {recent && profile.totalYearsExperience > 0 && (
          <p className="extracted-profile__summary-line">
            {profile.totalYearsExperience} years total experience
            {profile.name ? ` — ${profile.name}` : ''}
          </p>
        )}
      </div>
    </details>
  )
}

function readiness(profile: ApplicantProfile) {
  const resumeAttached = profile.assets.some((asset) => asset.kind === 'resume')
  const checklist = [
    { key: 'name', label: 'Full name', done: !!profile.basics.fullName.trim(), required: true },
    { key: 'email', label: 'Email', done: !!profile.basics.email.trim(), required: true },
    { key: 'resume', label: 'Resume file', done: resumeAttached, required: true },
    { key: 'phone', label: 'Phone', done: !!profile.basics.phone?.trim(), required: false },
    {
      key: 'location',
      label: 'Location',
      done: !!profile.basics.city?.trim() && !!profile.basics.state?.trim() && !!profile.basics.country?.trim(),
      required: false
    },
    {
      key: 'address',
      label: 'Address line + ZIP',
      done: !!profile.basics.addressLine1?.trim() && !!profile.basics.postalCode?.trim(),
      required: false
    },
    { key: 'linkedin', label: 'LinkedIn URL', done: !!profile.links.linkedInUrl?.trim(), required: false },
    {
      key: 'auth',
      label: 'Work authorization',
      done: profile.workAuth.authorizedToWork != null && profile.workAuth.requiresSponsorship != null,
      required: false
    },
    {
      key: 'experience',
      label: 'Years of experience',
      done: !!profile.background.yearsOfExperience?.trim(),
      required: false
    },
    {
      key: 'education',
      label: 'Education summary',
      done: !!profile.background.educationSummary?.trim(),
      required: false
    },
    {
      key: 'timing',
      label: 'Start date or notice period',
      done: !!profile.compensation.startDatePreference?.trim() || !!profile.compensation.noticePeriod?.trim(),
      required: false
    },
    {
      key: 'salary',
      label: 'Salary range (optional)',
      done: profile.compensation.salaryMin != null,
      required: false
    }
  ]
  const completed = checklist.filter((item) => item.done).length
  return {
    checklist,
    completed,
    total: checklist.length,
    requiredMissing: checklist.filter((item) => item.required && !item.done).map((item) => item.label),
    recommendedMissing: checklist.filter((item) => !item.required && !item.done).map((item) => item.label)
  }
}

function normalizeAnswerBank(profile: ApplicantProfile): ApplicantProfile {
  return {
    ...profile,
    answerBank: profile.answerBank.filter((entry) => entry.prompt.trim() || String(entry.answer).trim())
  }
}

/** Sections inside the optional-collapsed block; deep-linking opens the disclosure. */
const APPLY_OPTIONAL_ANCHORS = new Set(['apply-links', 'apply-work-auth', 'apply-screening', 'apply-comp', 'apply-background', 'apply-answers'])

function hashTargetsOptionalField(): boolean {
  if (typeof window === 'undefined') return false
  return APPLY_OPTIONAL_ANCHORS.has(window.location.hash.slice(1))
}

/** Checklist keys that live under “More fields (optional)”. */
const CHECKLIST_OPTIONAL_KEYS = new Set(['linkedin', 'auth', 'experience', 'education', 'timing', 'salary'])

const COMMON_SCREENING_SEEDS: { prompt: string; answerType: AnswerBankItem['answerType'] }[] = [
  { prompt: 'Why are you interested in this role?', answerType: 'text' },
  { prompt: 'Describe your relevant experience', answerType: 'text' },
  { prompt: 'What is your greatest strength?', answerType: 'text' },
  { prompt: 'Tell me about a time you had to manage competing priorities', answerType: 'text' },
  { prompt: 'Describe a challenging project you worked on and your contribution', answerType: 'text' },
  { prompt: 'How do you handle feedback from managers or peers?', answerType: 'text' },
  { prompt: 'Describe a time you worked with someone whose style was very different from yours', answerType: 'text' },
  { prompt: 'What drew you to this company/industry?', answerType: 'text' },
  { prompt: 'Where do you see yourself in 5 years?', answerType: 'text' },
  { prompt: 'Are you comfortable working in a team environment?', answerType: 'boolean' },
  { prompt: 'Are you willing to work overtime or flexible hours?', answerType: 'boolean' },
  { prompt: 'Do you have experience with [your primary skill]?', answerType: 'text' },
  { prompt: 'What languages do you speak fluently?', answerType: 'text' },
  { prompt: 'Do you have any relevant certifications?', answerType: 'text' }
]

/** Debounce for contact / location fields — persists without clicking Save profile. */
const BASICS_AUTOSAVE_MS = 650

/** Throttle writing a full local draft mirror (localStorage) so hard refresh can recover before IPC save. */
const LOCAL_DRAFT_MIRROR_MS = 350

function checklistFocusTarget(key: string): string | null {
  switch (key) {
    case 'name':
      return 'apply-full-name'
    case 'email':
      return 'apply-email'
    case 'resume':
      return 'apply-resume-upload'
    case 'phone':
      return 'apply-phone'
    case 'location':
      return 'apply-city'
    case 'address':
      return 'apply-address-line1'
    case 'linkedin':
      return 'apply-linkedin-url'
    case 'auth':
      return 'apply-work-auth-country'
    case 'experience':
      return 'apply-years-exp'
    case 'education':
      return 'apply-education-summary'
    case 'timing':
      return 'apply-start-date-pref'
    case 'salary':
      return 'apply-salary-min'
    default:
      return null
  }
}

export function ApplicationAssistantPanel({ onNavigateToJobs, onCompletionChange }: { onNavigateToJobs?: () => void; onCompletionChange?: (pct: number) => void } = {}) {
  const assistant = useApplicationAssistant()
  const [draft, setDraft] = useState<ApplicantProfile>(emptyProfile())
  const [optionalOpenFromHash, setOptionalOpenFromHash] = useState(hashTargetsOptionalField)
  const [optionalOpenFromNav, setOptionalOpenFromNav] = useState(false)
  const lastPersistedBasicsJson = useRef<string | null>(null)
  const lastPersistedRestJson = useRef<string | null>(null)
  const [autosaveError, setAutosaveError] = useState<string | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  /** After `loading` clears, next profile application is a fresh fetch (mount or Refresh). */
  const pendingInitialReconcileRef = useRef(true)

  useEffect(() => {
    const onHash = () => setOptionalOpenFromHash(hashTargetsOptionalField)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (assistant.loading) {
      pendingInitialReconcileRef.current = true
      return
    }
    if (!assistant.profile) return

    const isInitialFetch = pendingInitialReconcileRef.current
    pendingInitialReconcileRef.current = false

    if (isInitialFetch) {
      const backup = readLocalApplicantDraftBackup()
      if (backup && shouldRestoreFromLocalBackup(assistant.profile, backup)) {
        const merged = mergeLocalBackupOverProfile(assistant.profile, backup)
        setDraft(merged)
        lastPersistedBasicsJson.current = JSON.stringify(merged.basics)
        lastPersistedRestJson.current = JSON.stringify({ links: merged.links, workAuth: merged.workAuth, compensation: merged.compensation, background: merged.background, coverLetterTemplate: merged.coverLetterTemplate, answerBank: merged.answerBank })
        writeLocalApplicantDraftBackup(merged)
        void assistant.saveProfile({
          basics: merged.basics,
          links: merged.links,
          workAuth: merged.workAuth,
          compensation: merged.compensation,
          background: merged.background,
          coverLetterTemplate: merged.coverLetterTemplate,
          answerBank: merged.answerBank,
          screeningAnswerCache: merged.screeningAnswerCache
        })
        return
      }
      setDraft(assistant.profile)
      lastPersistedBasicsJson.current = JSON.stringify(assistant.profile.basics)
      lastPersistedRestJson.current = JSON.stringify({ links: assistant.profile.links, workAuth: assistant.profile.workAuth, compensation: assistant.profile.compensation, background: assistant.profile.background, coverLetterTemplate: assistant.profile.coverLetterTemplate, answerBank: assistant.profile.answerBank })
      return
    }

    const incomingJson = JSON.stringify(assistant.profile.basics)
    const draftJson = JSON.stringify(draftRef.current.basics)
    if (incomingJson === draftJson) {
      lastPersistedBasicsJson.current = incomingJson
      if (JSON.stringify(assistant.profile.assets) !== JSON.stringify(draftRef.current.assets)) {
        setDraft(prev => ({ ...prev, assets: assistant.profile!.assets }))
      }
      return
    }
    // Async save echoed an older snapshot while the user already typed ahead — do not replace the form.
    if (
      lastPersistedBasicsJson.current != null &&
      incomingJson === lastPersistedBasicsJson.current &&
      draftJson !== incomingJson
    ) {
      return
    }
    setDraft(assistant.profile)
    lastPersistedBasicsJson.current = incomingJson
    lastPersistedRestJson.current = JSON.stringify({ links: assistant.profile.links, workAuth: assistant.profile.workAuth, compensation: assistant.profile.compensation, background: assistant.profile.background, coverLetterTemplate: assistant.profile.coverLetterTemplate, answerBank: assistant.profile.answerBank })
  }, [assistant.loading, assistant.profile, assistant.saveProfile])

  useEffect(() => {
    const flushLocal = () => writeLocalApplicantDraftBackup(draftRef.current)
    window.addEventListener('beforeunload', flushLocal)
    window.addEventListener('pagehide', flushLocal)
    return () => {
      window.removeEventListener('beforeunload', flushLocal)
      window.removeEventListener('pagehide', flushLocal)
    }
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => writeLocalApplicantDraftBackup(draftRef.current), LOCAL_DRAFT_MIRROR_MS)
    return () => window.clearTimeout(t)
  }, [draft])

  useEffect(() => {
    if (assistant.loading || !assistant.profile) return
    const json = JSON.stringify(draft.basics)
    if (json === lastPersistedBasicsJson.current) return
    const t = window.setTimeout(() => {
      void assistant.saveProfile({ basics: draft.basics }, { quiet: true }).then((res) => {
        if (res.ok && 'profile' in res && res.profile) {
          setAutosaveError(null)
          const savedJson = JSON.stringify(res.profile.basics)
          if (savedJson === JSON.stringify(draftRef.current.basics)) {
            lastPersistedBasicsJson.current = savedJson
            writeLocalApplicantDraftBackup(draftRef.current)
          }
        } else if (!res.ok) {
          setAutosaveError('Couldn\u2019t save automatically. Your changes are backed up locally.')
        }
      }).catch(() => {
        setAutosaveError('Couldn\u2019t save automatically. Your changes are backed up locally.')
      })
    }, BASICS_AUTOSAVE_MS)
    return () => window.clearTimeout(t)
  }, [draft.basics, assistant.loading, assistant.profile, assistant.saveProfile])

  const restPayloadJson = useMemo(
    () => JSON.stringify({ links: draft.links, workAuth: draft.workAuth, compensation: draft.compensation, background: draft.background, coverLetterTemplate: draft.coverLetterTemplate, answerBank: draft.answerBank }),
    [draft.links, draft.workAuth, draft.compensation, draft.background, draft.coverLetterTemplate, draft.answerBank]
  )

  useEffect(() => {
    if (assistant.loading || !assistant.profile) return
    if (restPayloadJson === lastPersistedRestJson.current) return
    const t = window.setTimeout(() => {
      const d = draftRef.current
      const payload = normalizeAnswerBank({
        ...d,
        basics: d.basics,
        links: d.links,
        workAuth: d.workAuth,
        compensation: d.compensation,
        background: d.background,
        coverLetterTemplate: d.coverLetterTemplate,
        answerBank: d.answerBank,
        screeningAnswerCache: d.screeningAnswerCache
      })
      void assistant.saveProfile(payload, { quiet: true }).then((res) => {
        if (res.ok && 'profile' in res && res.profile) {
          setAutosaveError(null)
          const savedRestJson = JSON.stringify({ links: res.profile.links, workAuth: res.profile.workAuth, compensation: res.profile.compensation, background: res.profile.background, coverLetterTemplate: res.profile.coverLetterTemplate, answerBank: res.profile.answerBank })
          const currentRestJson = JSON.stringify({ links: draftRef.current.links, workAuth: draftRef.current.workAuth, compensation: draftRef.current.compensation, background: draftRef.current.background, coverLetterTemplate: draftRef.current.coverLetterTemplate, answerBank: draftRef.current.answerBank })
          if (savedRestJson === currentRestJson) {
            lastPersistedRestJson.current = savedRestJson
            writeLocalApplicantDraftBackup(draftRef.current)
          }
        } else if (!res.ok) {
          setAutosaveError('Couldn\u2019t save automatically. Your changes are backed up locally.')
        }
      }).catch(() => {
        setAutosaveError('Couldn\u2019t save automatically. Your changes are backed up locally.')
      })
    }, BASICS_AUTOSAVE_MS)
    return () => window.clearTimeout(t)
  }, [restPayloadJson, assistant.loading, assistant.profile, assistant.saveProfile])

  const readinessState = useMemo(() => readiness(draft), [draft])
  const checklistIncomplete = useMemo(
    () => readinessState.checklist.filter((item) => !item.done),
    [readinessState.checklist]
  )
  const checklistIncompleteVisible = checklistIncomplete.slice(0, 5)
  const checklistIncompleteMore = checklistIncomplete.length - checklistIncompleteVisible.length
  const completionPct = Math.round((readinessState.completed / readinessState.total) * 100)
  useEffect(() => { onCompletionChange?.(completionPct) }, [completionPct, onCompletionChange])
  const resumeAsset = draft.assets.find((asset) => asset.kind === 'resume')
  const coverAsset = draft.assets.find((asset) => asset.kind === 'cover_letter')
  const requiredFocus = readinessState.requiredMissing.length > 0
  const profileSparse = readinessState.completed < 6

  const setAnswerBank = (updater: (entries: AnswerBankItem[]) => AnswerBankItem[]) => {
    setDraft((current) => ({
      ...current,
      answerBank: updater(current.answerBank)
    }))
  }

  const saveDraft = async () => {
    const email = draft.basics.email?.trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAutosaveError('Enter a valid email address.')
      return
    }
    const payload = normalizeAnswerBank({
      ...draft,
      basics: draft.basics,
      links: draft.links,
      workAuth: draft.workAuth,
      compensation: draft.compensation,
      background: draft.background,
      coverLetterTemplate: draft.coverLetterTemplate,
      answerBank: draft.answerBank,
      screeningAnswerCache: draft.screeningAnswerCache
    })
    try {
      const res = await assistant.saveProfile(payload)
      if (res.ok && 'profile' in res && res.profile) {
        writeLocalApplicantDraftBackup(res.profile)
      }
    } catch (err) {
      setAutosaveError(err instanceof Error ? err.message : 'Couldn\u2019t save profile.')
    }
  }

  function jumpToChecklistField(itemKey: string) {
    if (CHECKLIST_OPTIONAL_KEYS.has(itemKey)) {
      setOptionalOpenFromNav(true)
    }
    const focusId = checklistFocusTarget(itemKey)
    window.requestAnimationFrame(() => {
      const el = focusId ? document.getElementById(focusId) : null
      if (el && 'scrollIntoView' in el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        if ('focus' in el && typeof (el as HTMLElement).focus === 'function') {
          try {
            ;(el as HTMLElement).focus({ preventScroll: true })
          } catch {
            ;(el as HTMLElement).focus()
          }
        }
      }
    })
  }

  return (
    <div className="wizard application-assistant">
      <div className="wizard-card" role="region" aria-label="Application profile and checklist">
        {assistant.loading && !assistant.profile && (
          <div className="application-assistant-loading" aria-busy="true">
            <p className="sr-only">Loading application profile and history</p>
            <div className="application-assistant-loading__rows" aria-hidden="true">
              <div className="application-assistant-loading__row" />
              <div className="application-assistant-loading__row application-assistant-loading__row--short" />
            </div>
          </div>
        )}
        <div className="application-assistant__header">
          <h2 className="s-title">Application profile</h2>
          <p className="application-assistant__subtitle">
            Fill once. The extension uses this to autofill job applications.
          </p>
          {assistant.status && (
            readinessState.requiredMissing.length === 0 ? (
              <div className="application-assistant__status application-assistant__status--ready" role="status">
                {'\u2713'} Ready to apply
              </div>
            ) : (
              <div className="application-assistant__status application-assistant__status--missing" role="status">
                {'\u2717'} Missing: {readinessState.requiredMissing.join(', ')}
              </div>
            )
          )}
        </div>

        {assistant.saveFeedback && (
          <div
            className={`wizard-feedback ${assistant.saveFeedback.ok ? 'wizard-feedback--ok' : 'wizard-feedback--error'}`}
            role={assistant.saveFeedback.ok ? 'status' : 'alert'}
            aria-live={assistant.saveFeedback.ok ? 'polite' : 'assertive'}
          >
            {assistant.saveFeedback.detail}
          </div>
        )}

        {autosaveError && (
          <div className="wizard-feedback wizard-feedback--error" role="alert" aria-live="assertive">
            {autosaveError}
          </div>
        )}

        {assistant.detectResult && (
          <div className={`wizard-feedback ${assistant.detectResult.ok ? 'wizard-feedback--ok' : 'wizard-feedback--error'}`} role="status">
            {assistant.detectResult.detail}
          </div>
        )}

        {assistant.error && (
          <div className="wizard-feedback wizard-feedback--error" role="alert">
            <strong>Could not load profile.</strong> {assistant.error}
            <div className="wizard-actions mt-xs">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void assistant.refresh()}>
                Try again
              </button>
            </div>
          </div>
        )}

        <div className="application-checklist" aria-label="Field status">
          <div className="application-checklist__items">
            {checklistIncomplete.length === 0 ? (
              <span className="application-chip application-chip--done">All fields done</span>
            ) : (
              <>
                {checklistIncompleteVisible.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="application-chip application-chip--jump"
                    onClick={() => jumpToChecklistField(item.key)}
                  >
                    Need {item.label}
                  </button>
                ))}
                {checklistIncompleteMore > 0 && (
                  <span
                    className="application-chip application-chip--more"
                    title={checklistIncomplete
                      .slice(5)
                      .map((i) => i.label)
                      .join(', ')}
                  >
                    +{checklistIncompleteMore}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="application-form-grid application-form-grid--profile-top">
          <div className="application-profile-files" aria-label="Application files">
          <section className="application-section" id="apply-resume">
            <h3>Resume</h3>
            <p className="field-hint">Used for Easy Apply uploads. If you uploaded a resume in Settings, it will be parsed to fill your profile fields automatically.</p>
            {resumeAsset ? (
              <div className="application-resume-card">
                <strong>{resumeAsset.fileName}</strong>
                <span>{resumeAsset.mimeType}</span>
              </div>
            ) : (
              <p className="field-hint muted">None attached.</p>
            )}
            <div className="wizard-actions mt-xs">
              <button
                id="apply-resume-upload"
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void assistant.uploadResume()}
                disabled={assistant.uploading}
                aria-busy={assistant.uploading}
              >
                {assistant.uploading ? 'Uploading…' : resumeAsset ? 'Replace file' : 'Upload'}
              </button>
              {resumeAsset && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void assistant.removeResume()} disabled={assistant.saving}>
                  Remove
                </button>
              )}
            </div>
          </section>

          <section className="application-section" id="apply-cover-letter">
            <h3>Cover letter</h3>
            <p className="field-hint">For Easy Apply file fields. AI tailoring uses your API key from Settings.</p>
            {coverAsset ? (
              <div className="application-resume-card">
                <strong>{coverAsset.fileName}</strong>
                <span>{coverAsset.mimeType}</span>
              </div>
            ) : (
              <p className="field-hint muted">No cover file attached.</p>
            )}
            <div className="wizard-actions mt-xs">
              <button
                id="apply-cover-upload"
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void assistant.uploadCoverLetter()}
                disabled={assistant.uploading}
              >
                {assistant.uploading ? 'Uploading…' : coverAsset ? 'Replace cover file' : 'Upload cover file'}
              </button>
              {coverAsset && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void assistant.removeCoverLetter()}
                  disabled={assistant.saving}
                >
                  Remove
                </button>
              )}
            </div>
            <label className="field mt-sm" htmlFor="apply-cover-template">
              Base letter for AI tailoring
              <textarea
                id="apply-cover-template"
                className="application-cover-template"
                rows={7}
                value={draft.coverLetterTemplate || ''}
                placeholder="Paste a sample cover letter. The model adapts it to each job when tailoring is enabled (falls back to text extracted from your cover PDF if this is empty)."
                onChange={(e) => setDraft({ ...draft, coverLetterTemplate: e.target.value })}
              />
            </label>
            <details className="mt-md" open={!!coverAsset || !!(draft.coverLetterTemplate?.trim())}>
              <summary className="field-hint application-cover-ai-toggle">AI tailoring options</summary>
              <fieldset className="mt-xs">
                <label className="field field--inline">
                  <input
                    type="checkbox"
                    checked={assistant.applyCoverPrefs.easyApplyTailorCoverLetter}
                    onChange={(e) => void assistant.saveApplyCoverPref({ easyApplyTailorCoverLetter: e.target.checked })}
                  />{' '}
                  Tailor cover per job (generates PDF, max 512KB)
                </label>
                <label className="field field--inline">
                  <input
                    type="checkbox"
                    checked={assistant.applyCoverPrefs.easyApplyEnrichCompanyContext}
                    onChange={(e) =>
                      void assistant.saveApplyCoverPref({ easyApplyEnrichCompanyContext: e.target.checked })
                    }
                  />{' '}
                  Company-context hints (extra short LLM call)
                </label>
              </fieldset>
            </details>
          </section>
          </div>

          <div className="application-profile-identity">
          <section className="application-section" id="apply-basics">
            <h3>Contact &amp; address</h3>
            <p className="field-hint">Name and mailing address used on applications.</p>
            <div className="grid2">
              <label className="field" htmlFor="apply-full-name">
                Full name
                <input id="apply-full-name" autoComplete="name" value={draft.basics.fullName} onChange={(e) => setDraft({ ...draft, basics: { ...draft.basics, fullName: e.target.value } })} />
              </label>
              <label className="field" htmlFor="apply-email">
                Email
                <input id="apply-email" type="email" autoComplete="email" value={draft.basics.email} onChange={(e) => setDraft({ ...draft, basics: { ...draft.basics, email: e.target.value } })} />
              </label>
              <label className="field" htmlFor="apply-phone">
                Phone
                <input id="apply-phone" type="tel" autoComplete="tel" value={draft.basics.phone || ''} onChange={(e) => setDraft({ ...draft, basics: { ...draft.basics, phone: e.target.value } })} />
              </label>
              <label className="field field-span" htmlFor="apply-address-line1">
                Address line 1
                <input
                  id="apply-address-line1"
                  autoComplete="address-line1"
                  value={draft.basics.addressLine1 || ''}
                  onChange={(e) => setDraft({ ...draft, basics: { ...draft.basics, addressLine1: e.target.value } })}
                />
              </label>
              <label className="field field-span" htmlFor="apply-address-line2">
                Address line 2
                <input
                  id="apply-address-line2"
                  autoComplete="address-line2"
                  value={draft.basics.addressLine2 || ''}
                  onChange={(e) => setDraft({ ...draft, basics: { ...draft.basics, addressLine2: e.target.value } })}
                  placeholder="Apt / Suite / Unit (optional)"
                />
              </label>
              <label className="field" htmlFor="apply-city">
                City
                <input id="apply-city" autoComplete="address-level2" value={draft.basics.city || ''} onChange={(e) => setDraft({ ...draft, basics: { ...draft.basics, city: e.target.value } })} />
              </label>
              <label className="field" htmlFor="apply-state">
                State
                <input id="apply-state" autoComplete="address-level1" value={draft.basics.state || ''} onChange={(e) => setDraft({ ...draft, basics: { ...draft.basics, state: e.target.value } })} />
              </label>
              <label className="field" htmlFor="apply-postal-code">
                ZIP / postal code
                <input
                  id="apply-postal-code"
                  autoComplete="postal-code"
                  value={draft.basics.postalCode || ''}
                  onChange={(e) => setDraft({ ...draft, basics: { ...draft.basics, postalCode: e.target.value } })}
                />
              </label>
              <label className="field" htmlFor="apply-country">
                Country
                <input id="apply-country" autoComplete="country-name" value={draft.basics.country || ''} onChange={(e) => setDraft({ ...draft, basics: { ...draft.basics, country: e.target.value } })} />
              </label>
            </div>
            <div
              className="application-location-block"
              role="group"
              aria-labelledby="apply-location-block-title"
            >
              <h4 className="application-subsection-title" id="apply-location-block-title">
                How forms ask for “where you live”
              </h4>
              <p className="field-hint application-location-block__intro">
                City / state / country stay the source of truth for eligibility and commute. Optional lines below help when employers use
                a single <strong>Location</strong> field or plain-language <strong>residing</strong> questions—they don’t limit where
                you apply (set remote/hybrid intent under <strong>More fields → Work location preference</strong>).
              </p>
              <div className="grid2 application-location-block__fields">
              <label className="field field-span" htmlFor="apply-current-location-line">
                Current location (single line, optional)
                <input
                  id="apply-current-location-line"
                  value={draft.basics.currentLocationLine || ''}
                  onChange={(e) => setDraft({ ...draft, basics: { ...draft.basics, currentLocationLine: e.target.value } })}
                  placeholder="e.g. New York, NY, USA"
                />
              </label>
              <label className="field field-span" htmlFor="apply-current-residence-answer">
                Where you’re currently residing (optional)
                <textarea
                  id="apply-current-residence-answer"
                  rows={3}
                  value={draft.basics.currentResidenceAnswer || ''}
                  onChange={(e) => setDraft({ ...draft, basics: { ...draft.basics, currentResidenceAnswer: e.target.value } })}
                  placeholder="Full sentence if the form asks in plain language. If empty, city / line above are used."
                />
              </label>
              </div>
            </div>
          </section>
          </div>

          <details
            className="application-optional-fields"
            open={!requiredFocus || profileSparse || optionalOpenFromHash || optionalOpenFromNav}
          >
            <summary className="application-optional-fields__summary">Professional details</summary>
            <div className="application-form-grid application-form-grid--optional-nested">
          <section className="application-section" id="apply-links">
            <h3>Links</h3>
            <div className="grid2">
              <label className="field" htmlFor="apply-linkedin-url">
                LinkedIn URL
                <input
                  id="apply-linkedin-url"
                  value={draft.links.linkedInUrl || ''}
                  onChange={(e) => setDraft({ ...draft, links: { ...draft.links, linkedInUrl: e.target.value } })}
                />
              </label>
              <label className="field" htmlFor="apply-website-url">
                Website
                <input
                  id="apply-website-url"
                  value={draft.links.websiteUrl || ''}
                  onChange={(e) => setDraft({ ...draft, links: { ...draft.links, websiteUrl: e.target.value } })}
                />
              </label>
              <label className="field" htmlFor="apply-portfolio-url">
                Portfolio
                <input
                  id="apply-portfolio-url"
                  value={draft.links.portfolioUrl || ''}
                  onChange={(e) => setDraft({ ...draft, links: { ...draft.links, portfolioUrl: e.target.value } })}
                />
              </label>
              <label className="field" htmlFor="apply-github-url">
                GitHub
                <input
                  id="apply-github-url"
                  value={draft.links.githubUrl || ''}
                  onChange={(e) => setDraft({ ...draft, links: { ...draft.links, githubUrl: e.target.value } })}
                />
              </label>
            </div>
          </section>

          <section className="application-section" id="apply-work-auth">
            <h3>Work authorization</h3>
            <div className="grid2">
              <label className="field" htmlFor="apply-work-auth-country">
                Country code
                <input
                  id="apply-work-auth-country"
                  value={draft.workAuth.countryCode}
                  onChange={(e) => setDraft({ ...draft, workAuth: { ...draft.workAuth, countryCode: e.target.value.toUpperCase() } })}
                />
              </label>
              <label className="field" htmlFor="apply-authorized-work">
                Authorized to work?
                <select
                  id="apply-authorized-work"
                  value={draft.workAuth.authorizedToWork == null ? '' : draft.workAuth.authorizedToWork ? 'yes' : 'no'}
                  onChange={(e) => setDraft({
                    ...draft,
                    workAuth: { ...draft.workAuth, authorizedToWork: e.target.value === '' ? undefined : e.target.value === 'yes' }
                  })}
                >
                  <option value="">Not set</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label className="field" htmlFor="apply-sponsorship">
                Need sponsorship?
                <select
                  id="apply-sponsorship"
                  value={draft.workAuth.requiresSponsorship == null ? '' : draft.workAuth.requiresSponsorship ? 'yes' : 'no'}
                  onChange={(e) => setDraft({
                    ...draft,
                    workAuth: { ...draft.workAuth, requiresSponsorship: e.target.value === '' ? undefined : e.target.value === 'yes' }
                  })}
                >
                  <option value="">Not set</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label className="field">
                Clearance eligible?
                <select
                  value={draft.workAuth.clearanceEligible == null ? '' : draft.workAuth.clearanceEligible ? 'yes' : 'no'}
                  onChange={(e) => setDraft({
                    ...draft,
                    workAuth: { ...draft.workAuth, clearanceEligible: e.target.value === '' ? undefined : e.target.value === 'yes' }
                  })}
                >
                  <option value="">Not set</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
            </div>
          </section>

          <section className="application-section" id="apply-screening">
            <h3>Common screening questions</h3>
            <p className="field-hint">&ldquo;Not set&rdquo; is safe — the filler skips the field if the form doesn&apos;t require it. Answering &ldquo;No&rdquo; to background check or drug test is an instant auto-rejection on most ATS platforms.</p>
            <div className="grid3">
              <label className="field" htmlFor="apply-over18">
                Over 18?
                <select
                  id="apply-over18"
                  value={draft.workAuth.over18 == null ? '' : draft.workAuth.over18 ? 'yes' : 'no'}
                  onChange={(e) => setDraft({
                    ...draft,
                    workAuth: { ...draft.workAuth, over18: e.target.value === '' ? undefined : e.target.value === 'yes' }
                  })}
                >
                  <option value="">Not set</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label className="field" htmlFor="apply-drivers-license">
                Driver&apos;s license?
                <select
                  id="apply-drivers-license"
                  value={draft.workAuth.hasDriversLicense == null ? '' : draft.workAuth.hasDriversLicense ? 'yes' : 'no'}
                  onChange={(e) => setDraft({
                    ...draft,
                    workAuth: { ...draft.workAuth, hasDriversLicense: e.target.value === '' ? undefined : e.target.value === 'yes' }
                  })}
                >
                  <option value="">Not set</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label className="field" htmlFor="apply-willing-relocate">
                Willing to relocate?
                <select
                  id="apply-willing-relocate"
                  value={draft.workAuth.willingToRelocate == null ? '' : draft.workAuth.willingToRelocate ? 'yes' : 'no'}
                  onChange={(e) => setDraft({
                    ...draft,
                    workAuth: { ...draft.workAuth, willingToRelocate: e.target.value === '' ? undefined : e.target.value === 'yes' }
                  })}
                >
                  <option value="">Not set</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label className="field" htmlFor="apply-willing-travel">
                Willing to travel?
                <select
                  id="apply-willing-travel"
                  value={draft.workAuth.willingToTravel == null ? '' : draft.workAuth.willingToTravel ? 'yes' : 'no'}
                  onChange={(e) => setDraft({
                    ...draft,
                    workAuth: { ...draft.workAuth, willingToTravel: e.target.value === '' ? undefined : e.target.value === 'yes' }
                  })}
                >
                  <option value="">Not set</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label className="field" htmlFor="apply-background-check">
                Pass background check?
                <select
                  id="apply-background-check"
                  value={draft.workAuth.canPassBackgroundCheck == null ? '' : draft.workAuth.canPassBackgroundCheck ? 'yes' : 'no'}
                  onChange={(e) => setDraft({
                    ...draft,
                    workAuth: { ...draft.workAuth, canPassBackgroundCheck: e.target.value === '' ? undefined : e.target.value === 'yes' }
                  })}
                >
                  <option value="">Not set</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label className="field" htmlFor="apply-drug-test">
                Pass drug test?
                <select
                  id="apply-drug-test"
                  value={draft.workAuth.canPassDrugTest == null ? '' : draft.workAuth.canPassDrugTest ? 'yes' : 'no'}
                  onChange={(e) => setDraft({
                    ...draft,
                    workAuth: { ...draft.workAuth, canPassDrugTest: e.target.value === '' ? undefined : e.target.value === 'yes' }
                  })}
                >
                  <option value="">Not set</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
            </div>
          </section>

          <section className="application-section" id="apply-comp">
            <h3>Compensation and timing</h3>
            <p className="field-hint field-hint--warn">Salary fields are optional. Leave blank unless a form requires it — you can always negotiate after an offer.</p>
            <div className="grid2">
              <label className="field" htmlFor="apply-salary-min">
                Salary minimum
                <input
                  id="apply-salary-min"
                  type="number"
                  value={draft.compensation.salaryMin ?? ''}
                  onChange={(e) => setDraft({
                    ...draft,
                    compensation: {
                      ...draft.compensation,
                      salaryMin: e.target.value === '' ? undefined : Number(e.target.value)
                    }
                  })}
                />
              </label>
              <label className="field" htmlFor="apply-salary-max">
                Salary maximum
                <input
                  id="apply-salary-max"
                  type="number"
                  value={draft.compensation.salaryMax ?? ''}
                  onChange={(e) => setDraft({
                    ...draft,
                    compensation: {
                      ...draft.compensation,
                      salaryMax: e.target.value === '' ? undefined : Number(e.target.value)
                    }
                  })}
                />
              </label>
              <label className="field" htmlFor="apply-salary-currency">
                Salary currency
                <input
                  id="apply-salary-currency"
                  value={draft.compensation.salaryCurrency || ''}
                  onChange={(e) => setDraft({ ...draft, compensation: { ...draft.compensation, salaryCurrency: e.target.value } })}
                />
              </label>
              <label className="field" htmlFor="apply-start-date-pref">
                Start date preference
                <input
                  id="apply-start-date-pref"
                  value={draft.compensation.startDatePreference || ''}
                  onChange={(e) => setDraft({ ...draft, compensation: { ...draft.compensation, startDatePreference: e.target.value } })}
                />
              </label>
              <label className="field" htmlFor="apply-notice-period">
                Notice period
                <input
                  id="apply-notice-period"
                  value={draft.compensation.noticePeriod || ''}
                  onChange={(e) => setDraft({ ...draft, compensation: { ...draft.compensation, noticePeriod: e.target.value } })}
                />
              </label>
              <label className="field field-span" htmlFor="apply-work-location">
                Work location preference
                <input
                  id="apply-work-location"
                  value={draft.compensation.workLocationPreference || ''}
                  onChange={(e) => setDraft({ ...draft, compensation: { ...draft.compensation, workLocationPreference: e.target.value } })}
                  placeholder="e.g. Remote, hybrid in NYC, or open to relocation"
                />
              </label>
            </div>
          </section>

          <section className="application-section" id="apply-background">
            <h3>Background</h3>
            <div className="application-section__import-row">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void assistant.importFromLinkedIn()}
                disabled={assistant.importing}
                aria-busy={assistant.importing}
              >
                {assistant.importing ? 'Importing\u2026' : 'Import from LinkedIn'}
              </button>
              <span className="application-section__import-hint">
                Opens your LinkedIn profile and fills background fields automatically
              </span>
            </div>
            <div className="grid2">
              <label className="field" htmlFor="apply-years-exp">
                Years of experience
                <input
                  id="apply-years-exp"
                  value={draft.background.yearsOfExperience || ''}
                  onChange={(e) => setDraft({ ...draft, background: { ...draft.background, yearsOfExperience: e.target.value } })}
                />
              </label>
              <label className="field field-span" htmlFor="apply-education-summary">
                Education summary
                <textarea
                  id="apply-education-summary"
                  rows={3}
                  value={draft.background.educationSummary || ''}
                  onChange={(e) => setDraft({ ...draft, background: { ...draft.background, educationSummary: e.target.value } })}
                  placeholder="e.g. BS in Computer Science, Stanford. MBA, Wharton."
                />
              </label>
              <label className="field" htmlFor="apply-school-name">
                School / University
                <input
                  id="apply-school-name"
                  value={draft.background.schoolName || ''}
                  onChange={(e) => setDraft({ ...draft, background: { ...draft.background, schoolName: e.target.value } })}
                  placeholder="e.g. Columbia University"
                />
              </label>
              <label className="field" htmlFor="apply-degree-type">
                Degree type
                <input
                  id="apply-degree-type"
                  value={draft.background.degreeType || ''}
                  onChange={(e) => setDraft({ ...draft, background: { ...draft.background, degreeType: e.target.value } })}
                  placeholder="e.g. Master's, Bachelor's"
                />
              </label>
              <label className="field" htmlFor="apply-field-of-study">
                Field of study
                <input
                  id="apply-field-of-study"
                  value={draft.background.fieldOfStudy || ''}
                  onChange={(e) => setDraft({ ...draft, background: { ...draft.background, fieldOfStudy: e.target.value } })}
                  placeholder="e.g. Computer Science"
                />
              </label>
            </div>
          </section>
            </div>
          </details>
        </div>

        <section className="application-section" id="apply-answers">
          <div className="application-section__header">
            <div>
              <h3>Screening answers</h3>
              <p className="field-hint">Reusable Q&amp;A for forms.</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setAnswerBank((entries) => [
                ...entries,
                {
                  id: nextId('answer'),
                  normalizedKey: '',
                  prompt: '',
                  answerType: 'text',
                  answer: '',
                  scope: 'global',
                  updatedAt: new Date().toISOString()
                }
              ])}
            >
              Add answer
            </button>
          </div>
          {draft.answerBank.length === 0 ? (
            <div className="application-answer-seeds">
              <p className="field-hint">Common ATS questions — click to add:</p>
              <div className="application-answer-seeds__list">
                {COMMON_SCREENING_SEEDS.map((seed) => (
                  <button
                    key={seed.prompt}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setAnswerBank((entries) => [
                      ...entries,
                      {
                        id: nextId('answer'),
                        normalizedKey: seed.prompt.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
                        prompt: seed.prompt,
                        answerType: seed.answerType,
                        answer: '',
                        scope: 'global',
                        updatedAt: new Date().toISOString()
                      }
                    ])}
                  >
                    + {seed.prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="application-answer-list">
              {draft.answerBank.map((entry, index) => (
                <div key={entry.id} className="application-answer-row">
                  <label className="field field-span">
                    Question {index + 1}
                    <input
                      value={entry.prompt}
                      onChange={(e) => setAnswerBank((entries) => entries.map((item, itemIndex) => itemIndex === index
                        ? {
                            ...item,
                            prompt: e.target.value,
                            normalizedKey: e.target.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
                          }
                        : item
                      ))}
                    />
                  </label>
                  <label className="field">
                    Type {index + 1}
                    <select
                      value={entry.answerType}
                      onChange={(e) => setAnswerBank((entries) => entries.map((item, itemIndex) => itemIndex === index
                        ? { ...item, answerType: e.target.value as AnswerBankItem['answerType'] }
                        : item
                      ))}
                    >
                      <option value="text">Text</option>
                      <option value="boolean">Yes / No</option>
                      <option value="number">Number</option>
                      <option value="select">Select</option>
                    </select>
                  </label>
                  <label className="field field-span">
                    Answer {index + 1}
                    <input
                      value={String(entry.answer)}
                      onChange={(e) => setAnswerBank((entries) => entries.map((item, itemIndex) => itemIndex === index
                        ? {
                            ...item,
                            answer:
                              item.answerType === 'boolean'
                                ? (e.target.value.toLowerCase() === 'yes')
                                : item.answerType === 'number'
                                  ? Number(e.target.value || 0)
                                  : e.target.value
                          }
                        : item
                      ))}
                      placeholder={entry.answerType === 'boolean' ? 'yes or no' : 'Saved answer'}
                    />
                  </label>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAnswerBank((entries) => entries.filter((_, itemIndex) => itemIndex !== index))}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="wizard-actions settings-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void saveDraft()}
            disabled={assistant.saving}
            aria-busy={assistant.saving}
          >
            {assistant.saving ? 'Saving…' : 'Force save'}
          </button>
          <span className="field-hint" style={{ fontSize: 'var(--text-xs, 0.72rem)' }}>
            Fields auto-save after you stop typing
          </span>
        </div>

        {assistant.userProfile && assistant.userProfile.entries?.length > 0 && (
          <ExtractedProfile profile={assistant.userProfile} />
        )}

        {!requiredFocus && (
          <div className="application-next-step" role="status">
            {'\u2713'} Profile looks good.{' '}
            {onNavigateToJobs ? (
              <button type="button" className="link-button" onClick={onNavigateToJobs}>
                Go to Jobs tab
              </button>
            ) : (
              <>Head to the <strong>Jobs</strong> tab</>
            )}{' '}
            to search and start applying, or keep refining here.
          </div>
        )}
      </div>

      <div className="wizard-card" id="apply-activity" role="region" aria-label="Application activity and insights">
        <div className="application-section__header">
          <div>
            <h3>Insights</h3>
            <p className="field-hint">Logged applies: where you cluster.</p>
          </div>
        </div>

        <div className="application-insights-grid">
          <InsightCard title="Company types" buckets={assistant.insights?.byCompanyType} />
          <InsightCard title="Stages" buckets={assistant.insights?.byStage} />
          <InsightCard title="Industries" buckets={assistant.insights?.byIndustry} />
          <InsightCard title="Work models" buckets={assistant.insights?.byWorkModel} />
        </div>

        {assistant.history.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon" aria-hidden="true">{'\u2630'}</div>
            <h3 className="empty-state__title">No events yet</h3>
            <p className="empty-state__body">Log applies here to see patterns.</p>
          </div>
        ) : (
          <div className="application-history-list">
            {assistant.history.slice(0, 8).map((record) => (
              <div key={record.id} className="application-history-item">
                <div>
                  <strong>{record.title}</strong>
                  <div className="field-hint">{record.company}{record.location ? ` • ${record.location}` : ''}</div>
                </div>
                <div className="application-history-item__meta">
                  <span className="application-chip application-chip--done">{humanize(record.outcome)}</span>
                  <span className="field-hint">
                    {humanize(record.companySignals.companyType)} • {humanize(record.companySignals.industry)} •{' '}
                    {humanize(record.companySignals.workModel)}
                    {record.coverLetterMeta?.mode === 'tailored'
                      ? ' • Cover tailored'
                      : record.coverLetterMeta?.mode === 'static'
                        ? ' • Cover file'
                        : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
