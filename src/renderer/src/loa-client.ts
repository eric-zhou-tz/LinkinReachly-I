import type {
  ApplicantProfile,
  ApplicationAssistantDetectView,
  ApplicationExtensionHealthView,
  ApplicationHistoryView,
  ApplicationRecordInput,
  ApplicationRecordSaveView,
  ApplicationAssistantStatusView,
  ApplyQueueView
} from '@core/application-types'
import type { AiFieldDefinition, QueueStartRequest, TargetRow } from '@core/types'
import { DEMO_STARTER_TEMPLATES } from '@core/demo-presets'
import type { JobsProgressState } from '@core/jobs-progress'
import { normalizeJobSearchInput, rankJobsForSearch } from '@core/job-search'
import { parseSafeExternalUrl, SAFE_EXTERNAL_URL_ERROR } from '@core/external-url'
import { PLAN_LIMITS } from '@core/plan-config'
import {
  DEV_BRIDGE_PORT,
  DEV_LOA_HTTP_PORT,
  PROD_BRIDGE_PORT,
  PROD_LOA_HTTP_PORT
} from '@core/runtime-ports'
import type { LoApi } from './vite-env'

const DEFAULT_BRIDGE_PORT = import.meta.env.DEV ? DEV_BRIDGE_PORT : PROD_BRIDGE_PORT
const LOA_HTTP_PORT = import.meta.env.DEV ? DEV_LOA_HTTP_PORT : PROD_LOA_HTTP_PORT

const STUB_SETTINGS = {
  seenOnboarding: true,
  bridgePort: DEFAULT_BRIDGE_PORT,
  llmProvider: 'grok',
  llmBaseUrl: 'http://127.0.0.1:8000',
  llmModel: 'grok-4.1-fast',
  llmEnabled: true,
  lastExecutionId: 'generic_connection',
  lastGoal: '',
  aiFieldDefinitions: [] as AiFieldDefinition[],
  templates: [...DEMO_STARTER_TEMPLATES],
  mustInclude: [] as string[],
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
  resumeFileName: '',
  jobsSearchKeywords: '',
  jobsSearchLocation: '',
  jobsSearchHistory: [] as { keywords: string; location: string }[],
  apiKeyPresent: false,
  userBackground: '',
  outreachTone: 'peer' as const
}

let stubSettingsState = {
  ...STUB_SETTINGS,
  templates: [...STUB_SETTINGS.templates],
  mustInclude: [...STUB_SETTINGS.mustInclude]
}

function cloneStubSettings() {
  return {
    ...stubSettingsState,
    templates: [...stubSettingsState.templates],
    mustInclude: [...stubSettingsState.mustInclude],
    jobsSearchHistory: [...stubSettingsState.jobsSearchHistory],
    aiFieldDefinitions: stubSettingsState.aiFieldDefinitions.map((field) => ({ ...field }))
  }
}

function createStubApplicantProfile(): ApplicantProfile {
  return {
    version: 1,
    basics: {
      fullName: 'Demo User',
      email: 'demo@example.com'
    },
    links: {},
    workAuth: {
      countryCode: 'US'
    },
    compensation: {},
    background: {},
    assets: [],
    answerBank: [],
    updatedAt: new Date(0).toISOString()
  }
}

let stubApplicationHistoryState: Extract<ApplicationHistoryView, { ok: true }> = {
  ok: true,
  records: [],
  insights: {
    total: 0,
    submittedCount: 0,
    activeCount: 0,
    needsReviewCount: 0,
    blockedCount: 0,
    outreachSentCount: 0,
    outreachPendingCount: 0,
    byCompanyType: [],
    byStage: [],
    byIndustry: [],
    byWorkModel: []
  },
  detail: 'No application activity recorded yet.'
}

function externalUrlBlocked(detail: string): { ok: false; detail: string } {
  return { ok: false as const, detail }
}

