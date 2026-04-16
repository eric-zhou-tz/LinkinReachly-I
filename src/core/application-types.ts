export type ApplicationAssistantPhase = 'scaffold'
export type ApplicationExtensionScope = 'linkedin_only'

export type ApplicantAsset = {
  id: string
  kind: 'resume' | 'cover_letter' | 'portfolio_pdf' | 'other'
  label: string
  fileName: string
  storagePath: string
  mimeType: string
  sizeBytes?: number
  updatedAt: string
}

export type AnswerBankItem = {
  id: string
  normalizedKey: string
  prompt: string
  answerType: 'text' | 'boolean' | 'number' | 'select'
  answer: string | boolean | number
  scope?: 'global' | 'adapter' | 'company'
  adapterId?: string
  company?: string
  updatedAt: string
}

export type ApplicantProfile = {
  version: number
  basics: {
    fullName: string
    email: string
    phone?: string
    addressLine1?: string
    addressLine2?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
    /** Where you live now, as one line (for single “Location” form fields). Not your job-search geography — use Work location preference for that. */
    currentLocationLine?: string
    /** Answer for “where are you currently residing”–style questions; if set, wins over current location line / city+state for those prompts. */
    currentResidenceAnswer?: string
  }
  links: {
    linkedInUrl?: string
    portfolioUrl?: string
    githubUrl?: string
    websiteUrl?: string
  }
  workAuth: {
    countryCode: string
    authorizedToWork?: boolean
    requiresSponsorship?: boolean
    /** Specific immigration status: 'citizen', 'permanent_resident', 'visa_holder', or 'other'. Distinct from authorizedToWork which is just yes/no. */
    citizenshipStatus?: 'citizen' | 'permanent_resident' | 'visa_holder' | 'other'
    clearanceEligible?: boolean
    willingToRelocate?: boolean
    willingToTravel?: boolean
    over18?: boolean
    hasDriversLicense?: boolean
    canPassBackgroundCheck?: boolean
    canPassDrugTest?: boolean
  }
  compensation: {
    salaryMin?: number
    salaryMax?: number
    salaryCurrency?: string
    noticePeriod?: string
    startDatePreference?: string
    workLocationPreference?: string
  }
  background: {
    yearsOfExperience?: string
    educationSummary?: string
    languages?: string
    certifications?: string
    /** Education start month (1-12) for "Month of From" dropdowns */
    educationStartMonth?: number
    /** Education start year (e.g. 2018) for "Year of From" dropdowns */
    educationStartYear?: number
    /** Education end month (1-12) for "Month of To" dropdowns */
    educationEndMonth?: number
    /** Education end year (e.g. 2022) for "Year of To" dropdowns */
    educationEndYear?: number
    /** Whether currently attending this institution */
    currentlyAttending?: boolean
    /** School/university name for dropdown matching */
    schoolName?: string
    /** Degree type for dropdown matching (e.g., "Bachelor's", "Master's") */
    degreeType?: string
    /** Field of study (e.g., "Computer Science") */
    fieldOfStudy?: string
    /** All education entries extracted from resume. Required during onboarding gate. */
    educationHistory?: Array<{
      school: string
      degree: string
      field: string
      year: number | null
    }>
    /** All work experience entries extracted from resume. Required during onboarding gate. */
    workHistory?: Array<{
      title: string
      company: string
      location?: string
      description?: string
      startMonth?: number | null
      startYear: number | null
      endMonth?: number | null
      endYear: number | null
      currentlyWorkHere?: boolean
    }>
  }
  /** Base cover letter text the LLM adapts per job when tailoring is enabled. */
  coverLetterTemplate?: string
  assets: ApplicantAsset[]
  answerBank: AnswerBankItem[]
  /** Cached answers for repeat screening / essay prompts (normalized label key → text). */
  screeningAnswerCache?: Record<string, string>
  updatedAt: string
}

/** Optional metadata for history / debugging (no full letter body). */
export type ApplicationCoverLetterMeta = {
  mode: 'static' | 'tailored' | 'generated'
  fileBytes?: number
  model?: string
  promptVersion?: string
  templateSha256?: string
}

export type ApplicantProfileView =
  | {
      ok: true
      profile: ApplicantProfile
    }
  | {
      ok: false
      detail: string
    }

