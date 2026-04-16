import type { JobSearchHistoryEntry } from '@core/job-search-history'
import type { AiFieldDefinition } from '@core/types'

type Tab = 'setup' | 'run' | 'history'

type PrimaryTabSpec = {
  id: string
  label: string
  shortcutDigit: string
}

export type SettingsView = {
  seenOnboarding: boolean
  bridgePort: number
  llmProvider: string
  llmBaseUrl: string
  llmModel: string
  llmEnabled: boolean
  llmMode?: 'bundled' | 'custom'
  lastExecutionId: string
  lastGoal?: string
  aiFieldDefinitions?: AiFieldDefinition[]
  templates: string[]
  mustInclude: string[]
  dailyCap: number
  applyDailyCap?: number
  reviewBeforeSubmit?: boolean
  sessionBreaksEnabled: boolean
  sessionBreakEveryMin: number
  sessionBreakEveryMax: number
  sessionBreakDurationMin: number
  sessionBreakDurationMax: number
  delayBetweenRequestsMin: number
  delayBetweenRequestsMax: number
  delayBetweenActionsMin: number
  delayBetweenActionsMax: number
  resumeFileName?: string
  /** Jobs tab: last keyword/title search */
  jobsSearchKeywords?: string
  /** Jobs tab: last location */
  jobsSearchLocation?: string
  /** Jobs tab: recent keyword+location searches (newest first) */
  jobsSearchHistory?: JobSearchHistoryEntry[]
  apiKeyPresent?: boolean
  userBackground?: string
  outreachTone?: 'peer' | 'warm_intro' | 'job_seeker' | 'sales'
  /** Jobs tab: AI screening criteria textarea (persisted). */
  jobsScreeningCriteria?: string
  /** LinkedIn jobs URL filters — see `linkedInJobsSearchUrl` / `JobSearchUrlOptions`. */
  jobsSearchRecencySeconds?: number
  jobsSearchSortBy?: 'R' | 'DD'
  jobsSearchDistanceMiles?: number
  jobsSearchExperienceLevels?: string[]
  jobsSearchJobTypes?: string[]
  jobsSearchRemoteTypes?: string[]
  jobsSearchSalaryFloor?: number
  jobsSearchFewApplicants?: boolean
  jobsSearchVerifiedOnly?: boolean
  jobsSearchEasyApplyOnly?: boolean
  customOutreachPrompt?: string
  autoFollowUpOnAccept?: boolean
  autoFollowUpDelayMinutes?: number
  autoSuggestOutreachAfterApply?: boolean
  customFollowUpDmTemplate?: string
  weeklyConnectionCap?: number
  /** When set (e.g. by extension), used for pending-invite warnings on Connect. */
  pendingInviteCount?: number
  /** Show all tabs (Follow Up, Pipeline, History) instead of focused Apply + Connect view. */
  showAllTabs?: boolean
  /** Whether the user has opted in to anonymous telemetry. */
  telemetryOptIn?: boolean
  /** Whether the user has dismissed the post-onboarding first session guide. */
  firstSessionGuideDismissed?: boolean
}

/** Normalized jobs search filter slice passed into JobsPanel (defaults applied in App). */
export type JobsSearchFiltersPersisted = {
  jobsSearchRecencySeconds: number
  jobsSearchSortBy: 'R' | 'DD'
  jobsSearchDistanceMiles: number
  jobsSearchExperienceLevels: string[]
  jobsSearchJobTypes: string[]
  jobsSearchRemoteTypes: string[]
  jobsSearchSalaryFloor: number
  jobsSearchFewApplicants: boolean
  jobsSearchVerifiedOnly: boolean
  jobsSearchEasyApplyOnly: boolean
}

export type ComposePreviewView =
  | {
      ok: true
      body: string
      variant: string
      route: 'llm' | 'template'
      detail: string
      resolvedExecutionId?: string
      resolvedExecutionLabel?: string
      resolvedFromFollowUpSource?: boolean
      sampleTarget: {
        profileUrl: string
        firstName: string
        company: string
        headline: string
      }
    }
  | {
      ok: false
      detail: string
    }

export type MissionPlanView =
  | {
      ok: true
      title: string
      summary: string
      executionId: string
      executionLabel: string
      searchQuery: string
      searchUrl: string
      csvSeed: string
      templates: string[]
      mustInclude: string[]
      nextStep: string
      mode: 'people' | 'jobs'
      route: 'llm' | 'heuristic'
      detail: string
    }
  | {
      ok: false
      detail: string
    }

export type ProspectCollectionView =
  | {
      ok: true
      searchUrl: string
      csvText: string
      count: number
    }
  | {
      ok: false
      detail: string
      searchUrl?: string
    }

export type SetupFeedback = { type: 'success' | 'error'; message: string } | null

export type ProfileImportView =
  | {
      ok: true
      background: string
      profile: {
        profileUrl?: string
        displayName?: string
        firstName?: string
        headline?: string
        company?: string
        location?: string
        about?: string
        experienceHighlights?: string[]
        rawText?: string
      }
      settings?: SettingsView
      detail: string
    }
  | {
      ok: false
      detail: string
    }

export type CampaignSummaryView = {
  id: string
  goal: string
  title: string
  totalTargets: number
  sentCount: number
  remainingCount: number
  createdAt: string
  updatedAt: string
  status: 'active' | 'completed' | 'archived'
}
