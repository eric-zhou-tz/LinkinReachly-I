import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs'
import { rename, writeFile, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  DEMO_STARTER_TEMPLATES,
  LEGACY_DEMO_STARTER_FOUR_TEMPLATES
} from '@core/demo-presets'
import { DEFAULT_EXECUTION_ID, getExecutionById } from '@core/executions'
import { BUILTIN_DEFAULT_TEMPLATES } from '@core/template-presets'
import type { JobSearchHistoryEntry } from '@core/job-search-history'
import { normalizeJobsSearchHistory } from '@core/job-search-history'
import type { AiFieldDefinition } from '@core/types'
import { DEFAULT_APPLY_DAILY_CAP } from '@core/plan-config'
import { PROD_BRIDGE_PORT, defaultBridgePortForPackaging } from '@core/runtime-ports'
import { userDataDir } from './user-data-path'
import { appLog } from './app-log'

/** Grok via local proxy using the standard Chat Completions request shape. */
type LlmProvider = 'grok'

type LlmMode = 'bundled' | 'custom'

export interface AppSettings {
  seenOnboarding: boolean
  bridgePort: number
  llmProvider: LlmProvider
  llmBaseUrl: string
  llmModel: string
  llmEnabled: boolean
  /** 'bundled' = use default Grok proxy with no config; 'custom' = user provides own key/url. */
  llmMode: LlmMode
  apiKeyStored: string | null
  apiKeyIsEncrypted: boolean
  lastExecutionId: string
  lastGoal?: string
  aiFieldDefinitions?: AiFieldDefinition[]
  templates: string[]
  mustInclude: string[]
  dailyCap: number
  applyDailyCap?: number
  reviewBeforeSubmit?: boolean
  weeklyConnectionCap: number
  sessionBreaksEnabled: boolean
  sessionBreakEveryMin: number
  sessionBreakEveryMax: number
  sessionBreakDurationMin: number
  sessionBreakDurationMax: number
  delayBetweenRequestsMin: number
  delayBetweenRequestsMax: number
  delayBetweenActionsMin: number
  delayBetweenActionsMax: number
  resumeText?: string
  resumeFileName?: string
  /** Last Jobs panel keyword / title search (persisted across restarts). */
  jobsSearchKeywords: string
  /** Last Jobs panel location filter (persisted across restarts). */
  jobsSearchLocation: string
  /** Recency filter for job search in seconds. 0 = no filter. Common: 3600 (1h), 86400 (24h), 604800 (7d), 2592000 (30d). */
  jobsSearchRecencySeconds: number
  /** Sort order for job search results. 'R' = relevance, 'DD' = date posted. */
  jobsSearchSortBy: 'R' | 'DD'
  /** Search radius in miles. 0 = no distance filter. Common: 10, 25, 50, 100. */
  jobsSearchDistanceMiles: number
  /** Experience level filter. Empty array = no filter. Values: '1'=internship, '2'=entry, '3'=associate, '4'=mid-senior, '5'=director, '6'=executive. */
  jobsSearchExperienceLevels: string[]
  /** Job type filter. Empty array = no filter. Values: 'F'=full-time, 'P'=part-time, 'C'=contract, 'T'=temporary, 'V'=volunteer, 'I'=internship, 'O'=other. */
  jobsSearchJobTypes: string[]
  /** Remote filter. Empty array = no filter. Values: '1'=on-site, '2'=remote, '3'=hybrid. */
  jobsSearchRemoteTypes: string[]
  /** Salary floor filter. 0 = no filter. Values: 1=$40k+, 2=$60k+, 3=$80k+, 4=$100k+, 5=$120k+, 6=$140k+, 7=$160k+, 8=$180k+, 9=$200k+. */
  jobsSearchSalaryFloor: number
  /** When true, show only jobs with few applicants (<10) or where you have connections. */
  jobsSearchFewApplicants: boolean
  /** When true, show only LinkedIn-verified job postings (filters scam listings). */
  jobsSearchVerifiedOnly: boolean
  /** When true (default), only show Easy Apply jobs in search results. When false, show all jobs. */
  jobsSearchEasyApplyOnly: boolean
  /** Last AI screening criteria entered by the user (persisted across restarts). */
  jobsScreeningCriteria: string
  /** Recent Jobs searches (keywords + location), newest first. */
  jobsSearchHistory: JobSearchHistoryEntry[]
  userBackground: string
  outreachTone: 'peer' | 'warm_intro' | 'job_seeker' | 'sales'
  /**
   * When true, Easy Apply generates a job-specific cover PDF via LLM when a cover file field exists
   * and base text is available (profile template and/or cover letter asset extraction).
   */
  easyApplyTailorCoverLetter: boolean
  /** Optional short second LLM call to add company/context bullets to the tailor prompt. */
  easyApplyEnrichCompanyContext: boolean
  /** Custom system prompt for outreach message generation (overrides default when non-empty). */
  customOutreachPrompt: string
  /** After apply queue finishes, automatically connect with hiring managers for submitted applications. */
  autoSuggestOutreachAfterApply?: boolean
  /** Auto-send follow-up DM when a connection accepts, with a delay window for user review/cancel. */
  autoFollowUpOnAccept?: boolean
  /** Minutes to wait after accept detection before auto-sending the follow-up DM. */
  autoFollowUpDelayMinutes?: number
  /** Custom follow-up DM template. Uses {firstName}, {company}, {jobTitle} tokens. */
  customFollowUpDmTemplate?: string
  /** Optional: pending connection invites (when reported by extension / bridge). Used for UI warnings only. */
  pendingInviteCount?: number
  /** When true, show all tabs (Follow Up, Pipeline, History) instead of focused Apply + Connect view. */
  showAllTabs?: boolean