async function openExternalUrlLocally(url: string): ReturnType<LoApi['openExternalUrl']> {
  const parsed = parseSafeExternalUrl(url)
  if (!parsed) return externalUrlBlocked(SAFE_EXTERNAL_URL_ERROR)

  if (typeof window === 'undefined' || typeof window.open !== 'function') {
    return externalUrlBlocked('This environment cannot open external links.')
  }

  try {
    const opened = window.open(parsed.toString(), '_blank', 'noopener,noreferrer')
    if (opened === null) {
      return externalUrlBlocked('The browser blocked the external link.')
    }
    return { ok: true as const }
  } catch (error) {
    return externalUrlBlocked(error instanceof Error ? error.message : String(error))
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function createStubLoa(): LoApi {
  return {
    settingsGet: async () => cloneStubSettings(),
    settingsSave: async (partial: Record<string, unknown>) => {
      const merged = { ...stubSettingsState, ...partial } as typeof STUB_SETTINGS
      if (!Array.isArray(merged.templates) || merged.templates.length === 0) {
        merged.templates = [...stubSettingsState.templates]
      }
      if (!Array.isArray(merged.mustInclude)) {
        merged.mustInclude = [...stubSettingsState.mustInclude]
      }
      if (!Array.isArray(merged.jobsSearchHistory)) {
        merged.jobsSearchHistory = [...stubSettingsState.jobsSearchHistory]
      }
      stubSettingsState = {
        ...merged,
        templates: [...merged.templates],
        mustInclude: [...merged.mustInclude],
        jobsSearchHistory: [...merged.jobsSearchHistory],
        aiFieldDefinitions: Array.isArray(merged.aiFieldDefinitions)
          ? merged.aiFieldDefinitions.map((field) => ({ ...field }))
          : [...stubSettingsState.aiFieldDefinitions]
      }
      return cloneStubSettings()
    },
    settingsSaveBundle: async (payload: { settings: Record<string, unknown>; apiKey?: string | null }) => {
      const merged = { ...stubSettingsState, ...payload.settings } as typeof STUB_SETTINGS
      if (!Array.isArray(merged.templates) || merged.templates.length === 0) {
        merged.templates = [...stubSettingsState.templates]
      }
      if (!Array.isArray(merged.mustInclude)) {
        merged.mustInclude = [...stubSettingsState.mustInclude]
      }
      if (!Array.isArray(merged.jobsSearchHistory)) {
        merged.jobsSearchHistory = [...stubSettingsState.jobsSearchHistory]
      }
      stubSettingsState = {
        ...merged,
        templates: [...merged.templates],
        mustInclude: [...merged.mustInclude],
        jobsSearchHistory: [...merged.jobsSearchHistory],
        aiFieldDefinitions: Array.isArray(merged.aiFieldDefinitions)
          ? merged.aiFieldDefinitions.map((field) => ({ ...field }))
          : [...stubSettingsState.aiFieldDefinitions],
        apiKeyPresent:
          payload.apiKey === undefined
            ? stubSettingsState.apiKeyPresent
            : !!String(payload.apiKey || '').trim()
      }
      return cloneStubSettings()
    },
    settingsSetApiKey: async (key: string | null) => {
      stubSettingsState = {
        ...stubSettingsState,
        apiKeyPresent: !!String(key || '').trim()
      }
      return cloneStubSettings()
    },
    missionPlan: async (payload: { prompt: string }) => ({
      ok: true,
      title: 'Generic connection plan',
      summary: `Built a simple outreach plan for: ${payload.prompt || 'your goal'}.`,
      executionId: 'generic_connection',
      executionLabel: 'Generic connection',
      searchQuery: `site:linkedin.com/in/ ${payload.prompt || 'target audience'}`,
      searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
        payload.prompt || 'target audience'
      )}`,
      csvSeed: 'profileUrl,firstName,company,headline\n',
      templates: [...DEMO_STARTER_TEMPLATES],
      mustInclude: [],
      nextStep: 'Find people from this plan, review the imported list, then press Start run.',
      route: stubSettingsState.apiKeyPresent ? 'llm' : 'heuristic',
      detail: stubSettingsState.apiKeyPresent ? 'provider:grok' : 'no_api_key'
    }),
    composePreview: async (payload?: { target?: TargetRow }) => {
      const target = payload?.target
        ? {
            profileUrl: payload.target.profileUrl || 'https://www.linkedin.com/in/demo-avery-chen/',
            firstName: payload.target.firstName || 'Avery',
            company: payload.target.company || 'Northbridge Labs',
            headline: payload.target.headline || 'VP Product'
          }
        : {
            profileUrl: 'https://www.linkedin.com/in/demo-avery-chen/',
            firstName: 'Avery',
            company: 'Northbridge Labs',
            headline: 'VP Product'
          }
      return {
        ok: true,
        body: `Hi ${target.firstName} — I noticed your work at ${target.company} and would like to connect. Hope you are having a good week.`,
        variant: 'T0',
        route: stubSettingsState.apiKeyPresent ? 'llm' : 'template',
        detail: stubSettingsState.apiKeyPresent ? 'provider:grok' : 'no_api_key',
        sampleTarget: target
      }
    },
    bridgeStatus: async () => ({ port: stubSettingsState.bridgePort, extensionConnected: false }),
    bridgePing: async () => ({
      ok: false,
      detail: 'Not in the desktop app — open LinkinReachly from Electron, or run npm run dev.'
    }),
    collectProspectsFromPlan: async (payload: { query: string }) => ({
      ok: true,
      searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
        payload.query || 'target audience'
      )}`,
      csvText: [
        'profileUrl,firstName,company,headline',
        'https://www.linkedin.com/in/demo-avery-chen/,Avery,Northbridge Labs,VP Product',
        'https://www.linkedin.com/in/demo-jordan-lee/,Jordan,Harbor Peak Capital,Head of Talent'
      ].join('\n'),
      count: 2
    }),
    logsRecent: async () => [],
    runtimeLogTail: async () => ({ ok: true as const, lines: [] as string[] }),
    logsExport: async () => ({ ok: false as const, canceled: true as const }),
    logsClear: async () => ({ ok: true as const, cleared: 0 }),
    onRuntimeLogLine: () => () => {},
    queueState: async () => ({
      running: false,
      currentIndex: 0,
      total: 0,
      lastDetail: '',
      lastProfileUrl: '',
      error: null,
      completedAt: null
    }),
    queueStart: async (_payload: TargetRow[] | QueueStartRequest) => ({ ok: false as const, reason: 'no_targets' as const }),
    queueStop: async () => ({ ok: true }),
    onQueueTick: () => () => {},
    onBridgeActivity: () => () => {},
    jobsProgressState: async () => null,
    onJobsProgress: () => () => {},
    profileImportMine: async () => ({
      ok: true,
      background: 'Senior product and engineering leader with experience across AI, infrastructure, and software delivery.',
      profile: {
        displayName: 'Demo User',
        firstName: 'Demo',
        headline: 'Senior product and engineering leader',
        company: 'Demo Corp',
        location: 'New York City',
        experienceHighlights: ['Led AI platform launches', 'Managed infrastructure-heavy product delivery']
      },
      detail: 'stub'
    }),
    jobsSearch: async (payload: { keywords: string; location?: string }) => ({
      ok: true,
      jobs: [
        {
          title: `${payload.keywords} Lead`,
          company: 'Demo Corp',
          location: payload.location || 'Remote',
          jobUrl: 'https://www.linkedin.com/jobs/view/demo-1/',
          postedDate: 'Recently',
          resumeMatchPercent: 88,
          resumeMatchReason: 'Stub — title overlap with demo profile'
        },
        {
          title: `Senior ${payload.keywords}`,
          company: 'Acme Inc',
          location: payload.location || 'New York, NY',
          jobUrl: 'https://www.linkedin.com/jobs/view/demo-2/',
          postedDate: '1 week ago',
          resumeMatchPercent: 71
        }
      ]
    }),
    jobsLoadMoreJobListings: async (payload?: {
      existingJobUrls?: string[]
      keywords?: string
      location?: string
    }) => ({
      ok: true,
      addedCount: 1,
      jobs: [
        {
          title: `More ${payload?.keywords || 'roles'} (stub)`,
          company: 'Extra Co',
          location: payload?.location || 'Remote',
          jobUrl: `https://www.linkedin.com/jobs/view/stub-more-${Date.now()}/`,
          resumeMatchPercent: 65
        }
      ]
    }),
    jobsScreen: async (payload: { criteria: string; jobs: unknown[] }) => ({
      ok: true,
      results: (payload.jobs as Array<Record<string, unknown>>).map((j, i) => ({
        ...j,
        score: 0,
        reason: 'Not yet scored by AI.'
      })),
      detail: 'stub'
    }),
    jobsSmartSearch: async (payload: { background: string }) => ({
      ok: true,
      plan: { queries: [payload.background], criteria: payload.background, summary: 'Stub smart search.' },
      queryResults: [{ query: payload.background, count: 2 }],
      jobs: [
        { title: 'AI Engineer', company: 'Demo Corp', location: 'Remote', jobUrl: 'https://linkedin.com/jobs/view/demo-smart-1/' },
        { title: 'ML Platform Engineer', company: 'Acme AI', location: 'San Francisco', jobUrl: 'https://linkedin.com/jobs/view/demo-smart-2/' }
      ],
      scored: [
        { title: 'AI Engineer', company: 'Demo Corp', location: 'Remote', jobUrl: 'https://linkedin.com/jobs/view/demo-smart-1/', score: 9, reason: 'Strong match for AI background.' },
        { title: 'ML Platform Engineer', company: 'Acme AI', location: 'San Francisco', jobUrl: 'https://linkedin.com/jobs/view/demo-smart-2/', score: 7, reason: 'Related ML infrastructure role.' }
      ],
      detail: 'stub'
    }),
    jobsCancelSearch: async () => ({ ok: true, canceled: false, detail: 'No active smart search.' }),
    campaignActive: async () => ({ ok: true, campaign: null }),
    campaignCreate: async () => ({ ok: true, campaign: null }),
    campaignResume: async () => ({ ok: false, detail: 'No active campaign.' }),
    campaignMarkSent: async () => ({ ok: true }),
    campaignArchive: async () => ({ ok: true }),
    sessionToken: async () => 'stub-session-token',
    testApiKey: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    feedbackSubmit: async () => ({ ok: true, id: 'stub' }),
    surveySubmit: async () => ({ ok: true, id: 'stub' }),
    surveyCanShow: async () => ({ canShow: true }),
    trackEvent: async () => ({ ok: true }),
    trackOnboarding: async () => ({ ok: true }),
    trackFirstJobSearch: async () => ({ ok: true }),
    trackFirstExtensionConnect: async () => ({ ok: true }),
    openExtensionFolder: async () => '',
    openUserData: async () => {},
    openLogsFolder: async () => '',
    openExternalUrl: (url: string) => openExternalUrlLocally(url),
    generateAiFields: async () => ({ ok: false, values: {}, detail: 'Not available in preview mode.' }),
    uploadResume: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    uploadResumeFile: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    clearResume: async () => ({ ok: true }),
    tailorResume: async () => ({ ok: false, headline: '', summary: '', tailored: false }),
    applicationStatus: async () =>
      ({
        ok: true,
        featureEnabled: true,
        phase: 'scaffold',
        bridgeConnected: false,
        activeLinkedInTab: false,
        extensionScope: 'linkedin_only',
        supportedAts: ['LinkedIn Easy Apply'],
        detail: 'Not available in preview mode.',
        blockedExtensionReload: false
      }) satisfies ApplicationAssistantStatusView,
    applicationExtensionHealth: async () =>
      ({
        ok: false,
        status: 'bridge_disconnected',
        reloadRequired: false,
        expectedContentVersion: 2,
        expectedBackgroundBridgeVersion: 1,
        detail: 'Not available in preview mode.'
      }) satisfies ApplicationExtensionHealthView,
    applicationDetect: async () =>
      ({
        ok: false,
        featureEnabled: true,
        reason: 'no_active_tab',
        detail: 'Not available in preview mode.'
      }) satisfies ApplicationAssistantDetectView,
    applicationHistory: async () => stubApplicationHistoryState,
    applicationHistoryDelete: async (payload: { id: string }) => {
      const id = String(payload?.id || '').trim()
      if (!id) {
        return { ok: false as const, detail: 'Record id is required.' }
      }
      const cur = stubApplicationHistoryState
      const removed = cur.records.find((r) => r.id === id)
      if (!removed) {
        return { ok: false as const, detail: 'Record not found.' }
      }
      const records = cur.records.filter((r) => r.id !== id)
      const submittedCount = records.filter((r) => r.outcome === 'submitted' || r.outcome === 'autofilled').length
      const activeCount = records.filter((r) => r.outcome === 'opened').length
      const needsReviewCount = records.filter((r) => r.outcome === 'needs_review').length
      const blockedCount = records.filter((r) => r.outcome === 'blocked').length
      stubApplicationHistoryState = {
        ok: true,
        records,
        insights: {
          total: records.length,
          submittedCount,
          activeCount,
          needsReviewCount,
          blockedCount,
          outreachSentCount: 0,
          outreachPendingCount: 0,
          byCompanyType: [],
          byStage: [],
          byIndustry: [],
          byWorkModel: []
        },
        detail: 'Application record removed.'
      }
      return stubApplicationHistoryState
    },
    applicationHistoryExportCsv: async () => {
      return { ok: true, csv: '' }
    },
    applicationRecord: async (payload: ApplicationRecordInput) => {
      const nextRecord = {
        id: `stub-${Date.now()}`,
        createdAt: new Date().toISOString(),
        company: payload.company,
        title: payload.title,
        location: payload.location,
        jobUrl: payload.jobUrl,
        easyApply: payload.easyApply,
        atsId: payload.atsId,
        source: payload.source,
        outcome: payload.outcome,
        detail: payload.detail,
        descriptionSnippet: payload.descriptionSnippet,
        reasonSnippet: payload.reasonSnippet,
        companySignals: {
          companyType: 'unknown',
          stage: 'unknown',
          industry: 'unknown',
          workModel: 'unknown'
        }
      }
      const priorOk = stubApplicationHistoryState.ok === true ? stubApplicationHistoryState : null
      const priorRecords = priorOk?.records ?? []
      const priorInsights =
        priorOk?.insights ?? {
          total: 0,
          submittedCount: 0,
          activeCount: 0,
          needsReviewCount: 0,
          blockedCount: 0,
          outreachSentCount: 0,
          outreachPendingCount: 0,
          byCompanyType: [],
          byStage: [],
          byIndustry: [],
          byWorkModel: []
        }
      stubApplicationHistoryState = {
        ok: true,
        records: [nextRecord, ...priorRecords],
        insights: {
          total: priorRecords.length + 1,
          submittedCount:
            priorInsights.submittedCount +
            (payload.outcome === 'submitted' || payload.outcome === 'autofilled' ? 1 : 0),
          activeCount: priorInsights.activeCount + (payload.outcome === 'opened' ? 1 : 0),
          needsReviewCount: priorInsights.needsReviewCount + (payload.outcome === 'needs_review' ? 1 : 0),
          blockedCount: priorInsights.blockedCount + (payload.outcome === 'blocked' ? 1 : 0),
          outreachSentCount: priorInsights.outreachSentCount,
          outreachPendingCount: priorInsights.outreachPendingCount,
          byCompanyType: [],
          byStage: [],
          byIndustry: [],
          byWorkModel: []
        },
        detail: 'Application activity recorded.'
      }
      return {
        ok: true,
        record: nextRecord,
        insights: stubApplicationHistoryState.insights,
        detail: 'Application activity recorded.'
      } satisfies ApplicationRecordSaveView
    },
    applicationSave: async (_payload?: ApplicationRecordInput) => ({
      ok: false as const,
      detail: 'Not available in preview mode.'
    }),
    applicationUpdate: async (_payload?: { id: string } & Partial<ApplicationRecordInput>) => ({
      ok: false as const,
      detail: 'Not available in preview mode.'
    }),
    applicationQueueState: async () =>
      ({
        ok: true,
        state: {
          items: [],
          running: false,
          currentIndex: 0
        }
      }) satisfies ApplyQueueView,
    applicationQueueAdd: async (_payload?: { items: unknown[] }) => ({
      ok: false as const,
      detail: 'Not available in preview mode.'
    }),
    applicationQueueStart: async () =>
      ({
        ok: true,
        state: { items: [], running: false, currentIndex: 0 }
      }) satisfies ApplyQueueView,
    applicationQueueStop: async () =>
      ({
        ok: true,
        state: { items: [], running: false, currentIndex: 0 }
      }) satisfies ApplyQueueView,
    applicationQueueRetry: async (_payload?: { id?: string; ids?: string[] }) =>
      ({
        ok: true,
        state: { items: [], running: false, currentIndex: 0 }
      }) satisfies ApplyQueueView,
    applicationQueueSkip: async (_payload?: { id: string }) =>
      ({
        ok: true,
        state: { items: [], running: false, currentIndex: 0 }
      }) satisfies ApplyQueueView,
    applicationQueueRemove: async (_payload?: { id: string }) => ({
      ok: false as const,
      detail: 'Not available in preview mode.'
    }),
    applicationQueueClear: async () =>
      ({
        ok: true,
        state: { items: [], running: false, currentIndex: 0 }
      }) satisfies ApplyQueueView,
    onApplyQueueTick: () => () => {},
    easyApply: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    applicantGet: async () => ({ ok: true, profile: createStubApplicantProfile() }),
    applicantSave: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    userProfileGet: async () => ({ ok: false, hasProfile: false }),
    applicantUploadResume: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    applicantRemoveResume: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    applicantUploadCoverLetter: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    applicantRemoveCoverLetter: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    applicantPromoteScreeningAnswers: async () => ({ promoted: 0, profile: createStubApplicantProfile() }),
    outreachCandidates: async () => ({ ok: true as const, candidates: [] }),
    outreachMarkSent: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    outreachSkip: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    outreachSearchHiringManager: async () => ({ ok: false, targets: [], detail: 'Not available in preview mode.' }),
    outreachRun: async () => ({ ok: false, sent: 0, detail: 'Not available in preview mode.' }),
    outreachRunChain: async () => ({ ok: false, sent: 0, skipped: 0, detail: 'Not available in preview mode.', results: [] }),
    onPostApplyOutreachReady: () => () => {},
    onOutreachChainProgress: () => () => {},
    onAppToast: () => () => {},
    followupSendDm: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    followupMarkReplied: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    followupArchive: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    followUpState: async () => ({
      ok: true as const,
      recentAccepts: [],
      pendingFollowUps: [],
      staleConnections: [],
      awaitingReply: [],
      responded: [],
      stats: { acceptsThisWeek: 0, dmsSent: 0, stale: 0, awaitingReply: 0, responded: 0 }
    }),
    followupDetectNow: async () => [],
    followupGetNewAccepts: async () => ({ accepts: [] }),
    followupClearAccepts: async () => ({ ok: false }),
    onFollowupNewAccepts: () => () => {},
    followupPendingQueue: async () => ({ items: [] }),
    followupCancelQueued: async () => ({ ok: false }),
    onFollowupQueueUpdate: () => () => {},
    backupExport: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    backupImport: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    cacheClearAll: async () => ({ ok: false, detail: 'Not available in preview mode.' }),
    authSetToken: async () => ({ ok: true }),
    authGoogleSignIn: async () => ({ ok: false as const, error: 'Not available in preview mode.' }),
    authRegister: async () => ({ ok: false, error: 'Not available in preview mode.' }),
    authGetUser: async () => ({ ok: false, error: 'Not available in preview mode.' }),
    authGetServiceConfig: async () => ({
      firebase: { apiKey: '', authDomain: '', projectId: '', appId: '' },
      hasBackend: false,
    }),
    planGetState: async () => ({
      userId: null,
      plan: 'free' as const,
      creditBalance: 0,
      trialStartedAt: null,
      trialEndsAt: null,
      dailyApplyLimit: PLAN_LIMITS.free.apply,
      dailyOutreachLimit: PLAN_LIMITS.free.outreach,
      isTrialing: false,
      trialDaysRemaining: 0,
    }),
    planCheckCanAct: async () => ({ ok: true, data: { allowed: true } }),
    planGetCounters: async () => ({ ok: false, error: 'Not available in preview mode.' }),
    planCreateCheckout: async () => ({ ok: false, error: 'Not available in preview mode.' }),
    planDevOverride: async () => ({ ok: false, error: 'Not available in preview mode.' }),
    accountDelete: async () => ({ ok: false, error: 'Not available in preview mode.' }),
    accountRestorePurchases: async () => ({ ok: false, error: 'Not available in preview mode.' }),
    onUpdateReady: () => () => {},
    updaterQuitAndInstall: async () => ({ status: 'dev' as const }),
    updaterCheckForUpdates: async () => ({ status: 'dev' as const }),
    onFatalError: () => () => {},
    onPlanStateChanged: () => () => {},
    getAppVersion: () => 'dev',
    isDevMode: true,
  }
}

