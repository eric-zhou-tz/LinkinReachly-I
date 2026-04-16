/// <reference types="vite/client" />

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
  ApplyQueueState,
  ApplyQueueView
} from '@core/application-types'
import type { JobsProgressState } from '@core/jobs-progress'
import type { AiFieldDefinition, QueueStartRequest, TargetRow } from '@core/types'

export type { TargetRow }

export interface UserProfileView {
  name: string
  location: string
  email: string
  linkedinUrl: string
  summary: string
  entries: Array<{
    role: string
    company: string
    startDate: string
    endDate: string
    durationMonths: number
    skills: string[]
  }>
  education: Array<{
    institution: string
    degree: string
    field: string
    graduationYear: number
  }>
  totalYearsExperience: number
  lastUpdated: string
}

type ApplicantResumeMutationView =
  | {
      ok: true
      profile: ApplicantProfile
      detail: string
    }
  | {
      ok: false
      detail: string
    }

export interface LoApi {
  settingsGet: () => Promise<unknown>
  settingsSave: (partial: Record<string, unknown>) => Promise<unknown>
  settingsSaveBundle: (payload: {
    settings: Record<string, unknown>
    apiKey?: string | null
  }) => Promise<unknown>
  settingsSetApiKey: (key: string | null) => Promise<unknown>
  missionPlan: (payload: {
    prompt: string
    draft?: Record<string, unknown>
    apiKey?: string | null
  }) => Promise<unknown>
  composePreview: (payload: {
    draft?: Record<string, unknown>
    apiKey?: string | null
    target?: TargetRow
  }) => Promise<unknown>
  bridgeStatus: () => Promise<{
    port: number
    extensionConnected: boolean
    activeLinkedInTab?: boolean
    /** TODO: wire from extension when available */
    pendingInviteCount?: number
  }>
  bridgePing: () => Promise<{ ok: boolean; detail: string }>
  collectProspectsFromPlan: (payload: { query: string }) => Promise<unknown>
  logsRecent: () => Promise<unknown[]>
  runtimeLogTail: (payload?: { maxLines?: number }) => Promise<{ ok: true; lines: string[] }>
  logsExport: () => Promise<{ ok: true; path: string } | { ok: false; canceled?: boolean }>
  logsClear: () => Promise<{ ok: true; cleared: number }>
  onRuntimeLogLine: (cb: (line: { text: string; level: string; t: number }) => void) => () => void
  queueState: () => Promise<unknown>
  queueStart: (payload: TargetRow[] | QueueStartRequest) => Promise<
    | { ok: true }
    | {
        ok: false
        reason: 'already_running' | 'no_targets' | 'bridge_not_ready'
        detail?: string
      }
  >
  queueStop: () => Promise<{ ok: boolean }>
  onQueueTick: (cb: (s: unknown) => void) => () => void
  onBridgeActivity: (cb: () => void) => () => void
  jobsProgressState: () => Promise<JobsProgressState | null>
  onJobsProgress: (cb: (progress: JobsProgressState | null) => void) => () => void
  userProfileGet: () => Promise<{ ok: boolean; profile?: UserProfileView; hasProfile: boolean }>
  profileImportMine: (payload?: { persist?: boolean; restoreAfter?: boolean }) => Promise<unknown>
  testApiKey: (payload: { apiKey?: string | null }) => Promise<{ ok: boolean; detail: string }>
  jobsSearch: (payload: { keywords: string; location?: string }) => Promise<unknown>
  jobsLoadMoreJobListings: (payload?: {
    existingJobUrls?: string[]
    keywords?: string
    location?: string
  }) => Promise<unknown>
  jobsScreen: (payload: { criteria: string; jobs: unknown[]; apiKey?: string | null }) => Promise<unknown>
  jobsSmartSearch: (payload: { background: string; location?: string; apiKey?: string | null; cachedDescriptions?: Record<string, string>; sourceUrl?: string }) => Promise<unknown>
  jobsCancelSearch: () => Promise<unknown>
  campaignActive: () => Promise<unknown>
  campaignCreate: (payload: { goal: string; plan: { title: string; summary: string; executionId: string; searchQuery: string }; targets: TargetRow[] }) => Promise<unknown>
  campaignResume: () => Promise<unknown>
  campaignMarkSent: (payload: { campaignId: string; profileUrls: string[] }) => Promise<unknown>
  campaignArchive: (payload: { campaignId: string }) => Promise<unknown>
  sessionToken: () => Promise<string>
  feedbackSubmit: (payload: {
    type: 'bug' | 'feature' | 'general'
    text: string
    rating?: number | null
    page?: string
  }) => Promise<{ ok: boolean; id?: string }>
  surveySubmit: (payload: {
    surveyType: 'csat' | 'pmf' | 'nps' | 'onboarding'
    answers: Record<string, unknown>
    score?: number | null
  }) => Promise<{ ok: boolean; id?: string }>
  surveyCanShow: (payload: { surveyType: string; cooldownDays: number }) => Promise<{ canShow: boolean }>
  trackEvent: (name: string, properties?: Record<string, unknown>) => Promise<{ ok: boolean }>
  trackOnboarding: (step: string, meta?: Record<string, unknown>) => Promise<{ ok: boolean }>
  trackFirstJobSearch: () => Promise<{ ok: boolean }>
  trackFirstExtensionConnect: () => Promise<{ ok: boolean }>
  openExtensionFolder: () => Promise<string>
  openUserData: () => Promise<void>
  openLogsFolder: () => Promise<string>
  openExternalUrl: (url: string) => Promise<{ ok: true } | { ok: false; detail: string }>
  generateAiFields: (payload: { fields: AiFieldDefinition[]; target: TargetRow; apiKey?: string | null }) => Promise<unknown>
  uploadResume: () => Promise<{ ok: true; fileName: string; charCount: number } | { ok: false; detail: string }>
  uploadResumeFile: (file: File) => Promise<{ ok: true; fileName: string; charCount: number } | { ok: false; detail: string }>
  clearResume: () => Promise<{ ok: true }>
  tailorResume: (payload: {
    currentHeadline: string
    currentSummary: string
    jobDescription: string
    jobTitle: string
    company: string
  }) => Promise<{ ok: boolean; headline: string; summary: string; tailored: boolean }>
  applicationStatus: () => Promise<ApplicationAssistantStatusView>
  applicationExtensionHealth: () => Promise<ApplicationExtensionHealthView>
  applicationDetect: (payload?: { url?: string }) => Promise<ApplicationAssistantDetectView>
  applicationHistory: () => Promise<ApplicationHistoryView>
  applicationHistoryDelete: (payload: { id: string }) => Promise<ApplicationHistoryView>
  applicationHistoryExportCsv: () => Promise<{ ok: boolean; csv: string }>
  applicationRecord: (payload: ApplicationRecordInput) => Promise<ApplicationRecordSaveView>
  applicationSave: (payload: ApplicationRecordInput) => Promise<ApplicationRecordSaveView>
  applicationUpdate: (
    payload: { id: string } & Partial<ApplicationRecordInput>
  ) => Promise<ApplicationRecordSaveView>
  applicationQueueState: () => Promise<ApplyQueueView>
  applicationQueueAdd: (payload: { items: unknown[] }) => Promise<ApplyQueueView>
  applicationQueueStart: () => Promise<ApplyQueueView>
  applicationQueueStop: () => Promise<ApplyQueueView>
  applicationQueueRetry: (payload?: { id?: string; ids?: string[] }) => Promise<ApplyQueueView>
  applicationQueueSkip: (payload: { id: string }) => Promise<ApplyQueueView>
  applicationQueueRemove: (payload: { id: string }) => Promise<ApplyQueueView>
  applicationQueueClear: () => Promise<ApplyQueueView>
  onApplyQueueTick: (cb: (state: ApplyQueueState) => void) => () => void
  easyApply: (payload: {
    jobUrl: string
    jobTitle?: string
    company?: string
    location?: string
    descriptionSnippet?: string
    reasonSnippet?: string
  }) => Promise<unknown>
  applicantGet: () => Promise<ApplicantProfileView>
  applicantSave: (payload: Partial<ApplicantProfile>) => Promise<ApplicantProfileSaveView>
  applicantUploadResume: () => Promise<ApplicantResumeMutationView>
  applicantRemoveResume: () => Promise<ApplicantResumeMutationView>
  applicantUploadCoverLetter: () => Promise<ApplicantResumeMutationView>
  applicantRemoveCoverLetter: () => Promise<ApplicantResumeMutationView>
  applicantPromoteScreeningAnswers: () => Promise<{ promoted: number; profile: ApplicantProfile }>

