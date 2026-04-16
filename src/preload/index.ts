import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ApplicantProfile,
  ApplicantProfileSaveView,
  ApplicantProfileView,
  ApplicationAssistantDetectView,
  ApplicationExtensionHealthView,
  ApplicationHistoryView,
  ApplicationRecordInput,
  ApplicationRecordSaveView,
  ApplicationAssistantStatusView,
  ApplyQueueView,
  OutreachChainProgressEvent,
  OutreachRunChainPayload,
  OutreachRunChainResult,
  OutreachRunPayload,
  OutreachRunResult,
  OutreachSearchHiringManagerPayload,
  OutreachSearchHiringManagerResult
} from '@core/application-types'
import type { JobsProgressState } from '@core/jobs-progress'
import type { AiFieldDefinition, QueueStartRequest, TargetRow } from '@core/types'

contextBridge.exposeInMainWorld('loa', {
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSave: (partial: Record<string, unknown>) => ipcRenderer.invoke('settings:save', partial),
  settingsSaveBundle: (payload: { settings: Record<string, unknown>; apiKey?: string | null }) =>
    ipcRenderer.invoke('settings:saveBundle', payload),
  settingsSetApiKey: (key: string | null) => ipcRenderer.invoke('settings:setApiKey', key),
  missionPlan: (payload: { prompt: string; draft?: Record<string, unknown>; apiKey?: string | null }) =>
    ipcRenderer.invoke('mission:plan', payload),
  composePreview: (payload: { draft?: Record<string, unknown>; apiKey?: string | null; target?: TargetRow }) =>
    ipcRenderer.invoke('compose:preview', payload),

  bridgeStatus: () => ipcRenderer.invoke('bridge:status'),
  bridgePing: () => ipcRenderer.invoke('bridge:ping'),
  collectProspectsFromPlan: (payload: { query: string }) =>
    ipcRenderer.invoke('prospects:collectFromPlan', payload),

  logsRecent: () => ipcRenderer.invoke('logs:recent'),
  runtimeLogTail: (payload?: { maxLines?: number }) =>
    ipcRenderer.invoke('logs:runtime:tail', payload),
  logsExport: () => ipcRenderer.invoke('logs:export'),
  logsClear: () => ipcRenderer.invoke('logs:clear'),

  onRuntimeLogLine: (cb: (line: { text: string; level: string; t: number }) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, line: { text: string; level: string; t: number }) => cb(line)
    ipcRenderer.on('runtime-log:line', fn)
    return () => ipcRenderer.removeListener('runtime-log:line', fn)
  },

  queueState: () => ipcRenderer.invoke('queue:state'),
  queueStart: (payload: TargetRow[] | QueueStartRequest) => ipcRenderer.invoke('queue:start', payload),
  queueStop: () => ipcRenderer.invoke('queue:stop'),

  onQueueTick: (cb: (s: unknown) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, state: unknown) => cb(state)
    ipcRenderer.on('queue:tick', fn)
    return () => ipcRenderer.removeListener('queue:tick', fn)
  },

  /** Fires when the extension connects/disconnects or sends an updated LinkedIn-tab snapshot — keeps UI in sync without slow polling. */
  onBridgeActivity: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('bridge:activity', fn)
    return () => ipcRenderer.removeListener('bridge:activity', fn)
  },

  jobsProgressState: () => ipcRenderer.invoke('jobs:progressState'),
  onJobsProgress: (cb: (progress: JobsProgressState | null) => void) => {
    let cancelled = false
    const emitSnapshot = () => {
      void ipcRenderer
        .invoke('jobs:progressState')
        .then((progress) => {
          if (!cancelled) cb((progress as JobsProgressState | null) ?? null)
        })
        .catch(() => {})
    }
    const fn = (_e: Electron.IpcRendererEvent, progress: JobsProgressState | null) => {
      cb(progress ?? null)
    }
    ipcRenderer.on('jobs:progress', fn)
    emitSnapshot()
    const id = window.setInterval(emitSnapshot, 900)
    return () => {
      cancelled = true
      window.clearInterval(id)
      ipcRenderer.removeListener('jobs:progress', fn)
    }
  },
  profileImportMine: (payload?: { persist?: boolean; restoreAfter?: boolean }) =>
    ipcRenderer.invoke('profile:mine', payload),

  testApiKey: (payload: { apiKey?: string | null }) =>
    ipcRenderer.invoke('llm:testKey', payload),
  jobsSearch: (payload: { keywords: string; location?: string }) =>
    ipcRenderer.invoke('jobs:search', payload),
  jobsLoadMoreJobListings: (payload?: {
    existingJobUrls?: string[]
    keywords?: string
    location?: string
  }) => ipcRenderer.invoke('jobs:loadMoreJobListings', payload),
  jobsScreen: (payload: { criteria: string; jobs: unknown[]; apiKey?: string | null }) =>
    ipcRenderer.invoke('jobs:screen', payload),
  jobsSmartSearch: (payload: { background: string; location?: string; apiKey?: string | null; sourceUrl?: string }) =>
    ipcRenderer.invoke('jobs:smartSearch', payload),
  jobsCancelSearch: () => ipcRenderer.invoke('jobs:cancelSearch'),

  campaignActive: () => ipcRenderer.invoke('campaign:active'),
  campaignCreate: (payload: { goal: string; plan: { title: string; summary: string; executionId: string; searchQuery: string }; targets: TargetRow[] }) =>
    ipcRenderer.invoke('campaign:create', payload),
  campaignResume: () => ipcRenderer.invoke('campaign:resume'),
  campaignMarkSent: (payload: { campaignId: string; profileUrls: string[] }) =>
    ipcRenderer.invoke('campaign:markSent', payload),
  campaignArchive: (payload: { campaignId: string }) =>
    ipcRenderer.invoke('campaign:archive', payload),

  // Feedback collection
  feedbackSubmit: (payload: {
    type: 'bug' | 'feature' | 'general'
    text: string
    rating?: number | null
    page?: string
  }): Promise<{ ok: boolean; id?: string }> => ipcRenderer.invoke('feedback:submit', payload),

  surveySubmit: (payload: {
    surveyType: 'csat' | 'pmf' | 'nps' | 'onboarding'
    answers: Record<string, unknown>
    score?: number | null
  }): Promise<{ ok: boolean; id?: string }> => ipcRenderer.invoke('survey:submit', payload),

  surveyCanShow: (payload: { surveyType: string; cooldownDays: number }): Promise<{ canShow: boolean }> =>
    ipcRenderer.invoke('survey:canShow', payload),

  trackEvent: (name: string, properties?: Record<string, unknown>) =>
    ipcRenderer.invoke('telemetry:track', { name, properties }),
  trackOnboarding: (step: string, meta?: Record<string, unknown>) =>
    ipcRenderer.invoke('telemetry:onboarding', { step, meta }),
  trackFirstJobSearch: () => ipcRenderer.invoke('telemetry:firstJobSearch'),
  trackFirstExtensionConnect: () => ipcRenderer.invoke('telemetry:firstExtensionConnect'),

  openExtensionFolder: () => ipcRenderer.invoke('shell:openExtensionFolder'),
  openUserData: () => ipcRenderer.invoke('shell:openUserData'),
  openLogsFolder: () => ipcRenderer.invoke('shell:openLogsFolder'),
  openExternalUrl: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  sessionToken: () => ipcRenderer.invoke('session:token'),

  // AI field generation for custom template variables
  generateAiFields: (payload: { fields: AiFieldDefinition[]; target: TargetRow; apiKey?: string | null }) =>
    ipcRenderer.invoke('ai:generateFields', payload),

  // Structured profile (Sprint 1)
  profileParse: (payload: { resumeText: string }) => ipcRenderer.invoke('profile:parse', payload),
  profileGet: () => ipcRenderer.invoke('profile:get'),
  profileSave: (payload: Record<string, unknown>) => ipcRenderer.invoke('profile:save', payload),
  jobsSmartScreen: (payload: { jobs: unknown[]; apiKey?: string | null }) =>
    ipcRenderer.invoke('jobs:smartScreen', payload),

  // Resume management
  uploadResume: () => ipcRenderer.invoke('resume:upload'),
  uploadResumeFile: (file: File) => {
    let filePath = ''
    try {
      filePath = webUtils.getPathForFile(file)
    } catch (error) {
      return Promise.resolve({
        ok: false as const,
        detail: error instanceof Error ? error.message : String(error)
      })
    }
    if (!filePath) {
      return Promise.resolve({
        ok: false as const,
        detail: 'Could not read the dropped file path.'
      })
    }
    return ipcRenderer.invoke('resume:importPath', filePath)
  },
  clearResume: () => ipcRenderer.invoke('resume:clear'),
  tailorResume: (payload: {
    currentHeadline: string
    currentSummary: string
    jobDescription: string
    jobTitle: string
    company: string
  }): Promise<{ ok: boolean; headline: string; summary: string; tailored: boolean }> =>
    ipcRenderer.invoke('resume:tailor', payload),

  // Easy Apply automation
  applicationStatus: (): Promise<ApplicationAssistantStatusView> => ipcRenderer.invoke('application:status'),
  applicationExtensionHealth: (): Promise<ApplicationExtensionHealthView> =>
    ipcRenderer.invoke('application:extensionHealth'),
  applicationDetect: (payload?: { url?: string }): Promise<ApplicationAssistantDetectView> =>
    ipcRenderer.invoke('application:detect', payload),
  applicationHistory: (): Promise<ApplicationHistoryView> => ipcRenderer.invoke('application:history'),
  applicationHistoryDelete: (payload: { id: string }): Promise<ApplicationHistoryView> =>
    ipcRenderer.invoke('application:history:delete', payload),
  applicationHistoryExportCsv: (): Promise<{ ok: boolean; csv: string }> =>
    ipcRenderer.invoke('application:history:exportCsv'),
  applicationRecord: (payload: ApplicationRecordInput): Promise<ApplicationRecordSaveView> =>
    ipcRenderer.invoke('application:record', payload),
  applicationSave: (payload: ApplicationRecordInput): Promise<ApplicationRecordSaveView> =>
    ipcRenderer.invoke('application:save', payload),
  applicationUpdate: (
    payload: { id: string } & Partial<ApplicationRecordInput>
  ): Promise<ApplicationRecordSaveView> => ipcRenderer.invoke('application:update', payload),
  applicationQueueState: (): Promise<ApplyQueueView> => ipcRenderer.invoke('application:queue:state'),
  applicationQueueAdd: (payload: { items: unknown[] }): Promise<ApplyQueueView> =>
    ipcRenderer.invoke('application:queue:add', payload),
  applicationQueueStart: (): Promise<ApplyQueueView> => ipcRenderer.invoke('application:queue:start'),
  applicationQueueStop: (): Promise<ApplyQueueView> => ipcRenderer.invoke('application:queue:stop'),
  applicationQueueRetry: (payload?: { id?: string; ids?: string[] }): Promise<ApplyQueueView> =>
    ipcRenderer.invoke('application:queue:retry', payload),
  applicationQueueSkip: (payload: { id: string }): Promise<ApplyQueueView> =>
    ipcRenderer.invoke('application:queue:skip', payload),
  applicationQueueRemove: (payload: { id: string }): Promise<ApplyQueueView> =>
    ipcRenderer.invoke('application:queue:remove', payload),
  applicationQueueClear: (): Promise<ApplyQueueView> => ipcRenderer.invoke('application:queue:clear'),
  onApplyQueueTick: (cb: (state: unknown) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, state: unknown) => cb(state)
    ipcRenderer.on('apply-queue:tick', fn)
    return () => ipcRenderer.removeListener('apply-queue:tick', fn)
  },
  easyApply: (payload: {
    jobUrl: string
    jobTitle?: string
    company?: string
    location?: string
    descriptionSnippet?: string
    reasonSnippet?: string
  }) =>
    ipcRenderer.invoke('application:easyApply', payload),

  // Applicant profile (for Easy Apply)
  applicantGet: (): Promise<ApplicantProfileView> => ipcRenderer.invoke('applicant:get'),
  applicantSave: (payload: Partial<ApplicantProfile>): Promise<ApplicantProfileSaveView> =>
    ipcRenderer.invoke('applicant:save', payload),
  applicantUploadResume: (): Promise<
    { ok: true; profile: ApplicantProfile; detail: string } | { ok: false; detail: string }
  > => ipcRenderer.invoke('applicant:upload-resume'),
  applicantRemoveResume: (): Promise<
    { ok: true; profile: ApplicantProfile; detail: string } | { ok: false; detail: string }
  > => ipcRenderer.invoke('applicant:remove-resume'),
  applicantUploadCoverLetter: (): Promise<
    { ok: true; profile: ApplicantProfile; detail: string } | { ok: false; detail: string }
  > => ipcRenderer.invoke('applicant:upload-cover-letter'),
  applicantRemoveCoverLetter: (): Promise<
    { ok: true; profile: ApplicantProfile; detail: string } | { ok: false; detail: string }
  > => ipcRenderer.invoke('applicant:remove-cover-letter'),
  applicantPromoteScreeningAnswers: (): Promise<
    { promoted: number; profile: ApplicantProfile }
  > => ipcRenderer.invoke('applicant:promoteScreeningAnswers'),

  outreachCandidates: (): Promise<{
    ok: true
    candidates: Array<{
      applicationRecordId: string
      jobTitle: string
      company: string
      jobUrl: string
      hiringTeamSearchHint?: string
      createdAt?: string
    }>
  }> => ipcRenderer.invoke('application:outreach:candidates'),

  outreachMarkSent: (payload: {
    applicationRecordId: string
    targetUrl?: string
    targetName?: string
  }): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke('application:outreach:markSent', payload),

  outreachSkip: (payload: {
    applicationRecordId: string
  }): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke('application:outreach:skip', payload),

  outreachSearchHiringManager: (
    payload: OutreachSearchHiringManagerPayload
  ): Promise<OutreachSearchHiringManagerResult> =>
    ipcRenderer.invoke('application:outreach:searchHiringManager', payload),

  outreachRun: (payload: OutreachRunPayload): Promise<OutreachRunResult> =>
    ipcRenderer.invoke('application:outreach:run', payload),

  outreachRunChain: (payload?: OutreachRunChainPayload): Promise<OutreachRunChainResult> =>
    ipcRenderer.invoke('application:outreach:runChain', payload),

  onOutreachChainProgress: (cb: (progress: OutreachChainProgressEvent) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, progress: OutreachChainProgressEvent) => cb(progress)
    ipcRenderer.on('outreach:chainProgress', fn)
    return () => ipcRenderer.removeListener('outreach:chainProgress', fn)
  },

  onPostApplyOutreachReady: (cb: (data: { candidates: Array<{ applicationRecordId: string; jobTitle: string; company: string; jobUrl: string }> }) => void): () => void => {
    const fn = (_e: unknown, data: { candidates: Array<{ applicationRecordId: string; jobTitle: string; company: string; jobUrl: string }> }) => cb(data)
    ipcRenderer.on('postApplyOutreachReady', fn)
    return () => ipcRenderer.removeListener('postApplyOutreachReady', fn)
  },

  onAppToast: (cb: (toast: { message: string; tone: 'info' | 'ok' | 'warn' | 'error' }) => void): () => void => {
    const fn = (_e: Electron.IpcRendererEvent, toast: { message: string; tone: 'info' | 'ok' | 'warn' | 'error' }) => cb(toast)
    ipcRenderer.on('app:toast', fn)
    return () => ipcRenderer.removeListener('app:toast', fn)
  },

  followupSendDm: (payload: {
    profileUrl: string
    firstName?: string
    company?: string
    jobTitle?: string
    message?: string
  }): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke('followup:sendDm', payload),

  followupMarkReplied: (payload: { profileUrl: string }): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke('followup:markReplied', payload),

  followUpState: (): Promise<{
    ok: true
    recentAccepts: Array<{ name: string; profileUrl: string; company?: string; acceptedAt?: string }>
    pendingFollowUps: Array<{ name: string; profileUrl: string; company?: string; daysSinceAccept: number }>
    staleConnections: Array<{ name: string; profileUrl: string; company?: string; daysSinceAccept: number }>
    stats: { acceptsThisWeek: number; dmsSent: number; stale: number }
  }> => ipcRenderer.invoke('followup:state'),

  followupDetectNow: (): Promise<Array<{ profileUrl: string; displayName: string }>> =>
    ipcRenderer.invoke('followup:detectNow'),

  followupGetNewAccepts: (): Promise<{ accepts: Array<{ profileUrl: string; displayName: string }> }> =>
    ipcRenderer.invoke('followup:newAccepts'),

  followupClearAccepts: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('followup:clearAccepts'),

  onFollowupNewAccepts: (cb: (accepts: Array<{ profileUrl: string; displayName: string }>) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { accepts: Array<{ profileUrl: string; displayName: string }> }) => {
      cb(data.accepts)
    }
    ipcRenderer.on('followup:newAccepts', handler)
    return () => ipcRenderer.removeListener('followup:newAccepts', handler)
  },

  backupExport: (): Promise<{ ok: boolean; path?: string; detail: string }> =>
    ipcRenderer.invoke('backup:export'),

  backupImport: (): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke('backup:import'),

  // -- Auth + monetization infrastructure ---
  authSetToken: (token: string | null) => ipcRenderer.invoke('auth:setToken', token),
  authGoogleSignIn: () => ipcRenderer.invoke('auth:googleSignIn'),
  authRegister: () => ipcRenderer.invoke('auth:register'),
  authGetUser: () => ipcRenderer.invoke('auth:getUser'),
  authGetServiceConfig: () => ipcRenderer.invoke('auth:getServiceConfig'),
  planGetState: () => ipcRenderer.invoke('plan:getState'),
  planCheckCanAct: (actionType: 'apply' | 'outreach') =>
    ipcRenderer.invoke('plan:canAct', actionType),
  planGetCounters: () => ipcRenderer.invoke('plan:getCounters'),
  planCreateCheckout: (product: 'plus' | 'boost' | 'bundle' | 'blitz') =>
    ipcRenderer.invoke('plan:createCheckout', product),
  planDevOverride: (plan: 'free' | 'plus' | 'reset') =>
    ipcRenderer.invoke('plan:devOverride', plan),

  accountDelete: () => ipcRenderer.invoke('account:delete'),
  accountRestorePurchases: () => ipcRenderer.invoke('account:restorePurchases'),

  followupPendingQueue: (): Promise<{ items: Array<{ id: string; profileUrl: string; displayName: string; company?: string; jobTitle?: string; scheduledSendAt: string; status: string }> }> =>
    ipcRenderer.invoke('followup:pendingQueue'),

  followupCancelQueued: (payload: { id: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('followup:cancelQueued', payload),

  onFollowupQueueUpdate: (cb: (data: { items: Array<{ id: string; profileUrl: string; displayName: string; company?: string; jobTitle?: string; scheduledSendAt: string; status: string }> }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { items: Array<{ id: string; profileUrl: string; displayName: string; company?: string; jobTitle?: string; scheduledSendAt: string; status: string }> }) => {
      cb(data)
    }
    ipcRenderer.on('followupQueueUpdate', handler)
    return () => ipcRenderer.removeListener('followupQueueUpdate', handler)
  },

  onUpdateReady: (cb: (info: { version: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: { version: string }) => cb(info)
    ipcRenderer.on('app:update-ready', handler)
    return () => ipcRenderer.removeListener('app:update-ready', handler)
  },

  updaterQuitAndInstall: (): Promise<{ status: 'ok' | 'dev' | 'error'; message?: string }> => ipcRenderer.invoke('updater:quitAndInstall'),

  updaterCheckForUpdates: (): Promise<{ status: 'ok'; version?: string } | { status: 'error'; message: string } | { status: 'dev' }> =>
    ipcRenderer.invoke('updater:checkForUpdates'),

  onFatalError: (cb: (error: { message: string; stack?: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: { message: string; stack?: string }) => cb(error)
    ipcRenderer.on('app:fatal-error', handler)
    return () => ipcRenderer.removeListener('app:fatal-error', handler)
  },

  onPlanStateChanged: (cb: (state: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => cb(state)
    ipcRenderer.on('plan:stateChanged', handler)
    return () => ipcRenderer.removeListener('plan:stateChanged', handler)
  },

  getAppVersion: (): string => {
    try {
      const args = process.argv.find((a) => a.startsWith('--app-version='))
      return args ? args.split('=')[1]! : 'dev'
    } catch { return 'dev' }
  },

  isDevMode: process.env.NODE_ENV !== 'production'
})
