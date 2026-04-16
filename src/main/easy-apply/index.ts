/**
 * Easy Apply pipeline — phases + `handleEasyApply` orchestrator.
 */

// Orchestrator (single-job Easy Apply)
export { handleEasyApply } from './handle-easy-apply'

// Shared types
export type {
  EasyApplyResult,
  EasyApplyArgs,
  EasyApplyFormCounters
} from './shared'

// Shared utilities used by the orchestrator
export { historyDetailWithSession, easyApplyBridgeCommand } from './shared'

// Phase 1
export { easyApplyPreflight } from './preflight'
export type { EasyApplyPreflightOk, EasyApplyPreflightResult } from './preflight'

// Phase 2
export { easyApplyNavigate } from './navigate'

// Phase 3
export { easyApplyClickApplyButton } from './click-apply'
export type { EasyApplyClickResult } from './click-apply'

// Phase 4
export { easyApplyFillFormLoop } from './fill-form'
export type { EasyApplyFormLoopResult } from './fill-form'

// Phase 5
export { easyApplyVerifySubmission } from './verify-submission'
