import * as Sentry from '@sentry/electron/main'

Sentry.init({
  dsn: process.env.LR_SENTRY_DSN || '',
  enabled: !!process.env.LR_SENTRY_DSN,
  release: `linkinreachly@${process.env.npm_package_version || '1.0.0'}`,
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  tracesSampleRate: 0.2,
})

import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItem, nativeImage, powerSaveBlocker, session, shell, Tray } from 'electron'
import type { Server } from 'node:http'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import contextMenu from 'electron-context-menu'
import unhandled from 'electron-unhandled'
import windowStateKeeper from 'electron-window-state'
import { parseTargetsCsv } from '@core/csv-targets'
import type { JobsProgressState } from '@core/jobs-progress'
import { normalizeJobsSearchHistory } from '@core/job-search-history'
import { isLinkedInUrl } from '@core/linkedin-url'
import { defaultRemoteDebuggingPortForPackaging } from '@core/runtime-ports'
import {
  buildUserBackgroundFromLinkedInProfile,
  type LinkedInProfileSnapshot
} from '@core/profile-background'
import {
  bridgeEvents,
  getActiveLinkedInTab,
  getActiveLinkedInTabUrl,
  getBridgePort,
  isExtensionConnected,
  sendCommand,
  startBridge,
  stopBridge
} from './bridge'
import { startFollowupDetector, stopFollowupDetector, runDetectNow, getNewAccepts, clearNewAccepts } from './followup-detector'
import { getPendingFollowUps, cancelFollowUp } from './followup-queue'
import { exportBackup, importBackup } from './backup-restore'
import { submitFeedback as submitFeedbackLocal, submitSurvey as submitSurveyLocal, hasSurveyBeenShown, type FeedbackPayload, type SurveyPayload } from './feedback'
import {
  appendMainLog,
  clearMainLog,
  loadLogHistory,
  loadRecentConnectionInvites,
  loadRecentLogLines,
  readMainLogText,
  type LogStatus,
  type OutreachLogEntry
} from './logger'
import log from 'electron-log/main.js'
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater
import { appLog, initializeAppLogging, readRuntimeLogTailLines, runtimeLogsDir } from './app-log'
import { installRuntimeLogBroadcastHook, setRuntimeLogBroadcastTarget } from './runtime-log-broadcast'
import { getQueueState, isQueueBusy, requestStop, runQueue } from './queue'
import {
  composeMessageDetailed,
  generateAiFields,
  linkedInPeopleSearchUrl,
  planMission,
  testApiKey
} from './llm'
import { uploadResume, clearResume, importResumeFromPath, importResumeFromData } from './resume'
import { parseResumeMarkdown } from '@core/resume-parser'
import type { UserProfile } from '@core/profile-db'
import { loadUserProfile, saveUserProfile, hasUserProfile } from './profile-store'
import { syncApplicantFromUserProfile } from './user-applicant-sync'
import { loadApplicantProfile, retryAllStuckFromCurrentAnswerBank } from './applicant-profile-store'
import { buildEasyApplyProfileFieldMap, resolveWorkExperienceFieldOverridesByIndex, resolveEducationFieldOverridesByIndex } from '@core/easy-apply-field-map'
import {
  handleApplicationAssistantChannel,
  isApplicationAssistantChannel,
  registerApplicationAssistantIpc
} from './application-assistant'
import { configureApplyQueueNotifier } from './apply-queue-runner'
import {
  archiveCampaign,
  createCampaign,
  getCampaignSummary,
  getRemainingTargets,
  loadActiveCampaign,
  markTargetsSent
} from './campaign'
import {
  getApiKey,
  loadSettings,
  saveSettings,
  saveSettingsAsync,
  saveSettingsWithApiKeyAsync,
  normalizeBridgePort,
  type AppSettings
} from './settings'
import {
  DEFAULT_EXECUTION_ID,
  getExecutionById,
  sourceConnectionExecutionForLogEntry
} from '@core/executions'
import type { ProfileFacts, QueueStartRequest, TargetRow } from '@core/types'
import { startLoaHttpBridge, getSessionToken } from './loa-http'
import {
  hardenSession,
  parseAllowedRendererDevUrl,
  registerElectronSecurityHooks
} from './electron-security'
import { openExternalUrl, secureBrowserWindowNavigation } from './window-security'
import { configureRuntimeIdentity, userDataDir } from './user-data-path'
import { registerJobsHandlers } from './ipc-handlers-jobs'
import { registerGeneralHandlers } from './ipc-handlers-general'
import { setFirebaseToken, getPlanState as getPlanStateImport, updatePlanState as updatePlanStateImport, isAuthenticated as isAuthenticatedImport, onPlanStateChanged } from './auth-service'
import { getServiceConfig as getServiceConfigImport, isBackendConfigured as isBackendConfiguredImport } from './service-config'
import { googleSignInViaWindow as googleSignInViaWindowImport } from './google-auth'
import { registerUser, getUserMe, checkCanAct, getCounters as getCountersImport, createCheckoutSession, syncServerUsage, trackOnboardingServer, activateTrialOnExtensionConnect } from './api-client'
// firestore-client.ts is no longer used — all Firestore ops go through Cloud Functions
import { trackAppOpened, trackOnboardingStep, trackFirstJobSearch, trackFirstExtensionConnect, trackGenericEvent, trackExtensionConnected, trackExtensionDisconnected, setTelemetryEnabled, type OnboardingStep } from './telemetry'
import { startEventQueue, stopEventQueue } from './event-queue'
import { attachUpdateReadyNotifier } from './auto-updater-ui'
import { getLoaInvokeGateBlock } from './loa-invoke-gates'

