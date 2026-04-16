import { useEffect, useMemo, useState } from 'react'
import type { ApplicationRecord } from '@core/application-types'
import { getLoa } from '@/loa-client'

const AVG_MANUAL_APPLY_MINUTES = 11

function isThisWeek(dateStr: string): boolean {
  const d = new Date(dateStr)
  const now = new Date()
  const weekAgo = new Date(now)
  weekAgo.setDate(weekAgo.getDate() - 7)
  return d >= weekAgo && d <= now
}

export function DashboardPanel() {
  const [records, setRecords] = useState<ApplicationRecord[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const loa = getLoa()
        const history = await loa.applicationHistory()
        if (!cancelled && history.ok) setRecords(history.records || [])
      } catch { /* ignore */ }
    }
    void load()
    const id = setInterval(load, 10_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const stats = useMemo(() => {
    const submitted = records.filter((r) => r.outcome === 'submitted' || r.outcome === 'autofilled')
    const weekSubmitted = submitted.filter((r) => r.createdAt && isThisWeek(r.createdAt))
    const totalApps = submitted.length
    const weekApps = weekSubmitted.length
    const totalMinutes = totalApps * AVG_MANUAL_APPLY_MINUTES
    const weekMinutes = weekApps * AVG_MANUAL_APPLY_MINUTES
    const weekTotal = records.filter((r) => r.createdAt && isThisWeek(r.createdAt)).length
    const weekCompletion = weekTotal > 0 ? Math.round((weekApps / weekTotal) * 100) : 0
    const outreachSent = records.filter((r) => r.outreachStatus === 'sent').length
    return { totalApps, weekApps, totalMinutes, weekMinutes, weekCompletion, weekTotal, outreachSent }
  }, [records])

  const fmtTime = (mins: number): string => {
    if (mins < 60) return `${mins} min`
    const h = (mins / 60).toFixed(1)
    return `${h} hrs`
  }

  return (
    <div className="panel-content" style={{ padding: '20px 24px' }}>
      <h2 className="sr-only">Efficiency Dashboard</h2>
      <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--neutral-500)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' }}>This Week</p>
      <div className="dashboard-grid">
        <div className="dash-card">
          <div className="dash-card__value dash-card__value--brand">{stats.weekApps}</div>
          <div className="dash-card__label">Applications Sent</div>
        </div>
        <div className="dash-card">
          <div className="dash-card__value dash-card__value--green">{fmtTime(stats.weekMinutes)}</div>
          <div className="dash-card__label">Time Saved</div>
          <div className="dash-card__sub">~{AVG_MANUAL_APPLY_MINUTES} min per application</div>
        </div>
        <div className="dash-card">
          <div className="dash-card__value">{stats.weekCompletion}%</div>
          <div className="dash-card__label">Queue Completion</div>
          <div className="dash-card__sub">{stats.weekApps} of {stats.weekTotal} submitted</div>
        </div>
      </div>

      <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--neutral-500)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' }}>All Time</p>
      <div className="dashboard-grid">
        <div className="dash-card">
          <div className="dash-card__value">{stats.totalApps}</div>
          <div className="dash-card__label">Total Applications</div>
        </div>
        <div className="dash-card">
          <div className="dash-card__value dash-card__value--green">{fmtTime(stats.totalMinutes)}</div>
          <div className="dash-card__label">Total Time Saved</div>
        </div>
        <div className="dash-card">
          <div className="dash-card__value">{stats.outreachSent}</div>
          <div className="dash-card__label">Outreach Sent</div>
        </div>
      </div>
    </div>
  )
}
