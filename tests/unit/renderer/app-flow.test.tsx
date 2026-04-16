/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../../src/renderer/src/App'

const mockSettings = {
  seenOnboarding: true,
  bridgePort: 19511,
  llmProvider: 'grok',
  llmBaseUrl: 'http://127.0.0.1:8000',
  llmModel: 'grok-4.1-fast',
  llmEnabled: true,
  lastExecutionId: 'generic_connection',
  templates: ['Hello {firstName}'],
  mustInclude: [],
  dailyCap: 20,
  sessionBreaksEnabled: true,
  sessionBreakEveryMin: 5,
  sessionBreakEveryMax: 8,
  sessionBreakDurationMin: 2,
  sessionBreakDurationMax: 5,
  delayBetweenRequestsMin: 45,
  delayBetweenRequestsMax: 90,
  delayBetweenActionsMin: 1,
  delayBetweenActionsMax: 3,
  resumeFileName: 'resume.pdf'
}

function createLoa(overrides?: {
  bridgeStatus?: { port: number; extensionConnected: boolean; activeLinkedInTab?: boolean }
  bridgePing?: { ok: boolean; detail: string }
}) {
  return {
    settingsGet: vi.fn().mockResolvedValue({ ...mockSettings }),
    settingsSave: vi.fn().mockImplementation(async (partial: Record<string, unknown>) => ({
      ...mockSettings,
      ...partial,
      templates: Array.isArray(partial.templates) ? partial.templates : mockSettings.templates
    })),
    settingsSaveBundle: vi.fn().mockImplementation(
      async (payload: { settings: Record<string, unknown>; apiKey?: string | null }) => ({
        ...mockSettings,
        ...payload.settings,
        templates: Array.isArray(payload.settings.templates)
          ? payload.settings.templates
          : mockSettings.templates,
        apiKeyPresent: !!String(payload.apiKey || '').trim()
      })
    ),
    settingsSetApiKey: vi.fn().mockResolvedValue(undefined),
    missionPlan: vi.fn().mockResolvedValue({
      ok: true,
      title: 'Hedge fund hiring plan',
      summary: 'Target recruiters and hiring managers at hedge funds.',
      executionId: 'job_signal_connection',
      executionLabel: 'Hiring / role signal',
      searchQuery: 'hedge fund recruiter OR hiring manager',
      searchUrl:
        'https://www.linkedin.com/search/results/people/?keywords=hedge%20fund%20recruiter%20OR%20hiring%20manager&origin=SWITCH_SEARCH_VERTICAL',
      csvSeed: 'profileUrl,firstName,company,headline\n',
      templates: ['Hi {firstName} - would love to connect regarding hiring needs at {company}.'],
      mustInclude: [],
      nextStep: 'Find people from this plan, review the imported list, then press Start run.',
      route: 'llm',
      detail: 'provider:grok'
    }),
    composePreview: vi.fn().mockImplementation(async (payload?: { target?: { profileUrl?: string; firstName?: string; company?: string; headline?: string } }) => {
      const target = payload?.target ?? {
        profileUrl: 'https://www.linkedin.com/in/demo-avery-chen/',
        firstName: 'Avery',
        company: 'Northbridge Labs',
        headline: 'VP Product'
      }
      return {
        ok: true,
        body: `Hello ${target.firstName || 'Avery'}`,
        variant: 'T0-llm',
        route: 'llm',
        detail: 'provider:grok',
        sampleTarget: {
          profileUrl: target.profileUrl || 'https://www.linkedin.com/in/demo-avery-chen/',
          firstName: target.firstName || 'Avery',
          company: target.company || 'Northbridge Labs',
          headline: target.headline || 'VP Product'
        }
      }
    }),
    authGetServiceConfig: vi.fn().mockResolvedValue({
      firebase: { apiKey: '', authDomain: '', projectId: '', appId: '' },
      hasBackend: false,
    }),
    bridgeStatus: vi.fn().mockResolvedValue(
      overrides?.bridgeStatus ?? { port: 19511, extensionConnected: true, activeLinkedInTab: true }
    ),
    bridgePing: vi.fn().mockResolvedValue(overrides?.bridgePing ?? { ok: true, detail: 'ok' }),
    collectProspectsFromPlan: vi.fn().mockResolvedValue({
      ok: true,
      searchUrl:
        'https://www.linkedin.com/search/results/people/?keywords=hedge%20fund%20recruiter%20OR%20hiring%20manager&origin=SWITCH_SEARCH_VERTICAL',
      csvText: [
        'profileUrl,firstName,company,headline',
        'https://www.linkedin.com/in/hedge-fund-recruiter/,Taylor,Harbor Peak Capital,Head of Talent'
      ].join('\n'),
      count: 1
    }),
    logsRecent: vi.fn().mockResolvedValue([]),
    runtimeLogTail: vi.fn().mockResolvedValue({ ok: true, lines: [] }),
    onRuntimeLogLine: vi.fn().mockReturnValue(() => {}),
    logsExport: vi.fn().mockResolvedValue({ ok: false, canceled: true }),
    queueState: vi.fn().mockResolvedValue({
      running: false,
      currentIndex: 0,
      total: 0,
      lastProfileUrl: '',
      lastDetail: '',
      error: null,
      completedAt: null
    }),
    queueStart: vi.fn().mockResolvedValue({ ok: true }),
    queueStop: vi.fn().mockResolvedValue({ ok: true }),
    onQueueTick: vi.fn().mockReturnValue(() => {}),
    onBridgeActivity: vi.fn().mockReturnValue(() => {}),
    jobsProgressState: vi.fn().mockResolvedValue(null),
    onJobsProgress: vi.fn().mockReturnValue(() => {}),
    openExtensionFolder: vi.fn().mockResolvedValue(''),
    openUserData: vi.fn().mockResolvedValue(undefined),
    applicationHistory: vi.fn().mockResolvedValue({ ok: true, records: [], insights: {} }),
    applicationQueueState: vi.fn().mockResolvedValue({ ok: true, state: { items: [], running: false, currentIndex: 0 } }),
    onApplyQueueTick: vi.fn().mockReturnValue(() => {}),
    applicantGet: vi.fn().mockResolvedValue({
      ok: true,
      profile: {
        basics: { fullName: 'Test User', email: 'test@example.com', phone: '555-0100' },
        assets: [{ kind: 'resume', fileName: 'resume.pdf' }],
        links: {},
        workAuth: {},
        compensation: {},
        background: {
          educationHistory: [{ school: 'MIT', degree: 'BS', field: 'CS', year: 2020 }],
          workHistory: [{ title: 'Engineer', company: 'Acme', startYear: 2020, endYear: null }],
        },
        screeningAnswerCache: {}
      }
    }),
    followUpState: vi.fn().mockResolvedValue({ ok: false }),
    followupPendingQueue: vi.fn().mockResolvedValue({ items: [] })
  }
}

