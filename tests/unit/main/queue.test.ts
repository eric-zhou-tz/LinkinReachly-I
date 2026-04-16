import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'

const mockSendCommand = vi.fn()
const mockComposeMessageDetailed = vi.fn()
const mockAppendMainLog = vi.fn()
const mockAppendSentToday = vi.fn()
const mockLoadCompletedConnectionInviteProfileKeys = vi.fn()
const mockLoadRecentConnectionInvites = vi.fn()
const mockLoadSentToday = vi.fn()
const mockTodayCount = vi.fn()
const mockLoadSettings = vi.fn()
const mockGetFollowupStage = vi.fn()
const mockRecordFollowupSent = vi.fn()

const { EventEmitter } = await import('node:events')
const mockBridgeEvents = new EventEmitter()
mockBridgeEvents.setMaxListeners(0)

vi.mock('../../../src/main/bridge', () => ({
  sendCommand: mockSendCommand,
  bridgeEvents: mockBridgeEvents,
  isExtensionConnected: () => true
}))

vi.mock('../../../src/main/llm', () => ({
  composeMessageDetailed: mockComposeMessageDetailed,
  linkedInPeopleSearchUrl: (query: string) =>
    `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`
}))

vi.mock('../../../src/main/logger', () => ({
  appendMainLog: mockAppendMainLog,
  appendSentToday: mockAppendSentToday,
  loadCompletedConnectionInviteProfileKeys: mockLoadCompletedConnectionInviteProfileKeys,
  loadRecentConnectionInvites: mockLoadRecentConnectionInvites,
  loadLogHistory: vi.fn().mockReturnValue([]),
  loadSentToday: mockLoadSentToday,
  todayCount: mockTodayCount,
  thisWeekConnectionCount: vi.fn().mockReturnValue(0)
}))

vi.mock('../../../src/main/followup-state', () => ({
  getFollowupStage: mockGetFollowupStage,
  recordFollowupSent: mockRecordFollowupSent
}))

vi.mock('../../../src/main/sequence-state', () => ({
  upsertSequenceTarget: vi.fn(),
  advanceStage: vi.fn(),
  getSequenceTarget: vi.fn().mockReturnValue(null)
}))

vi.mock('../../../src/main/settings', () => ({
  loadSettings: mockLoadSettings
}))

vi.mock('../../../src/main/telemetry', () => ({
  trackOutreachSent: vi.fn()
}))

async function importQueue() {
  vi.resetModules()
  return import('../../../src/main/queue')
}

function baseSettings() {
  return {
    seenOnboarding: true,
    bridgePort: 19511,
    llmProvider: 'grok',
    llmBaseUrl: 'http://127.0.0.1:8000',
    llmModel: 'grok-4.1-fast',
    llmEnabled: true,
    llmMode: 'bundled' as const,
    apiKeyStored: null,
    apiKeyIsEncrypted: false,
    lastExecutionId: 'generic_connection',
    templates: ['Hi {firstName}'],
    mustInclude: [],
    dailyCap: 20,
    sessionBreaksEnabled: false,
    sessionBreakEveryMin: 5,
    sessionBreakEveryMax: 8,
    sessionBreakDurationMin: 2,
    sessionBreakDurationMax: 5,
    delayBetweenRequestsMin: 0,
    delayBetweenRequestsMax: 0,
    delayBetweenActionsMin: 0,
    delayBetweenActionsMax: 0,
    jobsSearchRecencySeconds: 86400, jobsSearchSortBy: "DD" as const, jobsSearchDistanceMiles: 0, jobsSearchExperienceLevels: [], jobsSearchJobTypes: [], jobsSearchRemoteTypes: [], jobsSearchSalaryFloor: 0, jobsSearchFewApplicants: false, jobsSearchVerifiedOnly: false, jobsSearchEasyApplyOnly: true, jobsScreeningCriteria: "", customOutreachPrompt: ""
  }
}

function stageEntries() {
  return mockAppendMainLog.mock.calls
    .map(([entry]) => entry)
    .filter((entry) => entry.eventType === 'outreach_stage')
}

