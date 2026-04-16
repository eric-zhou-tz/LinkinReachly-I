import { useCallback, useEffect, useMemo, useState } from 'react'
import { getLoa } from '@/loa-client'

export interface HiringManagerOutreachCardProps {
  /** When false (wizard not on goal step), stop fetching and hide. */
  active: boolean
  chromeReady: boolean
}

function humanizeHmChainSummary(_detail: string, results?: Array<{ applicationRecordId: string; status: string }>): string {
  if (Array.isArray(results)) {
    return results.length > 0 ? 'Finished. See each job below.' : 'Finished.'
  }
  return 'Couldn\u2019t complete outreach. Try again.'
}

function friendlyHmResultStatus(status: string): string {
  const key = status.trim().toLowerCase().replace(/\s+/g, '_')
  const map: Record<string, string> = {
    sent: 'Sent',
    success: 'Sent',
    ok: 'Done',
    done: 'Done',
    skipped: 'Skipped',
    skip: 'Skipped',
    duplicate: 'Skipped',
    error: 'Failed',
    failed: 'Failed',
    rate_limited: 'Paused',
    pending: 'Pending',
    dry_run: 'Preview only'
  }
  if (map[key]) return map[key]
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatProgress(p: {
  phase: string
  current: number
  total: number
  company: string
}): string {
  if (p.phase === 'done') {
    return p.total > 0 ? `Done (${p.total} job${p.total === 1 ? '' : 's'}).` : 'Done.'
  }
  const phaseLabel =
    p.phase === 'checking job posting' ? 'Checking job posting for recruiter'
    : p.phase === 'searching' ? 'Searching for hiring manager'
    : p.phase === 'connecting' ? 'Sending connection request'
    : p.phase
  const idx = p.total > 0 ? ` — ${p.current} of ${p.total}` : ''
  const who = p.company ? ` (${p.company})` : ''
  return `${phaseLabel}${idx}${who}`
}

export function HiringManagerOutreachCard({ active, chromeReady }: HiringManagerOutreachCardProps) {
  const [candidates, setCandidates] = useState<
    Array<{
      applicationRecordId: string
      jobTitle: string
      company: string
      jobUrl: string
      hiringTeamSearchHint?: string
      createdAt?: string
    }>
  >([])
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [running, setRunning] = useState(false)
  const [progressLine, setProgressLine] = useState('')
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ detail: string; results?: Array<{ applicationRecordId: string; status: string; targetName?: string }> } | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!active) {
      setDismissed(false)
    }
  }, [active])

  const [loadError, setLoadError] = useState<string | null>(null)

  const refreshCandidates = useCallback(async () => {
    try {
      const res = await getLoa().outreachCandidates()
      if (!res.ok) { setLoadError('Couldn\u2019t load hiring-contact suggestions.'); return }
      setLoadError(null)
      setCandidates(res.candidates)
      setSelected(new Set(res.candidates.map((c) => c.applicationRecordId)))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Couldn\u2019t load hiring-contact suggestions.')
    }
  }, [])

  useEffect(() => {
    if (!active || !chromeReady) {
      setLoadState('idle')
      return
    }
    let cancelled = false
    setLoadState('loading')
    void refreshCandidates().finally(() => {
      if (!cancelled) setLoadState('ready')
    })
    return () => {
      cancelled = true
    }
  }, [active, chromeReady, refreshCandidates])

  useEffect(() => {
    if (!running) return
    const off = getLoa().onOutreachChainProgress((p) => {
      setProgressLine(formatProgress(p))
      setActiveRecordId(p.applicationRecordId?.trim() ? p.applicationRecordId : null)
    })
    return off
  }, [running])

  const selectedCount = selected.size
  const allSelected = candidates.length > 0 && selectedCount === candidates.length

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(candidates.map((c) => c.applicationRecordId)))
    }
  }, [allSelected, candidates])

  const runChain = useCallback(async () => {
    const ids = candidates.filter((c) => selected.has(c.applicationRecordId)).map((c) => c.applicationRecordId)
    if (ids.length === 0) return
    setRunning(true)
    setSummary(null)
    setProgressLine('Starting…')
    setActiveRecordId(null)
    try {
      const res = await getLoa().outreachRunChain({
        candidateIds: ids,
        maxTargets: ids.length
      })
      setSummary({ detail: res.detail, results: res.results })
      await refreshCandidates()
    } catch (err) {
      setSummary({
        detail: err instanceof Error ? err.message : String(err),
        results: undefined
      })
      await refreshCandidates()
    } finally {
      setRunning(false)
      setProgressLine('')
      setActiveRecordId(null)
    }
  }, [candidates, refreshCandidates, selected])

  const sorted = useMemo(() => {
    return [...candidates].sort((a, b) => {
      const ta = a.createdAt || ''
      const tb = b.createdAt || ''
      return tb.localeCompare(ta)
    })
  }, [candidates])

  if (!active || !chromeReady) return null
  if (dismissed) return null
  if (loadState === 'loading') return (
    <div className="wizard-feedback mt-xs" role="status" aria-live="polite">
      <span className="s-spinner" aria-hidden="true" /> Checking for outreach candidates…
    </div>
  )
  if (loadError) return (
    <div className="wizard-feedback wizard-feedback--error mt-xs" role="alert">
      {loadError}
      <button type="button" className="btn btn-ghost btn-sm ml-sm" onClick={() => void refreshCandidates()}>Retry</button>
    </div>
  )
  if (loadState !== 'ready' || candidates.length === 0) return null

  return (
    <section className="wizard-hm-outreach" aria-labelledby="wizard-hm-outreach-title">
      <div className="wizard-hm-outreach__header">
        <h3 id="wizard-hm-outreach-title">Reach out to hiring managers</h3>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setDismissed(true)}>
          Hide
        </button>
      </div>
      <p className="wizard-hm-outreach__lede muted caption">
        {candidates.length} applied job{candidates.length === 1 ? '' : 's'} still need outreach. Select which ones to
        run; each one searches LinkedIn for a contact, then sends a connection request.
      </p>

      <div className="wizard-hm-outreach__toolbar">
        <button type="button" className="link-button caption" onClick={toggleAll} disabled={running}>
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
        <span className="wizard-hm-outreach__count muted caption">{selectedCount} selected</span>
      </div>

      <ul className="wizard-hm-outreach__list" role="list">
        {sorted.map((c) => {
          const checked = selected.has(c.applicationRecordId)
          const rowActive = activeRecordId === c.applicationRecordId
          const dateLabel = c.createdAt
            ? new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            : null
          return (
            <li
              key={c.applicationRecordId}
              className={'wizard-hm-outreach__row' + (rowActive ? ' wizard-hm-outreach__row--active' : '')}
            >
              <label className="wizard-hm-outreach__label">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={running}
                  onChange={() => toggleOne(c.applicationRecordId)}
                />
                <span className="wizard-hm-outreach__row-body">
                  <span className="wizard-hm-outreach__title">{c.jobTitle}</span>
                  <span className="wizard-hm-outreach__meta muted caption">
                    {c.company}
                    {dateLabel ? ` · ${dateLabel}` : ''}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      <div className="wizard-hm-outreach__actions">
        <button
          type="button"
          className="btn btn-primary btn-go"
          disabled={running || selectedCount === 0}
          aria-busy={running}
          onClick={() => void runChain()}
        >
          {running ? 'Working\u2026' : `Connect with hiring managers (${selectedCount})`}
        </button>
      </div>

      {running && progressLine && (
        <p className="wizard-hm-outreach__progress muted caption" role="status" aria-live="polite">
          {progressLine}
        </p>
      )}

      {summary && !running && (
        <div className="wizard-hm-outreach__summary" role="status">
          <p className="wizard-hm-outreach__summary-detail">{humanizeHmChainSummary(summary.detail, summary.results)}</p>
          {summary.results && summary.results.length > 0 && (
            <ul className="wizard-hm-outreach__results muted caption">
              {summary.results.map((r) => (
                <li key={r.applicationRecordId}>
                  <strong>{friendlyHmResultStatus(r.status)}</strong>
                  {r.targetName ? ` — ${r.targetName}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