const __dirname = dirname(fileURLToPath(import.meta.url))

configureRuntimeIdentity()
initializeAppLogging()
installRuntimeLogBroadcastHook(log)

let mainWindow: BrowserWindow | null = null
let loaHttpServer: Server | null = null
let jobsProgressState: JobsProgressState | null = null
let jobsProgressClearTimer: ReturnType<typeof setTimeout> | null = null
let activeSearchAbortController: AbortController | null = null
let disposeContextMenu: (() => void) | null = null
let mainWindowState: ReturnType<typeof windowStateKeeper> | null = null
let powerSaveBlockerId: number | null = null
let tray: Tray | null = null

unhandled({
  showDialog: false,
  logger: (error) => {
    appLog.error('[loa] Unhandled error:', error)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:fatal-error', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
    }
    // Report to server-side error collection
    try {
      const { trackError } = require('./telemetry') as typeof import('./telemetry')
      trackError('uncaught_exception', error instanceof Error ? error.message : String(error), {
        severity: 'fatal',
        stack: error instanceof Error ? error.stack : undefined,
      })
    } catch { /* telemetry may not be initialized yet */ }
  }
})
registerElectronSecurityHooks()

const isBackgroundMode = process.argv.includes('--background')
const isTestEnv = process.env.NODE_ENV === 'test'

if (process.env.NODE_ENV !== 'production') {
  const debugPort = process.env.REMOTE_DEBUGGING_PORT || String(defaultRemoteDebuggingPortForPackaging(app.isPackaged))
  app.commandLine.appendSwitch('remote-debugging-port', debugPort)
}
const gotSingleInstanceLock = isTestEnv || app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
}

function filterValidTargets(targets: TargetRow[]): TargetRow[] {
  return targets.filter((t) => {
    const profileUrl = typeof t.profileUrl === 'string' ? t.profileUrl.trim() : ''
    const searchQuery = typeof t.searchQuery === 'string' ? t.searchQuery.trim() : ''
    const personName = typeof t.personName === 'string' ? t.personName.trim() : ''
    const company = typeof t.company === 'string' ? t.company.trim() : ''
    return isLinkedInUrl(profileUrl) || !!searchQuery || !!personName || !!company
  })
}


function appendHistoryEvent(
  entry: Omit<OutreachLogEntry, 'timestamp' | 'status'> & { status?: LogStatus }
): void {
  appendMainLog({
    ...entry,
    timestamp: new Date().toISOString(),
    status: entry.status || 'info'
  })
}


function previewTargetForExecution(executionId: string): TargetRow {
  const ex = getExecutionById(executionId) ?? getExecutionById(DEFAULT_EXECUTION_ID)!
  const parsed = ex.starterCsv ? parseTargetsCsv(ex.starterCsv) : []
  const first = parsed[0]
  if (first) return first
  return {
    profileUrl: 'https://www.linkedin.com/in/demo-avery-chen/',
    firstName: 'Avery',
    company: 'Northbridge Labs',
    headline: 'VP Product'
  }
}

function latestFollowUpPreviewSource() {
  const invites = loadRecentConnectionInvites(600)
  for (let i = invites.length - 1; i >= 0; i--) {
    const entry = invites[i]!
    const sourceExecution = sourceConnectionExecutionForLogEntry(entry)
    if (!sourceExecution) continue
    const fallback = previewTargetForExecution(sourceExecution.id)
    return {
      execution: sourceExecution,
      target: {
        ...fallback,
        profileUrl: entry.profileUrl || fallback.profileUrl,
        firstName: entry.name?.split(/\s+/)[0] || fallback.firstName,
        company: entry.company || fallback.company
      }
    }
  }
  return null
}

function resolveIconPath(name = 'icon.png'): string | undefined {
  const candidates = [
    join(app.getAppPath(), 'build', name),
    join(app.getAppPath(), 'build', 'icons', name),
    join(process.cwd(), 'build', name),
    join(process.cwd(), 'build', 'icons', name),
    join(dirname(__dirname), '..', 'build', name),
    join(dirname(__dirname), '..', 'build', 'icons', name)
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return undefined
}

function startPowerSaveBlock(): void {
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) return
  powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
  appLog.info('[power] Power save blocker started', { id: powerSaveBlockerId })
}

function stopPowerSaveBlock(): void {
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId)
    appLog.info('[power] Power save blocker stopped', { id: powerSaveBlockerId })
  }
  powerSaveBlockerId = null
}


