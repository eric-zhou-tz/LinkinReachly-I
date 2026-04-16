import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EXECUTION_REGISTRY } from '@core/executions'
import { computeCampaignMetrics } from '@core/campaign-analytics'
import type { AppModel } from '@/hooks/useAppModel'
import { getLoa } from '@/loa-client'
import { TargetListPreview } from './TargetListPreview'
import type { SmartSearchProgress } from './jobs-smart-search-status'
import { JobsSmartSearchStatusCard } from './jobs-smart-search-status'
import { HiringManagerOutreachCard } from './HiringManagerOutreachCard'

type WizardStep = 'connect' | 'goal' | 'review' | 'send' | 'done'

const GOAL_EXAMPLES = [
  { label: 'Hiring managers', prompt: 'Connect with hiring managers at Series B+ startups in fintech who are looking for senior engineers.' },
  { label: 'Investors', prompt: 'Reach out to VCs and angel investors focused on B2B SaaS in the US who have recently made investments.' },
  { label: 'Sales leads', prompt: 'Find heads of marketing at mid-size e-commerce companies who might benefit from our analytics platform.' },
] as const

const STEP_ORDER: WizardStep[] = ['connect', 'goal', 'review', 'send', 'done']

const STEP_LABELS: Record<WizardStep, string> = {
  connect: 'Find',
  goal: 'Who to reach',
  review: 'Message',
  send: 'Send',
  done: 'Results'
}