  // -- Monetization infrastructure (Phase 1) --------------------------------

  /** Firebase UID for the authenticated user (null = not logged in). */
  firebaseUid?: string | null
  /** Server-assigned user ID (Supabase UUID). */
  cloudUserId?: string | null
  /** Current plan: 'free' or 'plus'. */
  userPlan?: 'free' | 'plus'
  /** Purchased credit balance (cached locally, server is source of truth). */
  creditBalance?: number
  /** ISO timestamp when the reverse trial started. */
  trialStartedAt?: string | null
  /** Whether the user has opted in to anonymous telemetry. */
  telemetryOptIn?: boolean
  /** LinkedIn profile URL bound to this account (1 profile per account). */
  linkedInProfileUrl?: string | null
}

type ApiKeyUpdate = string | null | undefined

/** In-memory API key when OS secure storage cannot encrypt — never written to settings.json. */
let sessionOnlyApiKey: string | null = null

let _settingsCache: AppSettings | null = null
let _settingsCacheMtimeMs = 0

const defaultSettings: AppSettings = {
  seenOnboarding: false,
  bridgePort: defaultBridgePortForPackaging(app?.isPackaged ?? false),
  llmProvider: 'grok',
  llmBaseUrl: 'http://api.linkinreachly.com:8000/v1',
  llmModel: 'grok-4.1-fast',
  llmEnabled: true,
  llmMode: 'bundled',
  apiKeyStored: null,
  apiKeyIsEncrypted: false,
  lastExecutionId: DEFAULT_EXECUTION_ID,
  lastGoal: '',
  aiFieldDefinitions: [],
  templates: [...DEMO_STARTER_TEMPLATES],
  mustInclude: [],
  dailyCap: 20,
  applyDailyCap: DEFAULT_APPLY_DAILY_CAP,
  reviewBeforeSubmit: false,
  weeklyConnectionCap: 60,
  sessionBreaksEnabled: true,
  sessionBreakEveryMin: 5,
  sessionBreakEveryMax: 8,
  sessionBreakDurationMin: 2,
  sessionBreakDurationMax: 5,
  delayBetweenRequestsMin: 45,
  delayBetweenRequestsMax: 90,
  delayBetweenActionsMin: 2,
  delayBetweenActionsMax: 5,
  resumeText: '',
  resumeFileName: '',
  jobsSearchKeywords: '',
  jobsSearchLocation: '',
  jobsSearchRecencySeconds: 86400,
  jobsSearchSortBy: 'DD',
  jobsSearchDistanceMiles: 0,
  jobsSearchExperienceLevels: [],
  jobsSearchJobTypes: [],
  jobsSearchRemoteTypes: [],
  jobsSearchSalaryFloor: 0,
  jobsSearchFewApplicants: false,
  jobsSearchVerifiedOnly: false,
  jobsSearchEasyApplyOnly: true,
  jobsScreeningCriteria: '',
  jobsSearchHistory: [],
  userBackground: '',
  outreachTone: 'peer',
  easyApplyTailorCoverLetter: false,
  easyApplyEnrichCompanyContext: false,
  customOutreachPrompt: '',
  autoSuggestOutreachAfterApply: true,
  autoFollowUpOnAccept: false,
  autoFollowUpDelayMinutes: 60,
  customFollowUpDmTemplate: '',
  showAllTabs: false,
  firebaseUid: null,
  cloudUserId: null,
  userPlan: 'free',
  creditBalance: 0,
  trialStartedAt: null,
  telemetryOptIn: false,
  linkedInProfileUrl: null,
}


