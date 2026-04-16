export type SequenceStage = 'new' | 'viewed' | 'invited' | 'accepted' | 'dm_sent' | 'responded' | 'skipped' | 'archived'

export type SequenceTarget = {
  profileUrl: string
  firstName: string
  company: string
  headline?: string
  jobTitle?: string
  jobUrl?: string
  applicationRecordId?: string
  stage: SequenceStage
  viewedAt?: string
  invitedAt?: string
  acceptedAt?: string
  dmSentAt?: string
  respondedAt?: string
  lastUpdated: string
}
