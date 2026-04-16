import { useEffect, useState } from 'react'

export type SmartSearchProgress = {
  phase: 'planning' | 'searching' | 'enriching' | 'screening' | 'done'
  message: string
  backgroundSource?: 'settings' | 'linkedin_profile' | 'none'
  startedAt?: number
  updatedAt?: number
  queriesPlanned?: string[]
  queriesCompleted?: number
  currentQuery?: string
  currentQueryIndex?: number
  totalQueries?: number
  currentQueryResultCount?: number
  totalJobsFound?: number
  enrichingCompleted?: number
  enrichingTotal?: number
  screeningCount?: number
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`
}

function formatQueryPreview(queries?: string[]): string | null {
  if (!queries?.length) return null
  const visible = queries.slice(0, 4)
  const suffix = queries.length > visible.length ? ` • +${queries.length - visible.length} more` : ''
  return `${visible.join(' • ')}${suffix}`
}

function phaseLabel(phase: SmartSearchProgress['phase']): string {
  if (phase === 'planning') return 'Planning'
  if (phase === 'searching') return 'Searching LinkedIn'
  if (phase === 'enriching') return 'Reading job details'
  if (phase === 'screening') return 'AI screening'
  return 'Complete'
}

export function JobsSmartSearchStatusCard({
  smartSearching,
  smartProgress,
  onCancel,
  cancelPending = false
}: {
  smartSearching: boolean
  smartProgress: SmartSearchProgress | null
  onCancel?: () => void
  cancelPending?: boolean
}) {
  const [progressNow, setProgressNow] = useState(() => Date.now())

  useEffect(() => {
    if (!smartSearching || !smartProgress?.startedAt) return
    setProgressNow(Date.now())
    const id = window.setInterval(() => setProgressNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [smartSearching, smartProgress?.startedAt])

  const liveProgress = smartSearching ? smartProgress : null
  const liveElapsed = liveProgress?.startedAt ? Math.max(0, progressNow - liveProgress.startedAt) : null
  const liveUpdateAge = liveProgress?.updatedAt ? Math.max(0, progressNow - liveProgress.updatedAt) : null
  const liveUpdateStale = (liveUpdateAge ?? 0) >= 12_000
  const plannedQueryPreview = formatQueryPreview(liveProgress?.queriesPlanned)
  const completedQueryCount = liveProgress?.queriesCompleted ?? 0
  const totalQueryCount = liveProgress?.totalQueries ?? liveProgress?.queriesPlanned?.length ?? 0
  const doneQueryCount = smartProgress?.queriesCompleted ?? smartProgress?.queriesPlanned?.length ?? 0
  const doneTotalQueries = smartProgress?.totalQueries ?? smartProgress?.queriesPlanned?.length ?? 0
  const drawerPlannedQueries =
    liveProgress?.queriesPlanned
    ?? (smartProgress?.phase === 'done' ? smartProgress.queriesPlanned : undefined)

  return (
    <>
      <h3 className="jobs-panel__drawer-title">Smart search</h3>
      <details className="jobs-smart-search-help">
        <summary className="jobs-smart-search-help__summary">Smart search steps</summary>
        <ul className="jobs-smart-search-help__list">
          <li>
            <strong>Planning</strong> — builds queries from your inputs.
          </li>
          <li>
            <strong>Searching</strong> — runs LinkedIn, collects posts.
          </li>
          <li>
            <strong>Reading details</strong> — opens listings when needed.
          </li>
          <li>
            <strong>AI screening</strong> — scores fit for sorting.
          </li>
          <li>
            <strong>Complete</strong> — results in the main list.
          </li>
        </ul>
      </details>

      {liveProgress && (
        <div className="wizard-feedback wizard-feedback--ok smart-search-progress" role="status" aria-live="polite">
          <div className="smart-search-progress__header">
            <div className="smart-search-progress__spinner" aria-hidden="true" />
            <div className="smart-search-progress__body">
              <strong>{liveProgress.message?.trim() ? liveProgress.message : 'Still working\u2026'}</strong>
              <div className="smart-search-progress__chips">
                <span className="smart-search-progress__chip">{phaseLabel(liveProgress.phase)}</span>
                {totalQueryCount > 0 && (
                  <span className="smart-search-progress__chip">
                    {completedQueryCount}/{totalQueryCount} searches
                  </span>
                )}
                {typeof liveProgress.totalJobsFound === 'number' && (
                  <span className="smart-search-progress__chip">{liveProgress.totalJobsFound} jobs found</span>
                )}
                {typeof liveProgress.enrichingTotal === 'number' && liveProgress.enrichingTotal > 0 && (
                  <span className="smart-search-progress__chip">
                    {liveProgress.enrichingCompleted ?? 0}/{liveProgress.enrichingTotal} descriptions
                  </span>
                )}
                {typeof liveProgress.screeningCount === 'number' && liveProgress.phase === 'screening' && (
                  <span className="smart-search-progress__chip">{liveProgress.screeningCount} to score</span>
                )}
                {liveElapsed !== null && (
                  <span className="smart-search-progress__chip">{formatDuration(liveElapsed)} elapsed</span>
                )}
              </div>
              {liveProgress.currentQuery && (
                <p className="smart-search-progress__detail">
                  Searching: <span>{liveProgress.currentQuery}</span>
                  {typeof liveProgress.currentQueryIndex === 'number' && totalQueryCount > 0
                    ? ` (${liveProgress.currentQueryIndex}/${totalQueryCount})`
                    : ''}
                </p>
              )}
              {typeof liveProgress.currentQueryResultCount === 'number' && liveProgress.phase === 'searching' && (
                <p className="muted caption mt-xs">
                  Latest search added {liveProgress.currentQueryResultCount} new
                  {liveProgress.currentQueryResultCount === 1 ? ' job.' : ' jobs.'}
                </p>
              )}
              {plannedQueryPreview && (
                <p className="muted caption mt-xs">Planned searches: {plannedQueryPreview}</p>
              )}
              {liveUpdateAge !== null && (
                <p className={`caption mt-xs ${liveUpdateStale ? 'smart-search-progress__stale' : 'muted'}`}>
                  {liveUpdateStale
                    ? `Still working. Last update ${formatDuration(liveUpdateAge)} ago.`
                    : `Last update ${formatDuration(liveUpdateAge)} ago.`}
                </p>
              )}
              {smartSearching && onCancel && (
                <div className="wizard-actions mt-xs">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={onCancel}
                    disabled={cancelPending}
                  >
                    {cancelPending ? 'Canceling\u2026' : 'Cancel smart search'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!liveProgress && smartProgress?.phase === 'done' && (
        <div className="wizard-feedback wizard-feedback--ok" role="status">
          <strong>{smartProgress.message}</strong>
          {(doneTotalQueries > 0 ||
            typeof smartProgress.totalJobsFound === 'number' ||
            typeof smartProgress.enrichingCompleted === 'number') && (
            <p className="muted caption mt-xs">
              {doneTotalQueries > 0 ? `Completed ${doneQueryCount}/${doneTotalQueries} searches.` : ''}
              {doneTotalQueries > 0 && typeof smartProgress.totalJobsFound === 'number' ? ' ' : ''}
              {typeof smartProgress.totalJobsFound === 'number'
                ? `Found ${smartProgress.totalJobsFound} jobs.`
                : ''}
              {typeof smartProgress.enrichingCompleted === 'number' && smartProgress.enrichingCompleted > 0
                ? ` Read ${smartProgress.enrichingCompleted} full descriptions.`
                : ''}
            </p>
          )}
          {smartProgress.backgroundSource === 'linkedin_profile' && (
            <p className="muted caption mt-xs">Tailored from your profile.</p>
          )}
        </div>
      )}

      {drawerPlannedQueries && drawerPlannedQueries.length > 0 && !liveProgress && (
        <div className="jobs-panel__drawer-planned">
          <h4>Planned searches</h4>
          <ul>
            {drawerPlannedQueries.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
