type JobsProgressPhase = 'planning' | 'searching' | 'enriching' | 'screening'

export type JobsProgressState = {
  active: true
  phase: JobsProgressPhase
  message: string
  startedAt: number
  updatedAt: number
  queriesPlanned?: string[]
  queriesCompleted?: number
  currentQuery?: string
  currentQueryIndex?: number
  totalQueries?: number
  currentQueryResultCount?: number
  totalJobsFound?: number
  enrichingCompleted?: number
  enrichingTotal?: number
  screeningCount?: number
}
