import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApplicationRecord } from '@core/application-types'
import type { AppModel } from '@/hooks/useAppModel'
import { getLoa } from '@/loa-client'
import { isFeatureGated } from '@/hooks/usePlanState'
import { ExternalLink } from './ExternalLink'
import { HistoryEventFeed } from './HistoryEventFeed'
import { StuckFieldsPrompt } from './StuckFieldsPrompt'

type LogCategory = 'success' | 'error' | 'skip' | 'info'
type HistoryKind = 'outreach' | 'outreach_stage' | 'prospects_search' | 'jobs_search' | 'jobs_screen' | 'generic'

interface ParsedPerson {
  profileUrl: string
  name: string
  company: string
  headline: string
}

interface ParsedJob {
  title: string
  company: string
  location: string
  jobUrl: string
  postedDate: string
  description: string
  score: number | null
  reason: string
  nextStep: string
}

interface ParsedLogEntry {
  category: LogCategory
  kind: HistoryKind
  title: string
  detail: string
  timestamp: string
  raw: string
  meta: string[]
  linkUrl: string
  linkLabel: string
  people: ParsedPerson[]
  jobs: ParsedJob[]
  resultCount: number
}

function categorizeStatus(status: string): LogCategory {
  const lower = status.toLowerCase()
  if (['sent', 'success', 'ok', 'connected', 'delivered'].includes(lower)) return 'success'
  if (['error', 'failed', 'failure', 'crash', 'rate_limited'].includes(lower)) return 'error'
  if (['skipped', 'skip', 'duplicate', 'already_sent', 'already_connected', 'pending', 'dry_run'].includes(lower)) return 'skip'
  return 'info'
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function deriveCategory(status: string, kind: HistoryKind, resultCount: number): LogCategory {
  const base = categorizeStatus(status)
  if (base !== 'info') return base
  if (kind !== 'outreach' && resultCount > 0) return 'success'
  return 'info'
}

function parsePeople(raw: unknown): ParsedPerson[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => {
      const row = entry as Record<string, unknown>
      const profileUrl = cleanText(row.profileUrl)
      const name = cleanText(row.name) || cleanText(row.firstName) || profileUrl
      return {
        profileUrl,
        name,
        company: cleanText(row.company),
        headline: cleanText(row.headline)
      }
    })
    .filter((row) => row.profileUrl)
}

function parseJobs(raw: unknown): ParsedJob[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => {
      const row = entry as Record<string, unknown>
      const scoreValue = row.score
      return {
        title: cleanText(row.title),
        company: cleanText(row.company),
        location: cleanText(row.location),
        jobUrl: cleanText(row.jobUrl),
        postedDate: cleanText(row.postedDate),
        description: cleanText(row.description),
        score: typeof scoreValue === 'number' ? scoreValue : null,
        reason: cleanText(row.reason),
        nextStep: cleanText(row.nextStep)
      }
    })
    .filter((row) => row.jobUrl || row.title || row.company)
}

function parseResultCount(obj: Record<string, unknown>, people: ParsedPerson[], jobs: ParsedJob[]): number {
  const resultCount = obj.resultCount
  if (typeof resultCount === 'number' && Number.isFinite(resultCount)) return resultCount
  if (people.length > 0) return people.length
  if (jobs.length > 0) return jobs.length
  return 0
}

