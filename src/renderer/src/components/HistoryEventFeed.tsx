import { useMemo, useState, useEffect } from 'react'
import type { ApplicationRecord } from '@core/application-types'

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function dotClass(outcome: string): string {
  if (outcome === 'submitted' || outcome === 'autofilled') return 'queue-feed__dot--applied'
  if (outcome === 'failed') return 'queue-feed__dot--error'
  if (outcome === 'needs_review') return 'queue-feed__dot--cooldown'
  return 'queue-feed__dot--started'
}

function outcomeLabel(outcome: string): string {
  if (outcome === 'submitted' || outcome === 'autofilled') return 'applied'
  if (outcome === 'failed') return 'failed'
  if (outcome === 'needs_review') return 'needs review'
  if (outcome === 'skipped') return 'skipped'
  return outcome.replace(/_/g, ' ')
}

type Props = {
  records: ApplicationRecord[]
  filter?: 'all' | 'submitted' | 'review' | 'failed'
  searchQuery?: string
}

export function HistoryEventFeed({ records, filter = 'all', searchQuery = '' }: Props) {
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const filtered = useMemo(() => {
    let items = records
    if (filter === 'submitted') items = items.filter(r => r.outcome === 'submitted' || r.outcome === 'autofilled')
    else if (filter === 'review') items = items.filter(r => r.outcome === 'needs_review')
    else if (filter === 'failed') items = items.filter(r => r.outcome === 'failed')
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      items = items.filter(r =>
        r.title?.toLowerCase().includes(q) ||
        r.company?.toLowerCase().includes(q)
      )
    }
    return items
  }, [records, filter, searchQuery])

  if (filtered.length === 0) return null

  const now = Date.now()

  return (
    <div className="queue-feed history-feed">
      <div className="queue-feed__head">
        <span className="queue-feed__title">Recent activity</span>
        <span className="queue-feed__count">{filtered.length} applications</span>
      </div>
      <div className="queue-feed__list">
        {filtered.map(record => {
          const hasStuck = (record.stuckFieldLabels?.length ?? 0) > 0
          return (
            <div
              key={record.id}
              className={`queue-feed__item${record.outcome === 'failed' ? ' queue-feed__item--error' : ''}`}
            >
              <span className={`queue-feed__dot ${dotClass(record.outcome)}`} />
              <span className="queue-feed__text">
                <strong>{record.company}</strong>
                {' \u2014 '}
                {outcomeLabel(record.outcome)}
                {hasStuck && (
                  <span className="history-feed__stuck"> ({record.stuckFieldLabels!.length} Q{record.stuckFieldLabels!.length > 1 ? 's' : ''})</span>
                )}
              </span>
              <span className="queue-feed__time">{formatRelative(record.createdAt)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