function variantIndex(variant: string): number | null {
  const match = /^T(\d+)/i.exec(String(variant || '').trim())
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function labelForVariant(variant: string): string {
  const index = variantIndex(variant)
  return index == null ? 'Custom message' : `Message group ${index + 1}`
}

function displayTargetName(target: { personName?: string; firstName?: string; profileUrl?: string }): string {
  if (target.personName) return target.personName
  if (target.firstName) return target.firstName
  if (target.profileUrl) {
    const slug = target.profileUrl.replace(/\/$/, '').split('/').pop() || ''
    return slug.replace(/-/g, ' ')
  }
  return 'this person'
}

function explainRunDetail(detail: string): string {
  if (!detail) return detail
  if (detail === 'email_required_to_connect') return "LinkedIn requires this person's email address before sending the invite."
  if (/already_completed_in_log/i.test(detail)) return 'Already sent to this person.'
  if (/already_in_today_ledger/i.test(detail)) return 'Already contacted today.'
  if (/warmup_profile_view/i.test(detail)) return 'Warming up: viewing profile first.'
  if (/warmup_delay_pending/i.test(detail)) return 'Warming up: waiting before sending.'
  if (/daily_cap/i.test(detail)) return 'Daily sending limit reached.'
  if (/weekly_cap/i.test(detail)) return 'Weekly sending limit reached.'
  if (/extract_connections_failed/i.test(detail)) return 'Could not read LinkedIn connections.'
  if (/no_log_match_after_retries/i.test(detail)) return 'Could not find this person on LinkedIn.'
  if (/no_pending_connection_invites/i.test(detail)) return 'No pending connection invites found.'
  if (/profile_search_no_match/i.test(detail)) return 'Could not find this person on LinkedIn search.'
  if (/connect_not_available/i.test(detail)) return 'Connect button not available for this person.'
  if (/bridge.*disconnect|extension.*not connected/i.test(detail)) return 'Chrome extension disconnected.'
  if (/verification_required|challenge|captcha/i.test(detail)) return 'Action needed in Chrome \u2014 check your LinkedIn tab.'
  if (/rate.*limit/i.test(detail)) return 'Taking a short break.'
  if (/^(override|type|send|verify|prepare|add_note|click):/i.test(detail)) {
    const after = detail.replace(/^[^:]+:\s*/, '')
    return after || detail
  }
  if (/^[a-z_]+$/i.test(detail)) {
    return detail.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
  }
  if (detail.length > 120) return 'Something went wrong. Try again in a moment.'
  return detail
}

interface WizardFlowProps {
  model: AppModel
  chromeReady: boolean
  noteReady: boolean
  listReady: boolean
  followUpMode: boolean
  hasPlannedSearch: boolean
  aiConfigured: boolean
  followUpBadge?: number
  /** Live job smart-search progress from Jobs panel (Campaign-only UI). */
  smartSearchActivity?: { smartSearching: boolean; smartProgress: SmartSearchProgress | null } | null
  onCancelSmartSearch?: () => void
  smartSearchCancelPending?: boolean
  onViewHistory?: () => void
  onStepChange?: (step: string) => void
  onCompletedStepsChange?: (steps: ReadonlySet<string>) => void
  externalStep?: string
}

export function WizardFlow({
  model,
  chromeReady,
  noteReady,
  listReady,
  followUpMode,
  hasPlannedSearch,
  aiConfigured,
  followUpBadge = 0,
  smartSearchActivity = null,
  onCancelSmartSearch,
  smartSearchCancelPending = false,
  onViewHistory,
  onStepChange,
  onCompletedStepsChange,
  externalStep
}: WizardFlowProps) {
  const initialStep = externalStep && STEP_ORDER.includes(externalStep as WizardStep)
    ? externalStep as WizardStep
    : 'connect'
  const [step, setStepRaw] = useState<WizardStep>(initialStep)
  const setStep = useCallback((s: WizardStep) => { setStepRaw(s); onStepChange?.(s) }, [onStepChange])

  const prevExternalStep = useRef(externalStep)
  useEffect(() => {
    if (externalStep && externalStep !== prevExternalStep.current && STEP_ORDER.includes(externalStep as WizardStep)) {
      prevExternalStep.current = externalStep
      setStepRaw(externalStep as WizardStep)
    } else {
      prevExternalStep.current = externalStep
    }
  }, [externalStep])
  const [messageOverrideEnabled, setMessageOverrideEnabled] = useState(false)
  const [messageOverride, setMessageOverride] = useState('')
  const [extensionFolderError, setExtensionFolderError] = useState<string | null>(null)
  const [extensionFolderOpening, setExtensionFolderOpening] = useState(false)
  const [bridgeCheckBusy, setBridgeCheckBusy] = useState(false)
  const [bridgeCheckError, setBridgeCheckError] = useState<string | null>(null)
  const [stoppingQueue, setStoppingQueue] = useState(false)
  const [stopQueueError, setStopQueueError] = useState<string | null>(null)
  /** Set true when bridge/settings report high pending invite count (see also `settings.pendingInviteCount`). */
  const [pendingInviteWarning, setPendingInviteWarning] = useState(false)
  const queueRunning = !!(model.queueState && model.queueState.running)
  const completedAt = model.queueState?.completedAt ?? null
  const prevCompletedAt = usePrevious(completedAt)
  /** True only after a queue run finishes this visit (not when opening Results from the rail with no run). */
  const [doneFromSessionCompletion, setDoneFromSessionCompletion] = useState(false)

  const hasTargets = model.targets.length > 0 || model.missionPlan?.ok
  const hasNote = noteReady
  const hasSent = doneFromSessionCompletion
  useEffect(() => {
    const completed = new Set<string>()
    if (hasTargets) completed.add('goal')
    if (hasTargets && hasNote) completed.add('review')
    if (hasSent) { completed.add('goal'); completed.add('review'); completed.add('send'); completed.add('done') }
    onCompletedStepsChange?.(completed)
  }, [hasTargets, hasNote, hasSent, onCompletedStepsChange])

  const singleSelectedTarget = !followUpMode && model.selectedTargets.length === 1 ? model.selectedTargets[0] : null
  const singleSelectedTargetKey = useMemo(
    () =>
      singleSelectedTarget
        ? [
            singleSelectedTarget.profileUrl || '',
            singleSelectedTarget.firstName || '',
            singleSelectedTarget.company || '',
            singleSelectedTarget.headline || ''
          ].join('|')
        : '',
    [singleSelectedTarget]
  )
  const activeExecution = useMemo(
    () => EXECUTION_REGISTRY.find((ex) => ex.id === model.settings?.lastExecutionId),
    [model.settings?.lastExecutionId]
  )
  const selectedTargetPreview =
    singleSelectedTarget &&
    model.composePreview?.ok &&
    model.composePreview.sampleTarget.profileUrl === singleSelectedTarget.profileUrl
      ? model.composePreview
      : null
  const selectedPreviewGroupIndex = selectedTargetPreview ? variantIndex(selectedTargetPreview.variant) : null
  const activeMessageGroups = useMemo(() => model.noteOptions
    .map((text, index) => ({ text: text.trim(), index }))
    .filter((entry) => entry.text.length > 0), [model.noteOptions])
  const requiredPhrases = useMemo(() => model.mustIncludeInput
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean), [model.mustIncludeInput])
  const csvIssueKeys = useMemo(() => {
    const seen = new Map<string, number>()
    return model.csvIssues.map((issue) => {
      const base = String(issue || '').trim().toLowerCase() || 'issue'
      const count = seen.get(base) || 0
      seen.set(base, count + 1)
      return `${base}#${count}`
    })
  }, [model.csvIssues])
  const trimmedMessageOverride = messageOverride.trim()
  const messageOverrideError = !messageOverrideEnabled
    ? null
    : !trimmedMessageOverride
      ? 'Enter the message you want to send.'
      : trimmedMessageOverride.length > 300
        ? 'Custom message must be 300 characters or fewer.'
        : requiredPhrases.find((phrase) => !trimmedMessageOverride.includes(phrase))
          ? `Custom message must include "${requiredPhrases.find((phrase) => !trimmedMessageOverride.includes(phrase))}".`
          : null
  const sendPrimaryDisabled = model.startRunDisabled || !!messageOverrideError
  const sendBlockedReason = messageOverrideError || model.startRunBlockedReason

  const settingsPendingInvites = model.settings?.pendingInviteCount
  const showPendingInviteBanner =
    pendingInviteWarning ||
    (typeof settingsPendingInvites === 'number' && settingsPendingInvites > 500)

  const startOutreachRunWithInviteCheck = useCallback(
    async (opts?: { dryRun?: boolean; messageOverride?: string }) => {
      try {
        const st = await getLoa().bridgeStatus()
        const fromBridge = st.pendingInviteCount
        const fromSettings = model.settings?.pendingInviteCount
        const n =
          typeof fromBridge === 'number' && Number.isFinite(fromBridge)
            ? fromBridge
            : typeof fromSettings === 'number' && Number.isFinite(fromSettings)
              ? fromSettings
              : undefined
        if (n != null && n > 500) {
          setPendingInviteWarning(true)
        }
      } catch {
        const fromSettings = model.settings?.pendingInviteCount
        if (typeof fromSettings === 'number' && fromSettings > 500) {
          setPendingInviteWarning(true)
        }
      }
      await model.startRun(opts)
    },
    [model]
  )

  const startOutreachRunRef = useRef(startOutreachRunWithInviteCheck)
  startOutreachRunRef.current = startOutreachRunWithInviteCheck

  useEffect(() => {
    if (step !== 'send' || queueRunning || !singleSelectedTarget) return
    if (selectedTargetPreview || model.composePreviewLoading) return
    void model.testComposePreview({ target: singleSelectedTarget })
  }, [step, queueRunning, singleSelectedTarget, singleSelectedTargetKey, selectedTargetPreview, model.composePreviewLoading, model.testComposePreview])

  useEffect(() => {
    if (chromeReady && step === 'connect') setStep('goal')
  }, [chromeReady, step])

  useEffect(() => {
    if (queueRunning && step !== 'send') setStep('send')
  }, [queueRunning, step])

  useEffect(() => {
    if (
      completedAt &&
      prevCompletedAt !== undefined &&
      completedAt !== prevCompletedAt &&
      step === 'send'
    ) {
      void model.refreshLogs()
      void model.markRunComplete()
      setDoneFromSessionCompletion(true)
      setStep('done')
    }
  }, [completedAt, prevCompletedAt, step, model])

  useEffect(() => {
    if (step === 'goal' || step === 'connect') {
      setDoneFromSessionCompletion(false)
    }
  }, [step])

  const primaryRef = useRef<HTMLButtonElement>(null)

  const stepRef = useRef(step); stepRef.current = step
  const chromeReadyRef = useRef(chromeReady); chromeReadyRef.current = chromeReady
  const noteReadyRef = useRef(noteReady); noteReadyRef.current = noteReady
  const queueRunningRef = useRef(queueRunning); queueRunningRef.current = queueRunning
  const sendPrimaryDisabledRef = useRef(sendPrimaryDisabled); sendPrimaryDisabledRef.current = sendPrimaryDisabled
  const messageOverrideEnabledRef = useRef(messageOverrideEnabled); messageOverrideEnabledRef.current = messageOverrideEnabled
  const messageOverrideRef = useRef(messageOverride); messageOverrideRef.current = messageOverride
  const modelRef = useRef(model); modelRef.current = model

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === 'Enter') {
        e.preventDefault()
        const m = modelRef.current
        let acted = false
        if (stepRef.current === 'goal' && !m.executingGoal && !m.missionPlanning && m.missionPrompt.trim() && chromeReadyRef.current) {
          void m.executeGoal()
          acted = true
        }
        if (stepRef.current === 'review' && noteReadyRef.current) {
          setStep('send')
          acted = true
        }
        if (stepRef.current === 'send' && !queueRunningRef.current && !sendPrimaryDisabledRef.current) {
          void startOutreachRunRef.current({
            messageOverride: messageOverrideEnabledRef.current ? messageOverrideRef.current : undefined
          })
          acted = true
        }
        if (!acted && primaryRef.current) {
          primaryRef.current.classList.remove('btn-shake')
          void primaryRef.current.offsetWidth
          primaryRef.current.classList.add('btn-shake')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const stepIndex = STEP_ORDER.indexOf(step)

  function canGoBack(): boolean {
    if (step === 'connect') return false
    if (queueRunning) return false
    return true
  }

  function goBack() {
    if (!canGoBack()) return
    const prev = STEP_ORDER[stepIndex - 1]
    if (prev === 'connect' && chromeReady) {
      setStep('goal')
    } else if (prev) {
      setStep(prev)
    }
  }

  return (
    <div className="wizard wizard--c1">
        <div className="wizard-surface wizard-content">
          <div className={`wizard-surface__body${step === 'done' ? ' wizard-surface__body--done-step' : ''}`}>
        {smartSearchActivity &&
          (smartSearchActivity.smartSearching || smartSearchActivity.smartProgress) && (
            <div
              className="campaign-smart-search-card jobs-bento__tile jobs-bento__smart"
              aria-label="Smart search progress"
            >
              <JobsSmartSearchStatusCard
                smartSearching={smartSearchActivity.smartSearching}
                smartProgress={smartSearchActivity.smartProgress}
                onCancel={onCancelSmartSearch}
                cancelPending={smartSearchCancelPending}
              />
            </div>
          )}

        {showPendingInviteBanner && (
          <div className="wizard-feedback wizard-feedback--warn" role="alert">
            You have 500+ pending invites. Withdrawing old ones improves your acceptance rate.
          </div>
        )}

        {step === 'connect' && (
          <div className="ext-setup-card" role="alert" style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-5, 2rem)', borderRadius: 'var(--radius-lg, 12px)', background: 'var(--surface-raised, var(--desk-200))', border: '1px solid var(--border-subtle, var(--desk-300))', minHeight: '320px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {chromeReady ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  <strong style={{ fontSize: '1.05rem' }}>Connected</strong>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-go"
                  onClick={() => setStep('goal')}
                >
                  Get started
                </button>
              </>
            ) : model.bridge.extensionConnected ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                  <strong style={{ fontSize: '1.05rem' }}>Extension connected {'\u2014'} open LinkedIn</strong>
                </div>
                <p style={{ margin: '0 0 var(--space-3)', color: 'var(--ink-secondary, var(--ink-600))', lineHeight: 1.5 }}>
                  Open <strong>linkedin.com</strong> in the same Chrome window where the extension is active. The header will turn green when ready.
                </p>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  <strong style={{ fontSize: '1.05rem' }}>Connect LinkinReachly to Chrome</strong>
                </div>
                <p style={{ margin: '0 0 var(--space-3)', color: 'var(--ink-secondary, var(--ink-600))', lineHeight: 1.5 }}>
                  LinkinReachly works through a Chrome extension that connects to LinkedIn for you. Follow these steps once {'\u2014'} it takes about 2 minutes.
                </p>
                <ol style={{ margin: '0 0 var(--space-3)', paddingLeft: 'var(--space-4)', lineHeight: 2, color: 'var(--ink-primary, var(--ink-800))' }}>
                  <li style={{ marginBottom: 'var(--space-1)' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={{ verticalAlign: 'middle' }}
                      disabled={extensionFolderOpening}
                      aria-busy={extensionFolderOpening}
                      onClick={() => {
                        setExtensionFolderError(null)
                        setExtensionFolderOpening(true)
                        void getLoa().openExtensionFolder()
                          .catch((err) => {
                            setExtensionFolderError(err instanceof Error ? err.message : 'Could not open folder.')
                          })
                          .finally(() => setExtensionFolderOpening(false))
                      }}
                    >
                      {extensionFolderOpening ? 'Opening\u2026' : 'Open extension folder'}
                    </button>
                    <span style={{ color: 'var(--ink-tertiary, var(--ink-500))', marginLeft: 'var(--space-2)', fontSize: '0.85em' }}>(this reveals the folder you{'\u2019'}ll add to Chrome)</span>
                  </li>
                  <li style={{ marginBottom: 'var(--space-1)' }}>
                    In Chrome, go to <code style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.9em', background: 'var(--surface-sunken, var(--desk-100))', padding: '2px 6px', borderRadius: 4 }}>chrome://extensions</code> and flip the <strong>Developer mode</strong> toggle (top-right corner).
                  </li>
                  <li style={{ marginBottom: 'var(--space-1)' }}>Click <strong>Load unpacked</strong> and pick the folder from step 1.</li>
                  <li>Open <strong>linkedin.com</strong> in Chrome.</li>
                </ol>
                {extensionFolderError && (
                  <p className="wizard-feedback wizard-feedback--error mt-xs" role="alert">
                    Could not open folder: {extensionFolderError}
                  </p>
                )}
              </>
            )}
            {!chromeReady && (
              <div style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md, 8px)', background: 'var(--surface-sunken, var(--desk-100))', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: model.bridge.extensionConnected ? 'var(--amber-500)' : 'var(--ink-disabled, var(--ink-400))', flexShrink: 0 }} />
                <span style={{ color: model.bridge.extensionConnected ? 'var(--amber-700)' : 'var(--ink-tertiary, var(--ink-500))' }}>
                  {model.bridge.extensionConnected ? 'Extension connected \u2014 waiting for LinkedIn tab' : 'Waiting for extension connection\u2026'}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 'auto' }}
                  disabled={bridgeCheckBusy}
                  aria-busy={bridgeCheckBusy}
                  onClick={() => {
                    void (async () => {
                      setBridgeCheckBusy(true)
                      try {
                        await model.refreshBridge()
                      } catch {
                        setBridgeCheckError('We couldn\u2019t verify the connection. Open LinkedIn in Chrome and confirm the extension is on.')
                      } finally {
                        setBridgeCheckBusy(false)
                      }
                    })()
                  }}
                >
                  {bridgeCheckBusy ? 'Checking\u2026' : 'Check connection'}
                </button>
              </div>
            )}
            {bridgeCheckError && (
              <p className="wizard-feedback wizard-feedback--error mt-xs" role="alert">{bridgeCheckError}</p>
            )}
          </div>
        )}

        {step === 'goal' && (
          <div className="wizard-card wizard-card--in-surface">
            {followUpBadge > 0 && (
              <div className="wizard-feedback wizard-feedback--ok mb-md" role="status">
                <strong>{followUpBadge} accept{followUpBadge === 1 ? '' : 's'} this week</strong> {'\u2014'} people accepted your connection request.
              </div>
            )}
            {model.activeCampaign && model.activeCampaign.status === 'active' && model.activeCampaign.remainingCount > 0 && (
              <div className="wizard-campaign-resume">
                <div className="wizard-campaign-resume__header">
                  <h3 className="wizard-section-heading">Continue your campaign</h3>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => void model.doArchiveCampaign()}>Dismiss</button>
                </div>
                <p className="wizard-campaign-resume__title">{model.activeCampaign.title}</p>
                <div className="wizard-campaign-resume__stats">
                  <span>{model.activeCampaign.sentCount} sent</span>
                  <span className="wizard-send-meta__sep">{'\u2022'}</span>
                  <span>{model.activeCampaign.remainingCount} remaining</span>
                  <span className="wizard-send-meta__sep">{'\u2022'}</span>
                  <span>of {model.activeCampaign.totalTargets} total</span>
                </div>
                <div className="wizard-campaign-resume__progress">
                  <div
                    className="wizard-campaign-resume__bar"
                    style={{ width: `${Math.round((model.activeCampaign.sentCount / Math.max(model.activeCampaign.totalTargets, 1)) * 100)}%` }}
                  />
                </div>
                <p className="wizard-campaign-resume__meta">
                  Started {new Date(model.activeCampaign.createdAt).toLocaleDateString()}
                  {model.activeCampaign.updatedAt !== model.activeCampaign.createdAt && (
                    <> {'\u2022'} Last active {new Date(model.activeCampaign.updatedAt).toLocaleDateString()}</>
                  )}
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-go"
                  disabled={model.executingGoal}
                  aria-busy={model.executingGoal}
                  onClick={() => {
                    void model.resumeCampaign()
                    setStep('send')
                  }}
                >
                  {model.executingGoal
                    ? model.goalProgress || 'Continuing\u2026'
                    : `Continue with ${model.activeCampaign.remainingCount} ${model.activeCampaign.remainingCount === 1 ? 'person' : 'people'}`}
                </button>
              </div>
            )}

            <HiringManagerOutreachCard active={step === 'goal'} chromeReady={chromeReady} />

            <h2 className="s-title">Who do you want to reach?</h2>

            <label className="wizard-goal-field" htmlFor="wiz-goal">
              Your goal
              <textarea
                id="wiz-goal"
                className="wizard-goal-textarea"
                rows={3}
                value={model.missionPrompt}
                onChange={(e) => model.setMissionPrompt(e.target.value)}
                placeholder="Example: Connect with hedge fund hiring managers looking for junior talent."
              />
              
            </label>

            <div className="wizard-actions mt-sm">
              <button
                ref={step === 'goal' ? primaryRef : undefined}
                type="button"
                className="btn btn-primary btn-go"
                disabled={!model.settings || model.executingGoal || model.missionPlanning || !model.missionPrompt.trim() || !chromeReady}
                aria-busy={model.executingGoal}
                onClick={() => void model.executeGoal()}
              >
                {model.executingGoal ? model.goalProgress || 'Working\u2026' : <><span>Find people</span><kbd className="kbd-hint">{'\u2318\u21A9'}</kbd></>}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!model.settings || model.missionPlanning || model.executingGoal || !model.missionPrompt.trim()}
                aria-busy={model.missionPlanning}
                onClick={() => void model.buildMissionPlan()}
              >
                {model.missionPlanning ? 'Building\u2026' : 'Plan only'}
              </button>
            </div>
            {model.missionPlanning && !model.executingGoal && (
              <div className="wizard-feedback mt-sm" role="status" aria-live="polite">
                <span className="s-spinner" aria-hidden="true" />
                {'Building plan\u2026'}
              </div>
            )}
            <div className="wizard-disclosures-row mt-sm">
              {aiConfigured && (
                <details className="wizard-goal-ai-disclosure">
                  <summary className="field-hint wizard-goal-ai-disclosure__summary">How AI uses your goal</summary>
                  <div className="disclosure-panel mt-xs" role="note">
                    <p>
                      <strong>Find people</strong> and <strong>Plan only</strong> may send your goal to the configured model to build or refine a plan. With AI off or no key in Settings, the app falls back to keyword-style planning.
                    </p>
                  </div>
                </details>
              )}
              {model.settings && (
                <details className="wizard-advanced-toggle">
                  <summary>Advanced options</summary>
                  <div className="wizard-execution-pick">
                    <label htmlFor="wiz-execution">
                      Connection style
                      <select
                        id="wiz-execution"
                        value={model.settings.lastExecutionId}
                        onChange={(e) => void model.setLastExecutionId(e.target.value)}
                        aria-describedby="wiz-execution-disclosure"
                      >
                        {EXECUTION_REGISTRY.map((ex) => (<option key={ex.id} value={ex.id}>{ex.label}</option>))}
                      </select>
                    </label>
                    {activeExecution && (
                      <p className="field-hint" id="wiz-execution-disclosure">
                        {activeExecution.description}
                      </p>
                    )}
                  </div>
                </details>
              )}
              <button
                type="button"
                className="link-button muted caption"
                disabled={!model.settings || model.executingGoal || model.missionPlanning || !model.missionPrompt.trim() || !chromeReady}
                onClick={() => {
                  if (model.jobSearchRequest) return
                  const kw = model.missionPrompt.trim()
                  if (!kw) return
                  model.setJobSearchRequest({ keywords: kw })
                }}
              >
                Search jobs instead
              </button>
              <button
                type="button"
                className="link-button muted caption"
                disabled={model.executingGoal || model.missionPlanning}
                onClick={() => {
                  const next = GOAL_EXAMPLES[Math.floor(Math.random() * GOAL_EXAMPLES.length)].prompt
                  model.setMissionPrompt(next)
                }}
              >
                Try an example
              </button>
            </div>

            {model.setupFeedback?.type === 'error' && !model.executingGoal && (
              <div className="wizard-feedback wizard-feedback--error" role="alert">
                <strong>{model.missionPlan?.ok ? 'No people found.' : 'We couldn\u2019t run that goal.'}</strong>{' '}
                {model.setupFeedback.message}
                <p className="wizard-feedback__hint">
                  {model.missionPlan?.ok
                    ? 'LinkedIn\'s search returned no results for this query. Try rephrasing your goal with different keywords, or paste your own list in the Send step.'
                    : 'Try rephrasing your goal or check Settings for missing credentials.'}
                </p>
                <div className="flex-row-wrap mt-xs">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!model.settings || model.executingGoal || model.missionPlanning || !model.missionPrompt.trim() || !chromeReady}
                    aria-busy={model.executingGoal}
                    onClick={() => void model.executeGoal()}
                  >
                    Retry find people
                  </button>
                  {model.missionPlan?.ok && (
                    <button type="button" className="btn btn-ghost" onClick={() => setStep('send')}>Paste my own list</button>
                  )}
                </div>
              </div>
            )}

            {model.setupFeedback?.type === 'success' && !model.executingGoal && !model.missionPlan?.ok && (
              <div className="wizard-feedback wizard-feedback--ok" role="status">
                {model.setupFeedback.message}
              </div>
            )}

            {model.executingGoal && model.goalProgress && (
              <div className="wizard-feedback wizard-feedback--ok" role="status" aria-live="polite">
                <strong>{model.goalProgress}</strong>
              </div>
            )}

            {!model.executingGoal && model.missionPlan?.ok && model.setupFeedback?.type !== 'error' && (
              <div className="wizard-feedback wizard-feedback--ok" role="status" aria-live="polite">
                <strong>{model.missionPlan.title}</strong>
                <p>{model.missionPlan.summary}</p>
                <p className="muted caption">
                  {model.missionPlan.route === 'llm'
                    ? 'Plan built by AI'
                    : model.missionPlan.detail?.startsWith('llm_error')
                      ? `AI is temporarily unavailable. Using a keyword-based plan instead.`
                      : model.missionPlan.detail === 'no_api_key'
                        ? 'No API key set \u2014 using keyword-based plan. Add a key in Settings for AI plans.'
                        : 'Plan built from your keywords'}
                </p>
                {model.targets.length > 0 ? (
                  <>
                    <TargetListPreview
                      targets={model.targets}
                      selectedTargets={model.selectedTargets}
                      excludedIndices={model.excludedIndices}
                      sendLimit={model.sendLimit}
                      onToggle={model.toggleTarget}
                      onSelectAll={model.selectAllTargets}
                      onDeselectAll={model.deselectAllTargets}
                      onSendLimitChange={model.setSendLimit}
                    />
                    <p className="wizard-send-warning">You can withdraw pending requests anytime from LinkedIn.</p>
                    <div className="wizard-actions--main wizard-actions--stack mt-xs">
                      <button
                        type="button"
                        className="btn btn-primary btn-go btn-xl"
                        disabled={model.startRunDisabled}
                        aria-busy={queueRunning}
                        onClick={() => void startOutreachRunWithInviteCheck()}
                      >
                        {model.selectedTargets.length === 0
                          ? 'Select people to send'
                          : `Send to ${model.selectedTargets.length} ${model.selectedTargets.length === 1 ? 'person' : 'people'}`}
                      </button>
                    </div>
                    <div className="wizard-actions mt-xs">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={queueRunning}
                        aria-busy={queueRunning}
                        onClick={() => void startOutreachRunWithInviteCheck({ dryRun: true })}
                      >
                        {queueRunning ? 'Running\u2026' : 'Test run (preview only)'}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep('review')}>Review message</button>
                    </div>
                  </>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={() => setStep('review')}>Next: review message</button>
                )}
              </div>
            )}

            {!model.executingGoal && model.missionPlan && !model.missionPlan.ok && (
              <div className="wizard-feedback wizard-feedback--error" role="alert">
                <strong>Could not build a plan.</strong> {model.missionPlan.detail}
                <p className="wizard-feedback__hint">Check your internet connection and API key in Settings, then try again.</p>
                <div className="mt-xs">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!model.settings || model.missionPlanning || model.executingGoal || !model.missionPrompt.trim()}
                    aria-busy={model.missionPlanning}
                    onClick={() => void model.buildMissionPlan()}
                  >
                    {model.missionPlanning ? 'Retrying\u2026' : 'Retry plan'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'review' && (
          <div className="wizard-card wizard-card--in-surface">
            <h2 className="s-title">Review your message</h2>
            <p className="wizard-card__body wizard-card__body--tight">
              {followUpMode
                ? 'Sends a follow-up message to people who just accepted your invite. We find them automatically.'
                : 'Goes with each invite. Max 300 characters (LinkedIn).'}
            </p>
            

            {!followUpMode && model.noteOptions.map((text, i) => (
              <div key={`note-${i}-${model.noteOptions.length}`} className="wizard-message-card">
                <label htmlFor={`wiz-note-${i}`} className="wizard-message-label">
                  {model.noteOptions.length === 1 ? 'Connection note' : `Message ${i + 1}`}
                </label>
                <textarea
                  id={`wiz-note-${i}`}
                  className="wizard-message-textarea"
                  value={text}
                  onChange={(e) => model.updateNoteOption(i, e.target.value)}
                  rows={4}
                  maxLength={300}
                  placeholder="Hi {firstName}, I'd love to connect."
                />
                <div className="wizard-message-meta">
                  <div className="wizard-chips">
                    <button type="button" className="btn btn-ghost btn-chip" onClick={() => model.appendPlaceholderToNote(i, '{firstName}')}>First name</button>
                    <button type="button" className="btn btn-ghost btn-chip" onClick={() => model.appendPlaceholderToNote(i, '{company}')}>Company</button>
                    <button type="button" className="btn btn-ghost btn-chip" onClick={() => model.appendPlaceholderToNote(i, '{headline}')}>Headline</button>
                  </div>
                  <span className={`wizard-char-count ${text.length > 280 ? 'wizard-char-count--warn' : ''}`}>{text.length}/300</span>
                </div>
              </div>
            ))}

            <div className="wizard-actions">
              <button type="button" className="btn btn-primary" disabled={!model.settings || model.composePreviewLoading} aria-busy={model.composePreviewLoading} onClick={() => void model.testComposePreview()}>
                {model.composePreviewLoading ? 'Testing\u2026' : 'Preview message'}
              </button>
              {!followUpMode && model.noteOptions.length < 6 && (
                <button type="button" className="btn btn-ghost" onClick={() => model.addNoteOption()}>Add another message</button>
              )}
            </div>

            {model.composePreview && model.composePreview.ok && (
              <div className="wizard-feedback wizard-feedback--ok" role="status" aria-live="polite">
                <p>Preview for <strong>{model.composePreview.sampleTarget.firstName}</strong> at <strong>{model.composePreview.sampleTarget.company}</strong>:</p>
                <pre className="wizard-preview-text">{model.composePreview.body}</pre>
                <p className="muted caption mt-xs">
                  {model.composePreview.route === 'llm'
                    ? 'Written by AI'
                    : model.composePreview.detail?.startsWith('llm_error')
                      ? `AI is temporarily unavailable \u2014 using a template instead.`
                      : model.composePreview.detail === 'no_api_key'
                        ? 'No API key \u2014 using template. Add a key in Settings for personalized messages.'
                        : 'Using your template'} {'\u2022'} {model.composePreview.body.length} chars
                </p>
              </div>
            )}

            {model.composePreview && !model.composePreview.ok && (
              <div className="wizard-feedback wizard-feedback--error" role="alert">
                <strong>We couldn&apos;t generate a preview.</strong> {model.composePreview.detail}
                <p className="wizard-feedback__hint">Check your API key in Settings, or try again in a moment.</p>
                <div className="mt-xs">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!model.settings || model.composePreviewLoading}
                    aria-busy={model.composePreviewLoading}
                    onClick={() => void model.testComposePreview()}
                  >
                    {model.composePreviewLoading ? 'Retrying\u2026' : 'Retry preview'}
                  </button>
                </div>
              </div>
            )}

            {!noteReady && !followUpMode && (
              <p className="field-hint" id="wizard-review-blocked" role="status">
                Add text to at least one connection note above, or trim empty messages, to continue.
              </p>
            )}
            <div className="wizard-nav">
              <button type="button" className="btn btn-ghost" onClick={goBack} aria-label="Go back to previous step">Back</button>
              <button
                type="button"
                className="btn btn-primary btn-xl"
                disabled={!noteReady}
                onClick={() => setStep('send')}
                aria-describedby={
                  !noteReady && !followUpMode ? 'wizard-review-blocked' : undefined
                }
              >
                Continue to Send
              </button>
            </div>
          </div>
        )}

        {step === 'send' && (
          <div className="wizard-card wizard-card--in-surface">
            <h2 className="s-title">{queueRunning ? 'Sending\u2026' : sendBlockedReason ? 'Almost ready' : 'Ready to send'}</h2>

            {queueRunning && !chromeReady && (
              <div className="wizard-feedback wizard-feedback--error" role="alert">
                <strong>Chrome disconnected.</strong> The outreach run may stall. Reconnect Chrome and the extension to resume.
              </div>
            )}

            {queueRunning && model.queueState && (() => {
              const current = Number(model.queueState.currentIndex)
              const total = Math.max(1, Number(model.queueState.total))
              const pct = Math.round((current / total) * 100)
              const remaining = total - current
              const avgDelaySec = model.settings
                ? (Number(model.settings.delayBetweenRequestsMin) + Number(model.settings.delayBetweenRequestsMax)) / 2
                : 10
              const etaSec = Math.round(remaining * avgDelaySec)
              const etaLabel = etaSec < 60 ? `~${etaSec}s left` : `~${Math.ceil(etaSec / 60)}m left`

              return (
                <div className="wizard-progress">
                  <div className="wizard-progress-header">
                    <span className="wizard-progress-pct">{pct}%</span>
                    <span className="wizard-progress-count">
                      {String(current)} of {String(total)}
                      {remaining > 0 && <span className="wizard-progress-eta"> {'\u2022'} {etaLabel}</span>}
                    </span>
                  </div>
                  <div className="wizard-progress-track">
                    <div className="wizard-progress-fill" style={{ transform: `scaleX(${pct / 100})` }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} />
                  </div>
                  {model.queueState.lastDetail && (
                    <p className="wizard-progress-detail">{explainRunDetail(String(model.queueState.lastDetail))}</p>
                  )}
                </div>
              )
            })()}

            {!queueRunning && (
              <>
                {followUpMode && (
                  <div className="wizard-card__hint-box">
                    <span className="wizard-card__hint-icon" aria-hidden="true">{'\u21BB'}</span>
                    <span>Follow-up: message new connections automatically — no list needed.</span>
                  </div>
                )}
                {hasPlannedSearch ? (
                  <>
                    <p className="wizard-card__body wizard-card__body--tight">Plan ready — import from LinkedIn or paste below.</p>
                    <div className="wizard-actions wizard-actions--main wizard-actions--stack">
                      <button type="button" className="btn btn-primary btn-go" disabled={model.collectingProspects || !chromeReady} aria-busy={model.collectingProspects} onClick={() => void model.collectProspectsFromPlan()}>
                        {model.collectingProspects ? 'Finding people\u2026' : 'Find people from plan'}
                      </button>
                    </div>
                    <details className="send-manual-entry">
                      <summary>Or add contacts manually</summary>
                      <label className="wizard-csv-field" htmlFor="wiz-csv">
                        <textarea
                          id="wiz-csv"
                          className="wizard-csv-textarea"
                          value={model.csvInput}
                          onChange={(e) => model.setCsvInput(e.target.value)}
                          rows={4}
                          spellCheck={false}
                          placeholder={'Paste LinkedIn links or name rows:\nhttps://www.linkedin.com/in/someone/\nJamie Smith, Acme Capital'}
                        />
                      </label>
                    </details>
                  </>
                ) : (
                  <>
                    <label className="wizard-csv-field" htmlFor="wiz-csv">
                      People to contact
                      <textarea
                        id="wiz-csv"
                        className="wizard-csv-textarea"
                        value={model.csvInput}
                        onChange={(e) => model.setCsvInput(e.target.value)}
                        rows={6}
                        spellCheck={false}
                        placeholder={'Paste LinkedIn links or name rows:\nhttps://www.linkedin.com/in/someone/\nJamie Smith, Acme Capital'}
                      />
                    </label>
                  </>
                )}

                {model.csvIssues.length > 0 && (
                  <div className="wizard-feedback wizard-feedback--error wizard-send-validation-error" role="alert">
                    <strong>{model.csvIssues.length === 1 ? 'Issue with your input' : `${model.csvIssues.length} issues found`}</strong>
                    {model.csvIssues.map((issue, i) => <p key={csvIssueKeys[i]}>{issue}</p>)}
                    <p className="wizard-feedback__hint">Each line should be a LinkedIn URL or "Name, Company" pair.</p>
                  </div>
                )}

                {listReady && (
                  <>
                    <TargetListPreview
                      targets={model.targets}
                      selectedTargets={model.selectedTargets}
                      excludedIndices={model.excludedIndices}
                      sendLimit={model.sendLimit}
                      onToggle={model.toggleTarget}
                      onSelectAll={model.selectAllTargets}
                      onDeselectAll={model.deselectAllTargets}
                      onSendLimitChange={model.setSendLimit}
                    />
                    {aiConfigured && (
                      <p className="wizard-target-hint">AI will personalize each message.</p>
                    )}
                  </>
                )}

                {!followUpMode && activeMessageGroups.length > 0 && (
                  <details className="wizard-send-messages">
                    <summary className="wizard-send-messages__header">
                      <h3 className="wizard-section-heading">Message groups ({activeMessageGroups.length})</h3>
                    </summary>

                    {singleSelectedTarget && (
                      <>
                        {model.composePreviewLoading && (
                          <div className="wizard-send-preview-card wizard-send-preview-card--loading" role="status" aria-live="polite">
                            Loading exact preview for {displayTargetName(singleSelectedTarget)}…
                          </div>
                        )}

                        {selectedTargetPreview && (
                          <div className="wizard-send-preview-card" role="status" aria-live="polite">
                            <div className="wizard-send-preview-card__meta">
                              <span className="wizard-send-preview-card__badge">{labelForVariant(selectedTargetPreview.variant)}</span>
                              <span>
                                {selectedTargetPreview.route === 'llm'
                                  ? 'AI chose this message group for the selected person'
                                  : 'This message group will be used for the selected person'}
                              </span>
                            </div>
                            <p className="wizard-send-preview-card__title">
                              Preview for <strong>{displayTargetName(singleSelectedTarget)}</strong>
                            </p>
                            <pre className="wizard-preview-text">{selectedTargetPreview.body}</pre>
                          </div>
                        )}

                        {model.composePreview && !model.composePreview.ok && !model.composePreviewLoading && (
                          <div className="wizard-feedback wizard-feedback--error" role="alert">
                            <strong>Could not preview the selected message.</strong> {model.composePreview.detail}
                            <div className="mt-xs">
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={!model.settings || model.composePreviewLoading}
                                aria-busy={model.composePreviewLoading}
                                onClick={() =>
                                  void model.testComposePreview(
                                    singleSelectedTarget ? { target: singleSelectedTarget } : undefined
                                  )
                                }
                              >
                                Retry preview
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    <div className="wizard-send-group-list">
                      {activeMessageGroups.map((entry) => (
                        <article
                          key={`wizard-msg-${entry.index}`}
                          className={`wizard-send-group ${selectedPreviewGroupIndex === entry.index ? 'wizard-send-group--active' : ''}`}
                        >
                          <div className="wizard-send-group__top">
                            <span className="wizard-send-group__badge">Message group {entry.index + 1}</span>
                            {selectedPreviewGroupIndex === entry.index && (
                              <span className="wizard-send-group__hint">Current preview uses this one</span>
                            )}
                          </div>
                          <p className="wizard-send-group__text">{entry.text}</p>
                        </article>
                      ))}
                    </div>

                  </details>
                )}
              </>
            )}

            {!queueRunning && model.settings && model.selectedTargets.length > 0 && (
              <details className="section--collapsible">
                <summary className="section__toggle">
                  Send settings
                </summary>
                <div className="wizard-send-meta">
                  <span title="Maximum invites per day">Daily limit: {model.settings.dailyCap}</span>
                  <span className="wizard-send-meta__sep">{'\u2022'}</span>
                  <span title={`${model.settings.delayBetweenRequestsMin}\u2013${model.settings.delayBetweenRequestsMax}s between each invite`}>
                    Pace: {Number(model.settings.delayBetweenRequestsMin) <= 5 ? 'Fast' : Number(model.settings.delayBetweenRequestsMin) <= 12 ? 'Normal' : 'Slow'}
                  </span>
                  <span className="wizard-send-meta__sep">{'\u2022'}</span>
                  <span>
                    ~{Math.ceil(model.selectedTargets.length * ((Number(model.settings.delayBetweenRequestsMin) + Number(model.settings.delayBetweenRequestsMax)) / 2) / 60)}m estimated
                  </span>
                </div>
              </details>
            )}

            <div className="wizard-actions wizard-actions--main">
              {!queueRunning && (
                <>
                  <button type="button" className="btn btn-ghost" onClick={goBack} aria-label="Go back to previous step">Back</button>
                  <button
                    type="button"
                    className="btn btn-primary btn-xl btn-go"
                    disabled={sendPrimaryDisabled}
                    aria-busy={queueRunning}
                    onClick={() =>
                      void startOutreachRunWithInviteCheck({
                        messageOverride: messageOverrideEnabled ? messageOverride : undefined
                      })
                    }
                    aria-describedby={sendBlockedReason ? 'wizard-send-blocked' : undefined}
                  >
                    {followUpMode && model.selectedTargets.length === 0
                      ? 'Start follow-ups'
                      : model.selectedTargets.length === 0
                        ? 'Select people to send'
                        : `Send to ${model.selectedTargets.length} ${model.selectedTargets.length === 1 ? 'person' : 'people'}`}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      void startOutreachRunWithInviteCheck({
                        dryRun: true,
                        messageOverride: messageOverrideEnabled ? messageOverride : undefined
                      })
                    }
                    disabled={!!messageOverrideError || queueRunning}
                    aria-busy={queueRunning}
                    title="Preview messages without sending anything to LinkedIn"
                  >
                    {queueRunning ? 'Running\u2026' : 'Test run'}
                  </button>
                </>
              )}
              {queueRunning && (
                <button
                  type="button"
                  className="btn btn-secondary btn-xl"
                  disabled={stoppingQueue}
                  aria-busy={stoppingQueue}
                  onClick={() => {
                    void (async () => {
                      setStoppingQueue(true)
                      setStopQueueError(null)
                      try {
                        await getLoa().queueStop()
                      } catch {
                        setStopQueueError('Couldn\u2019t stop sending. Try again.')
                      } finally {
                        setStoppingQueue(false)
                      }
                    })()
                  }}
                >
                  {stoppingQueue ? 'Stopping\u2026' : 'Stop'}
                </button>
              )}
              {stopQueueError && (
                <p className="wizard-feedback wizard-feedback--error mt-xs" role="alert">{stopQueueError}</p>
              )}
            </div>

            {sendBlockedReason && !queueRunning && (
              <p id="wizard-send-blocked" className="wizard-hint wizard-hint--blocked" role="status" aria-live="polite">
                {sendBlockedReason}
              </p>
            )}

            {model.runStartFeedback && !queueRunning && (
              <div className="wizard-feedback wizard-feedback--error" role="alert">
                <strong>Couldn&apos;t start the run.</strong> {model.runStartFeedback}
                <p className="wizard-feedback__hint">Chrome open + LinkedIn tab + extension on.</p>
                <div className="mt-xs">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={sendPrimaryDisabled || queueRunning}
                    aria-busy={queueRunning}
                    onClick={() =>
                      void startOutreachRunWithInviteCheck({
                        messageOverride: messageOverrideEnabled ? messageOverride : undefined
                      })
                    }
                  >
                    Retry send
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'done' && !doneFromSessionCompletion && (
          <div className="wizard-done-screen">
            <div className="wizard-card wizard-card--center wizard-card--in-surface wizard-card--done-empty">
              <div className="wizard-card__icon" aria-hidden="true">{'\u2609'}</div>
              <h2 className="s-title">No run yet</h2>
              <p className="wizard-card__body wizard-card__body--tight">
                When you finish sending invites or follow-ups, totals and a short log appear here. Use <strong>Send</strong> to start a run.
              </p>
              <div className="wizard-actions wizard-actions--main">
                <button type="button" className="btn btn-primary btn-go" onClick={() => { setStep('send') }}>
                  Go to Send
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => { setStep('goal') }}>
                  Back to goal
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'done' && doneFromSessionCompletion && (
          <div className="wizard-done-screen">
          <div className="wizard-card wizard-card--center wizard-card--done wizard-card--in-surface">
            <div className="wizard-done-celebration" aria-hidden="true">
              <span className="wizard-done-ring" />
              <span className="wizard-done-check">{'\u2713'}</span>
            </div>
            <h2 className="s-title">Run complete</h2>
            <p className="wizard-card__body">
              Totals are for this run. <strong>History</strong> has the full log.
            </p>

            {model.queueState && (() => {
              const sent = model.queueState.sent ?? 0
              const skipped = model.queueState.skipped ?? 0
              const failed = model.queueState.failed ?? 0
              return (
                <div className="wizard-results">
                  <div className="wizard-results-grid wizard-results-grid--compact">
                    <div className="wizard-result-stat">
                      <span className="wizard-result-stat__value wizard-result-stat__value--sent">{sent}</span>
                      <span className="wizard-result-stat__label">Sent</span>
                    </div>
                    <div className="wizard-result-stat">
                      <span className="wizard-result-stat__value wizard-result-stat__value--skipped">{skipped}</span>
                      <span className="wizard-result-stat__label">Skipped</span>
                    </div>
                    <div className="wizard-result-stat">
                      <span className="wizard-result-stat__value wizard-result-stat__value--failed">{failed}</span>
                      <span className="wizard-result-stat__label">Failed</span>
                    </div>
                  </div>
                  {model.queueState.error && <p className="wizard-result-error">{explainRunDetail(String(model.queueState.error))}</p>}
                </div>
              )
            })()}

            {model.activeCampaign && model.activeCampaign.remainingCount > 0 && (
              <details className="section--collapsible" open>
                <summary className="section__toggle">
                  Campaign progress
                </summary>
                <div className="wizard-campaign-done-summary">
                  <p>Campaign progress: <strong>{model.activeCampaign.sentCount}</strong> of <strong>{model.activeCampaign.totalTargets}</strong> sent ({model.activeCampaign.remainingCount} remaining)</p>
                </div>
              </details>
            )}

            {model.logs.length > 5 && (() => {
              const metrics = computeCampaignMetrics(model.logs as Array<{ status?: string; variant?: string; logChannel?: string; profileUrl?: string; executionId?: string }>)
              if (metrics.totalSent === 0) return null
              return (
                <details className="wizard-analytics mt-xs">
                  <summary>Campaign analytics</summary>
                  <div className="wizard-analytics__grid">
                    <div className="wizard-result-stat">
                      <span className="wizard-result-stat__value">{metrics.acceptanceRate}%</span>
                      <span className="wizard-result-stat__label">Acceptance</span>
                    </div>
                    <div className="wizard-result-stat">
                      <span className="wizard-result-stat__value">{metrics.responseRate}%</span>
                      <span className="wizard-result-stat__label">Response</span>
                    </div>
                    <div className="wizard-result-stat">
                      <span className="wizard-result-stat__value">{metrics.dmsSent}</span>
                      <span className="wizard-result-stat__label">Messages sent</span>
                    </div>
                  </div>
                  {metrics.byTemplate.length > 1 && (() => {
                    const sorted = [...metrics.byTemplate].sort((a, b) => b.rate - a.rate)
                    const best = sorted[0]
                    const runner = sorted[1]
                    let significance = ''
                    if (best && runner && best.sent >= 5 && runner.sent >= 5) {
                      const p1 = best.accepted / best.sent
                      const p2 = runner.accepted / runner.sent
                      const pPool = (best.accepted + runner.accepted) / (best.sent + runner.sent)
                      const se = Math.sqrt(pPool * (1 - pPool) * (1 / best.sent + 1 / runner.sent))
                      const z = se > 0 ? Math.abs(p1 - p2) / se : 0
                      if (z > 1.96) significance = 'Clear winner — difference is reliable'
                      else if (best.sent + runner.sent < 30) significance = 'Not enough data yet — need ~30 sends total'
                      else significance = 'Too close to call — keep testing'
                    }
                    return (
                      <div className="wizard-analytics__templates mt-xs">
                        <strong>Template A/B performance</strong>
                        {sorted.map((t, i) => (
                          <div key={t.variant} className="wizard-analytics__row">
                            <span className="wizard-analytics__variant">
                              {t.variant}{i === 0 && sorted.length > 1 ? ' (best)' : ''}
                            </span>
                            <span>{t.sent} sent, {t.accepted} accepted ({t.rate}%)</span>
                          </div>
                        ))}
                        {significance && (
                          <div className="muted wizard-analytics__significance">{significance}</div>
                        )}
                      </div>
                    )
                  })()}
                </details>
              )
            })()}

            {model.logs.length > 0 && (
              <details className="wizard-run-log">
                <summary>Recent events this session ({model.logs.length} {model.logs.length === 1 ? 'entry' : 'entries'})</summary>
                <div className="wizard-run-log__entries" role="list">
                  {model.logs.slice(-30).map((line, i) => {
                    const obj = (typeof line === 'object' && line !== null ? line : {}) as Record<string, unknown>
                    const status = String(obj.status || '').toLowerCase()
                    const isOk = ['sent', 'success', 'ok', 'connected', 'delivered', 'sent_without_note', 'dry_run_sent'].includes(status)
                    const isErr = ['error', 'failed', 'failure', 'rate_limited'].includes(status)
                    const icon = isOk ? '\u2713' : isErr ? '\u2717' : '\u2192'
                    const cls = isOk ? 'ok' : isErr ? 'err' : 'skip'
                    const profile = String(obj.profileUrl || obj.profile_url || '').replace(/https?:\/\/(www\.)?linkedin\.com\/in\//g, '').replace(/\/$/, '')
                    const detail = explainRunDetail(String(obj.detail || obj.message || status || ''))
                    return (
                      <div key={`${String(obj.timestamp || i)}-${profile}-${status}`} className={`wizard-run-log__entry wizard-run-log__entry--${cls}`} role="listitem">
                        <span className="wizard-run-log__icon">{icon}</span>
                        <span className="wizard-run-log__profile">{profile || 'Unknown'}</span>
                        <span className="wizard-run-log__detail">{detail}</span>
                      </div>
                    )
                  })}
                </div>
              </details>
            )}

            <div className="wizard-actions wizard-actions--main">
              {model.activeCampaign && model.activeCampaign.remainingCount > 0 ? (
                <button type="button" className="btn btn-primary btn-go" onClick={() => {
                  void model.resumeCampaign()
                  setStep('send')
                }}>
                  Continue with {model.activeCampaign.remainingCount} remaining
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-go" onClick={() => { setStep('goal'); }}>Start a new campaign</button>
              )}
            </div>
            <div className="wizard-actions">
              {model.activeCampaign && model.activeCampaign.remainingCount > 0 && (
                <button type="button" className="btn btn-ghost" onClick={() => { setStep('goal'); }}>New campaign instead</button>
              )}
              <button type="button" className="btn btn-ghost" onClick={() => { onViewHistory?.() }}>View History tab</button>
              <button type="button" className="btn btn-ghost" onClick={() => void model.exportLogs()}>Export log</button>
            </div>
          </div>
          </div>
        )}
          </div>
        </div>
    </div>
  )
}

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined)
  const prev = ref.current
  ref.current = value
  return prev
}
