// ---------------------------------------------------------------------------
// llm.ts — Barrel re-export. All LLM functionality is split into focused modules:
//   llm-core.ts    — Transport, retry, error helpers, JSON extraction
//   llm-compose.ts — Message composition, mission planning, people search
//   llm-jobs.ts    — Job screening, search planning, batch matching
//   llm-apply.ts   — Application essays, resume tailoring, form field matching
//
// This file re-exports everything so existing consumers need zero changes.
// ---------------------------------------------------------------------------

// Core: transport, error helpers, JSON extraction
export {
  callLlm,
  callLlmDirect,
  callLlmMessages,
  classifyLlmError,
  extractErrorDetail,
  extractFirstCompleteJsonObject,
  extractLlmJsonContent,
  testApiKey,
  type LlmCallOptions,
  type LlmChatMessage
} from './llm-core'

// Compose: message generation, mission planning, people search
export {
  composeMessageDetailed,
  detectJobIntent,
  generateAiFields,
  linkedInPeopleSearchUrl,
  planMission,
  type MissionPlanTrace
} from './llm-compose'

// Jobs: screening, search planning, URL building, batch matching
export {
  buildCandidateContextForJobsMatch,
  linkedInJobsSearchUrl,
  llmBatchJobMatchPercents,
  planJobSearch,
  screenJobs,
  type JobListingForLlmMatch,
  type JobScreenResult,
  type JobSearchPlan,
  type JobSearchUrlOptions
} from './llm-jobs'

// Apply: essay answers, resume tailoring, snapshot-to-profile matching
export {
  generateApplicationEssayAnswer,
  llmMatchSnapshotToProfile,
  resolveProfileValueForKey,
  tailorResumeHeadlineSummary,
  type LlmFieldMapping,
  type LlmMatchResult
} from './llm-apply'