/** Default panel is Apply (formerly Jobs); campaign wizard lives under the Connect tab. */
function goToCampaignTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'Outreach' }))
}

function goToJobsTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'Jobs' }))
}

/** Node / Vitest can expose `localStorage` without a working `getItem` (e.g. partial polyfill). Tab panels read prefs on mount. */
function installWorkingLocalStorage(): void {
  let store: Record<string, string> = {}
  const api: Storage = {
    get length() {
      return Object.keys(store).length
    },
    clear() {
      store = {}
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null
    },
    removeItem(key: string) {
      delete store[key]
    },
    setItem(key: string, value: string) {
      store[key] = String(value)
    }
  }
  Object.defineProperty(globalThis, 'localStorage', { value: api, configurable: true, writable: true })
}

describe('Wizard flow', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    installWorkingLocalStorage()
    delete window.loa
    global.fetch = originalFetch
    try {
      localStorage.clear()
    } catch {
      /* ignore */
    }
  })

  afterEach(() => {
    cleanup()
    global.fetch = originalFetch
    delete window.loa
  })

  it('shows desktop-app blocker when not in Electron', async () => {
    delete window.loa
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      ok: false,
      status: 0,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('')
    }))
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText(/Open the LinkinReachly app window/)).toBeTruthy()
    })
  })

  it('auto-advances from Connect to Goal when Chrome is ready', async () => {
    const loa = createLoa()
    window.loa = loa as unknown as Window['loa']
    render(<App />)

    await waitFor(() => {
      expect(loa.settingsGet).toHaveBeenCalled()
    })

    goToCampaignTab()
    await waitFor(() => {
      expect(screen.getByText('Who do you want to reach?')).toBeTruthy()
    })
  })

  it('preserves Apply search field values when switching to Connect and back', async () => {
    const loa = createLoa()
    window.loa = loa as unknown as Window['loa']
    render(<App />)

    await waitFor(() => {
      expect(loa.settingsGet).toHaveBeenCalled()
    })

    const kw = screen.getByRole('textbox', { name: /Job title, keywords, or LinkedIn URL/i })
    fireEvent.change(kw, { target: { value: 'pm' } })
    const loc = screen.getByRole('textbox', { name: /^Location$/i })
    fireEvent.change(loc, { target: { value: 'sf' } })

    goToCampaignTab()
    await waitFor(() => {
      expect(screen.getByText('Who do you want to reach?')).toBeTruthy()
    })

    goToJobsTab()
    await waitFor(() => {
      const kwBack = screen.getByRole('textbox', { name: /Job title, keywords, or LinkedIn URL/i }) as HTMLInputElement
      const locBack = screen.getByRole('textbox', { name: /^Location$/i }) as HTMLInputElement
      expect(kwBack.value).toBe('pm')
      expect(locBack.value).toBe('sf')
    })
  })

  it('stays on Connect step when extension is offline', async () => {
    const loa = createLoa({
      bridgeStatus: { port: 19511, extensionConnected: false },
      bridgePing: { ok: false, detail: 'open_a_linkedin_tab' }
    })
    window.loa = loa as unknown as Window['loa']
    render(<App />)

    await waitFor(() => {
      expect(loa.settingsGet).toHaveBeenCalled()
    })

    goToCampaignTab()
    await waitFor(() => {
      expect(screen.getAllByText('Connect LinkinReachly to Chrome').length).toBeGreaterThan(0)
    })
  })

  it('builds a plan from the Goal step', async () => {
    const loa = createLoa()
    window.loa = loa as unknown as Window['loa']
    render(<App />)

    await waitFor(() => {
      expect(loa.settingsGet).toHaveBeenCalled()
    })

    goToCampaignTab()
    fireEvent.change(screen.getByLabelText('Your goal'), {
      target: { value: 'Connect with hedge fund hiring managers and recruiters.' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Plan only/i }))

    await waitFor(() => {
      expect(loa.missionPlan).toHaveBeenCalled()
    })

    expect(screen.getByText('Hedge fund hiring plan')).toBeTruthy()
    expect(screen.getByText('Next: review message')).toBeTruthy()
  })

  it('navigates to Review step and shows message editor', async () => {
    const loa = createLoa()
    window.loa = loa as unknown as Window['loa']
    render(<App />)

    await waitFor(() => {
      expect(loa.settingsGet).toHaveBeenCalled()
    })

    goToCampaignTab()
    fireEvent.change(screen.getByLabelText('Your goal'), {
      target: { value: 'Connect with hedge fund hiring managers.' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Plan only/i }))

    await waitFor(() => {
      expect(loa.missionPlan).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByText('Next: review message'))

    expect(screen.getByText('Review your message')).toBeTruthy()
    expect(screen.getByLabelText('Connection note')).toBeTruthy()
  })

  it('shows exact send preview for one selected person and passes a message override into the run', async () => {
    const loa = createLoa()
    window.loa = loa as unknown as Window['loa']
    render(<App />)

    await waitFor(() => {
      expect(loa.settingsGet).toHaveBeenCalled()
    })

    goToCampaignTab()
    fireEvent.change(screen.getByLabelText('Your goal'), {
      target: { value: 'Connect with hedge fund hiring managers.' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Plan only/i }))

    await waitFor(() => {
      expect(loa.missionPlan).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByText('Next: review message'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Send' }))
    fireEvent.click(screen.getByRole('button', { name: /Find people from plan/i }))

    await waitFor(() => {
      expect(loa.collectProspectsFromPlan).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(loa.composePreview).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({
            profileUrl: 'https://www.linkedin.com/in/hedge-fund-recruiter/'
          })
        })
      )
    })

    await waitFor(() => {
      expect(screen.getByText(/Preview for/i)).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /Send to 1 person/i }))

    await waitFor(() => {
      expect(loa.queueStart).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: [
            expect.objectContaining({
              profileUrl: 'https://www.linkedin.com/in/hedge-fund-recruiter/'
            })
          ]
        })
      )
    })
  })

  it('shows Settings panel when clicking Settings button', async () => {
    const loa = createLoa()
    window.loa = loa as unknown as Window['loa']
    render(<App />)

    await waitFor(() => {
      expect(loa.settingsGet).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(screen.getAllByText(/AI Outreach/).length).toBeGreaterThan(0)
  })

  it('shows History panel when clicking History button', async () => {
    const loa = createLoa()
    window.loa = loa as unknown as Window['loa']
    render(<App />)

    await waitFor(() => {
      expect(loa.settingsGet).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    await waitFor(() => {
      const tab = screen.getByRole('tab', { name: 'History' })
      expect(tab.getAttribute('aria-selected')).toBe('true')
    })
  })
})
