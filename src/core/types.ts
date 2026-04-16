export interface TargetRow {
  profileUrl: string
  firstName?: string
  personName?: string
  company?: string
  headline?: string
  searchQuery?: string
  executionId?: string
  [key: string]: string | undefined
}

export interface ProfileFacts {
  firstName?: string
  headline?: string
  company?: string
  rawText?: string
}

export interface QueueState {
  running: boolean
  currentIndex: number
  total: number
  lastDetail: string
  lastProfileUrl: string
  error: string | null
  completedAt: string | null
  sent?: number
  skipped?: number
  failed?: number
}

export interface QueueStartRequest {
  targets?: TargetRow[]
  dryRun?: boolean
  messageOverride?: string
}

/** A user-defined template variable with an AI instruction for generation. */
export interface AiFieldDefinition {
  /** Variable name used in template, e.g. "ticker" → {ticker} */
  name: string
  /** Human instruction telling the AI how to generate this field's value.
   *  e.g. "Pick a stock ticker the prospect's fund likely holds" */
  instruction: string
  /** Whether this field is auto-filled from prospect data or AI-generated */
  source: 'auto' | 'ai'
}
