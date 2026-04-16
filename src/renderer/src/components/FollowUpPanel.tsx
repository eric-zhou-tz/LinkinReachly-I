import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getLoa } from '../loa-client'
import { cacheTabResults, getCachedTabResults } from '../tab-results-cache'

function normalizeProfileUrl(url: string): string {
  try { return new URL(url).pathname.replace(/\/+$/, '') } catch { return url.replace(/\/+$/, '') }
}

function humanizeDmError(detail?: string): string {
  if (!detail) return 'Could not send the follow-up message.'
  if (/message.*composer|click_message/i.test(detail)) return 'Could not open the message window on LinkedIn.'
  if (/type.*message|type_conversation/i.test(detail)) return 'Could not type the message on LinkedIn.'
  if (/send.*message|click_send/i.test(detail)) return 'Message was typed but could not be sent.'
  if (/bridge.*disconnect|extension.*not connected/i.test(detail)) return 'Chrome extension disconnected.'
  if (/profile.*not.*found/i.test(detail)) return 'Could not find this person on LinkedIn.'
  return 'Something went wrong. Try again in a moment.'
}

type FollowUpEntry = {
  name: string
  profileUrl: string
  company?: string
  acceptedAt?: string
  daysSinceAccept?: number
}

type FollowUpData = {
  recentAccepts: FollowUpEntry[]
  pendingFollowUps: FollowUpEntry[]
  staleConnections: FollowUpEntry[]
  awaitingReply: FollowUpEntry[]
  responded: FollowUpEntry[]
  stats: { acceptsThisWeek: number; dmsSent: number; stale: number; awaitingReply: number; responded: number }
}

type Props = {
  chromeReady: boolean
}