/** Test-only override: point settings store at a temp directory instead of real user data. */
let _testSettingsDir: string | null = null
export function setTestSettingsDir(dir: string | null): void { _testSettingsDir = dir; _settingsCache = null; _settingsCacheMtimeMs = 0 }
export function resetSettingsCache(): void { _settingsCache = null; _settingsCacheMtimeMs = 0 }
function configDir(): string {
  if (_testSettingsDir) { if (!existsSync(_testSettingsDir)) mkdirSync(_testSettingsDir, { recursive: true }); return _testSettingsDir }
  const d = join(userDataDir(), 'config')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function settingsPath(): string {
  return join(configDir(), 'settings.json')
}

export function normalizeBridgePort(value: unknown): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1024 || n > 65535) return defaultSettings.bridgePort
  return n
}

function normalizeTemplateLine(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u2013\u2014]/g, '-') // en dash, em dash → ASCII hyphen (older saves / copy-paste)
}

function templateListsMatchPreset(file: string[], preset: string[]): boolean {
  if (file.length !== preset.length) return false
  return file.every((t, i) => normalizeTemplateLine(t) === normalizeTemplateLine(preset[i]))
}

function isPermutationOfBuiltinPack(templates: string[]): boolean {
  if (templates.length !== BUILTIN_DEFAULT_TEMPLATES.length) return false
  const normSort = (rows: string[]) => [...rows].map(normalizeTemplateLine).sort()
  const a = normSort(templates)
  const b = normSort(BUILTIN_DEFAULT_TEMPLATES)
  return a.every((s, i) => s === b[i])
}

function normalizeTemplatesFromDisk(templates: string[]): { templates: string[]; wroteMigration: boolean } {
  if (
    templateListsMatchPreset(templates, BUILTIN_DEFAULT_TEMPLATES) ||
    isPermutationOfBuiltinPack(templates)
  ) {
    return { templates: [...DEMO_STARTER_TEMPLATES], wroteMigration: true }
  }
  if (templateListsMatchPreset(templates, LEGACY_DEMO_STARTER_FOUR_TEMPLATES)) {
    return { templates: [...DEMO_STARTER_TEMPLATES], wroteMigration: true }
  }
  return { templates, wroteMigration: false }
}

/** Pre-Grok proxy base URLs we replace with bundled Grok defaults on load. */
function isObsoleteLlmProxyHost(url: string): boolean {
  return /dashscope|aliyuncs|bailian/i.test(url || '')
}

/** Reset LLM endpoint defaults when disk still points at a retired proxy host. */
function migrateLegacyLlmToGrokDefaults(merged: AppSettings): boolean {
  if (!isObsoleteLlmProxyHost(merged.llmBaseUrl)) return false
  merged.llmBaseUrl = defaultSettings.llmBaseUrl
  merged.llmModel = defaultSettings.llmModel
  return true
}

/** Merge disk values into defaults, accepting only matching primitive types. */
function typedMerge(defaults: AppSettings, raw: Record<string, unknown>): AppSettings {
  const result = { ...defaults } as unknown as Record<string, unknown>
  const defs = defaults as unknown as Record<string, unknown>
  for (const key of Object.keys(defs)) {
    const def = defs[key]
    const val = raw[key]
    if (val === undefined || val === null) continue
    if (typeof def === typeof val && !Array.isArray(def)) {
      result[key] = val
    } else if (Array.isArray(def) && Array.isArray(val)) {
      result[key] = val
    }
  }
  const out = result as unknown as AppSettings
  if (typeof raw.pendingInviteCount === 'number' && Number.isFinite(raw.pendingInviteCount)) {
    out.pendingInviteCount = Math.min(500_000, Math.max(0, Math.floor(raw.pendingInviteCount)))
  }
  return out
}

/**
 * Loads persisted settings from disk. Uses synchronous `readFileSync` (and may call
 * `saveSettings` → `writeFileSync` during migrations) intentionally: this runs during app
 * initialization before the event loop is serving user work, so blocking I/O here keeps
 * startup ordering simple and avoids racing the first IPC handlers.
 */
