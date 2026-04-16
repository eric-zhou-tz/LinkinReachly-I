import { ipcMain } from 'electron'
import {
  getApplicationAssistantStatus,
  getApplicationExtensionHealth
} from './application-assistant-extension-health'
import {
  appendApplicationFromPayload,
  deleteApplicationHistoryRecord,
  detectApplicationPage,
  getApplicationHistory,
  patchApplicationRecord,
  saveApplicationRecord,
  exportApplicationHistoryCsvHandler
} from './application-assistant-records'
import {
  enqueueApplicantSave,
  getApplicantProfile,
  handleAssetUpload,
  handleCoverLetterRemove,
  handleResumeRemove
} from './application-assistant-applicant'
import { promoteScreeningToAnswerBank } from './applicant-profile-store'
import {
  handleApplicationQueueAdd,
  handleApplicationQueueClear,
  handleApplicationQueueRemove,
  handleApplicationQueueRetry,
  handleApplicationQueueSkip,
  handleApplicationQueueStart,
  handleApplicationQueueState,
  handleApplicationQueueStop
} from './application-assistant-queue'
import {
  handleOutreachCandidates,
  handleOutreachMarkSent,
  handleOutreachRun,
  handleOutreachRunChain,
  handleOutreachSkip,
  handleSearchHiringManager
} from './application-assistant-outreach'
import {
  handleFollowUpArchive,
  handleFollowUpMarkReplied,
  handleFollowUpSendDm,
  handleFollowUpState
} from './application-assistant-followup'
import { handleEasyApply } from './easy-apply/handle-easy-apply'
export type { EasyApplyResult } from './easy-apply'

const APPLY_CHANNELS = [
  'application:status',
  'application:extensionHealth',
  'application:detect',
  'application:history',
  'application:record',
  'application:save',
  'application:update',
  'application:history:delete',
  'application:history:exportCsv',
  'application:queue:state',
  'application:queue:add',
  'application:queue:start',
  'application:queue:stop',
  'application:queue:retry',
  'application:queue:skip',
  'application:queue:remove',
  'application:queue:clear',
  'applicant:get',
  'applicant:save',
  'applicant:upload-resume',
  'applicant:remove-resume',
  'applicant:upload-cover-letter',
  'applicant:remove-cover-letter',
  'applicant:promoteScreeningAnswers',
  'application:easyApply',
  'application:outreach:candidates',
  'application:outreach:markSent',
  'application:outreach:skip',
  'application:outreach:searchHiringManager',
  'application:outreach:run',
  'application:outreach:runChain',
  'followup:state',
  'followup:sendDm',
  'followup:markReplied',
  'followup:archive'
] as const

type ApplyChannel = (typeof APPLY_CHANNELS)[number]

export { broadcastToRenderer } from './broadcast-to-renderer'

export { handleEasyApply }

export function isApplicationAssistantChannel(channel: string): channel is ApplyChannel {
  return (APPLY_CHANNELS as readonly string[]).includes(channel)
}

export async function handleApplicationAssistantChannel(
  channel: ApplyChannel,
  payload: unknown
): Promise<unknown> {
  switch (channel) {
    case 'application:status':
      return await getApplicationAssistantStatus()
    case 'application:extensionHealth':
      return await getApplicationExtensionHealth()
    case 'application:detect':
      return detectApplicationPage(payload)
    case 'application:history':
      return getApplicationHistory()
    case 'application:record':
      return saveApplicationRecord(payload)
    case 'application:save':
      return appendApplicationFromPayload(payload)
    case 'application:update':
      return patchApplicationRecord(payload)
    case 'application:history:delete':
      return deleteApplicationHistoryRecord(payload)
    case 'application:history:exportCsv':
      return exportApplicationHistoryCsvHandler()
    case 'application:queue:state':
      return handleApplicationQueueState()
    case 'application:queue:add':
      return handleApplicationQueueAdd(payload)
    case 'application:queue:start':
      return handleApplicationQueueStart()
    case 'application:queue:stop':
      return handleApplicationQueueStop()
    case 'application:queue:retry':
      return handleApplicationQueueRetry(payload)
    case 'application:queue:skip':
      return handleApplicationQueueSkip(payload)
    case 'application:queue:remove':
      return handleApplicationQueueRemove(payload)
    case 'application:queue:clear':
      return handleApplicationQueueClear()
    case 'applicant:get':
      return getApplicantProfile()
    case 'applicant:save':
      return await enqueueApplicantSave(payload)
    case 'applicant:upload-resume':
      return handleAssetUpload('resume')
    case 'applicant:remove-resume':
      return handleResumeRemove()
    case 'applicant:upload-cover-letter':
      return handleAssetUpload('cover_letter')
    case 'applicant:remove-cover-letter':
      return handleCoverLetterRemove()
    case 'applicant:promoteScreeningAnswers':
      return promoteScreeningToAnswerBank()
    case 'application:easyApply':
      return handleEasyApply(payload)
    case 'application:outreach:candidates':
      return handleOutreachCandidates()
    case 'application:outreach:markSent':
      return handleOutreachMarkSent(payload)
    case 'application:outreach:skip':
      return handleOutreachSkip(payload)
    case 'application:outreach:searchHiringManager':
      return handleSearchHiringManager(payload)
    case 'application:outreach:run':
      return handleOutreachRun(payload)
    case 'application:outreach:runChain':
      return handleOutreachRunChain(payload)
    case 'followup:state':
      return handleFollowUpState()
    case 'followup:sendDm':
      return handleFollowUpSendDm(payload)
    case 'followup:markReplied':
      return handleFollowUpMarkReplied(payload)
    case 'followup:archive':
      return handleFollowUpArchive(payload)
  }
}

export function registerApplicationAssistantIpc(
  loaInvoke: (channel: string, payload: unknown) => Promise<unknown>
): void {
  for (const channel of APPLY_CHANNELS) {
    ipcMain.handle(channel, (_event, payload: unknown) => loaInvoke(channel, payload))
  }
}