export type ApplicantProfileSaveView =
  | {
      ok: true
      profile: ApplicantProfile
      detail: string
    }
  | {
      ok: false
      detail: string
    }

export type ApplicationAssistantStatusView = {
  ok: true
  featureEnabled: boolean
  phase: ApplicationAssistantPhase
  bridgeConnected: boolean
  activeLinkedInTab: boolean
  extensionScope: ApplicationExtensionScope
  supportedAts: string[]
  detail: string
  /** True when the packed extension is older than the app expects (reload at chrome://extensions). */
  blockedExtensionReload?: boolean
  extensionContentScriptVersion?: number
  extensionBackgroundBridgeVersion?: number
}

export type ApplicationOutcome =
  | 'opened'
  | 'submitted'
  | 'autofilled'
  | 'needs_review'
  | 'failed'
  /** Apply pipeline could not run — e.g. policy block (extension stale uses failed + detail extension_stale). */
  | 'blocked'

export type ApplicationSource = 'linkedin_easy_apply' | 'manual'

export type ApplicationCompanySignals = {
  companyType: string
  stage: string
  industry: string
  workModel: string
}

export type OutreachStatus = 'none' | 'pending' | 'sent' | 'skipped' | 'connected'

export type PipelineStage =
  | 'saved'
  | 'applied'
  | 'outreach_sent'
  | 'response'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'ghosted'

export type HiringTeamMember = {
  name: string
  title?: string
  profileUrl?: string
}

export type ApplicationRecord = {
  id: string
  createdAt: string
  company: string
  title: string
  location?: string
  jobUrl?: string
  easyApply?: boolean
  atsId?: string
  source: ApplicationSource
  outcome: ApplicationOutcome
  detail?: string
  descriptionSnippet?: string
  reasonSnippet?: string
  /** Correlates with `[apply-trace]` session lines for this Easy Apply run. */
  easyApplySessionId?: number
  coverLetterMeta?: ApplicationCoverLetterMeta
  companySignals: ApplicationCompanySignals
  outreachStatus?: OutreachStatus
  outreachTargetUrl?: string
  outreachTargetName?: string
  outreachSentAt?: string
  /** Extracted from job posting or constructed as a search hint. */
  hiringTeam?: HiringTeamMember[]
  /** Search query hint for finding the hiring manager on LinkedIn. */
  hiringTeamSearchHint?: string
  pipelineStage?: PipelineStage
  stuckFieldLabels?: string[]
}

export type ApplicationInsightsBucket = {
  key: string
  label: string
  count: number
}

export type ApplicationInsights = {
  total: number
  submittedCount: number
  activeCount: number
  needsReviewCount: number
  blockedCount: number
  outreachSentCount: number
  outreachPendingCount: number
  byCompanyType: ApplicationInsightsBucket[]
  byStage: ApplicationInsightsBucket[]
  byIndustry: ApplicationInsightsBucket[]
  byWorkModel: ApplicationInsightsBucket[]
}

export type ApplicationRecordInput = {
  company: string
  title: string
  location?: string
  jobUrl?: string
  easyApply?: boolean
  atsId?: string
  source: ApplicationSource
  outcome: ApplicationOutcome
  detail?: string
  descriptionSnippet?: string
  reasonSnippet?: string
  easyApplySessionId?: number
  coverLetterMeta?: ApplicationCoverLetterMeta
  hiringTeam?: HiringTeamMember[]
  hiringTeamSearchHint?: string
  pipelineStage?: PipelineStage
  stuckFieldLabels?: string[]
}

export type ApplicationHistoryView =
  | {
      ok: true
      records: ApplicationRecord[]
      insights: ApplicationInsights
      detail: string
    }
  | {
      ok: false
      detail: string
    }

export type ApplicationRecordSaveView =
  | {
      ok: true
      record: ApplicationRecord
      insights: ApplicationInsights
      detail: string
    }
  | {
      ok: false
      detail: string
    }

export type ApplicationAssistantDetectView =
  | {
      ok: true
      atsId: string
      atsLabel: string
      company: string
      jobId: string
      confidence: 'high' | 'medium' | 'low'
      detail: string
    }
  | {
      ok: false
      featureEnabled: boolean
      reason: 'disabled' | 'extension_scope_not_expanded' | 'no_ats_detected' | 'no_active_tab'
      detail: string
    }

