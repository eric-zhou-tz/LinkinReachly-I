import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ApplicantProfile,
  ApplicationAssistantDetectView,
  ApplicationInsights,
  ApplicationRecord,
  ApplicationAssistantStatusView
} from '@core/application-types'
import type { UserProfileView } from '../../vite-env'
import { getLoa } from '@/loa-client'

export type ApplyCoverPrefs = {
  easyApplyTailorCoverLetter: boolean
  easyApplyEnrichCompanyContext: boolean
}

export function useApplicationAssistant() {
  const [status, setStatus] = useState<ApplicationAssistantStatusView | null>(null)
  const [profile, setProfile] = useState<ApplicantProfile | null>(null)
  const [detectResult, setDetectResult] = useState<ApplicationAssistantDetectView | null>(null)
  const [history, setHistory] = useState<ApplicationRecord[]>([])
  const [insights, setInsights] = useState<ApplicationInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [userProfile, setUserProfile] = useState<UserProfileView | null>(null)
  const [saveFeedback, setSaveFeedback] = useState<{ ok: boolean; detail: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleFeedbackClear = useCallback((ms: number) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setSaveFeedback(null), ms)
  }, [])

  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
  }, [])
  const [applyCoverPrefs, setApplyCoverPrefs] = useState<ApplyCoverPrefs>({
    easyApplyTailorCoverLetter: false,
    easyApplyEnrichCompanyContext: false
  })

  /** Ignore stale `applicantSave` responses when a newer save already started (avoids profile→draft echo wiping edits). */
  const applicantSaveSeqRef = useRef(0)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const loa = getLoa()
      const [nextStatus, profileRes, historyRes, upRes] = await Promise.all([
        loa.applicationStatus(),
        loa.applicantGet(),
        loa.applicationHistory(),
        loa.userProfileGet()
      ])
      setStatus(nextStatus)
      setProfile(profileRes.ok ? profileRes.profile : null)
      if (!profileRes.ok) setError('Could not load your profile. Try refreshing.')
      if (historyRes.ok) {
        setHistory(historyRes.records)
        setInsights(historyRes.insights)
      }
      if (upRes.ok && upRes.profile) setUserProfile(upRes.profile)
      try {
        const settingsRaw = (await loa.settingsGet()) as Record<string, unknown>
        setApplyCoverPrefs({
          easyApplyTailorCoverLetter: !!settingsRaw.easyApplyTailorCoverLetter,
          easyApplyEnrichCompanyContext: !!settingsRaw.easyApplyEnrichCompanyContext
        })
      } catch {
        /* apply cover prefs keep previous defaults until settings load succeeds */
      }
    } catch (err) {
      setError('Something went wrong. Try again in a moment.')
    } finally {
      setLoading(false)
    }
  }, [])

  const saveProfile = useCallback(async (partial: Partial<ApplicantProfile>, options?: { quiet?: boolean }) => {
    const quiet = options?.quiet === true
    const seq = ++applicantSaveSeqRef.current
    if (!quiet) {
      setSaving(true)
      setSaveFeedback(null)
    }
    try {
      const result = await getLoa().applicantSave(partial)
      if (result.ok) {
        if (seq === applicantSaveSeqRef.current) {
          setProfile(result.profile)
        }
        if (!quiet) {
          setSaveFeedback({ ok: true, detail: result.detail })
          scheduleFeedbackClear(3000)
        }
      } else {
        setSaveFeedback({ ok: false, detail: result.detail })
      }
      return result
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setSaveFeedback({ ok: false, detail })
      return { ok: false as const, detail }
    } finally {
      if (!quiet) setSaving(false)
    }
  }, [])

  const uploadResume = useCallback(async () => {
    setUploading(true)
    setSaveFeedback(null)
    try {
      const result = await getLoa().applicantUploadResume()
      if (result.ok) {
        setProfile(result.profile)
        try {
          const upRes = await getLoa().userProfileGet()
          if (upRes.ok && upRes.profile) {
            setUserProfile(upRes.profile)
            const p = upRes.profile
            const parts: string[] = []
            if (p.name) parts.push(p.name)
            const recent = p.entries?.[0]
            if (recent) parts.push(`${recent.role} at ${recent.company}`)
            const counts: string[] = []
            if (p.entries?.length) counts.push(`${p.entries.length} role${p.entries.length > 1 ? 's' : ''}`)
            if (p.education?.length) counts.push(`${p.education.length} school${p.education.length > 1 ? 's' : ''}`)
            if (counts.length) parts.push(counts.join(', '))
            setSaveFeedback({ ok: true, detail: parts.length ? `Parsed: ${parts.join(' \u2022 ')}` : result.detail })
          } else {
            setSaveFeedback({ ok: true, detail: result.detail })
          }
        } catch {
          setSaveFeedback({ ok: true, detail: result.detail })
        }
        scheduleFeedbackClear(6000)
      } else {
        if (result.detail !== 'No file selected.') {
          setSaveFeedback({ ok: false, detail: result.detail })
        }
      }
      return result
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setSaveFeedback({ ok: false, detail })
      return { ok: false as const, detail }
    } finally {
      setUploading(false)
    }
  }, [])

  const removeResume = useCallback(async () => {
    setSaving(true)
    try {
      const result = await getLoa().applicantRemoveResume()
      if (result.ok) {
        setProfile(result.profile)
        setSaveFeedback({ ok: true, detail: result.detail })
        scheduleFeedbackClear(3000)
      } else {
        setSaveFeedback({ ok: false, detail: result.detail || 'Could not remove resume.' })
      }
      return result
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setSaveFeedback({ ok: false, detail })
      return { ok: false as const, detail }
    } finally {
      setSaving(false)
    }
  }, [])

  const uploadCoverLetter = useCallback(async () => {
    setUploading(true)
    setSaveFeedback(null)
    try {
      const result = await getLoa().applicantUploadCoverLetter()
      if (result.ok) {
        setProfile(result.profile)
        setSaveFeedback({ ok: true, detail: result.detail })
        scheduleFeedbackClear(4000)
      } else {
        if (result.detail !== 'No file selected.') {
          setSaveFeedback({ ok: false, detail: result.detail })
        }
      }
      return result
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setSaveFeedback({ ok: false, detail })
      return { ok: false as const, detail }
    } finally {
      setUploading(false)
    }
  }, [])

  const removeCoverLetter = useCallback(async () => {
    setSaving(true)
    try {
      const result = await getLoa().applicantRemoveCoverLetter()
      if (result.ok) {
        setProfile(result.profile)
        setSaveFeedback({ ok: true, detail: result.detail })
        scheduleFeedbackClear(3000)
      } else {
        setSaveFeedback({ ok: false, detail: result.detail || 'Could not remove cover letter.' })
      }
      return result
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setSaveFeedback({ ok: false, detail })
      return { ok: false as const, detail }
    } finally {
      setSaving(false)
    }
  }, [])

  const saveApplyCoverPref = useCallback(
    async (partial: Partial<ApplyCoverPrefs>) => {
      try {
        await getLoa().settingsSave(partial as Record<string, unknown>)
        setApplyCoverPrefs((prev) => ({ ...prev, ...partial }))
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        setSaveFeedback({ ok: false, detail })
      }
    },
    []
  )

  const importFromLinkedIn = useCallback(async () => {
    setImporting(true)
    setSaveFeedback(null)
    try {
      const result = await getLoa().profileImportMine({ persist: true }) as { ok: boolean; profile?: { displayName?: string }; detail?: string }
      if (result.ok) {
        // Re-fetch profile so the form shows updated background fields
        const profileRes = await getLoa().applicantGet()
        if (profileRes.ok) setProfile(profileRes.profile)
        setSaveFeedback({ ok: true, detail: `Imported profile: ${result.profile?.displayName || 'success'}` })
        scheduleFeedbackClear(5000)
      } else {
        setSaveFeedback({ ok: false, detail: result.detail || 'Import failed' })
      }
      return result
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setSaveFeedback({ ok: false, detail })
      return { ok: false as const, detail }
    } finally {
      setImporting(false)
    }
  }, [scheduleFeedbackClear])

  const detectCurrentPage = useCallback(async () => {
    setDetecting(true)
    try {
      const result = await getLoa().applicationDetect()
      setDetectResult(result)
      return result
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      const fallback: ApplicationAssistantDetectView = {
        ok: false,
        featureEnabled: true,
        reason: 'extension_scope_not_expanded',
        detail
      }
      setDetectResult(fallback)
      return fallback
    } finally {
      setDetecting(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    status,
    profile,
    userProfile,
    detectResult,
    history,
    insights,
    loading,
    detecting,
    saving,
    uploading,
    importing,
    saveFeedback,
    error,
    refresh,
    saveProfile,
    uploadResume,
    removeResume,
    uploadCoverLetter,
    removeCoverLetter,
    importFromLinkedIn,
    applyCoverPrefs,
    saveApplyCoverPref,
    detectCurrentPage
  }
}
