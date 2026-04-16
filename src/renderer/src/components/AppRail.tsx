import { useState } from 'react'

type ActivePanel = 'jobs' | 'connect' | 'history' | 'settings' | 'dashboard'

const SETTINGS_SCROLL_MAP: Record<string, string> = {
  ai: 'settings-ai',
  limits: 'settings-limits',
  answers: 'settings-answer-bank',
  data: 'settings-backup',
}

const MAIN_SCROLL_SELECTOR = '.app-shell__main-wrap .main'

function scrollSettingsSectionIntoView(elementId: string) {
  const el = document.getElementById(elementId)
  if (!el) return
  if (el.tagName === 'DETAILS' && !(el as HTMLDetailsElement).open) {
    ;(el as HTMLDetailsElement).open = true
  }
  const scrollRoot = document.querySelector<HTMLElement>(MAIN_SCROLL_SELECTOR)
  if (scrollRoot) {
    const rootRect = scrollRoot.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const pad = 12
    const top = elRect.top - rootRect.top + scrollRoot.scrollTop - pad
    scrollRoot.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  } else {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

type Props = {
  activePanel: ActivePanel
  jobsSubView?: 'results' | 'queue'
  onJobsSubViewChange?: (view: 'results' | 'queue') => void
  connectStep?: string
  onConnectStepChange?: (step: string) => void
  connectCompletedSteps?: ReadonlySet<string>
  connectSubView?: 'outreach' | 'followup'
  onConnectSubViewChange?: (view: 'outreach' | 'followup') => void
  historySubView?: 'apps' | 'outreach'
  onHistorySubViewChange?: (view: 'apps' | 'outreach') => void
  appliedToday?: number
  applyCap?: number
  queuedCount?: number
  weeklyOutreachSent?: number
  userName?: string
}

const RAIL_CONFIG: Record<ActivePanel, {
  heading: string
  items: Array<{ id: string; label: string; divider?: boolean }>
}> = {
  jobs: { heading: 'Jobs', items: [{ id: 'results', label: 'Search' }, { id: 'queue', label: 'Ready to apply' }] },
  connect: { heading: 'Outreach', items: [{ id: 'goal', label: 'Who to reach' }, { id: 'review', label: 'Message' }, { id: 'send', label: 'Send' }, { id: 'done', label: 'Results' }, { id: '__followup_divider', label: '', divider: true }, { id: 'followup', label: 'Follow Up' }] },
  dashboard: { heading: 'Dashboard', items: [] },
  history: { heading: 'History', items: [{ id: 'apps', label: 'Applications' }, { id: 'outreach', label: 'Outreach log' }] },
  settings: { heading: 'Settings', items: [{ id: 'ai', label: 'AI Outreach' }, { id: 'limits', label: 'Speed & Limits' }, { id: 'answers', label: 'Saved Answers' }, { id: 'data', label: 'Backup & Data' }] },
}

const CONNECT_STEP_ORDER = ['goal', 'review', 'send', 'done']

function connectStepState(itemId: string, activeStep: string, completedSteps?: ReadonlySet<string>): 'done' | 'active' | 'pending' {
  const normalizedStep = activeStep === 'connect' ? 'goal' : activeStep
  const activeIdx = CONNECT_STEP_ORDER.indexOf(normalizedStep)
  const itemIdx = CONNECT_STEP_ORDER.indexOf(itemId)
  if (itemIdx < 0 || activeIdx < 0) return 'pending'
  if (itemIdx === activeIdx) return 'active'
  if (completedSteps) return completedSteps.has(itemId) ? 'done' : 'pending'
  if (itemIdx < activeIdx) return 'done'
  return 'pending'
}

export function AppRail({
  activePanel,
  jobsSubView = 'results',
  onJobsSubViewChange,
  connectStep = 'goal',
  onConnectStepChange,
  connectCompletedSteps,
  connectSubView = 'outreach',
  onConnectSubViewChange,
  historySubView = 'apps',
  onHistorySubViewChange,
  appliedToday = 0,
  applyCap = 25,
  queuedCount = 0,
  weeklyOutreachSent,
  userName,
}: Props) {
  const config = RAIL_CONFIG[activePanel]
  const cap = Math.max(1, applyCap)
  const pct = Math.min(100, Math.round((appliedToday / cap) * 100))

  const [settingsActive, setSettingsActive] = useState('ai')

  const normalizedConnectStep = connectStep === 'connect' ? 'goal' : connectStep
  const activeSubId = activePanel === 'jobs' ? jobsSubView
    : activePanel === 'connect' ? (connectSubView === 'followup' ? 'followup' : normalizedConnectStep)
    : activePanel === 'history' ? historySubView
    : settingsActive

  const handleItemClick = (id: string) => {
    if (activePanel === 'jobs' && onJobsSubViewChange) {
      onJobsSubViewChange(id as 'results' | 'queue')
    } else if (activePanel === 'history' && onHistorySubViewChange) {
      onHistorySubViewChange(id as 'apps' | 'outreach')
    } else if (activePanel === 'settings') {
      setSettingsActive(id)
      const elId = SETTINGS_SCROLL_MAP[id]
      if (elId) {
        requestAnimationFrame(() => scrollSettingsSectionIntoView(elId))
      }
    } else if (activePanel === 'connect') {
      if (id === 'followup') {
        onConnectSubViewChange?.('followup')
      } else {
        onConnectSubViewChange?.('outreach')
        onConnectStepChange?.(id)
      }
    }
  }

  return (
    <aside className="app-rail" aria-label={`${config.heading} workspace`}>
      <div className="app-rail__head">{config.heading}</div>
      <nav className="app-rail__nav">
        {config.items.map((item) => {
          if (item.divider) {
            return <div key={item.id} className="app-rail__divider"><span>{item.label}</span></div>
          }
          const isConnect = activePanel === 'connect'
          const isWizardStep = isConnect && CONNECT_STEP_ORDER.includes(item.id)
          const stepState = isWizardStep ? connectStepState(item.id, connectStep, connectCompletedSteps) : null
          const isActive = activeSubId === item.id
          const cls = [
            'app-rail__btn',
            isActive ? 'app-rail__btn--active' : '',
            stepState === 'done' ? 'app-rail__btn--done' : '',
            stepState === 'pending' && !isActive ? 'app-rail__btn--pending' : ''
          ].filter(Boolean).join(' ')
          return (
            <button
              key={item.id}
              type="button"
              className={cls}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => handleItemClick(item.id)}
            >
              {stepState === 'done' && <span aria-hidden="true">{'\u2713'} </span>}
              {item.label}
            </button>
          )
        })}
      </nav>

      {activePanel === 'jobs' && (
        <div className="app-rail__footer">
          <div className="app-rail__footer-label">Daily goal</div>
          <div className="app-rail__progress-track">
            <div className="app-rail__progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="app-rail__stats">
            <span>{queuedCount} saved</span>
            <span>{appliedToday} applied</span>
          </div>
        </div>
      )}

      {activePanel !== 'jobs' && weeklyOutreachSent != null && (
        <div className="app-rail__footer">
          <div className="app-rail__footer-label">{weeklyOutreachSent} invites sent this week</div>
        </div>
      )}

      <div className="app-rail__profile">
        <div className="app-rail__profile-avatar" aria-hidden="true" />
        <div style={{ minWidth: 0 }}>
          <div className="app-rail__profile-name">{userName || 'User'}</div>
        </div>
      </div>
    </aside>
  )
}