export type ApplyQueueItem = {
  id: string
  jobTitle: string
  company: string
  location: string
  linkedinJobUrl: string
  applyUrl: string
  surface: 'linkedin_easy_apply'
  atsId?: string
  status: 'pending' | 'active' | 'done' | 'error' | 'skipped'
  addedAt: string
  processedAt?: string
  applicationRecordId?: string
  detail?: string
  descriptionSnippet?: string
  reasonSnippet?: string
  postedDate?: string
  matchScore?: number
  /** Labels of required form fields that could not be filled — user can answer inline. */
  stuckFieldLabels?: string[]
}

export type ApplyQueueRunSummary = {
  startedAt: string
  finishedAt: string
  durationSec: number
  done: number
  failed: number
  skipped: number
  pending: number
  total: number
  stoppedReason?: string
  /** Field labels that caused stuck form-fill failures — user can answer these once to fix future runs. */
  stuckFieldLabels?: string[]
  /** How many screening answers were learned (saved to cache) during this run. */
  answersLearned?: number
}

export type ApplyQueueState = {
  items: ApplyQueueItem[]
  running: boolean
  currentIndex: number
  lastRunSummary?: ApplyQueueRunSummary
  startedAt?: string
  pausedAt?: string
  lastError?: string
  lastErrorCode?: string
  lastDetail?: string
  /** Epoch ms when the current cooldown/break ends — UI can show a countdown. */
  cooldownEndsAt?: number
}

export type ApplyQueueView =
  | { ok: true; state: ApplyQueueState; added?: number; skippedDuplicate?: number; skippedAlreadyApplied?: number; skippedNames?: string[] }
  | { ok: false; detail: string; reason?: string; state?: ApplyQueueState }

export type ExtensionHealthStatus =
  | 'healthy'
  | 'bridge_disconnected'
  | 'no_linkedin_tab'
  | 'stale_extension'
  | 'content_unreachable'

export type ApplicationExtensionHealthView = {
  ok: boolean
  status: ExtensionHealthStatus
  reloadRequired: boolean
  expectedContentVersion: number
  expectedBackgroundBridgeVersion: number
  detectedContentVersion?: number
  detectedBackgroundBridgeVersion?: number
  detail: string
}

/** IPC: `application:outreach:runChain` request (renderer → main). */
export type OutreachRunChainPayload = {
  candidateIds?: string[]
  maxTargets?: number
}

/** IPC: single row in `application:outreach:runChain` response. */
export type OutreachRunChainResultItem = {
  applicationRecordId: string
  status: string
  targetName?: string
  jobUrl?: string
  detail?: string
}

/** IPC: `application:outreach:runChain` response (main → renderer). */
export type OutreachRunChainResult = {
  ok: boolean
  sent: number
  skipped: number
  detail: string
  results: OutreachRunChainResultItem[]
}

/** IPC: `application:outreach:searchHiringManager` request. */
export type OutreachSearchHiringManagerPayload = {
  company: string
  jobTitle?: string
  searchHint?: string
  hiringTeam?: HiringTeamMember[]
}

export type OutreachHiringManagerTarget = {
  profileUrl: string
  firstName: string
  company: string
  headline: string
}

/** IPC: `application:outreach:searchHiringManager` response. */
export type OutreachSearchHiringManagerResult = {
  ok: boolean
  targets: OutreachHiringManagerTarget[]
  detail: string
}

/** IPC: `application:outreach:run` request body. */
export type OutreachRunPayload = {
  targets: Array<{
    profileUrl: string
    firstName: string
    company: string
    headline?: string
    jobTitle?: string
    jobUrl?: string
    applicationRecordId?: string
  }>
}

/** IPC: `application:outreach:run` response. */
export type OutreachRunResult = {
  ok: boolean
  sent: number
  detail: string
}

/** IPC: `outreach:chainProgress` event payload (main → renderer). */
export type OutreachChainProgressEvent = {
  phase: string
  current: number
  total: number
  company: string
  applicationRecordId?: string
}