const stubLoa = createStubLoa()

/** Desktop app HTTP API (only used when the UI runs in a normal browser tab; the Electron window uses preload instead). */
const LOA_HTTP_BASE = `http://127.0.0.1:${LOA_HTTP_PORT}`
const LOA_HTTP_TIMEOUT_MS = 120_000
/** Smart search involves planning + multiple LinkedIn queries + enrichment + ranking — needs much longer. */
const LOA_SMART_SEARCH_TIMEOUT_MS = 150_000

/** Node's fetch (undici) and jsdom's AbortController often disagree on `instanceof AbortSignal`. */
let fetchAcceptsAbortSignalCache: boolean | null = null

function fetchAcceptsAbortSignal(): boolean {
  if (fetchAcceptsAbortSignalCache != null) return fetchAcceptsAbortSignalCache
  if (typeof Request === 'undefined') {
    fetchAcceptsAbortSignalCache = false
    return false
  }
  try {
    const c = new AbortController()
    new Request('http://127.0.0.1/', { signal: c.signal })
    fetchAcceptsAbortSignalCache = true
  } catch {
    fetchAcceptsAbortSignalCache = false
  }
  return fetchAcceptsAbortSignalCache
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = LOA_HTTP_TIMEOUT_MS, ...rest } = init

  if (!fetchAcceptsAbortSignal()) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Request timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    })
    try {
      return await Promise.race([fetch(input, rest), timeoutPromise])
    } finally {
      if (timer != null) clearTimeout(timer)
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(`Request timed out after ${Math.round(timeoutMs / 1000)}s`), timeoutMs)
  try {
    return await fetch(input, { ...rest, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

let httpSessionToken: string | null = null
let httpSessionTokenPromise: Promise<string> | null = null
let preloadSessionTokenKnownMissing = false

async function fetchHttpSessionToken(preferPreload = true): Promise<string> {
  if (
    preferPreload &&
    !preloadSessionTokenKnownMissing &&
    typeof window !== 'undefined' &&
    window.loa &&
    typeof window.loa.sessionToken === 'function'
  ) {
    try {
      const preloadToken = String(await window.loa.sessionToken()).trim()
      if (preloadToken) return preloadToken
    } catch (err) {
      if (isMissingIpcHandlerError(err)) {
        preloadSessionTokenKnownMissing = true
      }
    }
  }
  // In packaged Electron, the HTTP /session-token endpoint is blocked.
  // If preload should be present but isn't, fail fast instead of 403 loops.
  const inElectron = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)
  if (inElectron && !window.loa) {
    console.warn('[loa-client] preload API not available — session token unavailable')
    throw new Error('Preload API not loaded; session token unavailable.')
  }
  const response = await fetchWithTimeout(`${LOA_HTTP_BASE}/session-token`, { method: 'GET' })
  const text = await response.text()
  if (!response.ok) throw new Error(text.slice(0, 200) || `HTTP ${response.status}`)
  let parsed: { token?: string }
  try {
    parsed = JSON.parse(text) as { token?: string }
  } catch {
    throw new Error('Invalid token response from backend.')
  }
  const token = String(parsed.token || '').trim()
  if (!token) throw new Error('Missing token from backend.')
  return token
}

async function getHttpSessionToken(forceRefresh = false, preferPreload = true): Promise<string> {
  if (!forceRefresh && httpSessionToken) return httpSessionToken
  if (!forceRefresh && httpSessionTokenPromise) return httpSessionTokenPromise
  if (forceRefresh) httpSessionToken = null
  const p = fetchHttpSessionToken(preferPreload)
    .then((token) => {
      httpSessionToken = token
      return token
    })
    .finally(() => {
      httpSessionTokenPromise = null
    })
  httpSessionTokenPromise = p
  return p
}

/** Channels that run long operations and need extended client-side timeouts. */
const LONG_RUNNING_CHANNELS = new Set(['jobs:smartSearch', 'jobs:screen', 'jobs:search', 'jobs:loadMoreJobListings'])

async function httpLoaInvoke(channel: string, payload?: unknown): Promise<unknown> {
  const timeoutMs = LONG_RUNNING_CHANNELS.has(channel) ? LOA_SMART_SEARCH_TIMEOUT_MS : undefined
  const invokeWithToken = (token?: string) =>
    fetchWithTimeout(`${LOA_HTTP_BASE}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload === undefined ? { channel } : { channel, payload }),
      ...(timeoutMs ? { timeoutMs } : {})
    })

  let r = await invokeWithToken(httpSessionToken || undefined)
  if (r.status === 401) {
    const token = await getHttpSessionToken(!!httpSessionToken, true)
    r = await invokeWithToken(token)
    if (r.status === 401) {
      const canonicalToken = await getHttpSessionToken(true, false)
      r = await invokeWithToken(canonicalToken)
    }
  }

  const text = await r.text()
  let parsed: { result?: unknown; error?: string }
  try {
    parsed = JSON.parse(text) as { result?: unknown; error?: string }
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${r.status}`)
  }
  if (!r.ok) {
    throw new Error(parsed.error || `HTTP ${r.status}`)
  }
  if (typeof parsed.error === 'string' && parsed.error) {
    throw new Error(parsed.error)
  }
  return parsed.result
}

/** Prefer GET /runtime-log-tail — avoids older main builds that lack `logs:runtime:tail` in loaInvoke. */
const RUNTIME_LOG_TAIL_FALLBACK_INVOKE = '__RUNTIME_LOG_TAIL_USE_INVOKE__'

async function httpRuntimeLogTail(maxLines: number): Promise<{ ok: true; lines: string[] }> {
  const cap = Math.max(1, Math.min(Math.floor(maxLines || 500), 2500))
  const invokeWithToken = (token?: string) =>
    fetchWithTimeout(`${LOA_HTTP_BASE}/runtime-log-tail?maxLines=${encodeURIComponent(String(cap))}`, {
      method: 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      timeoutMs: 20_000
    })

  let r = await invokeWithToken(httpSessionToken || undefined)
  if (r.status === 401) {
    const token = await getHttpSessionToken(!!httpSessionToken, true)
    r = await invokeWithToken(token)
    if (r.status === 401) {
      const canonicalToken = await getHttpSessionToken(true, false)
      r = await invokeWithToken(canonicalToken)
    }
  }
  if (r.status === 404) {
    throw new Error(RUNTIME_LOG_TAIL_FALLBACK_INVOKE)
  }
  const text = await r.text()
  let parsed: { ok?: boolean; lines?: string[]; error?: string }
  try {
    parsed = JSON.parse(text) as { ok?: boolean; lines?: string[]; error?: string }
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${r.status}`)
  }
  if (!r.ok) {
    throw new Error(parsed.error || `HTTP ${r.status}`)
  }
  if (typeof parsed.error === 'string' && parsed.error) {
    throw new Error(parsed.error)
  }
  if (!parsed.ok || !Array.isArray(parsed.lines)) {
    throw new Error('Invalid runtime-log-tail response')
  }
  return { ok: true as const, lines: parsed.lines }
}

function isBackendOfflineError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /failed to fetch|fetch failed|networkerror|load failed|http 0|http 502|http 503|http 504/i.test(message)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isChannelMissingError(err: unknown, channel: string): boolean {
  const message = err instanceof Error ? err.message : String(err)
  const escaped = escapeRegExp(channel)
  return new RegExp(`no handler registered for ['"]${escaped}['"]|unknown channel:\\s*${escaped}`, 'i').test(
    message
  )
}

function isSmartSearchChannelMissingError(err: unknown): boolean {
  return isChannelMissingError(err, 'jobs:smartSearch')
}

function isOpenExternalChannelMissingError(err: unknown): boolean {
  return isChannelMissingError(err, 'shell:openExternal')
}

function isOpenLogsFolderChannelMissingError(err: unknown): boolean {
  return isChannelMissingError(err, 'shell:openLogsFolder')
}

async function withStubFallback<T>(fn: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isBackendOfflineError(err)) return fallback()
    throw err
  }
}