  outreachCandidates: () => Promise<{
    ok: true
    candidates: Array<{
      applicationRecordId: string
      jobTitle: string
      company: string
      jobUrl: string
      hiringTeamSearchHint?: string
      createdAt?: string
    }>
  }>
  outreachMarkSent: (payload: {
    applicationRecordId: string
    targetUrl?: string
    targetName?: string
  }) => Promise<{ ok: boolean; detail: string }>
  outreachSkip: (payload: { applicationRecordId: string }) => Promise<{ ok: boolean; detail: string }>
  outreachSearchHiringManager: (payload: {
    company: string
    jobTitle?: string
    searchHint?: string
    hiringTeam?: Array<{ name?: string; title?: string; profileUrl?: string }>
  }) => Promise<{
    ok: boolean
    targets: Array<{ profileUrl: string; firstName: string; company: string; headline: string }>
    detail: string
  }>

  outreachRun: (payload: {
    targets: Array<{
      profileUrl: string
      firstName: string
      company: string
      headline?: string
      jobTitle?: string
      jobUrl?: string
      applicationRecordId?: string
    }>
  }) => Promise<{ ok: boolean; sent: number; detail: string }>

  outreachRunChain: (payload?: {
    candidateIds?: string[]
    maxTargets?: number
  }) => Promise<{
    ok: boolean
    sent: number
    skipped: number
    detail: string
    results: Array<{ applicationRecordId: string; status: string; targetName?: string; jobUrl?: string }>
  }>