function parseLogEntry(line: unknown): ParsedLogEntry {
  if (typeof line === 'string') {
    try {
      return parseLogEntry(JSON.parse(line) as Record<string, unknown>)
    } catch {
      return {
        category: 'info',
        kind: 'generic',
        title: 'Event',
        detail: line,
        timestamp: '',
        raw: line,
        meta: [],
        linkUrl: '',
        linkLabel: '',
        people: [],
        jobs: [],
        resultCount: 0
      }
    }
  }

  if (typeof line !== 'object' || line === null) {
    const text = String(line)
    return {
      category: 'info',
      kind: 'generic',
      title: 'Event',
      detail: text,
      timestamp: '',
      raw: text,
      meta: [],
      linkUrl: '',
      linkLabel: '',
      people: [],
      jobs: [],
      resultCount: 0
    }
  }

  const obj = line as Record<string, unknown>
  const status = cleanText(obj.status)
  const timestamp = cleanText(obj.timestamp) || cleanText(obj.ts)
  const raw = JSON.stringify(obj, null, 2)
  const searchQuery = cleanText(obj.searchQuery)
  const searchUrl = cleanText(obj.searchUrl)
  const profileUrl = cleanText(obj.profileUrl) || cleanText(obj.profile_url) || cleanText(obj.url)
  const location = cleanText(obj.location)
  const criteria = cleanText(obj.criteria)
  const summary = cleanText(obj.summary)
  const detail = cleanText(obj.detail) || cleanText(obj.message) || cleanText(obj.error)
  const people = parsePeople(obj.people)
  const jobs = parseJobs(obj.jobs)
  const resultCount = parseResultCount(obj, people, jobs)
  const eventType = cleanText(obj.eventType)
  const queryResults = Array.isArray(obj.queryResults) ? obj.queryResults.length : 0
  const profileSource = cleanText(obj.profileSource)
  const stageLabel = cleanText(obj.stageLabel)
  const stageStatus = cleanText(obj.stageStatus)

  let kind: HistoryKind = 'outreach'
  let title = summary || profileUrl || detail || 'Event'
  let body = detail
  let meta = timestamp ? [timestamp] : []
  let linkUrl = profileUrl
  let linkLabel = profileUrl ? 'Open profile' : ''

  if (eventType === 'prospects_search') {
    kind = 'prospects_search'
    title = summary || (resultCount > 0 ? `Saved ${countLabel(resultCount, 'person', 'people')}` : 'People search')
    body = searchQuery ? `LinkedIn query: ${searchQuery}` : detail
    meta = [
      countLabel(resultCount, 'person', 'people'),
      ...(timestamp ? [timestamp] : [])
    ]
    linkUrl = searchUrl || profileUrl
    linkLabel = linkUrl ? 'Open search' : ''
  } else if (eventType === 'jobs_search') {
    kind = 'jobs_search'
    title = summary || (resultCount > 0 ? `Saved ${countLabel(resultCount, 'job')}` : 'Job search')
    body = criteria || (searchQuery ? `Search: ${searchQuery}` : detail)
    meta = [
      countLabel(resultCount, 'job'),
      ...(queryResults > 0 ? [countLabel(queryResults, 'search')] : []),
      ...(location ? [location] : []),
      ...(profileSource && profileSource !== 'none' ? [`Source: ${profileSource.replace(/_/g, ' ')}`] : []),
      ...(timestamp ? [timestamp] : [])
    ]
    linkUrl = searchUrl || profileUrl || jobs[0]?.jobUrl || ''
    linkLabel = linkUrl ? (searchUrl || profileUrl ? 'Open search' : 'Open top job') : ''
  } else if (eventType === 'jobs_screen') {
    kind = 'jobs_screen'
    title = summary || (resultCount > 0 ? `Saved screening for ${countLabel(resultCount, 'job')}` : 'Job screening')
    body = criteria || detail
    meta = [
      countLabel(resultCount, 'job'),
      ...(timestamp ? [timestamp] : [])
    ]
    linkUrl = jobs[0]?.jobUrl || profileUrl
    linkLabel = linkUrl ? 'Open top job' : ''
  } else if (eventType === 'outreach_stage') {
    kind = 'outreach_stage'
    const name = cleanText(obj.name)
    const company = cleanText(obj.company)
    title = name ? (company ? `${name} at ${company}` : name) : profileUrl || 'Outreach progress'
    body = stageLabel || summary || detail || 'Recorded outreach stage.'
    meta = [
      ...(stageStatus ? [stageStatus.replace(/_/g, ' ')] : []),
      ...(timestamp ? [timestamp] : [])
    ]
    linkUrl = profileUrl
    linkLabel = linkUrl ? 'Open profile' : ''
  } else {
    const name = cleanText(obj.name)
    const company = cleanText(obj.company)
    title = name ? (company ? `${name} at ${company}` : name) : profileUrl || detail || 'Event'
    body =
      detail && profileUrl
        ? DETAIL_EXPLANATIONS[detail] || detail
        : summary || DETAIL_EXPLANATIONS[detail] || detail
    meta = [
      ...(company && !title.includes(company) ? [company] : []),
      ...(timestamp ? [timestamp] : [])
    ]
    linkUrl = profileUrl
    linkLabel = linkUrl ? 'Open profile' : ''
  }

  return {
    category: deriveCategory(status, kind, resultCount),
    kind,
    title,
    detail: body,
    timestamp,
    raw,
    meta: meta.filter(Boolean),
    linkUrl,
    linkLabel,
    people,
    jobs,
    resultCount
  }
}

const LOG_ICON: Record<LogCategory, string> = {
  success: '\u2713',
  error: '\u2717',
  skip: '\u2192',
  info: '\u2022'
}

const DETAIL_EXPLANATIONS: Record<string, string> = {
  already_completed_in_log: 'Already sent a request to this person in a previous run.',
  already_in_today_ledger: 'Already contacted today to stay under the daily limit.',
  daily_cap: 'Daily sending limit reached. Remaining people will be sent tomorrow.',
  profile_search_no_match: 'Could not find a matching LinkedIn profile for this person.',
  dry_run_preview: 'Test run only. The message was composed but not sent.',
  already_connected: 'You are already connected with this person.',
  email_required_to_connect: "LinkedIn requires this person's email address before it will allow the invite to be sent.",
  connect_button_not_found: 'Could not find the Connect button on this profile page.',
  rate_limited: 'Temporarily paused. Will resume shortly.',
  no_note_field: 'LinkedIn did not show the note field, so the request was sent without a message.'
}