async function smartSearchCompatibilityFallback(
  payload: { background: string; location?: string; apiKey?: string | null }
): Promise<unknown> {
  const background = String(payload.background || '').trim()
  if (!background) {
    return { ok: false as const, detail: 'Describe your background or what you are looking for.' }
  }

  const normalizedSearch = normalizeJobSearchInput(background, payload.location)
  const keywords = normalizedSearch.keywords
  const location = normalizedSearch.location

  let searchRes: { ok: boolean; canceled?: boolean; jobs?: unknown[]; detail?: string }
  try {
    searchRes = (await withStubFallback(
      () =>
        httpLoaInvoke('jobs:search', {
          keywords,
          location
        }) as ReturnType<LoApi['jobsSearch']>,
      () =>
        stubLoa.jobsSearch({
          keywords,
          location
        })
    )) as { ok: boolean; canceled?: boolean; jobs?: unknown[]; detail?: string }
  } catch (err) {
    if (isChannelMissingError(err, 'jobs:search')) {
      return {
        ok: false as const,
        detail:
          'Your running desktop backend is too old for Jobs search compatibility. Fully quit all app windows and relaunch the latest build.'
      }
    }
    throw err
  }

  if (!searchRes.ok) {
    if (searchRes.canceled) {
      return { ok: false as const, canceled: true as const, detail: searchRes.detail || 'Search canceled.' }
    }
    return { ok: false as const, detail: searchRes.detail || 'Search failed.' }
  }

  const jobs = rankJobsForSearch(
    Array.isArray(searchRes.jobs)
      ? (searchRes.jobs as Array<{ title?: string; company?: string; location?: string }>)
      : [],
    background,
    location
  )
  const criteria = background

  if (jobs.length === 0) {
    return {
      ok: true as const,
      plan: {
        queries: [background],
        criteria,
        summary: 'Compatibility mode completed: no jobs found.'
      },
      queryResults: [{ query: background, count: 0 }],
      jobs: [],
      scored: [],
      enrichedCount: 0,
      detail: 'Search completed but found no jobs.'
    }
  }

  let screenRes: { ok: boolean; results?: unknown[]; detail?: string }
  try {
    screenRes = (await withStubFallback(
      () =>
        httpLoaInvoke('jobs:screen', {
          criteria,
          jobs,
          apiKey: payload.apiKey ?? undefined
        }) as ReturnType<LoApi['jobsScreen']>,
      () =>
        stubLoa.jobsScreen({
          criteria,
          jobs,
          apiKey: payload.apiKey ?? undefined
        })
    )) as { ok: boolean; results?: unknown[]; detail?: string }
  } catch (err) {
    if (isChannelMissingError(err, 'jobs:screen')) {
      return {
        ok: true as const,
        plan: {
          queries: [background],
          criteria,
          summary: 'Compatibility mode: job search worked, but AI screening is unavailable in this app build.'
        },
        queryResults: [{ query: background, count: jobs.length }],
        jobs,
        scored: [],
        enrichedCount: 0,
        detail:
          'Found jobs, but AI screening is unavailable in this backend build. Relaunch/update the app to enable scoring.'
      }
    }
    throw err
  }

  if (!screenRes.ok) {
    return { ok: false as const, detail: screenRes.detail || 'AI screening failed.' }
  }

  return {
    ok: true as const,
    plan: {
      queries: [background],
      criteria,
      summary: 'Compatibility mode: used jobs search + AI screen.'
    },
    queryResults: [{ query: background, count: jobs.length }],
    jobs,
    scored: Array.isArray(screenRes.results) ? screenRes.results : [],
    enrichedCount: 0,
    detail: screenRes.detail || 'compat_via_jobs_search_screen'
  }
}