function createOrUpdateTray(): void {
  if (tray && !tray.isDestroyed()) {
    tray.destroy()
  }
  const iconPath = resolveIconPath('tray-icon.png') ?? resolveIconPath()
  if (!iconPath) return
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
  tray = new Tray(trayIcon)
  tray.setToolTip('LinkinReachly')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show LinkinReachly',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
        } else {
          createWindow()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit()
    }
  ])
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!isBackgroundMode) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    return
  }

  mainWindowState ||= windowStateKeeper({
    defaultWidth: 1280,
    defaultHeight: 820,
    file: 'main-window-state.json'
  })

  const icon = resolveIconPath()
  const isDarwin = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 960,
    minHeight: 640,
    title: 'LinkinReachly',
    icon: icon || undefined,
    show: false,
    titleBarStyle: isDarwin ? 'hidden' : 'default',
    trafficLightPosition: isDarwin ? { x: 16, y: 14 } : undefined,
    vibrancy: isDarwin ? 'window' : undefined,
    frame: !isDarwin,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--app-version=${app.getVersion()}`]
    }
  })

  mainWindowState.manage(mainWindow)
  secureBrowserWindowNavigation(mainWindow)

  onPlanStateChanged((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('plan:stateChanged', state)
    }
  })

  configureApplyQueueNotifier((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('apply-queue:tick', state)
    }
    const s = state as { running?: boolean } | undefined
    if (s?.running) {
      startPowerSaveBlock()
    } else {
      stopPowerSaveBlock()
    }
  })

  setRuntimeLogBroadcastTarget(mainWindow.webContents)
  mainWindow.on('closed', () => {
    setRuntimeLogBroadcastTarget(null)
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.showInactive()
    if (isBackgroundMode && process.platform === 'darwin') {
      app.hide()
    }
  })


  mainWindow.on('unresponsive', () => {
    appLog.error('[loa] Main window became unresponsive')
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    appLog.error('[loa] Renderer process exited unexpectedly', details)
    if (details.reason !== 'clean-exit' && mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload()
      }, 1000)
    }
  })

  const rendererDevUrl = parseAllowedRendererDevUrl(process.env['ELECTRON_RENDERER_URL'])
  if (process.env['ELECTRON_RENDERER_URL'] && !rendererDevUrl) {
    appLog.warn('[loa] Ignoring unsafe ELECTRON_RENDERER_URL; expected a loopback http:// URL')
  }

  /**
   * Dev uses `loadURL(Vite)`. If Vite is not running, refresh/restart shows a blank window (failed load).
   * Fall back once to the packaged `file:` renderer so the app stays usable.
   */
  let fellBackFromFailedDevLoad = false
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || fellBackFromFailedDevLoad || !rendererDevUrl) return
      const urlStr = String(validatedURL || '')
      if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) return
      // ERR_ABORTED (-3): navigation replaced — do not treat as dead dev server
      if (errorCode === -3) return
      fellBackFromFailedDevLoad = true
      appLog.warn(
        '[loa] Renderer dev URL failed to load; loading packaged UI instead.',
        `code=${String(errorCode)} desc=${String(errorDescription)} url=${urlStr}`
      )
      mainWindow?.loadFile(join(__dirname, '../renderer/index.html'))
    }
  )

  if (rendererDevUrl) {
    mainWindow.loadURL(rendererDevUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      return
    }
    createWindow()
  })
}

function publicSettings() {
  const { apiKeyStored: _k, apiKeyIsEncrypted: _e, resumeText: _resumeText, ...rest } = loadSettings()
  const hasLocalKey = !!getApiKey()
  const proxyAvailable = !!(getServiceConfigImport().llmProxy.url && isAuthenticatedImport())
  return { ...rest, apiKeyPresent: hasLocalKey || proxyAvailable }
}

/** Keys ipc `settings:save` may change — blocks arbitrary prototype / secret fields from partial merges. */
const SETTINGS_PATCH_KEYS = new Set<string>([
  'seenOnboarding',
  'bridgePort',
  'llmProvider',
  'llmBaseUrl',
  'llmModel',
  'llmEnabled',
  'lastExecutionId',
  'lastGoal',
  'aiFieldDefinitions',
  'templates',
  'mustInclude',
  'dailyCap',
  'sessionBreaksEnabled',
  'sessionBreakEveryMin',
  'sessionBreakEveryMax',
  'sessionBreakDurationMin',
  'sessionBreakDurationMax',
  'delayBetweenRequestsMin',
  'delayBetweenRequestsMax',
  'delayBetweenActionsMin',
  'delayBetweenActionsMax',
  'resumeText',
  'resumeFileName',
  'jobsSearchKeywords',
  'jobsSearchLocation',
  'jobsSearchHistory',
  'userBackground',
  'outreachTone',
  'weeklyConnectionCap',
  'jobsScreeningCriteria',
  'customOutreachPrompt',
  'easyApplyTailorCoverLetter',
  'easyApplyEnrichCompanyContext',
  'jobsSearchRecencySeconds',
  'jobsSearchSortBy',
  'jobsSearchDistanceMiles',
  'jobsSearchExperienceLevels',
  'jobsSearchJobTypes',
  'jobsSearchRemoteTypes',
  'jobsSearchSalaryFloor',
  'jobsSearchFewApplicants',
  'jobsSearchVerifiedOnly',
  'jobsSearchEasyApplyOnly',
  'pendingInviteCount'
])

function mergeSettingsPartial(
  current: AppSettings,
  partial: Record<string, unknown> | Partial<AppSettings> | undefined
): AppSettings {
  if (!partial) return current
  const { apiKeyPresent: _ap, ...rawIn } = partial as Record<string, unknown>
  const rest: Record<string, unknown> = {}
  for (const key of SETTINGS_PATCH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(rawIn, key)) {
      rest[key] = rawIn[key]
    }
  }
  const merged = { ...current, ...rest } as AppSettings
  merged.bridgePort = normalizeBridgePort(rest.bridgePort ?? current.bridgePort)
  if (!Array.isArray(merged.templates) || merged.templates.length === 0) {
    merged.templates = current.templates
  } else {
    merged.templates = merged.templates.filter((line): line is string => typeof line === 'string')
  }
  if (!Array.isArray(merged.mustInclude)) {
    merged.mustInclude = current.mustInclude
  } else {
    merged.mustInclude = merged.mustInclude.filter((line): line is string => typeof line === 'string')
  }
  if (typeof merged.lastExecutionId === 'string' && !getExecutionById(merged.lastExecutionId)) {
    merged.lastExecutionId = current.lastExecutionId
  }
  const clampJobSearch = (v: unknown, fallback: string) =>
    typeof v === 'string' ? v.slice(0, 800) : fallback
  merged.jobsSearchKeywords = clampJobSearch(merged.jobsSearchKeywords, current.jobsSearchKeywords)
  merged.jobsSearchLocation = clampJobSearch(merged.jobsSearchLocation, current.jobsSearchLocation)
  merged.jobsSearchHistory = normalizeJobsSearchHistory(merged.jobsSearchHistory)
  merged.llmProvider = 'grok'
  merged.apiKeyStored = current.apiKeyStored
  merged.apiKeyIsEncrypted = current.apiKeyIsEncrypted
  if (typeof merged.pendingInviteCount === 'number' && Number.isFinite(merged.pendingInviteCount)) {
    merged.pendingInviteCount = Math.min(500_000, Math.max(0, Math.floor(merged.pendingInviteCount)))
  } else {
    merged.pendingInviteCount = current.pendingInviteCount
  }
  return merged
}

function restartBridgeIfNeeded(nextPort: number): void {
  if (nextPort === getBridgePort()) return
  stopBridge()
  startBridge(nextPort)
}

function broadcastBridgeActivity(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('bridge:activity')
  }
}

function broadcastJobsProgress(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('jobs:progress', jobsProgressState)
  }
}

function setJobsProgress(next: JobsProgressState | null): void {
  jobsProgressState = next
  broadcastJobsProgress()
}

function scheduleJobsProgressClear(expectedStartedAt?: number, delayMs = 2200): void {
  if (jobsProgressClearTimer) {
    clearTimeout(jobsProgressClearTimer)
    jobsProgressClearTimer = null
  }
  jobsProgressClearTimer = setTimeout(() => {
    jobsProgressClearTimer = null
    if (!jobsProgressState) return
    if (
      typeof expectedStartedAt === 'number' &&
      Number.isFinite(expectedStartedAt) &&
      jobsProgressState.startedAt !== expectedStartedAt
    ) {
      return
    }
    setJobsProgress(null)
  }, Math.max(300, delayMs))
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function extractOwnLinkedInProfileBackground(options?: {
  persist?: boolean
  restoreAfter?: boolean
}): Promise<
  | {
      ok: true
      background: string
      profile: LinkedInProfileSnapshot
      settings?: ReturnType<typeof publicSettings>
      detail: string
    }
  | { ok: false; detail: string }
> {
  const ping = await sendCommand('PING', {}, 15_000)
  if (!ping.ok) {
    return {
      ok: false,
      detail:
        ping.detail === 'open_a_linkedin_tab'
          ? 'Open a linkedin.com tab in Chrome first.'
          : ping.detail
    }
  }

  const currentUrl = options?.restoreAfter ? getActiveLinkedInTabUrl() : ''
  const profileUrl = 'https://www.linkedin.com/in/me/'

  try {
    const nav = await sendCommand('NAVIGATE', { url: profileUrl }, 45_000)
    if (!nav.ok) {
      return { ok: false, detail: nav.detail || 'Could not open your LinkedIn profile.' }
    }

    await wait(2600)
    const extracted = await sendCommand('EXTRACT_PROFILE', {}, 15_000)
    if (!extracted.ok) {
      return { ok: false, detail: extracted.detail || 'Could not read your LinkedIn profile.' }
    }

    const profile = ((extracted.data as LinkedInProfileSnapshot | undefined) || {}) as LinkedInProfileSnapshot
    const background = buildUserBackgroundFromLinkedInProfile(profile)
    if (!background || background.length < 24) {
      return { ok: false, detail: 'Your LinkedIn profile did not expose enough information to build a useful background summary.' }
    }

    let nextSettings: ReturnType<typeof publicSettings> | undefined
    if (options?.persist) {
      const current = loadSettings()
      saveSettings({ ...current, userBackground: background })
      nextSettings = publicSettings()
    }

    try {
      const parsed = parseResumeMarkdown(background)
      if (parsed.name || parsed.email) {
        saveUserProfile(parsed)
        syncApplicantFromUserProfile(parsed, background)
      }
    } catch (e) { appLog.debug('[index] applicant profile sync failed', e instanceof Error ? e.message : String(e)) }

    return {
      ok: true,
      background,
      profile,
      settings: nextSettings,
      detail: options?.persist ? 'profile_imported_and_saved' : 'profile_imported'
    }
  } finally {
    if (
      options?.restoreAfter &&
      currentUrl &&
      currentUrl !== profileUrl &&
      /linkedin\.com/i.test(currentUrl)
    ) {
      try {
        await sendCommand('NAVIGATE', { url: currentUrl }, 45_000)
      } catch (e) {
        appLog.debug(
          '[index] NAVIGATE restore after profile returned failed',
          e instanceof Error ? e.message : String(e)
        )
      }
    }
  }
}

if (gotSingleInstanceLock) app.whenReady().then(async () => {
  app.setAppUserModelId('com.lireach.app')
  appLog.info('[loa] Runtime logging ready', { dir: runtimeLogsDir() })
  hardenSession(session.defaultSession)
  disposeContextMenu ||= contextMenu({
    showInspectElement: !app.isPackaged,
    showSearchWithGoogle: false
  })

  // -- Event queue & telemetry opt-in ----------------------------------------
  const initialSettings = loadSettings()
  setTelemetryEnabled(!!initialSettings.telemetryOptIn)
  startEventQueue()

  try {
    startBridge(initialSettings.bridgePort)
  } catch (e) {
    appLog.error('Bridge failed to start', e)
  }

  try {
    const { retriedCount } = retryAllStuckFromCurrentAnswerBank()
    if (retriedCount > 0) appLog.info('[loa] startup: auto-retried stuck queue items', { retriedCount })
  } catch (e) { appLog.warn('[loa] startup retry check failed', e) }

  bridgeEvents.on('connected', () => { broadcastBridgeActivity(); trackExtensionConnected() })
  bridgeEvents.on('disconnected', () => { broadcastBridgeActivity(); trackExtensionDisconnected() })
  bridgeEvents.on('bridge-ready', broadcastBridgeActivity)
  bridgeEvents.on('port-unavailable', ({ port }: { port: number }) => {
    appLog.error(`[loa] Bridge port ${port} permanently unavailable — extension connection disabled this session`)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('bridge:activity')
    }
  })
  bridgeEvents.on('external-form-request', async (data: { tabId: number | null; frameId?: number; url: string; fields: { fields: Array<{ label: string; type: string; value: string; required: boolean; options?: string[] }>; url: string; title: string } }) => {
    try {
      const profile = loadApplicantProfile()
      const fieldMap = buildEasyApplyProfileFieldMap(profile)
      const fields = data.fields?.fields || []
      const frameId = typeof data.frameId === 'number' ? data.frameId : 0
      appLog.info(`[external-form] Received ${fields.length} fields from ${data.url} frame=${frameId}`)

      // Context-aware overrides for repeater sections (multi-education, multi-work-experience)
      const eduOverrides = resolveEducationFieldOverridesByIndex(
        fields.map((f) => ({ label: f.label, value: f.value })),
        profile.background.educationHistory
      )
      const workOverrides = resolveWorkExperienceFieldOverridesByIndex(
        fields.map((f) => ({ label: f.label, value: f.value })),
        profile.background.workHistory
      )

      let filled = 0
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i]!
        if (field.value && field.value.trim()) continue

        // Context override takes priority (correct entry for this repeater card)
        let fillValue: string | undefined
        if (workOverrides[i] !== undefined) {
          fillValue = workOverrides[i]
        } else if (eduOverrides[i] !== undefined) {
          fillValue = eduOverrides[i]
        } else {
          const labelLower = field.label.toLowerCase()
          const matchKey = Object.keys(fieldMap).find((k) => k.toLowerCase() === labelLower)
            || Object.keys(fieldMap).find((k) => {
              const kl = k.toLowerCase()
              return labelLower.includes(kl) || kl.includes(labelLower)
            })
          if (matchKey && fieldMap[matchKey]) fillValue = fieldMap[matchKey]
        }
        if (!fillValue) continue

        try {
          await sendCommand('FILL_EXTERNAL_FORM_FIELD', {
            tabId: data.tabId,
            frameId,
            label: field.label,
            value: fillValue,
            fieldIndex: i
          })
          filled++
        } catch (e) {
          appLog.warn(`[external-form] Fill failed for "${field.label}":`, e instanceof Error ? e.message : String(e))
        }
      }
      appLog.info(`[external-form] Filled ${filled}/${fields.length} fields`)
    } catch (e) {
      appLog.error('[external-form] Handler error:', e instanceof Error ? e.message : String(e))
    }
  })

  bridgeEvents.on('enrich-progress', (data: { completed: number; total: number }) => {
    if (jobsProgressState?.active) {
      setJobsProgress({
        ...jobsProgressState,
        updatedAt: Date.now(),
        enrichingCompleted: data.completed,
        enrichingTotal: data.total
      })
    }
  })

  const jobsHandlers = registerJobsHandlers({
    sendCommand,
    loadSettings,
    appendHistoryEvent,
    getJobsProgressState: () => jobsProgressState,
    setJobsProgress,
    scheduleJobsProgressClear,
    getActiveSearchAbortController: () => activeSearchAbortController,
    setActiveSearchAbortController: (c) => {
      activeSearchAbortController = c
    }
  })

  const generalHandlers = registerGeneralHandlers({
    restartBridgeIfNeeded,
    getMainWindow: () => mainWindow
  })

  async function loaInvoke(channel: string, payload: unknown): Promise<unknown> {
    const gate = getLoaInvokeGateBlock({
      channel,
      nodeEnv: process.env.NODE_ENV,
      isBackendConfigured: isBackendConfiguredImport(),
      isAuthenticated: isAuthenticatedImport(),
      planState: getPlanStateImport(),
    })
    if (gate) {
      if (gate.kind === 'auth') {
        appLog.warn('[auth-gate] Blocked unauthenticated access', { channel })
      } else {
        appLog.info('[plan-gate] Blocked free-tier access to plus feature', { channel })
      }
      return { ok: false, error: gate.error }
    }

    const jobsHandler = jobsHandlers.get(channel)
    if (jobsHandler) return jobsHandler(payload)
    const generalHandler = generalHandlers.get(channel)
    if (generalHandler) return generalHandler(payload)
    if (isApplicationAssistantChannel(channel)) return handleApplicationAssistantChannel(channel, payload)
    if (channel === 'auth:getServiceConfig') {
      const config = getServiceConfigImport()
      return { firebase: config.firebase, hasBackend: isBackendConfiguredImport() }
    }
    if (channel === 'auth:setToken') {
      setFirebaseToken(payload as string | null)
      if (payload) {
        void getUserMe().catch((err) =>
          appLog.warn('[auth] getUserMe failed', err instanceof Error ? err.message : String(err))
        )
        void syncServerUsage().catch((err) =>
          appLog.warn('[auth] syncServerUsage failed', err instanceof Error ? err.message : String(err))
        )
      }
      return { ok: true }
    }
    if (channel === 'auth:googleSignIn') {
      return googleSignInViaWindowImport()
    }
    if (channel === 'auth:register') return registerUser()
    if (channel === 'auth:getUser') return getUserMe()
    if (channel === 'plan:getState') return getPlanStateImport()
    if (channel === 'plan:canAct') {
      if (process.env.NODE_ENV !== 'production') {
        return { ok: true, data: { allowed: true } }
      }
      const actionType = payload as 'apply' | 'outreach'
      if (!isAuthenticatedImport()) {
        return { ok: true, data: { allowed: false, reason: 'Sign in to continue.' } }
      }
      if (isBackendConfiguredImport()) return checkCanAct(actionType)
      return { ok: true, data: { allowed: true } }
    }
    if (channel === 'plan:getCounters') return getCountersImport()
    throw new Error(`Unknown channel: ${channel}`)
  }

  // ipcMain.handle registrations — route to loaInvoke dispatcher

  ipcMain.handle('settings:get', () => loaInvoke('settings:get', undefined))
  ipcMain.handle('settings:save', (_e, partial: Record<string, unknown>) =>
    loaInvoke('settings:save', partial)
  )
  ipcMain.handle(
    'settings:saveBundle',
    (
      _e,
      payload:
        | {
            settings: Record<string, unknown>
            apiKey?: string | null
          }
        | undefined
    ) => loaInvoke('settings:saveBundle', payload)
  )
  ipcMain.handle('settings:setApiKey', (_e, key: string | null) => loaInvoke('settings:setApiKey', key))

  ipcMain.handle('bridge:status', () => loaInvoke('bridge:status', undefined))
  ipcMain.handle('bridge:ping', () => loaInvoke('bridge:ping', undefined))
  ipcMain.handle('prospects:collectFromPlan', (_e, payload: { query: string }) =>
    loaInvoke('prospects:collectFromPlan', payload)
  )

  ipcMain.handle('logs:recent', () => loaInvoke('logs:recent', undefined))
  ipcMain.handle('logs:runtime:tail', (_e, payload?: { maxLines?: number }) =>
    loaInvoke('logs:runtime:tail', payload)
  )
  ipcMain.handle('logs:export', () => loaInvoke('logs:export', undefined))
  ipcMain.handle('logs:clear', () => loaInvoke('logs:clear', undefined))

  ipcMain.handle(
    'mission:plan',
    (
      _e,
      payload:
        | {
            prompt?: string
            draft?: Partial<AppSettings>
            apiKey?: string | null
          }
        | undefined
    ) => loaInvoke('mission:plan', payload)
  )

  ipcMain.handle(
    'compose:preview',
    (
      _e,
      payload:
        | {
            draft?: Partial<AppSettings>
            apiKey?: string | null
          }
        | undefined
    ) => loaInvoke('compose:preview', payload)
  )

  ipcMain.handle('queue:state', () => loaInvoke('queue:state', undefined))

  ipcMain.handle('queue:start', (_e, payload: TargetRow[] | { targets?: TargetRow[]; dryRun?: boolean }) => loaInvoke('queue:start', payload))

  ipcMain.handle('queue:stop', () => loaInvoke('queue:stop', undefined))

  ipcMain.handle('jobs:search', (_e, payload: { keywords: string; location?: string }) =>
    loaInvoke('jobs:search', payload)
  )
  ipcMain.handle(
    'jobs:loadMoreJobListings',
    (
      _e,
      payload: { existingJobUrls?: string[]; keywords?: string; location?: string } | undefined
    ) => loaInvoke('jobs:loadMoreJobListings', payload)
  )
  ipcMain.handle('jobs:progressState', () => loaInvoke('jobs:progressState', undefined))
  ipcMain.handle('jobs:cancelSearch', () => loaInvoke('jobs:cancelSearch', undefined))
  ipcMain.handle('profile:mine', (_e, payload: { persist?: boolean; restoreAfter?: boolean } | undefined) =>
    loaInvoke('profile:mine', payload)
  )
  ipcMain.handle('jobs:screen', (_e, payload: { criteria: string; jobs: unknown[]; apiKey?: string | null }) =>
    loaInvoke('jobs:screen', payload)
  )
  ipcMain.handle('jobs:smartSearch', (_e, payload: { background: string; location?: string; apiKey?: string | null; sourceUrl?: string }) =>
    loaInvoke('jobs:smartSearch', payload)
  )

  ipcMain.handle('campaign:active', () => loaInvoke('campaign:active', undefined))
  ipcMain.handle('campaign:create', (_e, payload: unknown) => loaInvoke('campaign:create', payload))
  ipcMain.handle('campaign:resume', () => loaInvoke('campaign:resume', undefined))
  ipcMain.handle('campaign:markSent', (_e, payload: unknown) => loaInvoke('campaign:markSent', payload))
  ipcMain.handle('campaign:archive', (_e, payload: unknown) => loaInvoke('campaign:archive', payload))

  ipcMain.handle('llm:testKey', (_e, payload: { apiKey?: string | null }) => loaInvoke('llm:testKey', payload))
  ipcMain.handle('shell:openExtensionFolder', () => loaInvoke('shell:openExtensionFolder', undefined))
  ipcMain.handle('shell:openUserData', () => loaInvoke('shell:openUserData', undefined))
  ipcMain.handle('shell:openLogsFolder', () => loaInvoke('shell:openLogsFolder', undefined))
  ipcMain.handle('shell:openExternal', (_e, url: string) => loaInvoke('shell:openExternal', url))
  ipcMain.handle('session:token', () => getSessionToken())

  ipcMain.handle('telemetry:track', (_e, payload: { name: string; properties?: Record<string, unknown> }) => {
    trackGenericEvent(payload.name, payload.properties)
    return { ok: true }
  })
  ipcMain.handle('telemetry:onboarding', (_e, payload: { step: string; meta?: Record<string, unknown> }) => {
    trackOnboardingStep(payload.step as OnboardingStep, payload.meta)
    void trackOnboardingServer(payload.step, payload.meta)
    return { ok: true }
  })
  ipcMain.handle('telemetry:firstJobSearch', () => {
    trackFirstJobSearch()
    return { ok: true }
  })
  ipcMain.handle('telemetry:firstExtensionConnect', async () => {
    trackFirstExtensionConnect()
    // Activate deferred Plus trial on first extension connect
    void activateTrialOnExtensionConnect().catch((err) =>
      appLog.warn('[trial] activateTrialOnExtensionConnect failed', err instanceof Error ? err.message : String(err))
    )
    return { ok: true }
  })

  // -- Feedback collection ----------------------------------------------------
  ipcMain.handle('feedback:submit', (_e, payload: FeedbackPayload) =>
    submitFeedbackLocal(payload)
  )
  ipcMain.handle('survey:submit', (_e, payload: SurveyPayload) =>
    submitSurveyLocal(payload)
  )
  ipcMain.handle('survey:canShow', (_e, payload: { surveyType: string; cooldownDays: number }) => ({
    canShow: !hasSurveyBeenShown(payload.surveyType, payload.cooldownDays),
  }))

  // -- Auth + monetization infrastructure ----------------------------------
  ipcMain.handle('auth:setToken', (_e, token: string | null) => loaInvoke('auth:setToken', token))
  ipcMain.handle('auth:googleSignIn', () => googleSignInViaWindowImport())
  ipcMain.handle('auth:register', () => loaInvoke('auth:register', undefined))
  ipcMain.handle('auth:getUser', () => loaInvoke('auth:getUser', undefined))
  ipcMain.handle('auth:getServiceConfig', () => loaInvoke('auth:getServiceConfig', undefined))
  ipcMain.handle('plan:getState', () => loaInvoke('plan:getState', undefined))
  ipcMain.handle('plan:devOverride', (_e, plan: 'free' | 'plus' | 'reset') => {
    if (process.env.NODE_ENV === 'production') return { ok: false, error: 'Dev mode only' }
    if (plan === 'reset') {
      process.env.LR_DEV_PLAN = ''
    } else {
      process.env.LR_DEV_PLAN = plan
    }
    updatePlanStateImport({ plan: plan === 'reset' ? 'free' : plan })
    return { ok: true, plan: getPlanStateImport() }
  })
  ipcMain.handle('plan:canAct', (_e, actionType: 'apply' | 'outreach') => loaInvoke('plan:canAct', actionType))
  ipcMain.handle('plan:getCounters', () => loaInvoke('plan:getCounters', undefined))
  ipcMain.handle('plan:createCheckout', async (_e, product: 'plus' | 'boost' | 'bundle' | 'blitz') => {
    if (!isAuthenticatedImport()) return { ok: false, error: 'Authentication required.' }
    const result = await createCheckoutSession(product)
    if (result.ok) {
      await openExternalUrl(result.data.url)
    }
    return result
  })

  ipcMain.handle('account:delete', async () => {
    if (!isAuthenticatedImport()) return { ok: false, error: 'Not authenticated' }
    const { deleteAccount } = await import('./api-client')
    return deleteAccount()
  })

  ipcMain.handle('account:restorePurchases', async () => {
    if (!isAuthenticatedImport()) return { ok: false, error: 'Not authenticated' }
    const { restorePurchases } = await import('./api-client')
    return restorePurchases()
  })

  // AI field generation for custom template variables
  ipcMain.handle('ai:generateFields', (_e, payload: unknown) => loaInvoke('ai:generateFields', payload))
  ipcMain.handle('resume:tailor', (_e, payload: unknown) => loaInvoke('resume:tailor', payload))

  // Structured profile (Sprint 1)
  ipcMain.handle('profile:parse', (_e, payload: { resumeText?: string }) =>
    loaInvoke('profile:parse', payload)
  )
  ipcMain.handle('profile:get', () => loaInvoke('profile:get', undefined))
  ipcMain.handle('profile:save', (_e, payload: unknown) => loaInvoke('profile:save', payload))
  ipcMain.handle('jobs:smartScreen', (_e, payload: unknown) => loaInvoke('jobs:smartScreen', payload))

  // Resume management
  ipcMain.handle('resume:upload', () => loaInvoke('resume:upload', undefined))
  ipcMain.handle('resume:importPath', (_e, filePath: string) => loaInvoke('resume:importPath', filePath))
  ipcMain.handle(
    'resume:importData',
    (_e, payload: { fileName?: string; dataBase64?: string }) => loaInvoke('resume:importData', payload)
  )
  ipcMain.handle('resume:clear', () => loaInvoke('resume:clear', undefined))

  // Application assistant channels (Easy Apply, applicant profile, etc.)
  registerApplicationAssistantIpc(loaInvoke)

  ipcMain.handle('followup:detectNow', () => loaInvoke('followup:detectNow', undefined))
  ipcMain.handle('followup:newAccepts', () => loaInvoke('followup:newAccepts', undefined))
  ipcMain.handle('followup:clearAccepts', () => loaInvoke('followup:clearAccepts', undefined))
  ipcMain.handle('followup:pendingQueue', () => loaInvoke('followup:pendingQueue', undefined))
  ipcMain.handle('followup:cancelQueued', (_e, payload: { id: string }) => loaInvoke('followup:cancelQueued', payload))
  ipcMain.handle('backup:export', () => loaInvoke('backup:export', undefined))
  ipcMain.handle('backup:import', () => loaInvoke('backup:import', undefined))

  loaHttpServer = await startLoaHttpBridge(loaInvoke)
  trackAppOpened()
  createWindow()
  createOrUpdateTray()

  if (process.platform === 'darwin') {
    const appMenu = Menu.getApplicationMenu()
    if (appMenu) {
      const windowMenu = appMenu.items.find((item) => item.role === 'windowMenu' || item.label === 'Window')
      if (windowMenu?.submenu) {
        windowMenu.submenu.append(new MenuItem({ type: 'separator' }))
        windowMenu.submenu.append(
          new MenuItem({
            label: 'Always on Top',
            type: 'checkbox',
            checked: false,
            click: (menuItem) => {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setAlwaysOnTop(menuItem.checked)
              }
            }
          })
        )
        Menu.setApplicationMenu(appMenu)
      }
    }
  }

  if (app.isPackaged) {
    autoUpdater.logger = log
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    attachUpdateReadyNotifier(autoUpdater, () => mainWindow, (info) => {
      appLog.info('[updater] Update downloaded, will install on quit', { version: info.version })
    })
    autoUpdater.on('error', (err) => {
      appLog.debug('[updater] Auto-update check failed', err?.message ?? String(err))
    })
    autoUpdater.checkForUpdatesAndNotify()
      .catch(err => appLog.warn('[updater] Startup check failed', err?.message ?? String(err)))
  }

  ipcMain.handle('updater:quitAndInstall', () => {
    if (!app.isPackaged) return { status: 'dev' as const }
    try {
      appLog.info('[updater] User triggered quit-and-install')
      autoUpdater.quitAndInstall()
      return { status: 'ok' as const }
    } catch (err) {
      return { status: 'error' as const, message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('updater:checkForUpdates', async () => {
    if (!app.isPackaged) return { status: 'dev' as const }
    try {
      const result = await autoUpdater.checkForUpdates()
      const version = result?.updateInfo?.version
      if (!version) return { status: 'ok' as const }
      return { status: 'ok' as const, version }
    } catch (err) {
      return { status: 'error' as const, message: err instanceof Error ? err.message : String(err) }
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopBridge()
    app.quit()
  }
})

let eventQueueFlushed = false
let isInstallerQuitting = false
// electron-updater emits 'before-quit-for-update' on Electron's native autoUpdater
import { autoUpdater as nativeAutoUpdater } from 'electron'
nativeAutoUpdater.on('before-quit-for-update', () => { isInstallerQuitting = true })

app.on('before-quit', (e) => {
  if (isInstallerQuitting) {
    // Skip async event-queue flush during installer exit — let the updater take control immediately
    stopFollowupDetector()
    stopPowerSaveBlock()
    if (loaHttpServer) { try { loaHttpServer.close() } catch {} loaHttpServer = null }
    stopBridge()
    return
  }
  if (!eventQueueFlushed) {
    e.preventDefault()
    stopEventQueue()
      .then(() => { eventQueueFlushed = true; app.quit() })
      .catch(() => { eventQueueFlushed = true; app.quit() })
    return
  }
  stopFollowupDetector()
  stopPowerSaveBlock()
  disposeContextMenu?.()
  disposeContextMenu = null
  if (tray && !tray.isDestroyed()) {
    tray.destroy()
    tray = null
  }
  if (loaHttpServer) {
    try {
      loaHttpServer.close()
    } catch (e) {
      appLog.debug('[index] loa HTTP server close failed', e instanceof Error ? e.message : String(e))
    }
    loaHttpServer = null
  }
  stopBridge()
})
