/**
 * Custom hook encapsulating all apply-queue state, subscriptions, and callbacks.
 * Extracted from JobsPanel to reduce cognitive load.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApplyQueueState, ApplyQueueItem, ApplyQueueView } from '@core/application-types'
import { getLoa } from '@/loa-client'
import { queueItemNeedsCompletion } from './jobs-helpers'

export type QueueStats = {
  done: number
  pending: number
  resumeErr: number
  error: number
  skipped: number
  actionableTotal: number
  /** 0–100 for progressbar when actionableTotal > 0 */
  progress: number
  active: boolean
  activeCount: number
  hasPending: boolean
  hasError: boolean
  hasResumeErr: boolean
}

export function useApplyQueue(showFeedback: (msg: string, durationMs?: number) => void, historyAppliedUrls?: Set<string>) {
  const [applyQueue, setApplyQueue] = useState<ApplyQueueState | null>(null)
  const applyQueueRef = useRef<ApplyQueueState | null>(applyQueue)
  useEffect(() => { applyQueueRef.current = applyQueue }, [applyQueue])

  const [queuedJobUrls, setQueuedJobUrls] = useState<Set<string>>(new Set())
  const [outreachSentUrls, setOutreachSentUrls] = useState<Set<string>>(new Set())
  const [startingQueue, setStartingQueue] = useState(false)
  const [retryingItemUrls, setRetryingItemUrls] = useState<Set<string>>(new Set())
  const [clearingQueue, setClearingQueue] = useState(false)
  const [retryingBulk, setRetryingBulk] = useState(false)
  const [queuePausing, setQueuePausing] = useState(false)

  // Chain (hiring manager outreach after apply)
  const [chainRunning, setChainRunning] = useState(false)
  const [chainStatus, setChainStatus] = useState('')
  const [chainProgress, setChainProgress] = useState('')
  const [chainDismissed, setChainDismissed] = useState(false)
  const [chainSkipping, setChainSkipping] = useState(false)

  // Aria alert for screen readers on queue errors
  const [queueAriaAlert, setQueueAriaAlert] = useState('')
  const queueErrorBaselineRef = useRef(0)

  const appliedJobUrls = useMemo(() => {
    const urls = new Set<string>(historyAppliedUrls)
    if (applyQueue) {
      for (const i of applyQueue.items) {
        if (i.status === 'done' && i.linkedinJobUrl) urls.add(i.linkedinJobUrl)
      }
    }
    return urls
  }, [applyQueue, historyAppliedUrls])

  const applyQueueOpenItems = useMemo(
    () => (applyQueue ? applyQueue.items.filter((i) => i.status !== 'done' && i.status !== 'skipped') : []),
    [applyQueue]
  )

  const queueStats = useMemo<QueueStats>(() => {
    if (!applyQueue) {
      return { done: 0, pending: 0, resumeErr: 0, error: 0, skipped: 0, actionableTotal: 0, progress: 0, active: false, activeCount: 0, hasPending: false, hasError: false, hasResumeErr: false }
    }
    let done = 0, pending = 0, resumeErr = 0, error = 0, skipped = 0, activeCount = 0
    for (const item of applyQueue.items) {
      if (item.status === 'done') done++
      else if (item.status === 'pending') pending++
      else if (item.status === 'skipped') skipped++
      else if (item.status === 'error') {
        error++
        if (queueItemNeedsCompletion(item)) resumeErr++
      } else if (item.status === 'active') activeCount++
    }
    const actionableTotal = applyQueue.items.length - skipped
    const progress = actionableTotal > 0 ? Math.round((done / actionableTotal) * 100) : 0
    return { done, pending, resumeErr, error, skipped, actionableTotal, progress, active: activeCount > 0, activeCount, hasPending: pending > 0, hasError: error > 0, hasResumeErr: resumeErr > 0 }
  }, [applyQueue])

  // ── Subscriptions ──

  const pausingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const syncQueueUrls = useCallback((state: ApplyQueueState) => {
    setApplyQueue(state)
    if (!state.running) {
      setQueuePausing(false)
      if (pausingTimeoutRef.current) { clearTimeout(pausingTimeoutRef.current); pausingTimeoutRef.current = null }
    }
    setQueuedJobUrls(new Set((state.items || []).map((i: ApplyQueueItem) => i.applyUrl || i.linkedinJobUrl)))
  }, [])

  useEffect(() => {
    const loa = getLoa()
    void loa.applicationQueueState?.()
      .then((v: ApplyQueueView) => {
        if (v?.ok && v.state) syncQueueUrls(v.state)
      })
      .catch((err) => { console.warn('[useApplyQueue] Initial queue state fetch failed:', err) })
    void loa.applicationHistory?.()
      .then((res) => {
        if (res?.ok && Array.isArray(res.records)) {
          const processed = new Set<string>()
          for (const r of res.records as Array<{ jobUrl?: string; outreachStatus?: string }>) {
            if (r.jobUrl && r.outreachStatus && r.outreachStatus !== 'none' && r.outreachStatus !== 'pending') {
              processed.add(r.jobUrl)
            }
          }
          if (processed.size > 0) setOutreachSentUrls(processed)
        }
      })
      .catch(() => {})
    let unsub: () => void
    if (typeof loa.onApplyQueueTick === 'function') {
      unsub = loa.onApplyQueueTick((s: ApplyQueueState) => syncQueueUrls(s))
    } else {
      console.warn('[useApplyQueue] onApplyQueueTick not available — relying on backup poll')
      unsub = () => {}
    }
    return unsub
  }, [syncQueueUrls])

  // Backup poll while runner is active
  useEffect(() => {
    if (!applyQueue?.running) return
    const tick = () => {
      void getLoa().applicationQueueState?.()
        .then((v: ApplyQueueView) => { if (v?.ok && v.state) syncQueueUrls(v.state) })
        .catch(() => { /* poll failed; next interval retries */ })
    }
    tick()
    const id = window.setInterval(tick, 2500)
    return () => window.clearInterval(id)
  }, [applyQueue?.running, syncQueueUrls])

  // Chain progress subscription
  useEffect(() => {
    if (!chainRunning) return
    const off = getLoa().onOutreachChainProgress((p: { phase: string; current: number; total: number; company: string }) => {
      if (p.phase === 'done') {
        setChainProgress(p.total > 0 ? `Done (${p.total} job${p.total === 1 ? '' : 's'}).` : 'Done.')
        return
      }
      const label =
        p.phase === 'checking job posting' ? 'Checking job posting for recruiter'
        : p.phase === 'searching' ? 'Searching for hiring manager'
        : p.phase === 'connecting' ? 'Sending connection request'
        : p.phase
      const idx = p.total > 0 ? ` \u2014 ${p.current} of ${p.total}` : ''
      const who = p.company ? ` (${p.company})` : ''
      setChainProgress(`${label}${idx}${who}`)
    })
    return off
  }, [chainRunning])

  // Aria alert when errors increase during a run
  useEffect(() => {
    if (!applyQueue?.running) {
      queueErrorBaselineRef.current = queueStats.error
      return
    }
    const baseline = queueErrorBaselineRef.current
    if (queueStats.error > baseline) {
      const delta = queueStats.error - baseline
      setQueueAriaAlert(
        `${delta} application${delta === 1 ? '' : 's'} in the queue need${delta === 1 ? 's' : ''} attention. ${queueStats.error} total.`
      )
    }
    queueErrorBaselineRef.current = queueStats.error
  }, [applyQueue?.running, queueStats.error])

  useEffect(() => {
    if (!queueAriaAlert) return
    const id = window.setTimeout(() => setQueueAriaAlert(''), 1500)
    return () => window.clearTimeout(id)
  }, [queueAriaAlert])

  // ── Callbacks ──

  const startQueue = useCallback(async () => {
    // New queue runs should surface outreach options again after fresh applications.
    setChainDismissed(false)
    setChainStatus('')
    setChainProgress('')
    setStartingQueue(true)
    try {
      const r = await getLoa().applicationQueueStart()
      if (r.ok) { setApplyQueue(r.state); return }
      if (r.state) setApplyQueue(r.state)
      if (r.detail) showFeedback(r.detail)
    } catch (e) {
      showFeedback(e instanceof Error ? e.message : 'Couldn\u2019t start the queue.')
    } finally { setStartingQueue(false) }
  }, [showFeedback])

  // IMPORTANT: Stop is IMMEDIATE — the backend aborts at the next checkpoint,
  // not after the current job finishes. The button label MUST say "Stopping…"
  // (never "Stopping after this job"). This has regressed before.
  const stopQueue = useCallback(async () => {
    setQueuePausing(true)
    if (pausingTimeoutRef.current) clearTimeout(pausingTimeoutRef.current)
    pausingTimeoutRef.current = setTimeout(() => setQueuePausing(false), 15_000)
    try {
      const r = await getLoa().applicationQueueStop()
      if (r.ok) {
        setApplyQueue(r.state)
        if (!r.state.running) {
          setQueuePausing(false)
          if (pausingTimeoutRef.current) clearTimeout(pausingTimeoutRef.current)
        }
      } else {
        showFeedback(r.detail || 'Couldn\u2019t pause the queue.')
        setQueuePausing(false)
        if (pausingTimeoutRef.current) clearTimeout(pausingTimeoutRef.current)
      }
    } catch (e) {
      showFeedback(e instanceof Error ? e.message : 'Couldn\u2019t pause the queue.')
      setQueuePausing(false)
      if (pausingTimeoutRef.current) clearTimeout(pausingTimeoutRef.current)
    }
  }, [showFeedback])

  const clearQueue = useCallback(async () => {
    if (applyQueue?.running) return
    setClearingQueue(true)
    try {
      const r = await getLoa().applicationQueueClear()
      if (r.ok) { setApplyQueue(r.state); setQueuedJobUrls(new Set()) }
      else showFeedback(r.detail || 'Couldn\u2019t clear the queue.')
    } catch (e) {
      showFeedback(e instanceof Error ? e.message : 'Couldn\u2019t clear the queue.')
    } finally { setClearingQueue(false) }
  }, [applyQueue, showFeedback])

  const retryFailed = useCallback(async () => {
    if (applyQueue?.running) return
    setRetryingBulk(true)
    try {
      const r = await getLoa().applicationQueueRetry()
      if (r.ok) setApplyQueue(r.state)
      else showFeedback(r.detail || 'Couldn\u2019t retry those items.')
    } catch (e) {
      showFeedback(e instanceof Error ? e.message : 'Couldn\u2019t retry those items.')
    } finally { setRetryingBulk(false) }
  }, [applyQueue, showFeedback])

  const removeQueueItem = useCallback(async (id: string) => {
    if (applyQueue?.running) return
    try {
      const r = await getLoa().applicationQueueRemove({ id })
      if (r.ok) syncQueueUrls(r.state)
      else showFeedback(r.detail || 'Couldn\u2019t remove that job.')
    } catch (e) {
      showFeedback(e instanceof Error ? e.message : 'Couldn\u2019t remove that job.')
    }
  }, [applyQueue, syncQueueUrls, showFeedback])

  const retryQueueItem = useCallback(async (id: string) => {
    if (applyQueue?.running) return
    setRetryingItemUrls((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    try {
      const r = await getLoa().applicationQueueRetry({ id })
      if (r.ok) setApplyQueue(r.state)
      else showFeedback(r.detail || 'Couldn\u2019t retry that job.')
    } catch (e) {
      showFeedback(e instanceof Error ? e.message : 'Couldn\u2019t retry that job.')
    } finally {
      setRetryingItemUrls((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [applyQueue, showFeedback])

  const markQueueItemDone = useCallback(async (id: string) => {
    if (applyQueue?.running) return
    try {
      const r = await getLoa().applicationQueueSkip({ id })
      if (r.ok) {
        syncQueueUrls(r.state)
        showFeedback('Marked as completed.')
      } else {
        showFeedback(r.detail || 'Couldn\u2019t update that job.')
      }
    } catch (e) {
      showFeedback(e instanceof Error ? e.message : 'Couldn\u2019t update that job.')
    }
  }, [applyQueue, syncQueueUrls, showFeedback])

  return {
    applyQueue,
    queuedJobUrls,
    appliedJobUrls,
    outreachSentUrls,
    setOutreachSentUrls,
    applyQueueOpenItems,
    queueStats,
    queueAriaAlert,
    // Busy flags
    startingQueue,
    retryingItemUrls,
    clearingQueue,
    retryingBulk,
    queuePausing,
    // Chain state
    chainRunning, setChainRunning,
    chainStatus, setChainStatus,
    chainProgress, setChainProgress,
    chainDismissed, setChainDismissed,
    chainSkipping, setChainSkipping,
    // Actions
    syncQueueUrls,
    startQueue,
    stopQueue,
    clearQueue,
    retryFailed,
    removeQueueItem,
    retryQueueItem,
    markQueueItemDone,
    setApplyQueue
  }
}
