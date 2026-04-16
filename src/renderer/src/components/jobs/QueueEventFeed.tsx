import { useEffect, useRef, useState } from 'react'
import type { ApplyQueueState, ApplyQueueItem } from '@core/application-types'

export type FeedEvent = {
  id: string
  type: 'applied' | 'error' | 'cooldown' | 'active' | 'started'
  jobTitle?: string
  company?: string
  detail?: string
  timestamp: number
}

function deriveEvents(
  prev: ApplyQueueState | null,
  next: ApplyQueueState
): FeedEvent[] {
  const events: FeedEvent[] = []
  const prevMap = new Map<string, ApplyQueueItem>()
  if (prev) for (const item of prev.items) prevMap.set(item.id, item)

  for (const item of next.items) {
    const old = prevMap.get(item.id)
    if (!old) continue
    if (old.status !== 'done' && item.status === 'done') {
      events.push({
        id: `${item.id}-done-${Date.now()}`,
        type: 'applied',
        jobTitle: item.jobTitle,
        company: item.company,
        timestamp: Date.now(),
      })
    }
    if (old.status !== 'error' && item.status === 'error') {
      events.push({
        id: `${item.id}-err-${Date.now()}`,
        type: 'error',
        jobTitle: item.jobTitle,
        company: item.company,
        detail: item.detail,
        timestamp: Date.now(),
      })
    }
  }

  return events
}

function formatAge(ms: number): string {
  const sec = Math.round(ms / 1000)
  if (sec < 5) return 'now'
  if (sec < 60) return `${sec}s`
  const min = Math.round(sec / 60)
  return `${min}m`
}

type Props = {
  applyQueue: ApplyQueueState
}

export function QueueEventFeed({ applyQueue }: Props) {
  const [events, setEvents] = useState<FeedEvent[]>([])
  const prevRef = useRef<ApplyQueueState | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!applyQueue.running) {
      prevRef.current = applyQueue
      return
    }

    const prev = prevRef.current
    const newEvents = deriveEvents(prev, applyQueue)

    if (newEvents.length > 0) {
      setEvents(old => [...newEvents, ...old])
    }

    const lastDetail = applyQueue.lastDetail ?? ''
    const isCooldown = /cooldown|break|waiting/i.test(lastDetail)
    if (isCooldown && prev?.lastDetail !== applyQueue.lastDetail) {
      setEvents(old => [{
        id: `cooldown-${Date.now()}`,
        type: 'cooldown' as const,
        detail: lastDetail,
        timestamp: Date.now(),
      }, ...old])
    }

    prevRef.current = applyQueue
  }, [applyQueue])

  // Clear events when a new run starts
  useEffect(() => {
    if (applyQueue.running && applyQueue.startedAt) {
      setEvents([{
        id: `start-${Date.now()}`,
        type: 'started',
        detail: `Queue started (${applyQueue.items.filter(i => i.status === 'pending').length} jobs)`,
        timestamp: Date.now(),
      }])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyQueue.startedAt])

  // Refresh timestamps every 15s
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  const activeItem = applyQueue.running
    ? applyQueue.items.find(i => i.status === 'active')
    : null

  const activeDetail = applyQueue.lastDetail ?? ''
  const now = Date.now()

  if (!applyQueue.running && events.length === 0) return null

  return (
    <div className="queue-feed" ref={feedRef}>
      <div className="queue-feed__head">
        <span className="queue-feed__title">Activity</span>
        {events.length > 0 && (
          <span className="queue-feed__count">{events.length} events</span>
        )}
      </div>
      <div className="queue-feed__list">
        {activeItem && (
          <div className="queue-feed__item queue-feed__item--active">
            <span className="queue-feed__dot queue-feed__dot--active" />
            <span className="queue-feed__text">
              <strong>{activeItem.company}</strong>
              {' \u2014 '}
              {activeDetail || 'applying\u2026'}
            </span>
            <span className="queue-feed__time">now</span>
          </div>
        )}
        {events.filter(e => e.type !== 'started' || events.length <= 1).map(ev => (
          <div
            key={ev.id}
            className={`queue-feed__item${ev.type === 'error' ? ' queue-feed__item--error' : ''}`}
          >
            <span className={`queue-feed__dot queue-feed__dot--${ev.type}`} />
            <span className="queue-feed__text">
              {ev.type === 'applied' && (
                <><strong>{ev.company}</strong>{' \u2014 applied'}</>
              )}
              {ev.type === 'error' && (
                <><strong>{ev.company}</strong>{' \u2014 '}<span className="queue-feed__err-msg">{ev.detail || 'failed'}</span></>
              )}
              {ev.type === 'cooldown' && (ev.detail || 'Cooldown')}
              {ev.type === 'started' && (ev.detail || 'Queue started')}
            </span>
            <span className="queue-feed__time">{formatAge(now - ev.timestamp)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