  onOutreachChainProgress: (cb: (progress: {
    phase: string
    current: number
    total: number
    company: string
    applicationRecordId?: string
  }) => void) => () => void

  onPostApplyOutreachReady: (cb: (data: {
    candidates: Array<{ applicationRecordId: string; jobTitle: string; company: string; jobUrl: string }>
  }) => void) => () => void

  onAppToast: (cb: (toast: { message: string; tone: 'info' | 'ok' | 'warn' | 'error' }) => void) => () => void

  followupSendDm: (payload: {
    profileUrl: string
    firstName?: string
    company?: string
    jobTitle?: string
    message?: string
  }) => Promise<{ ok: boolean; detail: string }>
  followupMarkReplied: (payload: { profileUrl: string }) => Promise<{ ok: boolean; detail: string }>
  followupArchive: (payload: { profileUrl: string }) => Promise<{ ok: boolean; detail: string }>

  followUpState: () => Promise<{
    ok: true
    recentAccepts: Array<{ name: string; profileUrl: string; company?: string; acceptedAt?: string }>
    pendingFollowUps: Array<{ name: string; profileUrl: string; company?: string; daysSinceAccept: number }>
    staleConnections: Array<{ name: string; profileUrl: string; company?: string; daysSinceAccept: number }>
    awaitingReply: Array<{ name: string; profileUrl: string; company?: string; daysSinceAccept: number }>
    responded: Array<{ name: string; profileUrl: string; company?: string }>
    stats: { acceptsThisWeek: number; dmsSent: number; stale: number; awaitingReply: number; responded: number }
  }>
  followupDetectNow: () => Promise<Array<{ profileUrl: string; displayName: string }>>
  followupGetNewAccepts: () => Promise<{ accepts: Array<{ profileUrl: string; displayName: string }> }>
  followupClearAccepts: () => Promise<{ ok: boolean }>
  onFollowupNewAccepts: (cb: (accepts: Array<{ profileUrl: string; displayName: string }>) => void) => () => void
  backupExport: () => Promise<{ ok: boolean; path?: string; detail: string }>
  backupImport: () => Promise<{ ok: boolean; detail: string }>
  cacheClearAll: () => Promise<{ ok: boolean; detail: string }>
  followupPendingQueue: () => Promise<{ items: Array<{ id: string; profileUrl: string; displayName: string; company?: string; jobTitle?: string; scheduledSendAt: string; status: string }> }>
  followupCancelQueued: (payload: { id: string }) => Promise<{ ok: boolean }>
  onFollowupQueueUpdate: (cb: (data: { items: Array<{ id: string; profileUrl: string; displayName: string; company?: string; jobTitle?: string; scheduledSendAt: string; status: string }> }) => void) => () => void

  onUpdateReady: (cb: (info: { version: string }) => void) => () => void
  updaterQuitAndInstall: () => Promise<{ status: 'ok' | 'dev' | 'error'; message?: string }>
  updaterCheckForUpdates: () => Promise<{ status: 'ok'; version?: string } | { status: 'error'; message: string } | { status: 'dev' }>
  onFatalError: (cb: (error: { message: string; stack?: string }) => void) => () => void
  onPlanStateChanged: (cb: (state: unknown) => void) => () => void
  getAppVersion: () => string
  isDevMode: boolean

  // -- Auth + monetization infrastructure ---
  authSetToken: (token: string | null) => Promise<{ ok: boolean }>
  authGoogleSignIn: () => Promise<{ ok: true; idToken: string; accessToken: string } | { ok: false; error: string }>
  authRegister: () => Promise<unknown>
  authGetUser: () => Promise<unknown>
  authGetServiceConfig: () => Promise<{
    firebase: { apiKey: string; authDomain: string; projectId: string; appId: string }
    hasBackend: boolean
  }>
  planGetState: () => Promise<{
    userId: string | null
    plan: 'free' | 'plus'
    creditBalance: number
    trialStartedAt: string | null
    trialEndsAt: string | null
    dailyApplyLimit: number
    dailyOutreachLimit: number
    isTrialing: boolean
    trialDaysRemaining: number
  }>
  planCheckCanAct: (actionType: 'apply' | 'outreach') => Promise<unknown>
  planGetCounters: () => Promise<unknown>
  planCreateCheckout: (product: 'plus' | 'boost' | 'bundle' | 'blitz') => Promise<unknown>
  planDevOverride: (plan: 'free' | 'plus' | 'reset') => Promise<unknown>
  accountDelete: () => Promise<{ ok: boolean; error?: string }>
  accountRestorePurchases: () => Promise<{ ok: boolean; data?: unknown; error?: string }>
}

declare global {
  interface Window {
    /** Set by Electron preload; absent in a plain browser tab (then the UI uses loopback HTTP). */
    loa?: LoApi
  }
}

/** `inert` is valid in Chromium; React 18 expects a string when writing to the DOM. */
declare module 'react' {
  interface HTMLAttributes<T> {
    inert?: '' | 'true' | undefined
  }
}

export {}