describe('runQueue', () => {
  beforeEach(() => {
    mockSendCommand.mockReset()
    mockComposeMessageDetailed.mockReset()
    mockAppendMainLog.mockReset()
    mockAppendSentToday.mockReset()
    mockLoadCompletedConnectionInviteProfileKeys.mockReset()
    mockLoadRecentConnectionInvites.mockReset()
    mockLoadSentToday.mockReset()
    mockTodayCount.mockReset()
    mockLoadSettings.mockReset()
    mockGetFollowupStage.mockReset()
    mockRecordFollowupSent.mockReset()

    mockComposeMessageDetailed.mockResolvedValue({ body: 'Hi Sam', variant: 'T0', route: 'template' })
    mockLoadCompletedConnectionInviteProfileKeys.mockReturnValue(new Set())
    mockLoadRecentConnectionInvites.mockReturnValue([])
    mockLoadSentToday.mockReturnValue({ date: '2026-03-27', urls: [] })
    mockTodayCount.mockReturnValue(0)
    mockLoadSettings.mockReturnValue(baseSettings())
    mockGetFollowupStage.mockReturnValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips targets already completed in the log history', async () => {
    mockLoadCompletedConnectionInviteProfileKeys.mockReturnValue(new Set(['/in/sam']))
    const { runQueue } = await importQueue()

    await runQueue([{ profileUrl: 'https://www.linkedin.com/in/sam/' }])

    expect(mockSendCommand).not.toHaveBeenCalled()
    expect(mockAppendMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        profileUrl: 'https://www.linkedin.com/in/sam/',
        status: 'skipped',
        detail: 'already_completed_in_log'
      })
    )
  })

  it('verifies pending state before marking a send as successful', async () => {
    vi.useFakeTimers()
    mockSendCommand.mockImplementation(async (action) => {
      switch (action) {
        case 'NAVIGATE':
          return { ok: true, detail: 'navigated' }
        case 'EXTRACT_PROFILE':
          return { ok: true, detail: 'extracted', data: { firstName: 'Sam', company: 'Acme' } }
        case 'CLICK_CONNECT_2ND':
          return { ok: true, detail: 'clicked_connect_2nd' }
        case 'CLICK_ADD_NOTE':
          return { ok: true, detail: 'clicked_add_note' }
        case 'TYPE_NOTE':
          return { ok: true, detail: 'typed_42' }
        case 'CLICK_SEND':
          return { ok: true, detail: 'clicked_send' }
        case 'CHECK_ERROR_TOAST':
          return { ok: true, detail: 'no_error_toast' }
        case 'VERIFY_PENDING':
          return { ok: true, detail: 'pending_visible' }
        default:
          throw new Error(`Unexpected action: ${action}`)
      }
    })

    const { runQueue } = await importQueue()
    const promise = runQueue([{ profileUrl: 'https://www.linkedin.com/in/sam/' }])
    await vi.runAllTimersAsync()
    await promise

    expect(mockSendCommand).toHaveBeenCalledWith('VERIFY_PENDING', {})
    expect(mockAppendSentToday).toHaveBeenCalledWith('https://www.linkedin.com/in/sam/')
    expect(mockAppendMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        profileUrl: 'https://www.linkedin.com/in/sam/',
        status: 'sent',
        detail: 'pending_visible'
      })
    )
  })

  it('uses a separate daily ledger for follow-up sends', async () => {
    mockLoadSettings.mockReturnValue({
      ...baseSettings(),
      lastExecutionId: 'post_accept_followup'
    })
    mockLoadRecentConnectionInvites.mockReturnValue([
      {
        profileUrl: 'https://www.linkedin.com/in/sam/',
        name: 'Sam Example',
        company: 'Acme',
        status: 'sent',
        detail: 'pending_visible',
        timestamp: '2026-03-27T12:00:00.000Z',
        executionId: 'ria_connection',
        logChannel: 'ria',
        entryKind: 'connection_invite'
      }
    ])
    mockSendCommand.mockImplementation(async (action) => {
      switch (action) {
        case 'NAVIGATE':
          return { ok: true, detail: 'navigated' }
        case 'EXTRACT_CONNECTIONS':
          return {
            ok: true,
            detail: 'connections_1',
            data: {
              items: [
                {
                  profileUrl: 'https://www.linkedin.com/in/sam/',
                  displayName: 'Sam Example',
                  path: '/in/sam'
                }
              ]
            }
          }
        case 'CLICK_MESSAGE_FOR_PROFILE':
          return { ok: true, detail: 'clicked_message' }
        case 'TYPE_CONVERSATION':
          return { ok: true, detail: 'typed_dm_12' }
        case 'CLICK_SEND_CONVERSATION':
          return { ok: true, detail: 'clicked_send_conversation' }
        default:
          throw new Error(`Unexpected action: ${action}`)
      }
    })

    const { runQueue } = await importQueue()
    await runQueue([])

    expect(mockComposeMessageDetailed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ profileUrl: 'https://www.linkedin.com/in/sam/' }),
      expect.anything(),
      expect.objectContaining({ executionId: 'ria_connection', forFollowUp: true })
    )
    expect(mockTodayCount).toHaveBeenCalled()
    expect(mockAppendSentToday).toHaveBeenCalledWith('https://www.linkedin.com/in/sam/', 'followup_dm')
    expect(mockRecordFollowupSent).toHaveBeenCalledWith('https://www.linkedin.com/in/sam/', 'ria_connection', 1)
    expect(mockAppendMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        profileUrl: 'https://www.linkedin.com/in/sam/',
        sourceExecutionId: 'ria_connection',
        sourceLogChannel: 'ria'
      })
    )
  })

  it('records a skipped stage when no follow-up targets are pending', async () => {
    mockLoadSettings.mockReturnValue({
      ...baseSettings(),
      lastExecutionId: 'post_accept_followup'
    })

    const { runQueue } = await importQueue()
    await runQueue([])

    expect(stageEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'outreach_stage',
          stageCode: 'load_pending_followups',
          stageStatus: 'skipped',
          detail: 'no_pending_connection_invites'
        })
      ])
    )
  })

  it('resolves a name-only target through LinkedIn search before sending', async () => {
    vi.useFakeTimers()
    mockSendCommand.mockImplementation(async (action, payload) => {
      switch (action) {
        case 'NAVIGATE':
          return { ok: true, detail: String(payload?.url || '').includes('/search/results/people/') ? 'searched' : 'navigated' }
        case 'EXTRACT_SEARCH_RESULTS':
          return {
            ok: true,
            detail: 'search_results_1',
            data: {
              items: [
                {
                  profileUrl: 'https://www.linkedin.com/in/jane-doe/',
                  displayName: 'Jane Doe',
                  firstName: 'Jane',
                  company: 'Acme Capital',
                  headline: 'Partner'
                }
              ]
            }
          }
        case 'EXTRACT_PROFILE':
          return { ok: true, detail: 'extracted', data: { firstName: 'Jane', company: 'Acme Capital' } }
        case 'CLICK_CONNECT_2ND':
          return { ok: true, detail: 'clicked_connect_2nd' }
        case 'CLICK_ADD_NOTE':
          return { ok: true, detail: 'clicked_add_note' }
        case 'TYPE_NOTE':
          return { ok: true, detail: 'typed_42' }
        case 'CLICK_SEND':
          return { ok: true, detail: 'clicked_send' }
        case 'CHECK_ERROR_TOAST':
          return { ok: true, detail: 'no_error_toast' }
        case 'VERIFY_PENDING':
          return { ok: true, detail: 'pending_visible' }
        default:
          throw new Error(`Unexpected action: ${action}`)
      }
    })

    const { runQueue } = await importQueue()
    const promise = runQueue([{ profileUrl: '', personName: 'Jane Doe', company: 'Acme Capital', searchQuery: 'Jane Doe Acme Capital' }])
    await vi.runAllTimersAsync()
    await promise

    expect(mockSendCommand).toHaveBeenCalledWith(
      'EXTRACT_SEARCH_RESULTS',
      { scrollPasses: 2 },
      45_000
    )
    expect(mockAppendMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        profileUrl: 'https://www.linkedin.com/in/jane-doe/',
        status: 'sent'
      })
    )
    expect(
      stageEntries().find((entry) => entry.stageLabel === 'Started LinkedIn profile lookup')
    ).toMatchObject({
      stageCode: 'resolve_profile',
      stageStatus: 'started'
    })
  })

  it('skips an ambiguous name-only search instead of guessing', async () => {
    vi.useFakeTimers()
    mockSendCommand.mockImplementation(async (action, payload) => {
      switch (action) {
        case 'NAVIGATE':
          return {
            ok: true,
            detail: String(payload?.url || '').includes('/search/results/people/') ? 'searched' : 'navigated'
          }
        case 'EXTRACT_SEARCH_RESULTS':
          return {
            ok: true,
            detail: 'search_results_2',
            data: {
              items: [
                {
                  profileUrl: 'https://www.linkedin.com/in/john-smith-1/',
                  displayName: 'John Smith',
                  firstName: 'John',
                  company: 'Alpha Capital',
                  headline: 'Partner'
                },
                {
                  profileUrl: 'https://www.linkedin.com/in/john-smith-2/',
                  displayName: 'John Smith',
                  firstName: 'John',
                  company: 'Beta Capital',
                  headline: 'Principal'
                }
              ]
            }
          }
        default:
          throw new Error(`Unexpected action: ${action}`)
      }
    })

    const { runQueue } = await importQueue()
    const promise = runQueue([{ profileUrl: '', personName: 'John Smith', firstName: 'John', searchQuery: 'John Smith' }])
    await vi.runAllTimersAsync()
    await promise

    expect(mockComposeMessageDetailed).not.toHaveBeenCalled()
    expect(mockAppendMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'skipped',
        detail: 'profile_search_no_match'
      })
    )
  })

  it('dry run composes messages but never sends bridge commands', async () => {
    vi.useFakeTimers()
    const { runQueue } = await importQueue()
    const promise = runQueue(
      [{ profileUrl: 'https://www.linkedin.com/in/sam/', firstName: 'Sam', company: 'Acme' }],
      undefined,
      { dryRun: true }
    )
    await vi.runAllTimersAsync()
    await promise

    expect(mockComposeMessageDetailed).toHaveBeenCalled()
    expect(mockSendCommand).not.toHaveBeenCalled()
    expect(mockAppendMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'dry_run',
        detail: 'dry_run_preview'
      })
    )
  })

  it('notifies immediately when a run starts and uses the manual message override', async () => {
    vi.useFakeTimers()
    const onTick = vi.fn()
    mockSendCommand.mockImplementation(async (action, payload) => {
      switch (action) {
        case 'NAVIGATE':
          return { ok: true, detail: 'navigated' }
        case 'EXTRACT_PROFILE':
          return { ok: true, detail: 'extracted', data: { firstName: 'Sam', company: 'Acme' } }
        case 'CLICK_CONNECT_2ND':
          return { ok: true, detail: 'clicked_connect_2nd' }
        case 'CLICK_ADD_NOTE':
          return { ok: true, detail: 'clicked_add_note' }
        case 'TYPE_NOTE':
          expect(payload).toMatchObject({ text: 'Hi Sam from Acme' })
          return { ok: true, detail: 'typed_manual_override' }
        case 'CLICK_SEND':
          return { ok: true, detail: 'clicked_send' }
        case 'CHECK_ERROR_TOAST':
          return { ok: true, detail: 'no_error_toast' }
        case 'VERIFY_PENDING':
          return { ok: true, detail: 'pending_visible' }
        default:
          throw new Error(`Unexpected action: ${action}`)
      }
    })

    const { runQueue } = await importQueue()
    const promise = runQueue(
      [{ profileUrl: 'https://www.linkedin.com/in/sam/', firstName: 'Sam', company: 'Acme' }],
      onTick,
      { messageOverride: 'Hi {firstName} from {company}' }
    )

    expect(onTick).toHaveBeenCalled()

    await vi.runAllTimersAsync()
    await promise

    expect(mockComposeMessageDetailed).not.toHaveBeenCalled()
    expect(mockAppendMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        profileUrl: 'https://www.linkedin.com/in/sam/',
        status: 'sent',
        variant: 'manual_override',
        message: 'Hi Sam from Acme'
      })
    )
  })

  it('records an interruption stage for the next untouched target when the run is stopped', async () => {
    vi.useFakeTimers()
    mockSendCommand.mockImplementation(async (action) => {
      switch (action) {
        case 'NAVIGATE':
          return { ok: true, detail: 'navigated' }
        case 'EXTRACT_PROFILE':
          return { ok: true, detail: 'extracted', data: { firstName: 'Sam', company: 'Acme' } }
        case 'CLICK_CONNECT_2ND':
          return { ok: true, detail: 'clicked_connect_2nd' }
        case 'CLICK_ADD_NOTE':
          return { ok: true, detail: 'clicked_add_note' }
        case 'TYPE_NOTE':
          return { ok: true, detail: 'typed_42' }
        case 'CLICK_SEND':
          return { ok: true, detail: 'clicked_send' }
        case 'CHECK_ERROR_TOAST':
          return { ok: true, detail: 'no_error_toast' }
        case 'VERIFY_PENDING':
          return { ok: true, detail: 'pending_visible' }
        default:
          throw new Error(`Unexpected action: ${action}`)
      }
    })

    const { runQueue, requestStop } = await importQueue()
    mockAppendMainLog.mockImplementation((entry) => {
      if (entry.status === 'sent' && entry.profileUrl === 'https://www.linkedin.com/in/sam/') {
        requestStop()
      }
    })

    const promise = runQueue([
      { profileUrl: 'https://www.linkedin.com/in/sam/', firstName: 'Sam', company: 'Acme' },
      { profileUrl: 'https://www.linkedin.com/in/alex/', firstName: 'Alex', company: 'Northwind' }
    ])
    await vi.runAllTimersAsync()
    await promise

    expect(stageEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'outreach_stage',
          profileUrl: 'https://www.linkedin.com/in/alex/',
          stageCode: 'run_interrupted',
          stageStatus: 'blocked',
          detail: 'Stopped by user'
        })
      ])
    )
    expect(mockSendCommand).not.toHaveBeenCalledWith('NAVIGATE', { url: 'https://www.linkedin.com/in/alex/' })
  })

  it('records a blocked send stage when LinkedIn shows an error toast after clicking Send', async () => {
    vi.useFakeTimers()
    mockSendCommand.mockImplementation(async (action) => {
      switch (action) {
        case 'NAVIGATE':
          return { ok: true, detail: 'navigated' }
        case 'EXTRACT_PROFILE':
          return { ok: true, detail: 'extracted', data: { firstName: 'Sam', company: 'Acme' } }
        case 'CLICK_CONNECT_2ND':
          return { ok: true, detail: 'clicked_connect_2nd' }
        case 'CLICK_ADD_NOTE':
          return { ok: true, detail: 'clicked_add_note' }
        case 'TYPE_NOTE':
          return { ok: true, detail: 'typed_42' }
        case 'CLICK_SEND':
          return { ok: true, detail: 'clicked_send' }
        case 'CHECK_ERROR_TOAST':
          return { ok: false, detail: 'error_toast:rate_limited' }
        default:
          throw new Error(`Unexpected action: ${action}`)
      }
    })

    const { runQueue, getQueueState } = await importQueue()
    const promise = runQueue([{ profileUrl: 'https://www.linkedin.com/in/sam/', firstName: 'Sam', company: 'Acme' }])
    await vi.runAllTimersAsync()
    await promise

    expect(stageEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'outreach_stage',
          profileUrl: 'https://www.linkedin.com/in/sam/',
          stageCode: 'send_invite',
          stageStatus: 'blocked',
          detail: 'error_toast:rate_limited'
        })
      ])
    )
    expect(getQueueState().lastDetail).toBe('error_toast:rate_limited')
  })

  it('skips with a warning when LinkedIn requires an email address to connect', async () => {
    vi.useFakeTimers()
    const onTick = vi.fn()
    mockSendCommand.mockImplementation(async (action) => {
      switch (action) {
        case 'NAVIGATE':
          return { ok: true, detail: 'navigated' }
        case 'EXTRACT_PROFILE':
          return { ok: true, detail: 'extracted', data: { firstName: 'Sarah', company: 'Anthropic' } }
        case 'CLICK_CONNECT_2ND':
          return { ok: true, detail: 'clicked_connect_2nd' }
        case 'CLICK_ADD_NOTE':
          return { ok: false, detail: 'email_required_to_connect' }
        case 'DISMISS_MODAL':
          return { ok: true, detail: 'dismiss_attempt' }
        default:
          throw new Error(`Unexpected action: ${action}`)
      }
    })

    const { runQueue, getQueueState } = await importQueue()
    const promise = runQueue(
      [{ profileUrl: 'https://www.linkedin.com/in/sarah/', firstName: 'Sarah', company: 'Anthropic' }],
      onTick
    )
    await vi.runAllTimersAsync()
    await promise

    expect(mockAppendMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        profileUrl: 'https://www.linkedin.com/in/sarah/',
        status: 'skipped',
        detail: 'email_required_to_connect'
      })
    )
    const stageCalls = mockAppendMainLog.mock.calls
      .map(([entry]) => entry)
      .filter((entry) => entry.eventType === 'outreach_stage')
    expect(stageCalls.map((entry) => entry.stageCode)).toEqual(
      expect.arrayContaining([
        'prepare_target',
        'load_profile',
        'compose_message',
        'open_connect',
        'email_required_to_connect'
      ])
    )
    expect(getQueueState().lastDetail).toBe("LinkedIn requires this person's email address before it can send the invite.")
    expect(mockSendCommand).not.toHaveBeenCalledWith('CLICK_SEND', {}, expect.anything())
  })

  it('treats an email gate during typing as a skip instead of a generic error', async () => {
    vi.useFakeTimers()
    mockSendCommand.mockImplementation(async (action) => {
      switch (action) {
        case 'NAVIGATE':
          return { ok: true, detail: 'navigated' }
        case 'EXTRACT_PROFILE':
          return { ok: true, detail: 'extracted', data: { firstName: 'Sarah', company: 'Anthropic' } }
        case 'CLICK_CONNECT_2ND':
          return { ok: true, detail: 'clicked_connect_2nd' }
        case 'CLICK_ADD_NOTE':
          return { ok: true, detail: 'clicked_add_note' }
        case 'TYPE_NOTE':
          return { ok: false, detail: 'email_required_to_connect' }
        case 'DISMISS_MODAL':
          return { ok: true, detail: 'dismiss_attempt' }
        default:
          throw new Error(`Unexpected action: ${action}`)
      }
    })

    const { runQueue, getQueueState } = await importQueue()
    const promise = runQueue(
      [{ profileUrl: 'https://www.linkedin.com/in/sarah/', firstName: 'Sarah', company: 'Anthropic' }]
    )
    await vi.runAllTimersAsync()
    await promise

    expect(mockAppendMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        profileUrl: 'https://www.linkedin.com/in/sarah/',
        status: 'skipped',
        detail: 'email_required_to_connect'
      })
    )
    expect(mockAppendMainLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        detail: 'type:email_required_to_connect'
      })
    )
    expect(getQueueState().lastDetail).toBe("LinkedIn requires this person's email address before it can send the invite.")
  })

  it('treats an email gate during send as a skip instead of a generic error', async () => {
    vi.useFakeTimers()
    mockSendCommand.mockImplementation(async (action) => {
      switch (action) {
        case 'NAVIGATE':
          return { ok: true, detail: 'navigated' }
        case 'EXTRACT_PROFILE':
          return { ok: true, detail: 'extracted', data: { firstName: 'Sarah', company: 'Anthropic' } }
        case 'CLICK_CONNECT_2ND':
          return { ok: true, detail: 'clicked_connect_2nd' }
        case 'CLICK_ADD_NOTE':
          return { ok: true, detail: 'clicked_add_note' }
        case 'TYPE_NOTE':
          return { ok: true, detail: 'typed_120' }
        case 'CLICK_SEND':
          return { ok: false, detail: 'email_required_to_connect' }
        case 'CHECK_ERROR_TOAST':
          return { ok: true, detail: 'no_error_toast' }
        case 'DISMISS_MODAL':
          return { ok: true, detail: 'dismiss_attempt' }
        default:
          throw new Error(`Unexpected action: ${action}`)
      }
    })

    const { runQueue, getQueueState } = await importQueue()
    const promise = runQueue(
      [{ profileUrl: 'https://www.linkedin.com/in/sarah/', firstName: 'Sarah', company: 'Anthropic' }]
    )
    await vi.runAllTimersAsync()
    await promise

    expect(mockAppendMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        profileUrl: 'https://www.linkedin.com/in/sarah/',
        status: 'skipped',
        detail: 'email_required_to_connect'
      })
    )
    expect(mockAppendMainLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        detail: 'send:email_required_to_connect'
      })
    )
    expect(getQueueState().lastDetail).toBe("LinkedIn requires this person's email address before it can send the invite.")
  })
})
