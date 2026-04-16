import { useEffect, useRef, useState } from 'react'
import type { SmartSearchProgress } from '../jobs-smart-search-status'

/** Claude-style search progress with live phase transitions. */
export function JobsSearchProgress({ progress }: { progress: SmartSearchProgress | null }) {
  const phase = progress?.phase ?? 'searching'
  const [tick, setTick] = useState(0)
  const phaseStartRef = useRef<{ phase: string; ts: number }>({ phase, ts: Date.now() })
  useEffect(() => {
    if (phaseStartRef.current.phase !== phase) {
      phaseStartRef.current = { phase, ts: Date.now() }
    }
  }, [phase])
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])
  void tick
  const elapsed = Math.round((Date.now() - phaseStartRef.current.ts) / 1000)

  const phases: Array<{ key: string; label: string; done: boolean; active: boolean }> = [
    { key: 'searching', label: 'Searching LinkedIn', done: ['enriching', 'screening'].includes(phase), active: phase === 'searching' || phase === 'planning' },
    { key: 'enriching', label: 'Reading job descriptions', done: phase === 'screening', active: phase === 'enriching' },
    { key: 'screening', label: 'Scoring matches', done: false, active: phase === 'screening' }
  ]

  const totalFound = progress?.totalJobsFound ?? 0

  let detail = ''
  if ((phase === 'searching' || phase === 'planning') && progress?.currentQuery) {
    detail = `"${progress.currentQuery}"${totalFound ? ` \u00b7 ${totalFound} jobs found` : ''}`
  } else if (phase === 'enriching') {
    const completed = progress?.enrichingCompleted ?? 0
    const total = progress?.enrichingTotal ?? 0
    const parts: string[] = []
    if (total > 0 && completed > 0) {
      parts.push(`${completed} of ${total} descriptions read`)
    } else if (completed > 0) {
      parts.push(`${completed} descriptions read`)
    }
    if (totalFound > 0) parts.push(`${totalFound} jobs found`)
    detail = parts.join(' \u00b7 ') || 'Reading job descriptions\u2026'
  } else if (phase === 'screening') {
    detail = totalFound > 0 ? `Ranking ${totalFound} jobs against your profile` : 'Scoring\u2026'
  }

  return (
    <div className="search-progress" aria-busy="true" aria-live="polite" role="status" aria-label="Job search in progress">
      <div className="search-progress__steps" role="list">
        {phases.map((p) => (
          <div
            key={p.key}
            className={`search-progress__step${p.active ? ' --active' : ''}${p.done ? ' --done' : ''}`}
            role="listitem"
            aria-current={p.active ? 'step' : undefined}
          >
            <span className="search-progress__icon" aria-hidden="true">
              {p.done ? '\u2713' : p.active ? <span className="search-progress__dot" /> : '\u25CB'}
            </span>
            <span className="search-progress__label">
              {p.label}
              {p.active && elapsed > 2 && (
                <span className="search-progress__elapsed" aria-label={`${elapsed} seconds elapsed`}>{elapsed}s</span>
              )}
            </span>
          </div>
        ))}
      </div>
      {detail && <div className="search-progress__detail">{detail}</div>}
      {phase === 'enriching' && (progress?.enrichingTotal ?? 0) > 0 && (() => {
        const pct = Math.min(100, Math.round(((progress?.enrichingCompleted ?? 0) / (progress?.enrichingTotal ?? 1)) * 100))
        return (
          <div
            className="search-progress__bar-track"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Reading descriptions: ${pct}% complete`}
          >
            <div className="search-progress__bar-fill" style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
        )
      })()}
    </div>
  )
}

export function CooldownCountdown({ endsAt }: { endsAt: number }) {
  const [secsLeft, setSecsLeft] = useState(() => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)))
  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      setSecsLeft(left)
      if (left <= 0) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [endsAt])
  if (secsLeft <= 0) return null
  return <span className="jobs-queue-panel__countdown">Next job in {secsLeft}s</span>
}