/** Browser tab fallback: same API as preload, via loopback HTTP (Electron main must be running). */
function createBrowserHttpLoa(): LoApi {
  return {
    settingsGet: () =>
      withStubFallback(() => httpLoaInvoke('settings:get') as ReturnType<LoApi['settingsGet']>, () =>
        stubLoa.settingsGet()
      ),
    settingsSave: (partial) =>
      withStubFallback(
        () => httpLoaInvoke('settings:save', partial) as ReturnType<LoApi['settingsSave']>,
        () => stubLoa.settingsSave(partial)
      ),
    settingsSaveBundle: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('settings:saveBundle', payload) as ReturnType<LoApi['settingsSaveBundle']>,
        () => stubLoa.settingsSaveBundle(payload)
      ),
    settingsSetApiKey: (key) =>
      withStubFallback(
        () => httpLoaInvoke('settings:setApiKey', key) as ReturnType<LoApi['settingsSetApiKey']>,
        () => stubLoa.settingsSetApiKey(key)
      ),
    missionPlan: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('mission:plan', payload) as ReturnType<LoApi['missionPlan']>,
        () => stubLoa.missionPlan(payload)
      ),
    composePreview: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('compose:preview', payload ?? {}) as ReturnType<LoApi['composePreview']>,
        () => stubLoa.composePreview(payload)
      ),
    bridgeStatus: () =>
      withStubFallback(
        () => httpLoaInvoke('bridge:status') as ReturnType<LoApi['bridgeStatus']>,
        () => stubLoa.bridgeStatus()
      ),
    bridgePing: () =>
      withStubFallback(
        () => httpLoaInvoke('bridge:ping') as ReturnType<LoApi['bridgePing']>,
        () => stubLoa.bridgePing()
      ),
    collectProspectsFromPlan: (payload) =>
      withStubFallback(
        () =>
          httpLoaInvoke('prospects:collectFromPlan', payload) as ReturnType<LoApi['collectProspectsFromPlan']>,
        () => stubLoa.collectProspectsFromPlan(payload)
      ),
    logsRecent: () =>
      withStubFallback(() => httpLoaInvoke('logs:recent') as Promise<unknown[]>, () => stubLoa.logsRecent()),
    runtimeLogTail: (payload) =>
      withStubFallback(async () => {
        const maxLines = typeof payload?.maxLines === 'number' ? payload.maxLines : 500
        try {
          return await httpRuntimeLogTail(maxLines)
        } catch (e) {
          if (e instanceof Error && e.message === RUNTIME_LOG_TAIL_FALLBACK_INVOKE) {
            return httpLoaInvoke('logs:runtime:tail', payload) as ReturnType<LoApi['runtimeLogTail']>
          }
          throw e
        }
      }, () => stubLoa.runtimeLogTail(payload)),
    logsExport: () =>
      withStubFallback(
        () =>
          httpLoaInvoke('logs:export') as Promise<
            { ok: true; path: string } | { ok: false; canceled?: boolean }
          >,
        () => stubLoa.logsExport()
      ),
    logsClear: () =>
      withStubFallback(
        () => httpLoaInvoke('logs:clear') as ReturnType<LoApi['logsClear']>,
        () => stubLoa.logsClear()
      ),
    queueState: () =>
      withStubFallback(() => httpLoaInvoke('queue:state') as ReturnType<LoApi['queueState']>, () =>
        stubLoa.queueState()
      ),
    queueStart: (payload) =>
      withStubFallback(
        () =>
          httpLoaInvoke('queue:start', payload) as Promise<
            | { ok: true }
            | { ok: false; reason: 'already_running' | 'no_targets' | 'bridge_not_ready'; detail?: string }
          >,
        () => stubLoa.queueStart(payload)
      ),
    queueStop: () =>
      withStubFallback(() => httpLoaInvoke('queue:stop') as Promise<{ ok: boolean }>, () =>
        stubLoa.queueStop()
      ),
    onQueueTick: (cb) => {
      const id = window.setInterval(() => {
        void httpLoaInvoke('queue:state')
          .then((s) => cb(s))
          .catch(() => {})
      }, 2000)
      return () => window.clearInterval(id)
    },
    jobsProgressState: () =>
      withStubFallback(
        () => httpLoaInvoke('jobs:progressState') as ReturnType<LoApi['jobsProgressState']>,
        () => stubLoa.jobsProgressState()
      ),
    onJobsProgress: (cb) => {
      let cancelled = false
      const poll = () => {
        void withStubFallback(
          () => httpLoaInvoke('jobs:progressState') as ReturnType<LoApi['jobsProgressState']>,
          () => stubLoa.jobsProgressState()
        )
          .then((progress) => {
            if (!cancelled) cb((progress as JobsProgressState | null) ?? null)
          })
          .catch(() => {})
      }
      poll()
      const id = window.setInterval(poll, 2000)
      return () => {
        cancelled = true
        window.clearInterval(id)
      }
    },
    userProfileGet: () =>
      withStubFallback(
        () => httpLoaInvoke('profile:get') as ReturnType<LoApi['userProfileGet']>,
        () => stubLoa.userProfileGet()
      ),
    profileImportMine: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('profile:mine', payload ?? {}) as ReturnType<LoApi['profileImportMine']>,
        () => stubLoa.profileImportMine(payload)
      ),
    testApiKey: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('llm:testKey', payload) as ReturnType<LoApi['testApiKey']>,
        () => stubLoa.testApiKey(payload)
      ),
    feedbackSubmit: (payload) =>
      withStubFallback(
        () => (window.loa?.feedbackSubmit?.(payload) ?? httpLoaInvoke('feedback:submit', payload)) as ReturnType<LoApi['feedbackSubmit']>,
        () => stubLoa.feedbackSubmit(payload)
      ),
    surveySubmit: (payload) =>
      withStubFallback(
        () => (window.loa?.surveySubmit?.(payload) ?? httpLoaInvoke('survey:submit', payload)) as ReturnType<LoApi['surveySubmit']>,
        () => stubLoa.surveySubmit(payload)
      ),
    surveyCanShow: (payload) =>
      withStubFallback(
        () => (window.loa?.surveyCanShow?.(payload) ?? httpLoaInvoke('survey:canShow', payload)) as ReturnType<LoApi['surveyCanShow']>,
        () => stubLoa.surveyCanShow(payload)
      ),
    trackEvent: (name: string, properties?: Record<string, unknown>) =>
      withStubFallback(
        () => (window.loa?.trackEvent?.(name, properties) ?? httpLoaInvoke('telemetry:track', { name, properties })) as Promise<{ ok: boolean }>,
        () => stubLoa.trackEvent(name, properties)
      ),
    trackOnboarding: (step: string, meta?: Record<string, unknown>) =>
      withStubFallback(
        () => (window.loa?.trackOnboarding?.(step, meta) ?? httpLoaInvoke('telemetry:onboarding', { step, meta })) as Promise<{ ok: boolean }>,
        () => stubLoa.trackOnboarding(step, meta)
      ),
    trackFirstJobSearch: () =>
      withStubFallback(
        () => (window.loa?.trackFirstJobSearch?.() ?? httpLoaInvoke('telemetry:firstJobSearch')) as Promise<{ ok: boolean }>,
        () => stubLoa.trackFirstJobSearch()
      ),
    trackFirstExtensionConnect: () =>
      withStubFallback(
        () => (window.loa?.trackFirstExtensionConnect?.() ?? httpLoaInvoke('telemetry:firstExtensionConnect')) as Promise<{ ok: boolean }>,
        () => stubLoa.trackFirstExtensionConnect()
      ),
    openExtensionFolder: () =>
      withStubFallback(() => httpLoaInvoke('shell:openExtensionFolder') as Promise<string>, () =>
        stubLoa.openExtensionFolder()
      ),
    openUserData: () =>
      withStubFallback(() => httpLoaInvoke('shell:openUserData') as Promise<void>, () =>
        stubLoa.openUserData()
      ),
    openLogsFolder: async () => {
      try {
        return await withStubFallback(
          () => httpLoaInvoke('shell:openLogsFolder') as Promise<string>,
          () => stubLoa.openLogsFolder()
        )
      } catch (err) {
        if (isOpenLogsFolderChannelMissingError(err)) {
          return stubLoa.openLogsFolder()
        }
        throw err
      }
    },
    openExternalUrl: async (url) => {
      const parsed = parseSafeExternalUrl(url)
      if (!parsed) return externalUrlBlocked(SAFE_EXTERNAL_URL_ERROR)

      const normalizedUrl = parsed.toString()
      try {
        return (await httpLoaInvoke(
          'shell:openExternal',
          normalizedUrl
        )) as Awaited<ReturnType<LoApi['openExternalUrl']>>
      } catch (err) {
        if (isBackendOfflineError(err) || isOpenExternalChannelMissingError(err)) {
          return stubLoa.openExternalUrl(normalizedUrl)
        }
        throw err
      }
    },
    generateAiFields: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('ai:generateFields', payload) as ReturnType<LoApi['generateAiFields']>,
        () => stubLoa.generateAiFields(payload)
      ),
    uploadResume: () =>
      withStubFallback(
        () => httpLoaInvoke('resume:upload') as ReturnType<LoApi['uploadResume']>,
        () => stubLoa.uploadResume()
      ),
    uploadResumeFile: async (file) =>
      withStubFallback(
        async () => {
          const dataBase64 = arrayBufferToBase64(await file.arrayBuffer())
          return (await httpLoaInvoke('resume:importData', {
            fileName: file.name,
            dataBase64
          })) as Awaited<ReturnType<LoApi['uploadResumeFile']>>
        },
        () => stubLoa.uploadResumeFile(file)
      ),
    clearResume: () =>
      withStubFallback(
        () => httpLoaInvoke('resume:clear') as ReturnType<LoApi['clearResume']>,
        () => stubLoa.clearResume()
      ),
    tailorResume: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('resume:tailor', payload) as ReturnType<LoApi['tailorResume']>,
        () => stubLoa.tailorResume(payload)
      ),
    applicationStatus: () =>
      withStubFallback(
        () => httpLoaInvoke('application:status') as ReturnType<LoApi['applicationStatus']>,
        () => stubLoa.applicationStatus()
      ),
    applicationExtensionHealth: () =>
      withStubFallback(
        () =>
          httpLoaInvoke('application:extensionHealth') as ReturnType<LoApi['applicationExtensionHealth']>,
        () => stubLoa.applicationExtensionHealth()
      ),
    applicationDetect: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('application:detect', payload ?? {}) as ReturnType<LoApi['applicationDetect']>,
        () => stubLoa.applicationDetect(payload)
      ),
    applicationHistory: () =>
      withStubFallback(
        () => httpLoaInvoke('application:history') as ReturnType<LoApi['applicationHistory']>,
        () => stubLoa.applicationHistory()
      ),
    applicationHistoryDelete: (payload) =>
      withStubFallback(
        () =>
          httpLoaInvoke('application:history:delete', payload) as ReturnType<LoApi['applicationHistoryDelete']>,
        () => stubLoa.applicationHistoryDelete(payload)
      ),
    applicationHistoryExportCsv: () =>
      withStubFallback(
        () =>
          httpLoaInvoke('application:history:exportCsv') as ReturnType<LoApi['applicationHistoryExportCsv']>,
        () => stubLoa.applicationHistoryExportCsv()
      ),
    applicationRecord: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('application:record', payload) as ReturnType<LoApi['applicationRecord']>,
        () => stubLoa.applicationRecord(payload)
      ),
    applicationSave: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('application:save', payload) as ReturnType<LoApi['applicationSave']>,
        () => stubLoa.applicationSave(payload)
      ),
    applicationUpdate: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('application:update', payload) as ReturnType<LoApi['applicationUpdate']>,
        () => stubLoa.applicationUpdate(payload)
      ),
    applicationQueueState: () =>
      withStubFallback(
        () => httpLoaInvoke('application:queue:state') as ReturnType<LoApi['applicationQueueState']>,
        () => stubLoa.applicationQueueState()
      ),
    applicationQueueAdd: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('application:queue:add', payload) as ReturnType<LoApi['applicationQueueAdd']>,
        () => stubLoa.applicationQueueAdd(payload)
      ),
    applicationQueueStart: () =>
      withStubFallback(
        () => httpLoaInvoke('application:queue:start') as ReturnType<LoApi['applicationQueueStart']>,
        () => stubLoa.applicationQueueStart()
      ),
    applicationQueueStop: () =>
      withStubFallback(
        () => httpLoaInvoke('application:queue:stop') as ReturnType<LoApi['applicationQueueStop']>,
        () => stubLoa.applicationQueueStop()
      ),
    applicationQueueRetry: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('application:queue:retry', payload) as ReturnType<LoApi['applicationQueueRetry']>,
        () => stubLoa.applicationQueueRetry(payload)
      ),
    applicationQueueSkip: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('application:queue:skip', payload) as ReturnType<LoApi['applicationQueueSkip']>,
        () => stubLoa.applicationQueueSkip(payload)
      ),
    applicationQueueRemove: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('application:queue:remove', payload) as ReturnType<LoApi['applicationQueueRemove']>,
        () => stubLoa.applicationQueueRemove(payload)
      ),
    applicationQueueClear: () =>
      withStubFallback(
        () => httpLoaInvoke('application:queue:clear') as ReturnType<LoApi['applicationQueueClear']>,
        () => stubLoa.applicationQueueClear()
      ),
    onApplyQueueTick: (cb) => {
      if (typeof window !== 'undefined' && window.loa && typeof window.loa.onApplyQueueTick === 'function') {
        return window.loa.onApplyQueueTick(cb)
      }
      return () => {}
    },
    onRuntimeLogLine: (cb) => {
      if (typeof window !== 'undefined' && window.loa && typeof window.loa.onRuntimeLogLine === 'function') {
        return window.loa.onRuntimeLogLine(cb)
      }
      return () => {}
    },
    easyApply: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('application:easyApply', payload) as ReturnType<LoApi['easyApply']>,
        () => stubLoa.easyApply(payload)
      ),
    applicantGet: () =>
      withStubFallback(
        () => httpLoaInvoke('applicant:get') as ReturnType<LoApi['applicantGet']>,
        () => stubLoa.applicantGet()
      ),
    applicantSave: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('applicant:save', payload) as ReturnType<LoApi['applicantSave']>,
        () => stubLoa.applicantSave(payload)
      ),
    applicantUploadResume: () =>
      withStubFallback(
        () => httpLoaInvoke('applicant:upload-resume') as ReturnType<LoApi['applicantUploadResume']>,
        () => stubLoa.applicantUploadResume()
      ),
    applicantRemoveResume: () =>
      withStubFallback(
        () => httpLoaInvoke('applicant:remove-resume') as ReturnType<LoApi['applicantRemoveResume']>,
        () => stubLoa.applicantRemoveResume()
      ),
    applicantUploadCoverLetter: () =>
      withStubFallback(
        () =>
          httpLoaInvoke('applicant:upload-cover-letter') as ReturnType<LoApi['applicantUploadCoverLetter']>,
        () => stubLoa.applicantUploadCoverLetter()
      ),
    applicantRemoveCoverLetter: () =>
      withStubFallback(
        () =>
          httpLoaInvoke('applicant:remove-cover-letter') as ReturnType<LoApi['applicantRemoveCoverLetter']>,
        () => stubLoa.applicantRemoveCoverLetter()
      ),
    applicantPromoteScreeningAnswers: () =>
      withStubFallback(
        () =>
          httpLoaInvoke('applicant:promoteScreeningAnswers') as ReturnType<LoApi['applicantPromoteScreeningAnswers']>,
        () => stubLoa.applicantPromoteScreeningAnswers()
      ),
    outreachCandidates: () =>
      withStubFallback(
        () => httpLoaInvoke('application:outreach:candidates') as ReturnType<LoApi['outreachCandidates']>,
        () => stubLoa.outreachCandidates()
      ),
    outreachMarkSent: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('application:outreach:markSent', payload) as ReturnType<LoApi['outreachMarkSent']>,
        () => stubLoa.outreachMarkSent(payload)
      ),
    outreachSkip: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('application:outreach:skip', payload) as ReturnType<LoApi['outreachSkip']>,
        () => stubLoa.outreachSkip(payload)
      ),
    outreachSearchHiringManager: (payload) =>
      withStubFallback(
        () =>
          httpLoaInvoke('application:outreach:searchHiringManager', payload) as ReturnType<
            LoApi['outreachSearchHiringManager']
          >,
        () => stubLoa.outreachSearchHiringManager(payload)
      ),
    outreachRun: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('application:outreach:run', payload) as ReturnType<LoApi['outreachRun']>,
        () => stubLoa.outreachRun(payload)
      ),
    outreachRunChain: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('application:outreach:runChain', payload) as ReturnType<LoApi['outreachRunChain']>,
        () => stubLoa.outreachRunChain(payload)
      ),
    onOutreachChainProgress: (cb) => {
      if (typeof window !== 'undefined' && window.loa && typeof window.loa.onOutreachChainProgress === 'function') {
        return window.loa.onOutreachChainProgress(cb)
      }
      return () => {}
    },
    onPostApplyOutreachReady: (cb) => {
      if (typeof window !== 'undefined' && window.loa && typeof window.loa.onPostApplyOutreachReady === 'function') {
        return window.loa.onPostApplyOutreachReady(cb)
      }
      return () => {}
    },
    onAppToast: (cb) => {
      if (typeof window !== 'undefined' && window.loa && typeof window.loa.onAppToast === 'function') {
        return window.loa.onAppToast(cb)
      }
      return () => {}
    },
    followupSendDm: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('followup:sendDm', payload) as ReturnType<LoApi['followupSendDm']>,
        () => stubLoa.followupSendDm(payload)
      ),
    followupMarkReplied: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('followup:markReplied', payload) as ReturnType<LoApi['followupMarkReplied']>,
        () => stubLoa.followupMarkReplied(payload)
      ),
    followupArchive: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('followup:archive', payload) as ReturnType<LoApi['followupArchive']>,
        () => stubLoa.followupArchive(payload)
      ),
    followUpState: () =>
      withStubFallback(
        () => httpLoaInvoke('followup:state') as ReturnType<LoApi['followUpState']>,
        () => stubLoa.followUpState()
      ),
    followupDetectNow: () =>
      withStubFallback(
        () => httpLoaInvoke('followup:detectNow') as ReturnType<LoApi['followupDetectNow']>,
        () => stubLoa.followupDetectNow()
      ),
    followupGetNewAccepts: () =>
      withStubFallback(
        () => httpLoaInvoke('followup:newAccepts') as ReturnType<LoApi['followupGetNewAccepts']>,
        () => stubLoa.followupGetNewAccepts()
      ),
    followupClearAccepts: () =>
      withStubFallback(
        () => httpLoaInvoke('followup:clearAccepts') as ReturnType<LoApi['followupClearAccepts']>,
        () => stubLoa.followupClearAccepts()
      ),
    onFollowupNewAccepts: () => () => {},
    followupPendingQueue: () =>
      withStubFallback(
        () => httpLoaInvoke('followup:pendingQueue') as ReturnType<LoApi['followupPendingQueue']>,
        () => stubLoa.followupPendingQueue()
      ),
    followupCancelQueued: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('followup:cancelQueued', payload) as ReturnType<LoApi['followupCancelQueued']>,
        () => stubLoa.followupCancelQueued(payload)
      ),
    onFollowupQueueUpdate: () => () => {},
    backupExport: () =>
      withStubFallback(
        () => httpLoaInvoke('backup:export') as ReturnType<LoApi['backupExport']>,
        () => stubLoa.backupExport()
      ),
    backupImport: () =>
      withStubFallback(
        () => httpLoaInvoke('backup:import') as ReturnType<LoApi['backupImport']>,
        () => stubLoa.backupImport()
      ),
    cacheClearAll: () =>
      withStubFallback(
        () => httpLoaInvoke('cache:clearAll') as ReturnType<LoApi['cacheClearAll']>,
        () => stubLoa.cacheClearAll()
      ),
    authSetToken: (token) =>
      typeof window !== 'undefined' && window.loa?.authSetToken
        ? window.loa.authSetToken(token)
        : stubLoa.authSetToken(token),
    authGoogleSignIn: () =>
      typeof window !== 'undefined' && window.loa?.authGoogleSignIn
        ? window.loa.authGoogleSignIn()
        : withStubFallback(
            () => httpLoaInvoke('auth:googleSignIn') as ReturnType<LoApi['authGoogleSignIn']>,
            () => stubLoa.authGoogleSignIn()
          ),
    authRegister: () =>
      typeof window !== 'undefined' && window.loa?.authRegister
        ? window.loa.authRegister()
        : stubLoa.authRegister(),
    authGetUser: () =>
      typeof window !== 'undefined' && window.loa?.authGetUser
        ? window.loa.authGetUser()
        : stubLoa.authGetUser(),
    authGetServiceConfig: () =>
      typeof window !== 'undefined' && window.loa?.authGetServiceConfig
        ? window.loa.authGetServiceConfig()
        : withStubFallback(
            () => httpLoaInvoke('auth:getServiceConfig') as ReturnType<LoApi['authGetServiceConfig']>,
            () => stubLoa.authGetServiceConfig()
          ),
    planGetState: () =>
      typeof window !== 'undefined' && window.loa?.planGetState
        ? window.loa.planGetState()
        : stubLoa.planGetState(),
    planCheckCanAct: (actionType) =>
      typeof window !== 'undefined' && window.loa?.planCheckCanAct
        ? window.loa.planCheckCanAct(actionType)
        : stubLoa.planCheckCanAct(actionType),
    planGetCounters: () =>
      typeof window !== 'undefined' && window.loa?.planGetCounters
        ? window.loa.planGetCounters()
        : stubLoa.planGetCounters(),
    planCreateCheckout: (product) =>
      typeof window !== 'undefined' && window.loa?.planCreateCheckout
        ? window.loa.planCreateCheckout(product)
        : stubLoa.planCreateCheckout(product),
    planDevOverride: (plan) =>
      typeof window !== 'undefined' && window.loa?.planDevOverride
        ? window.loa.planDevOverride(plan)
        : stubLoa.planDevOverride(plan),
    accountDelete: () =>
      typeof window !== 'undefined' && window.loa?.accountDelete
        ? window.loa.accountDelete()
        : stubLoa.accountDelete(),
    accountRestorePurchases: () =>
      typeof window !== 'undefined' && window.loa?.accountRestorePurchases
        ? window.loa.accountRestorePurchases()
        : stubLoa.accountRestorePurchases(),
    onBridgeActivity: () => () => {},
    jobsSearch: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('jobs:search', payload) as ReturnType<LoApi['jobsSearch']>,
        () => stubLoa.jobsSearch(payload)
      ),
    jobsLoadMoreJobListings: (payload) =>
      withStubFallback(
        () =>
          httpLoaInvoke('jobs:loadMoreJobListings', payload) as ReturnType<
            LoApi['jobsLoadMoreJobListings']
          >,
        () => stubLoa.jobsLoadMoreJobListings(payload)
      ),
    jobsScreen: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('jobs:screen', payload) as ReturnType<LoApi['jobsScreen']>,
        () => stubLoa.jobsScreen(payload)
      ),
    jobsSmartSearch: (payload) =>
      withStubFallback(
        async () => {
          try {
            return (await httpLoaInvoke('jobs:smartSearch', payload)) as ReturnType<LoApi['jobsSmartSearch']>
          } catch (err) {
            if (isSmartSearchChannelMissingError(err)) {
              return (await smartSearchCompatibilityFallback(payload)) as ReturnType<
                LoApi['jobsSmartSearch']
              >
            }
            throw err
          }
        },
        () => stubLoa.jobsSmartSearch(payload)
      ),
    jobsCancelSearch: () =>
      withStubFallback(
        () => httpLoaInvoke('jobs:cancelSearch') as ReturnType<LoApi['jobsCancelSearch']>,
        () => stubLoa.jobsCancelSearch()
      ),
    campaignActive: () =>
      withStubFallback(
        () => httpLoaInvoke('campaign:active') as ReturnType<LoApi['campaignActive']>,
        () => stubLoa.campaignActive()
      ),
    campaignCreate: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('campaign:create', payload) as ReturnType<LoApi['campaignCreate']>,
        () => stubLoa.campaignCreate(payload)
      ),
    campaignResume: () =>
      withStubFallback(
        () => httpLoaInvoke('campaign:resume') as ReturnType<LoApi['campaignResume']>,
        () => stubLoa.campaignResume()
      ),
    campaignMarkSent: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('campaign:markSent', payload) as ReturnType<LoApi['campaignMarkSent']>,
        () => stubLoa.campaignMarkSent(payload)
      ),
    campaignArchive: (payload) =>
      withStubFallback(
        () => httpLoaInvoke('campaign:archive', payload) as ReturnType<LoApi['campaignArchive']>,
        () => stubLoa.campaignArchive(payload)
      ),
    sessionToken: () =>
      withStubFallback(
        () => getHttpSessionToken(false),
        () => stubLoa.sessionToken()
      ),
    onUpdateReady: () => () => {},
    updaterQuitAndInstall: async () => ({ status: 'dev' as const }),
    updaterCheckForUpdates: async () => ({ status: 'dev' as const }),
    onFatalError: () => () => {},
    onPlanStateChanged: () => () => {},
    getAppVersion: () => 'dev',
    isDevMode: true,
  }
}