/** Local calendar day key for grouping (YYYY-MM-DD), or __none__ if missing/unparseable. */
function dayKeyFromEntry(entry: ParsedLogEntry): string {
  const raw = entry.timestamp?.trim()
  if (!raw) return '__none__'
  const ms = Date.parse(raw)
  if (!Number.isNaN(ms)) {
    const d = new Date(ms)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  return '__none__'
}

function formatHistoryDayHeading(dayKey: string): string {
  if (dayKey === '__none__') return 'No timestamp'
  const [ys, ms, ds] = dayKey.split('-')
  const y = Number(ys)
  const mo = Number(ms)
  const d = Number(ds)
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return dayKey
  const date = new Date(y, mo - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)
  if (dayStart.getTime() === today.getTime()) return 'Today'
  const yday = new Date(today)
  yday.setDate(yday.getDate() - 1)
  if (dayStart.getTime() === yday.getTime()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

/** Full calendar line for subtitles (always includes weekday + date when parsable). */
function formatHistoryDayCalendarLine(dayKey: string): string {
  if (dayKey === '__none__') {
    return 'These rows had no saved time—grouped together so nothing is lost.'
  }
  const [ys, ms, ds] = dayKey.split('-')
  const y = Number(ys)
  const mo = Number(ms)
  const d = Number(ds)
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return dayKey
  const date = new Date(y, mo - 1, d)
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function groupHistoryLogsByDay(logs: unknown[]): { dayKey: string; rows: { line: unknown; index: number }[] }[] {
  const bucket = new Map<string, { line: unknown; index: number }[]>()
  logs.forEach((line, index) => {
    const key = dayKeyFromEntry(parseLogEntry(line))
    if (!bucket.has(key)) bucket.set(key, [])
    bucket.get(key)!.push({ line, index })
  })
  const keys = [...bucket.keys()].sort((a, b) => {
    if (a === '__none__') return 1
    if (b === '__none__') return -1
    return b.localeCompare(a)
  })
  return keys.map((dayKey) => ({ dayKey, rows: bucket.get(dayKey)! }))
}

function computeHistoryStats(logs: unknown[]): {
  operations: number
  success: number
  error: number
  skip: number
  people: number
  jobs: number
} {
  let operations = 0
  let success = 0
  let error = 0
  let skip = 0
  let people = 0
  let jobs = 0

  for (const line of logs) {
    const entry = parseLogEntry(line)
    if (entry.kind !== 'outreach_stage') operations++
    if (entry.kind === 'outreach') {
      if (entry.category === 'success') success++
      else if (entry.category === 'error') error++
      else if (entry.category === 'skip') skip++
    }
    if (entry.kind === 'prospects_search') people += entry.resultCount
    if (entry.kind === 'jobs_search' || entry.kind === 'jobs_screen') jobs += entry.resultCount
  }

  return { operations, success, error, skip, people, jobs }
}

interface HistoryPanelProps {
  model: AppModel
  initialTab?: 'applications' | 'campaign'
  onTabChange?: (tab: 'applications' | 'campaign') => void
  plan?: 'free' | 'plus'
  onNavigateToAnswerBank?: () => void
}

type HistoryFilter = 'all' | 'jobs' | LogCategory

function outcomeStatusTitle(outcome: string): string | undefined {
  switch (outcome) {
    case 'autofilled':
      return 'Application was automatically filled and submitted'
    case 'failed':
      return 'Application could not be completed — click to see details'
    case 'needs_review':
      return 'Application may have been submitted but needs manual verification'
    default:
      return undefined
  }
}

function formatOutcome(outcome: string): string {
  switch (outcome) {
    case 'submitted': return 'Submitted'
    case 'autofilled': return 'Auto-filled'
    case 'needs_review': return 'Needs review'
    case 'failed': return 'Failed'
    case 'opened': return 'Opened'
    case 'blocked': return 'Blocked'
    case 'skipped': return 'Skipped'
    case 'cancelled': return 'Cancelled'
    default: return outcome.charAt(0).toUpperCase() + outcome.slice(1).replace(/_/g, ' ')
  }
}

function outcomeColor(outcome: string): string {
  switch (outcome) {
    case 'submitted':
    case 'autofilled':
      return 'application-chip--done'
    case 'failed':
      return 'application-chip--error'
    case 'needs_review':
      return 'application-chip--pending'
    default:
      return ''
  }
}

function isSubmittedOutcome(outcome: string): boolean {
  return outcome === 'submitted' || outcome === 'autofilled'
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function HistoryPanel({ model, initialTab, onTabChange, plan = 'free', onNavigateToAnswerBank }: HistoryPanelProps) {
  const parsedLogs = useMemo(() => model.logs.map(parseLogEntry), [model.logs])
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')

  const historyStats = useMemo(() => {
    let operations = 0
    let success = 0
    let error = 0
    let skip = 0
    let people = 0
    let jobs = 0
    for (const entry of parsedLogs) {
      const matchesFilter =
        historyFilter === 'all' ||
        (historyFilter === 'jobs' && (entry.kind === 'jobs_search' || entry.kind === 'jobs_screen')) ||
        entry.category === historyFilter
      if (!matchesFilter) continue
      if (entry.kind !== 'outreach_stage') operations++
      if (entry.kind === 'outreach') {
        if (entry.category === 'success') success++
        else if (entry.category === 'error') error++
        else if (entry.category === 'skip') skip++
      }
      if (entry.kind === 'prospects_search') people += entry.resultCount
      if (entry.kind === 'jobs_search' || entry.kind === 'jobs_screen') jobs += entry.resultCount
    }
    return { operations, success, error, skip, people, jobs }
  }, [parsedLogs, historyFilter])

  const canClearLog = model.logs.length > 0
  const [lastReloadLabel, setLastReloadLabel] = useState<string | null>(null)
  const [campaignLogRefreshBusy, setCampaignLogRefreshBusy] = useState(false)
  const [appHistory, setAppHistory] = useState<ApplicationRecord[]>([])
  const [appHistoryLoading, setAppHistoryLoading] = useState(false)
  const [appHistoryDeletingId, setAppHistoryDeletingId] = useState<string | null>(null)
  const [appHistoryConfirmDeleteId, setAppHistoryConfirmDeleteId] = useState<string | null>(null)
  const [clearLogConfirm, setClearLogConfirm] = useState(false)
  const [appHistoryResolvingId, setAppHistoryResolvingId] = useState<string | null>(null)
  const [appHistoryVisibleLimit, setAppHistoryVisibleLimit] = useState(50)
  const [historyTab, setHistoryTabRaw] = useState<'applications' | 'campaign'>(initialTab ?? 'campaign')
  const setHistoryTab = useCallback((tab: 'applications' | 'campaign') => {
    setHistoryTabRaw(tab)
    onTabChange?.(tab)
  }, [onTabChange])

  useEffect(() => {
    if (initialTab && initialTab !== historyTab) setHistoryTabRaw(initialTab)
  }, [initialTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const [appHistoryError, setAppHistoryError] = useState<string | null>(null)
  const [appHistoryFilterStatus, setAppHistoryFilterStatus] = useState<'all' | 'submitted' | 'review' | 'failed'>('all')
  const [appHistorySearchQuery, setAppHistorySearchQuery] = useState('')

  const historyLoadSeqRef = useRef(0)
  const loadAppHistory = useCallback(async () => {
    const seq = ++historyLoadSeqRef.current
    setAppHistoryLoading(true)
    setAppHistoryError(null)
    try {
      const res = await getLoa().applicationHistory()
      if (seq !== historyLoadSeqRef.current) return
      if (res.ok && Array.isArray(res.records)) {
        setAppHistory(res.records)
      } else {
        setAppHistoryError('Could not load application history. Try refreshing.')
      }
    } catch {
      if (seq !== historyLoadSeqRef.current) return
      setAppHistoryError('Couldn\u2019t connect to the app. Check that it\u2019s running, then try again.')
    }
    setAppHistoryLoading(false)
  }, [])

  const deleteAppHistoryRecord = useCallback(async (record: ApplicationRecord) => {
    const msg = `Remove “${record.title}” at ${record.company} from history?`
    if (appHistoryConfirmDeleteId !== record.id) {
      setAppHistoryConfirmDeleteId(record.id)
      return
    }
    setAppHistoryConfirmDeleteId(null)
    setAppHistoryDeletingId(record.id)
    try {
      const res = await getLoa().applicationHistoryDelete({ id: record.id })
      if (res.ok) {
        setAppHistory(res.records)
      } else {
        setAppHistoryError('Couldn\u2019t delete that record. Try again.')
      }
    } catch (err) {
      setAppHistoryError('Couldn\u2019t delete that record. Try again.')
    } finally {
      setAppHistoryDeletingId(null)
    }
  }, [appHistoryConfirmDeleteId])

  const resolveNeedsReview = useCallback(async (record: ApplicationRecord, outcome: 'submitted' | 'failed') => {
    setAppHistoryResolvingId(record.id)
    try {
      const r = await getLoa().applicationUpdate({ id: record.id, outcome })
      if (r && !r.ok) setAppHistoryError('Couldn\u2019t update this record. Try again.')
      void loadAppHistory()
    } catch {
      setAppHistoryError('Couldn\u2019t update application status.')
    } finally {
      setAppHistoryResolvingId(null)
    }
  }, [loadAppHistory])

  const [stageEditId, setStageEditId] = useState<string | null>(null)
  const [stageUpdatingId, setStageUpdatingId] = useState<string | null>(null)
  const updatePipelineStage = useCallback(async (recordId: string, stage: ApplicationRecord['pipelineStage']) => {
    setStageUpdatingId(recordId)
    try {
      await getLoa().applicationUpdate({ id: recordId, pipelineStage: stage })
      void loadAppHistory()
    } catch (err) {
      setAppHistoryError('Couldn\u2019t update the pipeline stage. Try again.')
    } finally {
      setStageUpdatingId(null)
      setStageEditId(null)
    }
  }, [loadAppHistory])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setAppHistoryLoading(true)
      try {
        const res = await getLoa().applicationHistory()
        if (!cancelled && res.ok && Array.isArray(res.records)) {
          setAppHistory(res.records)
        } else if (!cancelled) {
          setAppHistoryError('Could not load application history. Try refreshing.')
        }
      } catch {
        if (!cancelled) setAppHistoryError('Couldn\u2019t connect to the app. Check that it\u2019s running, then try again.')
      }
      if (!cancelled) setAppHistoryLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const filteredDayGroups = useMemo(() => {
    const bucket = new Map<string, { entry: ParsedLogEntry; line: unknown; index: number }[]>()
    parsedLogs.forEach((entry, index) => {
      const key = dayKeyFromEntry(entry)
      if (!bucket.has(key)) bucket.set(key, [])
      bucket.get(key)!.push({ entry, line: model.logs[index], index })
    })
    const keys = [...bucket.keys()].sort((a, b) => {
      if (a === '__none__') return 1
      if (b === '__none__') return -1
      return b.localeCompare(a)
    })
    return keys
      .map((dayKey) => ({
        dayKey,
        rows: bucket.get(dayKey)!.filter(({ entry }) => {
          if (historyFilter === 'all') return true
          if (historyFilter === 'jobs') return entry.kind === 'jobs_search' || entry.kind === 'jobs_screen'
          return entry.category === historyFilter
        })
      }))
      .filter((group) => group.rows.length > 0)
  }, [parsedLogs, model.logs, historyFilter])

  function handleClearLog(): void {
    if (!canClearLog) return
    if (!clearLogConfirm) {
      setClearLogConfirm(true)
      return
    }
    setClearLogConfirm(false)
    void model.clearLogs()
  }

  const supersededIds = useMemo(() => {
    const successUrls = new Set<string>()
    for (const r of appHistory) {
      if (isSubmittedOutcome(r.outcome) && r.jobUrl) {
        successUrls.add(r.jobUrl)
      }
    }
    const ids = new Set<string>()
    for (const r of appHistory) {
      if (r.outcome === 'needs_review' && r.jobUrl && successUrls.has(r.jobUrl)) {
        ids.add(r.id)
      }
    }
    return ids
  }, [appHistory])

  const appHistoryStats = useMemo(() => {
    let total = 0
    let submitted = 0
    let failed = 0
    let review = 0
    let opened = 0
    for (const r of appHistory) {
      if (supersededIds.has(r.id)) continue
      total++
      if (isSubmittedOutcome(r.outcome)) submitted++
      else if (r.outcome === 'failed') failed++
      else if (r.outcome === 'needs_review') review++
      else if (r.outcome === 'opened') opened++
    }
    return { total, submitted, failed, review, opened }
  }, [appHistory, supersededIds])

  return (
    <div className="history-panel" role="region" aria-label="History">
      <div className="history-panel__card">

        {historyTab === 'applications' && (
          <div id="history-tab-applications" className="history-applications" role="tabpanel" aria-label="Application history">

            <div className="history-compact-bar">
              <div className="history-compact-bar__stats" role="region" aria-label="Application summary">
                <span><b>{appHistoryStats.total}</b> total</span>
                <span className="history-compact-bar__sep" aria-hidden="true">·</span>
                <span className="history-compact-bar__stat--success"><b>{appHistoryStats.submitted}</b> submitted</span>
                <span className="history-compact-bar__sep" aria-hidden="true">·</span>
                <span className="history-compact-bar__stat--warn"><b>{appHistoryStats.review}</b> review</span>
                <span className="history-compact-bar__sep" aria-hidden="true">·</span>
                <span className="history-compact-bar__stat--danger"><b>{appHistoryStats.failed}</b> failed</span>
              </div>
              <div className="history-compact-bar__actions">
                <input className="v7-inp v7-inp--sm history-search-input" placeholder="Search\u2026" value={appHistorySearchQuery} onChange={(e) => setAppHistorySearchQuery(e.target.value)} />
                <div className="chip-row">
                  <button type="button" className={`v7-chip${appHistoryFilterStatus === 'all' ? ' v7-chip--on' : ''}`} onClick={() => { setAppHistoryFilterStatus('all'); setAppHistoryVisibleLimit(50) }}>All</button>
                  <button type="button" className={`v7-chip${appHistoryFilterStatus === 'submitted' ? ' v7-chip--on' : ''}`} onClick={() => { setAppHistoryFilterStatus('submitted'); setAppHistoryVisibleLimit(50) }}>Submitted</button>
                  <button type="button" className={`v7-chip${appHistoryFilterStatus === 'review' ? ' v7-chip--on' : ''}`} onClick={() => { setAppHistoryFilterStatus('review'); setAppHistoryVisibleLimit(50) }}>Review</button>
                  <button type="button" className={`v7-chip${appHistoryFilterStatus === 'failed' ? ' v7-chip--on' : ''}`} onClick={() => { setAppHistoryFilterStatus('failed'); setAppHistoryVisibleLimit(50) }}>Failed</button>
                </div>
              </div>
            </div>
            <div className="history-compact-bar__toolbar">
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => void loadAppHistory()} disabled={appHistoryLoading} aria-busy={appHistoryLoading}>
                {appHistoryLoading ? 'Loading\u2026' : 'Refresh'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                disabled={isFeatureGated('analytics_export', plan)}
                onClick={async () => {
                  try {
                    const res = await getLoa().applicationHistoryExportCsv()
                    if (!res.ok) {
                      setAppHistoryError('Couldn\u2019t export. Try again.')
                      return
                    }
                    const blob = new Blob([res.csv], { type: 'text/csv' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `linkinreachly-history-${new Date().toISOString().slice(0, 10)}.csv`
                    a.click()
                    URL.revokeObjectURL(url)
                  } catch (err) {
                    setAppHistoryError('Couldn\u2019t export. Try again.')
                  }
                }}
              >
                Export CSV
              </button>
              {isFeatureGated('analytics_export', plan) && <span className="gate-badge">Plus</span>}
            </div>

            {appHistory.length > 0 && (
              <HistoryEventFeed
                records={appHistory}
                filter={appHistoryFilterStatus}
                searchQuery={appHistorySearchQuery}
              />
            )}

            {appHistoryLoading && appHistory.length === 0 && (
              <div className="wizard-feedback mt-xs" role="status" aria-live="polite">
                <span className="s-spinner" aria-hidden="true" /> Loading application history…
              </div>
            )}

            {appHistory.length === 0 && !appHistoryLoading && !appHistoryError && (
              <div className="empty-state">
                <div className="empty-state__icon" aria-hidden="true">{'\u2630'}</div>
                <h3 className="empty-state__title">No applications yet</h3>
                <p className="empty-state__body">Queue jobs under the Jobs tab and run Easy Apply to see your application history here.</p>
              </div>
            )}

            {appHistoryError && !appHistoryLoading && (
              <div className="wizard-feedback wizard-feedback--error mt-sm" role="alert">
                {appHistoryError}
                <button type="button" className="btn btn-ghost btn-sm ml-sm" disabled={appHistoryLoading} aria-busy={appHistoryLoading} onClick={() => void loadAppHistory()}>Retry</button>
              </div>
            )}

            {appHistory.length > 0 && (
              <div className="s-card history-panel__card-flush">
              <div className="history-app-list" role="list" aria-live="polite">
                {(() => { const filtered = appHistory.filter((r) => {
                  if (supersededIds.has(r.id)) return false
                  if (appHistoryFilterStatus === 'submitted' && !isSubmittedOutcome(r.outcome)) return false
                  if (appHistoryFilterStatus === 'review' && r.outcome !== 'needs_review') return false
                  if (appHistoryFilterStatus === 'failed' && r.outcome !== 'failed') return false
                  if (appHistorySearchQuery) {
                    const q = appHistorySearchQuery.toLowerCase()
                    if (!r.title?.toLowerCase().includes(q) && !r.company?.toLowerCase().includes(q) && !r.outcome?.toLowerCase().includes(q)) return false
                  }
                  return true
                }); const hasMore = filtered.length > appHistoryVisibleLimit; return (<>{filtered.slice(0, appHistoryVisibleLimit).map((record) => {
                  const isReview = record.outcome === 'needs_review'
                  const isSuperseded = supersededIds.has(record.id)
                  let stuckLabels = record.stuckFieldLabels ?? []
                  if (isReview && !isSuperseded && stuckLabels.length === 0 && record.detail) {
                    const stuckMatch = record.detail.match(/unfilled\s*\(([^)]+)\)/i)
                    if (stuckMatch) stuckLabels = stuckMatch[1].split(',').map(s => s.trim()).filter(s => s && s !== '...')
                  }
                  return (
                  <div key={record.id} className={`tl-row${isReview && !isSuperseded ? ' tl-row--review' : ''}`} role="listitem">
                    <span
                      className={`tl-dot tl-dot--${isSubmittedOutcome(record.outcome) ? 'submitted' : isReview ? (isSuperseded ? 'default' : 'needs-review') : record.outcome === 'failed' ? 'failed' : 'default'}`}
                      aria-hidden="true"
                    />
                    <div className="history-app-item__main">
                      <div className="history-app-item__info">
                        <strong>{record.title}</strong>
                        <span className="muted">{record.company}{record.location ? ` \u2022 ${record.location}` : ''}{` \u2022 ${formatRelativeTime(record.createdAt)}`}</span>
                      </div>
                      <div className="history-app-item__right">
                        {isSuperseded ? (
                          <span className="application-chip chip--muted">Superseded</span>
                        ) : (
                          <>
                            <span
                              className={`application-chip ${outcomeColor(record.outcome)}`}
                              title={outcomeStatusTitle(record.outcome)}
                            >
                              {formatOutcome(record.outcome)}
                            </span>
                            {isReview && stuckLabels.length > 0 && (
                              <span className="history-unfilled-badge">{stuckLabels.length} unfilled</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    {isSubmittedOutcome(record.outcome) && (
                      <div className="history-app-item__pipeline">
                        {record.pipelineStage && record.pipelineStage !== 'applied' ? (
                          <span className={`s-chip s-chip--${record.pipelineStage === 'response' || record.pipelineStage === 'interview' || record.pipelineStage === 'offer' ? 'success' : record.pipelineStage === 'rejected' || record.pipelineStage === 'ghosted' ? 'error' : 'neutral'}`}>
                            {record.pipelineStage === 'response' ? 'Got response' : record.pipelineStage === 'interview' ? 'Interview' : record.pipelineStage === 'offer' ? 'Offer' : record.pipelineStage === 'rejected' ? 'Rejected' : record.pipelineStage === 'ghosted' ? 'No reply' : record.pipelineStage}
                          </span>
                        ) : null}
                        {stageEditId === record.id ? (
                          <span className="history-stage-picker">
                            {(['response', 'interview', 'offer', 'rejected', 'ghosted'] as const).map((s) => (
                              <button
                                key={s}
                                type="button"
                                className={`btn btn-ghost btn-xs${record.pipelineStage === s ? ' btn-active' : ''}`}
                                disabled={stageUpdatingId === record.id}
                                onClick={() => void updatePipelineStage(record.id, s)}
                              >
                                {s === 'response' ? 'Response' : s === 'interview' ? 'Interview' : s === 'offer' ? 'Offer' : s === 'rejected' ? 'Rejected' : 'No reply'}
                              </button>
                            ))}
                            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setStageEditId(null)}>Cancel</button>
                          </span>
                        ) : (
                          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setStageEditId(record.id)}>
                            {record.pipelineStage && record.pipelineStage !== 'applied' ? 'Change' : 'Track outcome'}
                          </button>
                        )}
                      </div>
                    )}
                    {!isReview && record.detail && (
                      <p className="history-app-item__detail">{record.detail}</p>
                    )}
                    {!isReview && record.reasonSnippet && (
                      <p className="history-app-item__reason">{record.reasonSnippet}</p>
                    )}
                    {isReview && !isSuperseded && (
                      <div className="history-app-item__review-wrap">
                        {stuckLabels.length > 0 && (
                          <details className="history-questions-accordion">
                            <summary className="history-questions-accordion__trigger">
                              Answer {stuckLabels.length} screening question{stuckLabels.length === 1 ? '' : 's'} →
                            </summary>
                            <div className="history-questions-accordion__body">
                              <StuckFieldsPrompt
                                labels={stuckLabels}
                                compact
                                onSave={async (answers) => {
                                  try {
                                    await getLoa().applicantSave({ screeningAnswerCache: answers })
                                    void loadAppHistory()
                                  } catch (e) {
                                    setAppHistoryError('Couldn\u2019t save answers. Try again.')
                                  }
                                }}
                                onNavigateToAnswerBank={onNavigateToAnswerBank}
                              />
                            </div>
                          </details>
                        )}
                        <div className="history-app-item__review-actions">
                          {record.jobUrl && (
                            <ExternalLink href={record.jobUrl} className="btn btn-ghost btn-sm">
                              Open on LinkedIn
                            </ExternalLink>
                          )}
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={appHistoryResolvingId === record.id}
                            aria-busy={appHistoryResolvingId === record.id}
                            aria-label={`Mark ${record.title} as submitted`}
                            onClick={() => void resolveNeedsReview(record, 'submitted')}
                          >
                            {appHistoryResolvingId === record.id ? '…' : 'Mark submitted'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={appHistoryResolvingId === record.id}
                            aria-busy={appHistoryResolvingId === record.id}
                            aria-label={`Mark ${record.title} as failed`}
                            onClick={() => void resolveNeedsReview(record, 'failed')}
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                    {isSuperseded && (
                      <p className="history-app-item__detail muted">A later attempt for this job succeeded — no action needed.</p>
                    )}
                    {!isReview && record.jobUrl && (
                      <div className="history-app-item__meta">
                        <ExternalLink href={record.jobUrl} className="history-app-item__link">
                          View job
                        </ExternalLink>
                      </div>
                    )}
                  </div>
                  )
                })}{hasMore && <div className="history-app-list__show-more"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setAppHistoryVisibleLimit(l => l + 50)}>Show more ({filtered.length - appHistoryVisibleLimit} remaining)</button></div>}</>)})()}
              </div>
              </div>
            )}
          </div>
        )}

        {historyTab === 'campaign' && (
        <div id="history-tab-campaign" className="history-campaign" role="tabpanel" aria-label="Outreach log">
        <div className="log-toolbar">
          <div>
            <h3 className="s-title">Saved history</h3>
          </div>
          <div className="row-actions row-actions--tight">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              title="Reload saved history from disk"
              disabled={!!model.logsBusy || campaignLogRefreshBusy}
              aria-busy={campaignLogRefreshBusy}
              onClick={() => {
                setCampaignLogRefreshBusy(true)
                void (async () => {
                  try {
                    await model.refreshLogs()
                    setLastReloadLabel(
                      new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
                    )
                  } finally {
                    setCampaignLogRefreshBusy(false)
                  }
                })()
              }}
            >
              {campaignLogRefreshBusy ? 'Refreshing\u2026' : 'Refresh'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={handleClearLog}
              disabled={!canClearLog || !!model.logsBusy}
              aria-busy={model.logsBusy === 'clearing'}
            >
              {model.logsBusy === 'clearing' ? 'Clearing\u2026' : clearLogConfirm ? 'Confirm clear?' : 'Clear log'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              aria-label="Export saved history to a file on this computer"
              title="Download saved history as a file on this computer"
              disabled={!!model.logsBusy}
              aria-busy={model.logsBusy === 'exporting'}
              onClick={() => void model.exportLogs()}
            >
              {model.logsBusy === 'exporting' ? 'Exporting\u2026' : 'Export log'}
            </button>
          </div>
        </div>
        <div className="history-campaign__scroll">
        {lastReloadLabel && (
          <p className="muted stack-sm history-last-reload" role="status" aria-live="polite">
            Last reloaded from disk at {lastReloadLabel}.
          </p>
        )}
        {model.historyFeedback && <p className="muted stack-sm" role="status" aria-live="polite">{model.historyFeedback}</p>}

        {model.logs.length > 0 && (
          <div className="v7-stat-pills" role="region" aria-label="Outreach summary">
            <div className="v7-stat-pill"><b>{historyStats.operations}</b><small>Operations</small></div>
            <div className="v7-stat-pill v7-stat-pill--success"><b>{historyStats.success}</b><small>Sent</small></div>
            <div className="v7-stat-pill v7-stat-pill--danger"><b>{historyStats.error}</b><small>Failed</small></div>
            <div className="v7-stat-pill"><b>{historyStats.skip}</b><small>Skipped</small></div>
            {historyStats.people > 0 && <div className="v7-stat-pill"><b>{historyStats.people}</b><small>People</small></div>}
            {historyStats.jobs > 0 && <div className="v7-stat-pill"><b>{historyStats.jobs}</b><small>Jobs</small></div>}
          </div>
        )}

        {model.logs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon" aria-hidden="true">{'\u2261'}</div>
            <h3 className="empty-state__title">No activity yet</h3>
            <button type="button" className="btn btn-ghost btn-sm mt-sm" disabled={!!model.logsBusy} aria-busy={!!model.logsBusy} onClick={() => void model.refreshLogs()}>
              {model.logsBusy ? 'Loading\u2026' : 'Reload from disk'}
            </button>
          </div>
        ) : (
          <>
            <details className="section--collapsible" open={historyFilter !== 'all'}>
              <summary className="section__toggle">
                Filter{historyFilter !== 'all' ? `: ${historyFilter === 'success' ? 'Sent' : historyFilter === 'error' ? 'Failed' : historyFilter === 'skip' ? 'Skipped' : historyFilter === 'jobs' ? 'Job searches' : 'Info'}` : ''}
              </summary>
              <div className="history-filter" role="group" aria-label="Filter history entries">
                {(
                  [
                    { id: 'all' as const, label: 'All' },
                    { id: 'success' as const, label: 'Sent' },
                    { id: 'error' as const, label: 'Failed' },
                    { id: 'skip' as const, label: 'Skipped' },
                    { id: 'info' as const, label: 'Info' },
                    { id: 'jobs' as const, label: 'Job searches' }
                  ] as const
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={`history-filter__btn ${historyFilter === id ? 'history-filter__btn--active' : ''}`}
                    aria-pressed={historyFilter === id}
                    onClick={() => setHistoryFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </details>
            {filteredDayGroups.length === 0 ? (
              <div className="empty-state empty-state--compact mt-sm">
                <div className="empty-state__icon" aria-hidden="true">{'\u2315'}</div>
                <h3 className="empty-state__title">No entries match this filter</h3>
                <p className="empty-state__body">Try another filter or show every saved entry.</p>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHistoryFilter('all')}>
                  Show all
                </button>
              </div>
            ) : (
              <>
            
            <div
              className="history-by-day"
              aria-label="Activity by calendar day, newest first"
              aria-live="polite"
            >
            {filteredDayGroups.map((group) => {
              const headingId = `history-day-${group.dayKey.replace(/[^a-z0-9-]/gi, '-')}`
              const n = group.rows.length
              const entryWord = n === 1 ? 'entry' : 'entries'
              const dayTitle = formatHistoryDayHeading(group.dayKey)
              const relativeDay = dayTitle === 'Today' || dayTitle === 'Yesterday' || dayTitle === 'No timestamp'
              return (
              <section key={group.dayKey} className="history-day-group" aria-labelledby={headingId}>
                <div className="history-day-group__header">
                  <h3 id={headingId} className="history-day-group__title">
                    {dayTitle}
                  </h3>
                  <p className="history-day-group__meta">
                    {n} {entryWord}
                    {relativeDay ? (
                      <>
                        <span className="history-day-group__meta-sep" aria-hidden="true">
                          {' · '}
                        </span>
                        <span>{formatHistoryDayCalendarLine(group.dayKey)}</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="history-entries history-entries--by-day" role="list">
                  {group.rows.map(({ entry, line, index: i }) => {
                    const stableKey = `${group.dayKey}-${i}`
                    return (
                      <div key={stableKey} className={`history-entry history-entry--${entry.category}`} role="listitem" style={{ animationDelay: `${Math.min(i * 0.03, 0.5)}s` }}>
                        <span className="history-entry__icon" aria-hidden="true">{LOG_ICON[entry.category]}</span>
                        <div className="history-entry__body">
                          <strong>{entry.title}</strong>
                          {entry.detail && <p>{entry.detail}</p>}
                          {entry.meta.length > 0 && (
                            <div className="history-entry__meta">
                              {entry.meta.map((item) => (
                                <span key={`${stableKey}-${item}`}>{item}</span>
                              ))}
                            </div>
                          )}
                          {entry.linkUrl && (
                            <ExternalLink href={entry.linkUrl} className="history-entry__link">
                              {entry.linkLabel}
                            </ExternalLink>
                          )}
                        </div>

                        {entry.people.length > 0 && (
                          <details className="history-entry__collection">
                            <summary>
                              Show {countLabel(entry.people.length, 'person', 'people')} saved here
                            </summary>
                            <div className="history-result-list" role="list" aria-label={`People found for ${entry.title}`}>
                              {entry.people.map((person, idx) => (
                                <ExternalLink
                                  key={`${stableKey}-person-${person.profileUrl || idx}`}
                                  href={person.profileUrl}
                                  className="history-result-card"
                                  role="listitem"
                                >
                                  <div className="history-result-card__top">
                                    <strong>{person.name}</strong>
                                    {person.company && <span>{person.company}</span>}
                                  </div>
                                  {person.headline && <p>{person.headline}</p>}
                                </ExternalLink>
                              ))}
                            </div>
                          </details>
                        )}

                        {entry.jobs.length > 0 && (
                          <details className="history-entry__collection">
                            <summary>Show {countLabel(entry.jobs.length, 'job')} saved here</summary>
                            <div className="history-result-list" role="list" aria-label={`Jobs found for ${entry.title}`}>
                              {entry.jobs.map((job, idx) => (
                                <ExternalLink
                                  key={`${stableKey}-job-${job.jobUrl || idx}`}
                                  href={job.jobUrl}
                                  className="history-result-card"
                                  role="listitem"
                                >
                                  <div className="history-result-card__top">
                                    <strong>{job.title || 'Untitled role'}</strong>
                                    {job.score != null && job.score > 0 && <span className="history-result-card__score">Score {job.score}</span>}
                                  </div>
                                  <span className="history-result-card__company">{[job.company, job.location].filter(Boolean).join(' • ')}</span>
                                  {job.reason && <p>{job.reason}</p>}
                                  {job.nextStep && <p className="history-result-card__next-step">{job.nextStep}</p>}
                                  {job.postedDate && <span className="history-result-card__meta">Posted: {job.postedDate}</span>}
                                </ExternalLink>
                              ))}
                            </div>
                          </details>
                        )}

                        
                      </div>
                    )
                  })}
                </div>
              </section>
              )
            })}
            </div>
              </>
            )}
          </>
        )}
        </div>
        </div>
        )}
      </div>
    </div>
  )
}