export function loadSettings(): AppSettings {
  const p = settingsPath()
  if (!existsSync(p)) return { ...defaultSettings }
  try {
    const mtimeMs = statSync(p).mtimeMs
    if (_settingsCache && mtimeMs === _settingsCacheMtimeMs) {
      return { ..._settingsCache }
    }
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
    const fromFile = Array.isArray(raw.templates) && raw.templates.length > 0
      ? [...raw.templates] as string[]
      : [...defaultSettings.templates]
    const { templates: normalizedTemplates, wroteMigration } = normalizeTemplatesFromDisk(fromFile)

    const merged = typedMerge(defaultSettings, raw)
    merged.bridgePort = normalizeBridgePort(raw.bridgePort)
    merged.apiKeyStored = raw.apiKeyStored != null ? String(raw.apiKeyStored) : null
    merged.apiKeyIsEncrypted = !!raw.apiKeyIsEncrypted

    let devBridgePortMigrated = false
    if (!app.isPackaged && merged.bridgePort === PROD_BRIDGE_PORT) {
      merged.bridgePort = defaultSettings.bridgePort
      devBridgePortMigrated = true
    }

    // Migrate insecure plaintext keys off disk (encrypt if possible; otherwise session-only).
    if (merged.apiKeyStored && !merged.apiKeyIsEncrypted) {
      const plain = merged.apiKeyStored
      if (safeStorage.isEncryptionAvailable()) {
        try {
          const buf = safeStorage.encryptString(plain)
          merged.apiKeyStored = Buffer.from(buf).toString('base64')
          merged.apiKeyIsEncrypted = true
          saveSettings(merged)
        } catch (err) {
          appLog.warn('[settings] API key encryption failed, using session-only storage', { error: err instanceof Error ? err.message : String(err) })
          sessionOnlyApiKey = plain
          merged.apiKeyStored = null
          merged.apiKeyIsEncrypted = false
          saveSettings(merged)
        }
      } else {
        sessionOnlyApiKey = plain
        merged.apiKeyStored = null
        merged.apiKeyIsEncrypted = false
        saveSettings(merged)
      }
    }
    merged.lastExecutionId =
      typeof raw.lastExecutionId === 'string' && getExecutionById(raw.lastExecutionId)
        ? raw.lastExecutionId
        : defaultSettings.lastExecutionId
    merged.templates = normalizedTemplates

    if (merged.dailyCap > merged.weeklyConnectionCap) {
      merged.dailyCap = merged.weeklyConnectionCap
    }

    merged.jobsSearchHistory = normalizeJobsSearchHistory(merged.jobsSearchHistory)

    let strippedLegacyOpenClaw = false
    for (const k of ['openclawEnabled', 'openclawBaseUrl'] as const) {
      if (k in raw) {
        strippedLegacyOpenClaw = true
        delete raw[k]
      }
    }

    merged.llmProvider = 'grok'

    const grokMigrated = migrateLegacyLlmToGrokDefaults(merged)

    let baseUrlMigrated = false
    if (merged.llmBaseUrl === 'http://127.0.0.1:8000' || merged.llmBaseUrl === 'http://127.0.0.1:8000/v1') {
      merged.llmBaseUrl = defaultSettings.llmBaseUrl
      baseUrlMigrated = true
    }

    let delayMigrated = false
    if (merged.delayBetweenRequestsMin === 120 && merged.delayBetweenRequestsMax === 300) {
      merged.delayBetweenRequestsMin = 45
      merged.delayBetweenRequestsMax = 90
      delayMigrated = true
    }

    if (grokMigrated) {
      appLog.info('[settings] migration: reset LLM endpoint from retired proxy to Grok defaults', { baseUrl: merged.llmBaseUrl, model: merged.llmModel })
    }
    if (baseUrlMigrated) {
      appLog.info('[settings] migration: appended /v1 to base URL', { baseUrl: merged.llmBaseUrl })
    }
    if (strippedLegacyOpenClaw) {
      appLog.info('[settings] migration: stripped legacy OpenClaw keys from settings')
    }
    if (delayMigrated) {
      appLog.info('[settings] migration: reduced inter-request delay from 120-300s to 45-90s')
    }
    if (devBridgePortMigrated) {
      appLog.info('[settings] migration: reset dev bridge port to isolated default', {
        bridgePort: merged.bridgePort
      })
    }
    if (wroteMigration) {
      appLog.info('[settings] migration: normalized templates to current demo starter pack', { count: merged.templates.length })
    }
    // Backwards compat: if user already had a custom API key or non-default base URL,
    // auto-detect as 'custom' mode so their config isn't hidden.
    if (
      merged.llmMode === 'bundled' &&
      (raw.llmMode === undefined) &&
      (merged.apiKeyStored || sessionOnlyApiKey ||
       (merged.llmBaseUrl !== defaultSettings.llmBaseUrl) ||
       (merged.llmModel !== defaultSettings.llmModel))
    ) {
      merged.llmMode = 'custom'
    }

    if (grokMigrated || wroteMigration || strippedLegacyOpenClaw || baseUrlMigrated || devBridgePortMigrated) {
      saveSettings(merged)
    }

    _settingsCache = merged
    _settingsCacheMtimeMs = mtimeMs
    return { ...merged }
  } catch (err) {
    appLog.warn('[settings] failed to load settings, using defaults', { error: err instanceof Error ? err.message : String(err) })
    return { ...defaultSettings }
  }
}

