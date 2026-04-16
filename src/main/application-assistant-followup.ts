import { fillTemplate, pickVariant } from '@core/message-compose'
import { getExecutionById } from '@core/executions'
import { canonicalProfileUrlKey } from '@core/linkedin-url'
import { recordFollowupSent } from './followup-state'
import { advanceStage as advanceSequenceStage, getAllSequenceTargets } from './sequence-state'
import { loadApplicationHistory } from './application-history-store'
import { sendCommand, sendCommandWithRetry, isExtensionConnected } from './bridge'
import { loadSettings } from './settings'
import { appLog } from './app-log'

export function handleFollowUpState(): {
  ok: true
  recentAccepts: Array<{ name: string; profileUrl: string; company?: string; acceptedAt?: string }>
  pendingFollowUps: Array<{ name: string; profileUrl: string; company?: string; daysSinceAccept: number }>
  staleConnections: Array<{ name: string; profileUrl: string; company?: string; daysSinceAccept: number }>
  awaitingReply: Array<{ name: string; profileUrl: string; company?: string; daysSinceAccept: number }>
  responded: Array<{ name: string; profileUrl: string; company?: string }>
  stats: { acceptsThisWeek: number; dmsSent: number; stale: number; awaitingReply: number; responded: number }
} {
  try {
    const seqTargets = getAllSequenceTargets()
    const now = Date.now()
    const weekMs = 7 * 24 * 60 * 60 * 1000

    const recentAccepts: Array<{ name: string; profileUrl: string; company?: string; acceptedAt?: string }> = []
    const pendingFollowUps: Array<{ name: string; profileUrl: string; company?: string; daysSinceAccept: number }> = []
    const staleConnections: Array<{ name: string; profileUrl: string; company?: string; daysSinceAccept: number }> = []
    const awaitingReply: Array<{ name: string; profileUrl: string; company?: string; daysSinceAccept: number }> = []
    const responded: Array<{ name: string; profileUrl: string; company?: string }> = []
    let dmsSent = 0

    for (const target of seqTargets) {
      const displayName = target.firstName || canonicalProfileUrlKey(target.profileUrl).replace(/^\/in\//, '').replace(/\/$/, '').replace(/-/g, ' ')
      const company = target.company || undefined
      const acceptedAt = target.acceptedAt ? new Date(target.acceptedAt).getTime() : 0
      const isRecent = acceptedAt && now - acceptedAt < weekMs

      if (isRecent) {
        recentAccepts.push({ name: displayName, profileUrl: target.profileUrl, company, acceptedAt: target.acceptedAt })
      }

      if (target.stage === 'responded') {
        responded.push({ name: displayName, profileUrl: target.profileUrl, company })
      } else if (target.stage === 'dm_sent' && target.dmSentAt) {
        dmsSent++
        const daysSinceDm = Math.floor((now - new Date(target.dmSentAt).getTime()) / (24 * 60 * 60 * 1000))
        awaitingReply.push({ name: displayName, profileUrl: target.profileUrl, company, daysSinceAccept: daysSinceDm })
      } else if (target.stage === 'accepted') {
        const daysSinceAccept = acceptedAt ? Math.floor((now - acceptedAt) / (24 * 60 * 60 * 1000)) : 0
        if (daysSinceAccept > 7) {
          staleConnections.push({ name: displayName, profileUrl: target.profileUrl, company, daysSinceAccept })
        } else {
          pendingFollowUps.push({ name: displayName, profileUrl: target.profileUrl, company, daysSinceAccept })
        }
      }
    }

    return {
      ok: true,
      recentAccepts,
      pendingFollowUps,
      staleConnections,
      awaitingReply,
      responded,
      stats: {
        acceptsThisWeek: recentAccepts.length,
        dmsSent,
        stale: staleConnections.length,
        awaitingReply: awaitingReply.length,
        responded: responded.length
      }
    }
  } catch (e) {
    appLog.debug('[application-assistant] handleFollowUpState failed', e instanceof Error ? e.message : String(e))
    return {
      ok: true,
      recentAccepts: [],
      pendingFollowUps: [],
      staleConnections: [],
      awaitingReply: [],
      responded: [],
      stats: { acceptsThisWeek: 0, dmsSent: 0, stale: 0, awaitingReply: 0, responded: 0 }
    }
  }
}

export function handleFollowUpMarkReplied(
  payload: unknown
): { ok: boolean; detail: string } {
  const p = payload as { profileUrl?: string }
  if (!p?.profileUrl) return { ok: false, detail: 'No profile URL.' }
  try {
    advanceSequenceStage(p.profileUrl, 'responded')
    return { ok: true, detail: 'Marked as replied.' }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

export function handleFollowUpArchive(
  payload: unknown
): { ok: boolean; detail: string } {
  const p = payload as { profileUrl?: string }
  if (!p?.profileUrl) return { ok: false, detail: 'No profile URL.' }
  try {
    advanceSequenceStage(p.profileUrl, 'archived')
    return { ok: true, detail: 'Archived.' }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

export async function handleFollowUpSendDm(
  payload: unknown
): Promise<{ ok: boolean; detail: string }> {
  const p = payload as {
    profileUrl?: string
    firstName?: string
    company?: string
    jobTitle?: string
    message?: string
  }
  if (!p?.profileUrl) return { ok: false, detail: 'No profile URL.' }
  if (!isExtensionConnected()) return { ok: false, detail: 'Chrome extension not connected. Open a LinkedIn tab and try again.' }

  try {
    await sendCommand('NAVIGATE', { url: p.profileUrl })
    await new Promise((r) => setTimeout(r, 2000))

    const profileResult = await sendCommand('EXTRACT_PROFILE', {})
    const facts = profileResult.ok && profileResult.data
      ? profileResult.data as Record<string, string>
      : {}

    const firstName = p.firstName || (facts.firstName as string) || ''
    const company = p.company || (facts.company as string) || ''

    let message = p.message
    if (!message) {
      const settings = loadSettings()
      const history = loadApplicationHistory()
      const targetKey = p.profileUrl ? canonicalProfileUrlKey(p.profileUrl) : ''
      const matchedRecord = targetKey ? history.find(
        r => r.outreachTargetUrl && canonicalProfileUrlKey(r.outreachTargetUrl) === targetKey && r.outreachStatus === 'sent'
      ) : null
      const sameCompanyRecord = !matchedRecord ? history.find(
        r => r.company && company && r.company.toLowerCase() === company.toLowerCase() &&
          (r.outcome === 'submitted' || r.outcome === 'autofilled') && r.outreachStatus === 'sent'
      ) : null

      let templates: string[]
      if (settings.customFollowUpDmTemplate?.trim()) {
        templates = [settings.customFollowUpDmTemplate.trim()]
      } else if (matchedRecord) {
        templates = [
          'Hi {firstName}, thanks for connecting! I recently applied for the {jobTitle} role at {company} and am excited about the opportunity. Would love to hear about the team and what you\'re working on.',
          'Hi {firstName}, appreciate the connection! I applied for {jobTitle} at {company} — the role really resonated with my background. Happy to share more about my experience if helpful.'
        ]
      } else if (sameCompanyRecord) {
        templates = [
          'Hi {firstName}, thanks for connecting! I recently applied to a role at {company} and thought it\'d be great to connect with someone on the team. Would love to learn more about what you\'re working on.',
        ]
      } else {
        const exec = getExecutionById('post_accept_followup')
        templates = exec?.packTemplates ?? [
          'Hi {firstName}, thanks for connecting! I wanted to follow up — would love to learn more about what you\'re working on at {company}.'
        ]
      }

      const jobTitle = matchedRecord?.title || sameCompanyRecord?.title || p.jobTitle || ''
      const row = { profileUrl: p.profileUrl, firstName, company, headline: '' }
      const { body } = pickVariant(templates, p.profileUrl)
      message = fillTemplate(body, row, { firstName, company, headline: (facts.headline as string) || '' }).replace(/\{jobTitle\}/g, jobTitle)
    }

    const openResult = await sendCommand('CLICK_MESSAGE_FOR_PROFILE', {
      profileUrl: p.profileUrl,
      displayName: firstName
    })
    if (!openResult.ok) {
      return { ok: false, detail: `Could not open message composer: ${openResult.detail}` }
    }
    await new Promise((r) => setTimeout(r, 1500))

    const typeResult = await sendCommandWithRetry('TYPE_CONVERSATION', {
      text: message,
      charMin: 20,
      charMax: 60
    }, 2)
    if (!typeResult.ok) {
      await sendCommand('DISMISS_MODAL', {}).catch((e) => {
        appLog.debug('[followup-dm] DISMISS_MODAL failed', {
          error: e instanceof Error ? e.message : e
        })
      })
      return { ok: false, detail: `Could not type message: ${typeResult.detail}` }
    }
    await new Promise((r) => setTimeout(r, 1000))

    const sendResult = await sendCommandWithRetry('CLICK_SEND_CONVERSATION', {}, 2)
    if (!sendResult.ok) {
      return { ok: false, detail: `Could not send message: ${sendResult.detail}` }
    }

    recordFollowupSent(p.profileUrl, 'followup-dm-panel', 1)
    advanceSequenceStage(p.profileUrl, 'dm_sent')
    appLog.info(`[followup-dm] sent DM to ${firstName} at ${company}`)

    return { ok: true, detail: `Follow-up DM sent to ${firstName}.` }
  } catch (err) {
    appLog.error('[followup-dm] failed', err)
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}
