import {
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { parseTargetsCsvWithDiagnostics } from '@core/csv-targets'
import { canonicalProfileUrlKey } from '@core/linkedin-url'
import { SAMPLE_CONNECTION_NOTE } from '@core/demo-presets'
import { getExecutionById, persistedTemplatesForExecutionSelect } from '@core/executions'
import type { QueueState, TargetRow } from '@core/types'
import { getLoa, isElectronLoaAvailable } from '@/loa-client'
import { useBridgeState } from '@/hooks/useBridgeState'
import { useLogs } from '@/hooks/useLogs'
import { useNoteTemplates } from '@/hooks/useNoteTemplates'
import {
  type MissionPlanView,
  type ProspectCollectionView,
  type ComposePreviewView,
  type ProfileImportView,
  type SettingsView,
  type SetupFeedback,
  type CampaignSummaryView
} from '@/types/app'

export type AppModel = ReturnType<typeof useAppModel>

/** Deterministic JSON for comparing setup drafts (object key order–independent). */
function stableValueStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableValueStringify).join(',')}]`
  }
  const o = value as Record<string, unknown>
  const keys = Object.keys(o).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableValueStringify(o[k])}`).join(',')}}`
}

function csvEscapeCell(value: string | undefined): string {
  const text = String(value || '')
  if (!/[",\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

function targetsToCsvText(
  rows: Array<{ profileUrl: string; firstName?: string; company?: string; headline?: string }>
): string {
  const header = 'profileUrl,firstName,company,headline'
  const lines = rows.map((row) =>
    [
      csvEscapeCell(row.profileUrl),
      csvEscapeCell(row.firstName),
      csvEscapeCell(row.company),
      csvEscapeCell(row.headline)
    ].join(',')
  )
  return [header, ...lines].join('\n')
}

function parseLogStatusAndUrl(line: unknown): { status: string; profileUrl: string; timestampMs: number | null } {
  if (typeof line !== 'object' || line == null) {
    return { status: '', profileUrl: '', timestampMs: null }
  }
  const row = line as Record<string, unknown>
  const status = String(row.status || '').toLowerCase().trim()
  const profileUrl = String(row.profileUrl || row.profile_url || '').trim()
  const ts = String(row.timestamp || row.ts || '').trim()
  const parsed = ts ? Date.parse(ts) : NaN
  return {
    status,
    profileUrl,
    timestampMs: Number.isFinite(parsed) ? parsed : null
  }
}

export function useAppModel() {
  const {
    bridge,
    bridgeReady,
    bridgeProbed,
    desktopBackendReady,
    electronIpcAvailable,
    localBackendAvailable,
    setLocalBackendAvailable,
    probeBridge,
    refreshBridge,
    probeLocalBackend
  } = useBridgeState()
  const { logs, logsBusy, historyFeedback, refreshLogs, exportLogs, clearLogs } = useLogs()
  const {
    noteOptions,
    mustIncludeInput,
    setNoteOptions,
    setMustIncludeInput,
    updateNoteOption,
    appendPlaceholderToNote,
    addNoteOption
  } = useNoteTemplates()

  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [csvInput, setCsvInput] = useState('')
  const [queueState, setQueueState] = useState<QueueState | null>(null)
  const [setupFeedback, setSetupFeedback] = useState<SetupFeedback>(null)
  const [settingsHydrating, setSettingsHydrating] = useState(true)
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null)
  const [onboardingDismissError, setOnboardingDismissError] = useState<string | null>(null)
  const [gettingStartedError, setGettingStartedError] = useState<string | null>(null)
  const [runStartFeedback, setRunStartFeedback] = useState<string | null>(null)
  const [missionPrompt, setMissionPrompt] = useState('')
  const [missionPlan, setMissionPlan] = useState<MissionPlanView | null>(null)
  const [missionPlanning, setMissionPlanning] = useState(false)
  const [collectingProspects, setCollectingProspects] = useState(false)
  const [composePreview, setComposePreview] = useState<ComposePreviewView | null>(null)
  const [composePreviewLoading, setComposePreviewLoading] = useState(false)
  const [importingLinkedInBackground, setImportingLinkedInBackground] = useState(false)
  const [uploadingResume, setUploadingResume] = useState(false)
  const [activeCampaign, setActiveCampaign] = useState<CampaignSummaryView | null>(null)
  const [campaignLoading, setCampaignLoading] = useState(true)
  const saveBannerTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const selectedExecution = useMemo(
    () => (settings ? getExecutionById(settings.lastExecutionId) : undefined),
    [settings]
  )
  const followUpRunWithoutList = !!selectedExecution && selectedExecution.queueKind === 'post_accept_dm'

  const clearSaveBannerTimer = useCallback(() => {
    const id = saveBannerTimerRef.current
    if (id != null) {
      window.clearTimeout(id)
      saveBannerTimerRef.current = null
    }
  }, [])

  const loadSettings = useCallback(async () => {
    setSettingsHydrating(true)
    setSettingsLoadError(null)
    const maxAttempts = 6
    let lastErr: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const s = (await getLoa().settingsGet()) as SettingsView
        setSettings(s)
        setNoteOptions(s.templates?.length ? [...s.templates] : [''])
        setMustIncludeInput((s.mustInclude || []).join('\n'))
        if (s.lastGoal && !missionPrompt) setMissionPrompt(s.lastGoal)
        setSettingsHydrating(false)
        if (attempt > 1) setLocalBackendAvailable(true)
        return
      } catch (e) {
        lastErr = e
        if (attempt < maxAttempts) {
          await new Promise((r) => window.setTimeout(r, 350 * attempt))
        }
      }
    }
    setSettingsLoadError(lastErr instanceof Error ? lastErr.message : String(lastErr))
    setSettingsHydrating(false)
  }, [])

  const loadActiveCampaign = useCallback(async () => {
    if (!mountedRef.current) return
    setCampaignLoading(true)
    try {
      const res = (await getLoa().campaignActive()) as { ok: boolean; campaign: CampaignSummaryView | null }
      if (!mountedRef.current) return
      setActiveCampaign(res.ok && res.campaign ? res.campaign : null)
    } catch {
      if (!mountedRef.current) return
      setActiveCampaign(null)
    } finally {
      if (!mountedRef.current) return
      setCampaignLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    void loadSettings()
    void refreshBridge()
    void refreshLogs()
    void loadActiveCampaign()
  }, [loadSettings, refreshBridge, refreshLogs, loadActiveCampaign])

  // Fire trackFirstExtensionConnect once per session when extension connects
  const extensionConnectFiredRef = useRef(false)
  useEffect(() => {
    if (bridge.extensionConnected && !extensionConnectFiredRef.current) {
      extensionConnectFiredRef.current = true
      void getLoa().trackFirstExtensionConnect().catch(() => {})
    }
  }, [bridge.extensionConnected])

  useEffect(() => {
    const ms = bridgeReady ? 4000 : 3000
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void refreshBridge()
    }, ms)
    return () => window.clearInterval(id)
  }, [bridgeReady, refreshBridge])

  useEffect(() => {
    const loa = getLoa()
    const off =
      typeof loa.onBridgeActivity === 'function' ? loa.onBridgeActivity(() => void refreshBridge()) : undefined
    return typeof off === 'function' ? off : () => {}
  }, [refreshBridge])

  useEffect(() => {
    const bump = () => {
      if (document.visibilityState === 'visible') void refreshBridge()
    }
    window.addEventListener('focus', bump)
    document.addEventListener('visibilitychange', bump)
    return () => {
      window.removeEventListener('focus', bump)
      document.removeEventListener('visibilitychange', bump)
    }
  }, [refreshBridge])

  useEffect(() => {
    if (isElectronLoaAvailable()) return
    const probe = () => {
      void probeLocalBackend()
    }
    probe()
    const id = window.setInterval(probe, 5000)
    const onFocus = () => probe()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [probeLocalBackend])

  useEffect(() => {
    if (electronIpcAvailable || localBackendAvailable !== true) return
    void loadSettings()
    void refreshLogs()
  }, [electronIpcAvailable, localBackendAvailable, loadSettings, refreshLogs])

  useEffect(() => {
    const loa = getLoa()
    const sub = loa?.onQueueTick
    const off =
      typeof sub === 'function'
        ? sub((s: unknown) => setQueueState(s as QueueState))
        : undefined
    const qs = loa?.queueState
    if (typeof qs === 'function') {
      void qs().then((s: unknown) => setQueueState(s as QueueState))
    }
    return typeof off === 'function' ? off : () => {}
  }, [])

  useEffect(() => () => clearSaveBannerTimer(), [clearSaveBannerTimer])


  const [excludedIndices, setExcludedIndices] = useState<Set<number>>(new Set())
  const [sendLimit, setSendLimit] = useState<number | null>(null)

  const csvDiagnostics = useMemo(
    () => parseTargetsCsvWithDiagnostics(csvInput, { runExecutionId: settings?.lastExecutionId }),
    [csvInput, settings?.lastExecutionId]
  )
  const { targets, issues: csvIssues } = csvDiagnostics

  const selectedTargets = useMemo(() => {
    let filtered = targets.filter((_, i) => !excludedIndices.has(i))
    if (sendLimit != null && sendLimit < filtered.length) {
      filtered = filtered.slice(0, sendLimit)
    }
    return filtered
  }, [targets, excludedIndices, sendLimit])

  const targetSelectionKey = useMemo(
    () =>
      targets
        .map((row) =>
          [
            row.profileUrl || '',
            row.searchQuery || '',
            row.personName || '',
            row.firstName || '',
            row.company || ''
          ].join('|')
        )
        .join('\u0001'),
    [targets]
  )

  useEffect(() => {
    setExcludedIndices(new Set())
    setSendLimit(null)
  }, [targetSelectionKey])

  const toggleTarget = useCallback((index: number) => {
    setExcludedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const selectAllTargets = useCallback(() => {
    setExcludedIndices(new Set())
    setSendLimit(null)
  }, [])

  const deselectAllTargets = useCallback(() => {
    setExcludedIndices(new Set(targets.map((_, i) => i)))
  }, [targets])

  const queueRunning = !!(queueState && queueState.running)
  const runReady =
    !queueRunning &&
    !settingsHydrating &&
    desktopBackendReady &&
    bridgeReady &&
    !!(followUpRunWithoutList || selectedTargets.length > 0)

  const profileIncomplete = !!(settings && !settings.resumeFileName)
  const startRunBlockedReason = queueRunning
    ? 'A run is already in progress.'
    : !desktopBackendReady
      ? 'Open the desktop app first.'
    : !bridgeReady
      ? 'Connect to LinkedIn in Chrome first.'
    : profileIncomplete
      ? 'Upload your resume first so we can personalize your messages.'
    : !selectedTargets.length && !followUpRunWithoutList
      ? targets.length > 0 ? 'Select at least one person to send to.' : 'Add people above to get started.'
      : null
  const startRunDisabled =
    !desktopBackendReady || !bridgeReady || profileIncomplete || (!selectedTargets.length && !followUpRunWithoutList) || queueRunning

  const canRestoreRunPreset =
    !!settings &&
    !followUpRunWithoutList &&
    !!getExecutionById(settings.lastExecutionId)?.starterCsv?.trim() &&
    targets.length === 0

  useEffect(() => {
    if (queueRunning) setRunStartFeedback(null)
  }, [queueRunning])

  useEffect(() => {
    setComposePreview(null)
  }, [settings, noteOptions, mustIncludeInput])

  const buildSetupDraft = useCallback(() => {
    if (!settings) return null
    let templates = noteOptions.map((t) => t.trim()).filter(Boolean)
    if (templates.length === 0) templates = [SAMPLE_CONNECTION_NOTE]
    const mustInclude = mustIncludeInput
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const { apiKeyPresent: _k, ...rest } = settings
    return {
      ...rest,
      bridgePort: Number(settings.bridgePort),
      llmEnabled: !!settings.llmEnabled,
      templates,
      mustInclude,
      dailyCap: Number(settings.dailyCap),
      sessionBreaksEnabled: !!settings.sessionBreaksEnabled,
      sessionBreakEveryMin: Number(settings.sessionBreakEveryMin),
      sessionBreakEveryMax: Number(settings.sessionBreakEveryMax),
      sessionBreakDurationMin: Number(settings.sessionBreakDurationMin),
      sessionBreakDurationMax: Number(settings.sessionBreakDurationMax),
      delayBetweenRequestsMin: Number(settings.delayBetweenRequestsMin),
      delayBetweenRequestsMax: Number(settings.delayBetweenRequestsMax),
      delayBetweenActionsMin: Number(settings.delayBetweenActionsMin),
      delayBetweenActionsMax: Number(settings.delayBetweenActionsMax)
    }
  }, [mustIncludeInput, noteOptions, settings])

  const setupDraftKey = useMemo(() => {
    const d = buildSetupDraft()
    return d ? stableValueStringify(d) : null
  }, [buildSetupDraft])

  const [setupBaselineTick, setSetupBaselineTick] = useState(0)
  const [savedSetupKey, setSavedSetupKey] = useState<string | null>(null)
  const setupBaselineInitRef = useRef(false)

  useEffect(() => {
    if (settingsHydrating) setupBaselineInitRef.current = false
  }, [settingsHydrating])

  useEffect(() => {
    if (settingsHydrating || !settings || setupDraftKey == null) return
    if (!setupBaselineInitRef.current) {
      setupBaselineInitRef.current = true
      setSavedSetupKey(setupDraftKey)
    }
  }, [settingsHydrating, settings, setupDraftKey])

  useEffect(() => {
    if (setupBaselineTick === 0) return
    const d = buildSetupDraft()
    if (d) setSavedSetupKey(stableValueStringify(d))
  }, [setupBaselineTick, buildSetupDraft])

  const setupDirty =
    savedSetupKey != null && setupDraftKey != null && setupDraftKey !== savedSetupKey

  const persistSetupDraft = useCallback(
    async (opts?: { showSuccessBanner?: boolean; settingsPatch?: Partial<SettingsView> }) => {
      if (!settings) return null
      const draft = buildSetupDraft()
      if (!draft) return null
      const mergedDraft = opts?.settingsPatch ? { ...draft, ...opts.settingsPatch } : draft
      const next = (await getLoa().settingsSaveBundle({
        settings: mergedDraft
      })) as SettingsView
      setSettings(next)
      setNoteOptions(next.templates?.length ? [...next.templates] : [''])
      setSetupBaselineTick((n) => n + 1)
      if (opts?.showSuccessBanner) {
        setSetupFeedback({ type: 'success', message: 'Saved. These stick until you change them again.' })
        saveBannerTimerRef.current = window.setTimeout(() => {
          setSetupFeedback(null)
          saveBannerTimerRef.current = null
        }, 4500)
      }
      return next
    },
    [buildSetupDraft, settings]
  )

  const saveSetup = useCallback(async (): Promise<boolean> => {
    if (!settings) return false
    clearSaveBannerTimer()
    setSetupFeedback(null)
    try {
      await persistSetupDraft({ showSuccessBanner: true })
      return true
    } catch (err) {
      setSetupFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
      return false
    }
  }, [persistSetupDraft, clearSaveBannerTimer])

  const lastRunTargetsRef = useRef<string[]>([])
  const lastRunStartedAtRef = useRef<number>(0)

  const startRun = useCallback(async (opts?: { dryRun?: boolean; messageOverride?: string }) => {
    const dryRun = !!opts?.dryRun
    const messageOverride = String(opts?.messageOverride || '').trim() || undefined
    setRunStartFeedback(null)
    try {
      if (!dryRun) {
        const bridgeState = await probeBridge()
        if (!bridgeState.ok) {
          setRunStartFeedback(
            bridgeState.detail === 'desktop_app_offline'
              ? 'Start the desktop app window first.'
              : bridgeState.extensionConnected
              ? 'Open a linkedin.com tab in Chrome before starting the run.'
              : bridgeState.detail || 'Chrome is not linked yet.'
          )
          return
        }
      }
      if (settings) {
        await persistSetupDraft()
      }
      const toSend = selectedTargets.length > 0 ? selectedTargets : []
      if (!dryRun) {
        lastRunTargetsRef.current = toSend.map((t) => t.profileUrl).filter(Boolean)
        lastRunStartedAtRef.current = Date.now()
      }
      const res = await getLoa().queueStart({
        targets: toSend,
        ...(dryRun ? { dryRun: true } : {}),
        ...(messageOverride ? { messageOverride } : {})
      })
      if (!res.ok) {
        if (!dryRun) {
          lastRunTargetsRef.current = []
          lastRunStartedAtRef.current = 0
        }
        setRunStartFeedback(
          res.reason === 'already_running'
            ? 'A run is already in progress.'
            : res.reason === 'bridge_not_ready'
              ? res.detail || 'Open a linkedin.com tab in Chrome before starting the run.'
            : 'No valid profile URLs. Check your list — or select Post-accept follow-up and run without rows.'
        )
      } else {
        setQueueState({
          running: true,
          currentIndex: 0,
          total: toSend.length,
          lastDetail: dryRun ? 'Starting test run…' : 'Starting run…',
          lastProfileUrl: toSend[0]?.profileUrl || '',
          error: null,
          completedAt: null
        })
      }
    } catch (e) {
      if (!dryRun) {
        lastRunTargetsRef.current = []
        lastRunStartedAtRef.current = 0
      }
      setRunStartFeedback(
        e instanceof Error ? `Could not save current setup before starting: ${e.message}` : String(e)
      )
    }
  }, [followUpRunWithoutList, persistSetupDraft, probeBridge, settings, selectedTargets])

  const markRunComplete = useCallback(async () => {
    if (!activeCampaign || lastRunTargetsRef.current.length === 0) {
      lastRunTargetsRef.current = []
      lastRunStartedAtRef.current = 0
      return
    }
    const attemptedKeys = new Set(
      lastRunTargetsRef.current.map((url) => canonicalProfileUrlKey(url)).filter(Boolean)
    )
    const runStartedAt = lastRunStartedAtRef.current
    try {
      const recentLogs = (await getLoa().logsRecent()) as unknown[]
      const completedKeys = new Set<string>()
      for (const line of recentLogs) {
        const { status, profileUrl, timestampMs } = parseLogStatusAndUrl(line)
        if (status !== 'sent' && status !== 'already_connected') continue
        if (runStartedAt > 0 && (timestampMs == null || timestampMs < runStartedAt - 1000)) continue
        const key = canonicalProfileUrlKey(profileUrl)
        if (!key || !attemptedKeys.has(key)) continue
        completedKeys.add(key)
      }
      if (completedKeys.size === 0) return
      await getLoa().campaignMarkSent({
        campaignId: activeCampaign.id,
        profileUrls: [...completedKeys]
      })
      void loadActiveCampaign()
    } catch { /* markRunComplete failed — campaign syncs on next load */ }
    finally {
      lastRunTargetsRef.current = []
      lastRunStartedAtRef.current = 0
    }
  }, [activeCampaign, loadActiveCampaign])

  const testComposePreview = useCallback(async (opts?: { target?: TargetRow }) => {
    if (!settings) return
    const draft = buildSetupDraft()
    if (!draft) return
    setComposePreviewLoading(true)
    try {
      const res = (await getLoa().composePreview({
        draft,
        target: opts?.target
      })) as ComposePreviewView
      setComposePreview(res)
    } catch (e) {
      setComposePreview({
        ok: false,
        detail: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setComposePreviewLoading(false)
    }
  }, [buildSetupDraft, settings])

  const setMissionExample = useCallback(() => {
    setMissionPrompt(
      'Connect with hiring managers and recruiters at hedge funds that may be looking for junior talent.'
    )
  }, [])

  const buildMissionPlan = useCallback(async () => {
    if (!settings) return
    const prompt = missionPrompt.trim()
    if (!prompt) return
    const draft = buildSetupDraft()
    if (!draft) return
    setMissionPlanning(true)
    setMissionPlan(null)
    setSetupFeedback(null)
    try {
      const res = (await getLoa().missionPlan({
        prompt,
        draft
      })) as MissionPlanView
      setMissionPlan(res)
      if (!res.ok) {
        setSetupFeedback({ type: 'error', message: res.detail })
        return
      }
      setSettings({
        ...settings,
        lastExecutionId: res.executionId,
        templates: [...res.templates],
        mustInclude: [...res.mustInclude]
      })
      setNoteOptions([...res.templates])
      setMustIncludeInput(res.mustInclude.join('\n'))
      setCsvInput('')
      setSetupFeedback({
        type: 'success',
        message:
          res.executionId === 'post_accept_followup'
            ? `Applied ${res.executionLabel.toLowerCase()} plan.`
            : `Applied ${res.executionLabel.toLowerCase()} plan. Find people now or open Run.`
      })
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      setMissionPlan({ ok: false, detail })
      setSetupFeedback({ type: 'error', message: detail })
    } finally {
      setMissionPlanning(false)
    }
  }, [buildSetupDraft, missionPrompt, settings])

  const [executingGoal, setExecutingGoal] = useState(false)
  const executingGoalRef = useRef(false)
  const [goalProgress, setGoalProgress] = useState('')
  const [jobSearchRequest, setJobSearchRequest] = useState<{ keywords: string; location?: string } | null>(null)

  const executeGoal = useCallback(async () => {
    if (executingGoalRef.current) return
    if (!settings) return
    const prompt = missionPrompt.trim()
    if (!prompt) return
    const draft = buildSetupDraft()
    if (!draft) return

    executingGoalRef.current = true
    setExecutingGoal(true)
    setMissionPlan(null)
    setSetupFeedback(null)
    setRunStartFeedback(null)

    try {
      setGoalProgress('Building your plan…')
      const planRes = (await getLoa().missionPlan({
        prompt,
        draft
      })) as MissionPlanView

      setMissionPlan(planRes)
      if (!planRes.ok) {
        setSetupFeedback({ type: 'error', message: planRes.detail })
        return
      }

      const updatedSettings = {
        ...settings,
        lastExecutionId: planRes.executionId,
        templates: [...planRes.templates],
        mustInclude: [...planRes.mustInclude]
      }
      setSettings(updatedSettings)
      setNoteOptions([...planRes.templates])
      setMustIncludeInput(planRes.mustInclude.join('\n'))
      setCsvInput('')

      setGoalProgress('Saving settings…')
      try {
        const savedSettings = (await getLoa().settingsSaveBundle({
          settings: {
            ...draft,
            lastExecutionId: planRes.executionId,
            templates: [...planRes.templates],
            mustInclude: [...planRes.mustInclude],
            lastGoal: missionPrompt.trim()
          }
        })) as SettingsView
        setSettings(savedSettings)
      } catch { /* settings bundle save failed — user sees plan result; can save manually */ }

      if (planRes.mode === 'jobs') {
        setJobSearchRequest({ keywords: planRes.searchQuery })
        setSetupFeedback({
          type: 'success',
          message: `Switching to Jobs tab to search for: "${planRes.searchQuery}"`
        })
        return
      }

      if (planRes.executionId === 'post_accept_followup') {
        setGoalProgress('Starting follow-up run…')
        const bridgeState = await probeBridge()
        if (!bridgeState.ok) {
          setSetupFeedback({
            type: 'error',
            message: bridgeState.extensionConnected
              ? 'Open a linkedin.com tab in Chrome before starting.'
              : 'Chrome is not linked yet.'
          })
          return
        }
        const res = await getLoa().queueStart([])
        if (!res.ok) {
          setRunStartFeedback(res.detail || 'Could not start follow-up run.')
        } else {
          setSetupFeedback({
            type: 'success',
            message: 'Follow-up run started from your goal.'
          })
        }
        return
      }

      setGoalProgress('Checking Chrome connection…')
      const bridgeState = await probeBridge()
      if (!bridgeState.ok) {
        setSetupFeedback({
          type: 'error',
          message: bridgeState.extensionConnected
            ? 'Plan built, but open a linkedin.com tab in Chrome so the app can find people.'
            : 'Plan built, but Chrome is not linked yet. Connect the extension first.'
        })
        return
      }

      setGoalProgress('Searching LinkedIn for people…')
      const prospectRes = (await getLoa().collectProspectsFromPlan({
        query: planRes.searchQuery
      })) as ProspectCollectionView

      if (!prospectRes.ok) {
        setSetupFeedback({ type: 'error', message: prospectRes.detail })
        return
      }

      if (prospectRes.count === 0) {
        setCsvInput(prospectRes.csvText || '')
        setSetupFeedback({
          type: 'error',
          message: 'Search ran but found no one. Try a different goal or paste your own list.'
        })
        return
      }

      setCsvInput(prospectRes.csvText)

      const parsed = parseTargetsCsvWithDiagnostics(prospectRes.csvText, {
        runExecutionId: planRes.executionId
      })
      if (parsed.targets.length === 0) {
        setSetupFeedback({
          type: 'error',
          message: 'Found people but could not parse valid profiles. Try a different goal.'
        })
        return
      }

      setSetupFeedback({
        type: 'success',
        message: `Found ${parsed.targets.length} ${parsed.targets.length === 1 ? 'person' : 'people'}. Review below and send when ready.`
      })

      try {
        const campaignRes = (await getLoa().campaignCreate({
          goal: prompt,
          plan: {
            title: planRes.title,
            summary: planRes.summary,
            executionId: planRes.executionId,
            searchQuery: planRes.searchQuery
          },
          targets: parsed.targets
        })) as { ok: boolean; campaign: CampaignSummaryView }
        if (campaignRes.ok) setActiveCampaign(campaignRes.campaign)
      } catch { /* campaign create failed — outer catch may still surface */ }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      setSetupFeedback({ type: 'error', message: detail })
    } finally {
      executingGoalRef.current = false
      setExecutingGoal(false)
      setGoalProgress('')
    }
  }, [buildSetupDraft, missionPrompt, probeBridge, settings])

  const collectProspectsFromPlan = useCallback(async () => {
    if (!missionPlan?.ok || missionPlan.executionId === 'post_accept_followup') return
    setCollectingProspects(true)
    setSetupFeedback(null)
    setRunStartFeedback(null)
    try {
      const bridgeState = await probeBridge()
      if (!bridgeState.ok) {
        setSetupFeedback({
          type: 'error',
          message: bridgeState.extensionConnected
            ? 'Open a linkedin.com tab in Chrome before finding people.'
            : 'Chrome is not linked yet.'
        })
        return
      }
      const res = (await getLoa().collectProspectsFromPlan({
        query: missionPlan.searchQuery
      })) as ProspectCollectionView
      if (!res.ok) {
        setSetupFeedback({
          type: 'error',
          message: res.detail
        })
        return
      }
      setCsvInput(res.csvText)
      setSetupFeedback({
        type: 'success',
        message:
          res.count > 0
            ? `Loaded ${res.count} ${res.count === 1 ? 'person' : 'people'} from LinkedIn search.`
            : 'Opened LinkedIn search, but no people were imported yet.'
      })
    } catch (e) {
      setSetupFeedback({
        type: 'error',
        message: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setCollectingProspects(false)
    }
  }, [missionPlan, probeBridge])

  const dismissOnboarding = useCallback(async () => {
    if (!settings) return
    setOnboardingDismissError(null)
    try {
      await persistSetupDraft({ settingsPatch: { seenOnboarding: true } })
    } catch (e) {
      setOnboardingDismissError(
        e instanceof Error ? e.message : 'Could not save. Try Save settings on the Setup tab.'
      )
    }
  }, [settings, persistSetupDraft])

  const showGettingStartedAgain = useCallback(async () => {
    if (!settings) return
    setOnboardingDismissError(null)
    setGettingStartedError(null)
    try {
      await persistSetupDraft({ settingsPatch: { seenOnboarding: false } })
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      })
    } catch (e) {
      setGettingStartedError(
        e instanceof Error ? e.message : 'Could not show the guide. Try again or use Save settings on Setup.'
      )
    }
  }, [settings, persistSetupDraft])

  const setLastExecutionId = useCallback(
    (id: string) => {
      if (!settings) return
      setRunStartFeedback(null)
      const ex = getExecutionById(id)
      const nextTemplates = persistedTemplatesForExecutionSelect(id)
      setSettings({
        ...settings,
        lastExecutionId: id,
        templates: nextTemplates ? [...nextTemplates] : settings.templates
      })
      if (nextTemplates) setNoteOptions([...nextTemplates])
      if (ex?.queueKind === 'post_accept_dm') setCsvInput('')
    },
    [settings]
  )

  const restoreRunPreset = useCallback(() => {
    if (!settings) return
    const ex = getExecutionById(settings.lastExecutionId)
    if (ex?.starterCsv?.trim()) setCsvInput(ex.starterCsv)
  }, [settings])

  const skipToMain = useCallback((e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    const el = document.getElementById('main-content')
    if (!el) return
    el.focus()
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }, [])

  const resumeCampaign = useCallback(async () => {
    if (!activeCampaign) return
    try {
      const res = (await getLoa().campaignResume()) as {
        ok: boolean
        campaign?: CampaignSummaryView
        plan?: { title: string; summary: string; executionId: string; searchQuery: string }
        remainingTargets?: Array<{ profileUrl: string; firstName?: string; company?: string; headline?: string }>
        detail?: string
      }
      if (!res.ok) {
        setSetupFeedback({ type: 'error', message: res.detail || 'Could not resume campaign.' })
        return
      }
      const plan = res.plan
      const remaining = res.remainingTargets || []

      if (res.campaign) {
        setActiveCampaign(res.campaign)
        setMissionPrompt(res.campaign.goal)
      }

      if (plan && settings) {
        setSettings({
          ...settings,
          lastExecutionId: plan.executionId
        })
      }

      if (remaining.length > 0) {
        setCsvInput(targetsToCsvText(remaining))
      }

      if (plan) {
        setMissionPlan({
          ok: true,
          title: plan.title,
          summary: plan.summary,
          executionId: plan.executionId,
          executionLabel: plan.executionId,
          searchQuery: plan.searchQuery,
          searchUrl: '',
          csvSeed: '',
          templates: settings?.templates || [],
          mustInclude: settings?.mustInclude || [],
          nextStep: 'send',
          mode: 'people',
          route: 'llm',
          detail: ''
        })
      }

      const remainingCount = res.campaign?.remainingCount ?? activeCampaign.remainingCount
      const totalTargets = res.campaign?.totalTargets ?? activeCampaign.totalTargets
      setSetupFeedback({
        type: 'success',
        message: `Resumed campaign: ${remainingCount} of ${totalTargets} people remaining.`
      })
    } catch (e) {
      setSetupFeedback({ type: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }, [activeCampaign, settings])

  const doArchiveCampaign = useCallback(async () => {
    if (!activeCampaign) return
    try {
      await getLoa().campaignArchive({ campaignId: activeCampaign.id })
      setActiveCampaign(null)
    } catch {
      setSetupFeedback({ type: 'error', message: 'Could not archive campaign. Try again.' })
    }
  }, [activeCampaign])

  const loadDemoCsvExample = useCallback(() => {
    setCsvInput(`https://www.linkedin.com/in/demo-avery-chen/