let httpLoaSingleton: LoApi | null = null
let electronLoaFallbackCache: WeakMap<object, LoApi> | null = null

function getHttpLoaSingleton(): LoApi {
  if (!httpLoaSingleton) httpLoaSingleton = createBrowserHttpLoa()
  return httpLoaSingleton
}

function getElectronLoaFallbackCache(): WeakMap<object, LoApi> {
  if (!electronLoaFallbackCache) electronLoaFallbackCache = new WeakMap<object, LoApi>()
  return electronLoaFallbackCache
}

function isMissingIpcHandlerError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /no handler registered for ['"][^'"]+['"]|unknown channel:\s*[\w:-]+/i.test(message)
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return !!value && typeof (value as Promise<unknown>).then === 'function'
}

/**
 * Older Electron builds may miss newer `window.loa` methods and/or IPC handlers.
 * Builds a plain merged API object (not a Proxy) to avoid Electron/contextBridge proxy invariants.
 */
function wrapElectronLoaWithHttpFallback(base: LoApi): LoApi {
  const key = base as unknown as object
  const cache = getElectronLoaFallbackCache()
  const cached = cache.get(key)
  if (cached) return cached

  const http = getHttpLoaSingleton()
  const merged: Record<string, unknown> = {}
  const keys = new Set<PropertyKey>([...Reflect.ownKeys(http), ...Reflect.ownKeys(base)])
  for (const prop of keys) {
    const v = Reflect.get(base, prop, base as object)
    const fb = Reflect.get(http, prop, http as object)
    if (typeof v === 'function' && typeof fb === 'function') {
      Reflect.set(merged, prop, (...args: unknown[]) => {
        let primaryResult: unknown
        try {
          primaryResult = (v as (...a: unknown[]) => unknown).apply(base as object, args)
        } catch (err) {
          if (isMissingIpcHandlerError(err)) {
            return (fb as (...a: unknown[]) => unknown).apply(http as object, args)
          }
          throw err
        }
        if (isPromiseLike(primaryResult)) {
          return primaryResult.catch((err) => {
            if (isMissingIpcHandlerError(err)) {
              return (fb as (...a: unknown[]) => unknown).apply(http as object, args)
            }
            throw err
          })
        }
        return primaryResult
      })
      continue
    }
    if (typeof v === 'function') {
      Reflect.set(merged, prop, (...args: unknown[]) => (v as (...a: unknown[]) => unknown).apply(base as object, args))
      continue
    }
    if (typeof fb === 'function') {
      Reflect.set(merged, prop, (...args: unknown[]) => (fb as (...a: unknown[]) => unknown).apply(http as object, args))
      continue
    }
    Reflect.set(merged, prop, v ?? fb)
  }

  const wrapped = merged as unknown as LoApi
  cache.set(key, wrapped)
  return wrapped
}

/** Prefer the Electron preload API; only then loopback HTTP (browser tab); last resort stub. */
export function getLoa(): LoApi {
  if (typeof window !== 'undefined' && window.loa != null) {
    return wrapElectronLoaWithHttpFallback(window.loa as LoApi)
  }
  if (typeof window !== 'undefined') return createBrowserHttpLoa()
  return stubLoa
}

export function isElectronLoaAvailable(): boolean {
  return typeof window !== 'undefined' && window.loa != null
}

export function loaHttpHealthUrl(): string {
  return `${LOA_HTTP_BASE}/health`
}