function clampDailyCap(s: AppSettings): void {
  if (s.dailyCap > s.weeklyConnectionCap) {
    s.dailyCap = s.weeklyConnectionCap
  }
}

/** Synchronous disk write with atomic rename. Prefer `saveSettingsAsync` from IPC handlers. */
export function saveSettings(s: AppSettings): void {
  clampDailyCap(s)
  const dest = settingsPath()
  const tmp = `${dest}.tmp`
  writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8')
  renameSync(tmp, dest)
  _settingsCache = { ...s }
  try { _settingsCacheMtimeMs = statSync(dest).mtimeMs } catch (e) { appLog.debug('[settings] mtime read failed', e instanceof Error ? e.message : String(e)); _settingsCacheMtimeMs = 0 }
}

export async function saveSettingsAsync(s: AppSettings): Promise<void> {
  clampDailyCap(s)
  const dest = settingsPath()
  const tmp = `${dest}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(s, null, 2), 'utf8')
  try {
    await rename(tmp, dest)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
  _settingsCache = { ...s }
  try { _settingsCacheMtimeMs = statSync(dest).mtimeMs } catch (e) { appLog.debug('[settings] mtime read failed', e instanceof Error ? e.message : String(e)); _settingsCacheMtimeMs = 0 }
}

function applyApiKeyUpdate(next: AppSettings, apiKeyUpdate?: ApiKeyUpdate): void {
  if (apiKeyUpdate === undefined) return
  if (apiKeyUpdate === null) {
    sessionOnlyApiKey = null
    next.apiKeyStored = null
    next.apiKeyIsEncrypted = false
    return
  }
  const plain = String(apiKeyUpdate).trim()
  if (!plain) {
    sessionOnlyApiKey = null
    next.apiKeyStored = null
    next.apiKeyIsEncrypted = false
  } else if (safeStorage.isEncryptionAvailable()) {
    sessionOnlyApiKey = null
    const buf = safeStorage.encryptString(plain)
    next.apiKeyStored = Buffer.from(buf).toString('base64')
    next.apiKeyIsEncrypted = true
  } else {
    sessionOnlyApiKey = plain
    next.apiKeyStored = null
    next.apiKeyIsEncrypted = false
  }
}

export function saveSettingsWithApiKey(s: AppSettings, apiKeyUpdate?: ApiKeyUpdate): AppSettings {
  const next: AppSettings = { ...s }
  applyApiKeyUpdate(next, apiKeyUpdate)
  saveSettings(next)
  return next
}

export async function saveSettingsWithApiKeyAsync(
  s: AppSettings,
  apiKeyUpdate?: ApiKeyUpdate
): Promise<AppSettings> {
  const next: AppSettings = { ...s }
  applyApiKeyUpdate(next, apiKeyUpdate)
  await saveSettingsAsync(next)
  return next
}

export function setApiKey(plain: string | null): AppSettings {
  const s = loadSettings()
  return saveSettingsWithApiKey(s, plain)
}

const BUNDLED_API_KEY = process.env.LINKINREACHLY_API_KEY || ''

export function getApiKey(): string | null {
  if (sessionOnlyApiKey) return sessionOnlyApiKey
  const s = loadSettings()
  const envKey = process.env.LOA_LLM_API_KEY?.trim()
  if (s.apiKeyStored) {
    if (s.apiKeyIsEncrypted && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(s.apiKeyStored, 'base64'))
      } catch (e) {
        appLog.warn('[settings] API key decryption failed, falling through', e instanceof Error ? e.message : String(e))
      }
    } else if (s.apiKeyStored) {
      return s.apiKeyStored
    }
  }
  return envKey || BUNDLED_API_KEY || null
}