Avery Chen, Northbridge Labs`)
  }, [])

  const importLinkedInBackground = useCallback(async () => {
    if (!settings) return
    clearSaveBannerTimer()
    setSetupFeedback(null)
    setImportingLinkedInBackground(true)
    try {
      const bridgeState = await probeBridge()
      if (!bridgeState.ok) {
        setSetupFeedback({
          type: 'error',
          message:
            bridgeState.detail === 'desktop_app_offline'
              ? 'Start the desktop app window first.'
              : bridgeState.extensionConnected
                ? 'Open your LinkedIn tab in Chrome first.'
                : bridgeState.detail || 'Chrome is not linked yet.'
        })
        return
      }

      const res = (await getLoa().profileImportMine({
        persist: false,
        restoreAfter: true
      })) as ProfileImportView

      if (!res.ok) {
        setSetupFeedback({ type: 'error', message: res.detail })
        return
      }

      const next = await persistSetupDraft({
        settingsPatch: { userBackground: res.background }
      })
      if (next) {
        setSettings(next)
        setNoteOptions(next.templates?.length ? [...next.templates] : [''])
        setMustIncludeInput((next.mustInclude || []).join('\n'))
      } else {
        setSettings((current) => (current ? { ...current, userBackground: res.background } : current))
      }

      setSetupFeedback({
        type: 'success',
        message: 'Imported your LinkedIn profile into About you.'
      })
      saveBannerTimerRef.current = window.setTimeout(() => {
        setSetupFeedback(null)
        saveBannerTimerRef.current = null
      }, 4500)
    } catch (err) {
      setSetupFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setImportingLinkedInBackground(false)
    }
  }, [clearSaveBannerTimer, persistSetupDraft, probeBridge, settings])

  const handleResumeUploadResult = useCallback(
    (
      res:
        | { ok: true; fileName: string; charCount: number }
        | { ok: false; detail: string }
    ) => {
      if (!res.ok) {
        if (res.detail === 'cancelled') return false
        setSetupFeedback({ type: 'error', message: res.detail })
        return false
      }
      setSettings((current) => (current ? { ...current, resumeFileName: res.fileName } : current))
      setSetupFeedback({
        type: 'success',
        message: `Saved resume "${res.fileName}". Smart job search and AI screening will use it.`
      })
      saveBannerTimerRef.current = window.setTimeout(() => {
        setSetupFeedback(null)
        saveBannerTimerRef.current = null
      }, 4500)
      return true
    },
    []
  )

  const uploadResume = useCallback(async () => {
    clearSaveBannerTimer()
    setSetupFeedback(null)
    setUploadingResume(true)
    try {
      const res = await getLoa().uploadResume()
      return handleResumeUploadResult(res)
    } catch (err) {
      setSetupFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
      return false
    } finally {
      setUploadingResume(false)
    }
  }, [clearSaveBannerTimer, handleResumeUploadResult])

  const uploadResumeFile = useCallback(async (file: File) => {
    clearSaveBannerTimer()
    setSetupFeedback(null)
    setUploadingResume(true)
    try {
      const res = await getLoa().uploadResumeFile(file)
      return handleResumeUploadResult(res)
    } catch (err) {
      setSetupFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
      return false
    } finally {
      setUploadingResume(false)
    }
  }, [clearSaveBannerTimer, handleResumeUploadResult])

  const clearResume = useCallback(async () => {
    clearSaveBannerTimer()
    setSetupFeedback(null)
    try {
      await getLoa().clearResume()
      setSettings((current) => (current ? { ...current, resumeFileName: '' } : current))
      setSetupFeedback({
        type: 'success',
        message: 'Removed the saved resume.'
      })
      saveBannerTimerRef.current = window.setTimeout(() => {
        setSetupFeedback(null)
        saveBannerTimerRef.current = null
      }, 3000)
      return true
    } catch (err) {
      setSetupFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
      return false
    }
  }, [clearSaveBannerTimer])

  const openLogsFolder = useCallback(async () => {
    try {
      const path = await getLoa().openLogsFolder()
      if (path) return true

      clearSaveBannerTimer()
      setSetupFeedback({
        type: 'error',
        message:
          'Could not open the logs folder automatically. If another older app window is running, fully quit all app windows and relaunch the latest build.'
      })
      return false
    } catch (err) {
      clearSaveBannerTimer()
      setSetupFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
      return false
    }
  }, [clearSaveBannerTimer])

  return {
    bridge,
    bridgeReady,
    bridgeProbed,
    desktopBackendReady,
    settings,
    noteOptions,
    updateNoteOption,
    appendPlaceholderToNote,
    addNoteOption,
    mustIncludeInput,
    setMustIncludeInput,
    csvInput,
    setCsvInput,
    queueState,
    logs,
    logsBusy,
    setupFeedback,
    composePreview,
    composePreviewLoading,
    settingsHydrating,
    settingsLoadError,
    setupDirty,
    missionPrompt,
    setMissionPrompt,
    missionPlan,
    missionPlanning,
    collectingProspects,
    buildMissionPlan,
    executeGoal,
    executingGoal,
    goalProgress,
    collectProspectsFromPlan,
    targets,
    csvIssues,
    startRunBlockedReason,
    startRunDisabled,
    runStartFeedback,
    historyFeedback,
    setSettings,
    reloadSettings: loadSettings,
    refreshBridge,
    refreshLogs,
    exportLogs,
    clearLogs,
    saveSetup,
    testComposePreview,
    importLinkedInBackground,
    importingLinkedInBackground,
    uploadResume,
    uploadResumeFile,
    uploadingResume,
    clearResume,
    openLogsFolder,
    startRun,
    dismissOnboarding,
    showGettingStartedAgain,
    skipToMain,
    setLastExecutionId,
    followUpRunWithoutList,
    jobSearchRequest,
    setJobSearchRequest,
    clearJobSearchRequest: () => setJobSearchRequest(null),
    selectedTargets,
    excludedIndices,
    sendLimit,
    setSendLimit,
    toggleTarget,
    selectAllTargets,
    deselectAllTargets,
    activeCampaign,
    resumeCampaign,
    doArchiveCampaign,
    markRunComplete
  }
}