export function FollowUpPanel({ chromeReady }: Props) {
  const [data, setData] = useState<FollowUpData | null>(() => getCachedTabResults<FollowUpData>('followup'))
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showFeedback = (text: string, tone: 'ok' | 'error', durationMs = tone === 'ok' ? 4000 : 6000) => {
    setFeedback({ text, tone })
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), durationMs)
  }
  const setFeedbackOk = (text: string) => showFeedback(text, 'ok')
  const setFeedbackError = (text: string) => showFeedback(text, 'error')
  const [newAccepts, setNewAccepts] = useState<Array<{ profileUrl: string; displayName: string }>>([])
  const [detecting, setDetecting] = useState(false)
  const [queuedFollowUps, setQueuedFollowUps] = useState<Array<{ id: string; profileUrl: string; displayName: string; company?: string; jobTitle?: string; scheduledSendAt: string; status: string }>>([])
  const [busyProfileUrl, setBusyProfileUrl] = useState<string | null>(null)
  const [dismissAcceptsBusy, setDismissAcceptsBusy] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const loadQueuedFollowUps = useCallback(async () => {
    try {
      const r = await getLoa().followupPendingQueue()
      if (r && Array.isArray(r.items)) setQueuedFollowUps(r.items)
    } catch {
      setFeedbackError('Could not load queued follow-ups.')
    }
  }, [])

  const loadDataRef = useRef(0)
  const loadData = useCallback(async () => {
    const seq = ++loadDataRef.current
    setLoading(true)
    try {
      const r = await getLoa().followUpState()
      if (seq !== loadDataRef.current) return
      if (r.ok) {
        setData(r)
        cacheTabResults('followup', r)
      } else {
        setFeedbackError('Could not load follow-up data.')
      }
    } catch {
      if (seq === loadDataRef.current) setFeedbackError('Couldn\u2019t load follow-up data.')
    }
    if (seq === loadDataRef.current) setLoading(false)
  }, [])

  useEffect(() => {
    void loadData()
    void loadQueuedFollowUps()
    const loa = getLoa()
    const unsubs: Array<() => void> = []
    if (typeof loa.onFollowupNewAccepts === 'function') {
      unsubs.push(loa.onFollowupNewAccepts((accepts) => {
        setNewAccepts((prev) => {
          const existing = new Set(prev.map(a => normalizeProfileUrl(a.profileUrl)))
          const fresh = accepts.filter(a => !existing.has(normalizeProfileUrl(a.profileUrl)))
          return [...prev, ...fresh]
        })
        void loadData()
        void loadQueuedFollowUps()
      }))
    }
    if (typeof loa.onFollowupQueueUpdate === 'function') {
      unsubs.push(loa.onFollowupQueueUpdate((data) => {
        setQueuedFollowUps(data.items)
      }))
    }
    return () => unsubs.forEach(u => u())
  }, [loadData, loadQueuedFollowUps])

  const handleDetectNow = useCallback(async () => {
    setDetecting(true)
    setFeedbackOk('Scanning for new connections\u2026')
    try {
      const accepts = await getLoa().followupDetectNow()
      if (Array.isArray(accepts) && accepts.length > 0) {
        setNewAccepts((prev) => [...prev, ...accepts])
        setFeedbackOk(`Found ${accepts.length} new connection${accepts.length === 1 ? '' : 's'}.`)
      } else {
        setFeedbackOk('No new connections found.')
      }
      void loadData()
    } catch {
      setFeedbackError('Couldn\u2019t scan connections.')
    }
    setDetecting(false)
    setTimeout(() => setFeedback(null), 5000)
  }, [loadData])

  const totalPending = data?.pendingFollowUps.length ?? 0
  const totalStale = data?.staleConnections.length ?? 0
  const totalAccepts = data?.recentAccepts.length ?? 0
  const statsDms = data?.stats.dmsSent ?? 0

  const queuedProfileUrls = useMemo(() => new Set(queuedFollowUps.map(q => normalizeProfileUrl(q.profileUrl))), [queuedFollowUps])
  const newCol = [...(data?.recentAccepts ?? [])].slice(0, 20)
  const pendingCol = [...(data?.pendingFollowUps ?? []), ...(data?.staleConnections ?? [])].filter(e => !queuedProfileUrls.has(normalizeProfileUrl(e.profileUrl)))
  const sentCol = data?.awaitingReply ?? []
  const repliedCol = data?.responded ?? []

  return (
    <div className="followup-panel" role="region" aria-label="Follow Up">
      <header className="followup-compact-header" style={{ position: 'relative' }}>
        <span className="followup-compact-header__stat">{totalAccepts} connections this week</span>
        <span className="followup-compact-header__sep">{'\u00B7'}</span>
        <span className="followup-compact-header__stat">{statsDms} sent</span>
        <span className="followup-compact-header__sep">{'\u00B7'}</span>
        <span className="followup-compact-header__stat">{data?.stats.responded ?? 0} replied</span>
        {newAccepts.length > 0 && (
          <>
            <span className="followup-compact-header__sep">{'\u00B7'}</span>
            <span className="followup-compact-header__new">+{newAccepts.length} new</span>
          </>
        )}
        {queuedFollowUps.length > 0 && (
          <>
            <span className="followup-compact-header__sep">{'\u00B7'}</span>
            <span className="followup-compact-header__stat"><strong>{queuedFollowUps.length} queued</strong></span>
          </>
        )}
        <button
          type="button"
          className="followup-compact-header__help"
          title="How follow-ups work"
          onClick={() => setShowHelp(h => !h)}
        >
          ?
        </button>
        {showHelp && (
          <div className="followup-help-popover">
            When someone accepts your connection invite, LinkinReachly can send them a personalized follow-up message.
            Hit <strong>Scan</strong> to check for new connections, then send messages one-by-one or let them queue automatically.
            <button type="button" className="btn btn-ghost btn-xs" style={{ marginTop: 'var(--space-2)', display: 'block' }} onClick={() => setShowHelp(false)}>Got it</button>
          </div>
        )}
        <span className="followup-compact-header__spacer" />
        <button
          type="button"
          className="btn btn-primary btn-xs"
          disabled={detecting || !chromeReady}
          aria-busy={detecting}
          onClick={() => void handleDetectNow()}
          title="Check LinkedIn for people who recently accepted your connection invite"
        >
          {detecting ? 'Scanning\u2026' : '\u21BB Scan'}
        </button>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => void loadData()} disabled={loading} aria-busy={loading}>
          {loading ? 'Loading\u2026' : 'Refresh'}
        </button>
      </header>

      {!chromeReady && (
        <div className="wizard-feedback wizard-feedback--warn mt-xs" role="alert">
          Connect Chrome to send follow-up messages.
        </div>
      )}

      {feedback && (
        <div className={`wizard-feedback wizard-feedback--${feedback.tone} mt-xs`} role={feedback.tone === 'error' ? 'alert' : 'status'} aria-live={feedback.tone === 'error' ? 'assertive' : 'polite'}>{feedback.text}</div>
      )}

      {loading && !data && (
        <div className="wizard-feedback mt-xs" role="status" aria-live="polite">
          <span className="s-spinner" aria-hidden="true" /> Loading follow-up data\u2026
        </div>
      )}

      {queuedFollowUps.length > 0 && (
        <div className="followup-compact-queue">
          <span className="followup-compact-queue__label">{queuedFollowUps.length} queued:</span>
          {queuedFollowUps.length <= 3 ? (
            queuedFollowUps.map((item) => (
              <span key={item.id} className="followup-compact-queue__item">
                {item.displayName}
                <button
                  type="button"
                  className="followup-compact-queue__cancel"
                  title={`Cancel ${item.displayName}`}
                  disabled={busyProfileUrl === item.profileUrl}
                  onClick={async () => {
                    setBusyProfileUrl(item.profileUrl)
                    try {
                      await getLoa().followupCancelQueued({ id: item.id })
                      void loadQueuedFollowUps()
                      setFeedbackOk(`Cancelled ${item.displayName}.`)
                    } catch { setFeedbackError('Could not cancel.') }
                    finally { setBusyProfileUrl(null) }
                  }}
                >
                  {'\u2715'}
                </button>
              </span>
            ))
          ) : (
            <>
              <span>{queuedFollowUps.slice(0, 2).map(q => q.displayName).join(', ')}</span>
              <span className="muted">+{queuedFollowUps.length - 2} more</span>
            </>
          )}
        </div>
      )}

      <div className="followup-kanban" role="region" aria-label="Follow-up pipeline">
        <div className="followup-kanban__col">
          <h4 className="followup-kanban__col-title">New connections <span className="followup-kanban__count">{newCol.length}</span></h4>
          <div className="followup-kanban__cards">
            {newCol.map((entry, i) => (
              <div key={entry.profileUrl + i} className="followup-kanban__card">
                <strong>{entry.name}</strong>
                {entry.company && <span className="muted">{entry.company}</span>}
                {entry.acceptedAt && <span className="muted">{new Date(entry.acceptedAt).toLocaleDateString()}</span>}
              </div>
            ))}
            {newCol.length === 0 && <p className="followup-kanban__empty">No new connections</p>}
          </div>
        </div>

        {/* Pending column */}
        <div className="followup-kanban__col">
          <h4 className="followup-kanban__col-title">Ready to message <span className="followup-kanban__count">{pendingCol.length}</span></h4>
          <div className="followup-kanban__cards">
            {pendingCol.map((entry, i) => {
              const isStale = (entry.daysSinceAccept ?? 0) >= 7
              return (
                <div key={entry.profileUrl + i} className={`followup-kanban__card${isStale ? ' followup-kanban__card--stale' : ''}`}>
                  <strong>{entry.name}</strong>
                  {entry.company && <span className="muted">{entry.company}</span>}
                  {entry.daysSinceAccept != null && <span className="muted">{entry.daysSinceAccept}d ago{isStale ? ' (no reply)' : ''}</span>}
                  <button
                    type="button"
                    className="btn btn-sm btn-primary followup-kanban__card-action"
                    disabled={!chromeReady || busyProfileUrl === entry.profileUrl}
                    aria-busy={busyProfileUrl === entry.profileUrl}
                    onClick={async () => {
                      setBusyProfileUrl(entry.profileUrl)
                      try {
                        const result = await getLoa().followupSendDm({ profileUrl: entry.profileUrl, firstName: entry.name.split(/\s+/)[0] || entry.name, company: entry.company || '' })
                        if (result.ok) setFeedbackOk(`Message sent to ${entry.name}.`)
                        else setFeedbackError(humanizeDmError(result.detail))
                        void loadData()
                      } catch (e) { setFeedbackError('Couldn\u2019t send the message. Check your LinkedIn tab.') }
                      finally { setBusyProfileUrl(null) }
                    }}
                  >
                    {busyProfileUrl === entry.profileUrl ? 'Sending\u2026' : 'Send message'}
                  </button>
                </div>
              )
            })}
            {pendingCol.length === 0 && <p className="followup-kanban__empty">None pending</p>}
          </div>
        </div>

        {/* Sent column */}
        <div className="followup-kanban__col">
          <h4 className="followup-kanban__col-title">Message sent <span className="followup-kanban__count">{sentCol.length}</span></h4>
          <div className="followup-kanban__cards">
            {sentCol.map((entry, i) => (
              <div key={entry.profileUrl + i} className="followup-kanban__card">
                <strong>{entry.name}</strong>
                {entry.company && <span className="muted">{entry.company}</span>}
                {entry.daysSinceAccept != null && <span className="muted">Messaged {entry.daysSinceAccept}d ago</span>}
                <button
                  type="button"
                  className="btn btn-sm btn-ghost followup-kanban__card-action"
                  disabled={busyProfileUrl === entry.profileUrl}
                  onClick={async () => {
                    setBusyProfileUrl(entry.profileUrl)
                    try { await getLoa().followupMarkReplied({ profileUrl: entry.profileUrl }); setFeedbackOk(`Marked ${entry.name} as replied.`); void loadData() }
                    catch { setFeedbackError('Couldn\u2019t update.') }
                    finally { setBusyProfileUrl(null) }
                  }}
                >
                  {busyProfileUrl === entry.profileUrl ? '\u2026' : 'I got a reply'}
                </button>
              </div>
            ))}
            {sentCol.length === 0 && <p className="followup-kanban__empty">None sent</p>}
          </div>
        </div>

        {/* Replied column */}
        <div className="followup-kanban__col">
          <h4 className="followup-kanban__col-title">Replied <span className="followup-kanban__count">{repliedCol.length}</span></h4>
          <div className="followup-kanban__cards">
            {repliedCol.map((entry, i) => (
              <div key={entry.profileUrl + i} className="followup-kanban__card followup-kanban__card--done">
                <strong>{entry.name}</strong>
                {entry.company && <span className="muted">{entry.company}</span>}
              </div>
            ))}
            {repliedCol.length === 0 && <p className="followup-kanban__empty">None yet</p>}
          </div>
        </div>
      </div>

      
    </div>
  )
}
