import { fillTemplate, pickVariant } from '@core/message-compose'
import { getExecutionById } from '@core/executions'
import { getProfileCompleteness } from '@core/application-completeness'
import { upsertSequenceTarget } from './sequence-state'
import { loadApplicantProfile } from './applicant-profile-store'
import type {
  OutreachRunChainResult,
  OutreachRunResult,
  OutreachSearchHiringManagerResult
} from '@core/application-types'
import { updateApplicationRecord, loadApplicationHistory } from './application-history-store'
import { buildOutreachCandidatesFromHistory } from './apply-queue-helpers'
import {
  buildHiringManagerPeopleSearch,
  isPermittedLinkedInNavigationUrl,
  parseOutreachMarkSentPayload,
  parseOutreachRunChainPayload,
  parseOutreachRunPayload,
  parseOutreachSkipPayload,
  parseSearchHiringManagerPayload,
  pickStoredHiringPoster,
  selectChainCandidates,
  type HiringManagerPick
} from './application-outreach-chain'
import { broadcastToRenderer } from './broadcast-to-renderer'
import type { PostApplyOutreachCandidate } from './apply-queue-runner'
import { sendCommand, isExtensionConnected } from './bridge'
import { appLog } from './app-log'

export function handleOutreachCandidates(): { ok: true; candidates: PostApplyOutreachCandidate[] } {
  return { ok: true, candidates: buildOutreachCandidatesFromHistory(loadApplicationHistory()) }
}

export function handleOutreachMarkSent(payload: unknown): { ok: boolean; detail: string } {
  const p = parseOutreachMarkSentPayload(payload)
  if (!p) return { ok: false, detail: 'Missing applicationRecordId.' }

  const updated = updateApplicationRecord(p.applicationRecordId, {
    outreachStatus: 'sent',
    outreachTargetUrl: p.targetUrl,
    outreachTargetName: p.targetName,
    outreachSentAt: new Date().toISOString()
  })

  return updated
    ? { ok: true, detail: `Outreach marked as sent for ${updated.company} — ${updated.title}.` }
    : { ok: false, detail: 'Application record not found.' }
}

export function handleOutreachSkip(payload: unknown): { ok: boolean; detail: string } {
  const p = parseOutreachSkipPayload(payload)
  if (!p) return { ok: false, detail: 'Missing applicationRecordId.' }

  const updated = updateApplicationRecord(p.applicationRecordId, { outreachStatus: 'skipped' })
  return updated
    ? { ok: true, detail: `Outreach skipped for ${updated.company} — ${updated.title}.` }
    : { ok: false, detail: 'Application record not found.' }
}

export async function handleSearchHiringManager(payload: unknown): Promise<OutreachSearchHiringManagerResult> {
  if (!isExtensionConnected()) return { ok: false, targets: [], detail: 'Chrome extension not connected. Open a LinkedIn tab and try again.' }
  const p = parseSearchHiringManagerPayload(payload)
  if (!p) return { ok: false, targets: [], detail: 'Missing company name.' }

  const storedPick = pickStoredHiringPoster({
    applicationRecordId: '',
    jobTitle: p.jobTitle || '',
    company: p.company,
    jobUrl: '',
    hiringTeam: p.hiringTeam
  })
  if (storedPick) {
    return {
      ok: true,
      targets: [storedPick],
      detail: 'Using hiring contact from your application.'
    }
  }

  const { searchUrl } = buildHiringManagerPeopleSearch(p.company, p.jobTitle, p.searchHint)
  if (!isPermittedLinkedInNavigationUrl(searchUrl)) {
    return { ok: false, targets: [], detail: 'Invalid search URL.' }
  }

  try {
    await sendCommand('NAVIGATE', { url: searchUrl })
    await new Promise((r) => setTimeout(r, 3000))
    const result = await sendCommand('EXTRACT_SEARCH_RESULTS', {})

    const data = result.data as Record<string, unknown> | undefined
    if (!result.ok || !data?.results) {
      return { ok: false, targets: [], detail: result.detail || 'No search results found.' }
    }

    const targets = (data.results as Array<Record<string, string>>)
      .filter((r) => r.profileUrl && r.name)
      .slice(0, 5)
      .map((r) => ({
        profileUrl: r.profileUrl || '',
        firstName: (r.name || '').split(/\s+/)[0] || '',
        company: r.company || p.company || '',
        headline: r.headline || ''
      }))

    return { ok: true, targets, detail: `Found ${targets.length} potential contacts.` }
  } catch (err) {
    return {
      ok: false,
      targets: [],
      detail: err instanceof Error ? err.message : String(err)
    }
  }
}

export async function handleOutreachRun(payload: unknown): Promise<OutreachRunResult> {
  if (!isExtensionConnected()) return { ok: false, sent: 0, detail: 'Chrome extension not connected. Open a LinkedIn tab and try again.' }
  const completeness = getProfileCompleteness(loadApplicantProfile())
  if (!completeness.readyToApply) {
    return { ok: false, sent: 0, detail: `Upload your resume first so we can personalize your messages. Missing: ${completeness.missingRequired.join(', ')}.` }
  }
  const p = parseOutreachRunPayload(payload)
  if (!p?.targets?.length) return { ok: false, sent: 0, detail: 'No targets provided.' }

  const exec = getExecutionById('post_apply_connection')
  let sent = 0
  for (const target of p.targets) {
    try {
      if (!isPermittedLinkedInNavigationUrl(target.profileUrl)) {
        appLog.info('[outreach-run] skipped non-LinkedIn profile URL', { url: target.profileUrl?.slice(0, 80) })
        if (target.applicationRecordId) updateApplicationRecord(target.applicationRecordId, { outreachStatus: 'skipped' })
        continue
      }
      await sendCommand('NAVIGATE', { url: target.profileUrl })
      await new Promise((r) => setTimeout(r, 2000))

      const profileResult = await sendCommand('EXTRACT_PROFILE', {})
      const facts = profileResult.ok && profileResult.data
        ? profileResult.data as Record<string, string>
        : {}
      const templates = exec?.packTemplates ?? [
        'Hi {firstName} — I applied for the {jobTitle} role at {company} and wanted to connect directly.'
      ]

      const row = {
        profileUrl: target.profileUrl,
        firstName: target.firstName || (facts.firstName as string) || '',
        company: target.company,
        headline: target.headline || (facts.headline as string) || '',
        jobTitle: target.jobTitle || '',
        jobUrl: target.jobUrl || ''
      }
      const profileFacts = {
        firstName: (facts.firstName as string) || target.firstName,
        company: (facts.company as string) || target.company,
        headline: (facts.headline as string) || target.headline
      }

      const { body } = pickVariant(templates, target.profileUrl)
      const note = fillTemplate(body, row, profileFacts)

      const connectResult = await sendCommand('CLICK_CONNECT_ANY', {})
      if (!connectResult.ok) {
        appLog.info(`[outreach-run] connect button not found for ${target.firstName}`, connectResult)
        if (target.applicationRecordId) updateApplicationRecord(target.applicationRecordId, { outreachStatus: 'skipped' })
        continue
      }
      await new Promise((r) => setTimeout(r, 1000))
      await sendCommand('CLICK_ADD_NOTE', {})
      await new Promise((r) => setTimeout(r, 500))
      await sendCommand('TYPE_NOTE', { text: note.slice(0, 300) })
      await new Promise((r) => setTimeout(r, 500))
      const sendResult = await sendCommand('CLICK_SEND', {})
      await new Promise((r) => setTimeout(r, 1000))
      await sendCommand('DISMISS_MODAL', {}).catch((e) => {
        appLog.debug('[outreach-run] DISMISS_MODAL failed', {
          error: e instanceof Error ? e.message : e
        })
      })

      if (!sendResult.ok) {
        appLog.info(`[outreach-run] CLICK_SEND not confirmed for ${target.firstName}`, sendResult)
        if (target.applicationRecordId) updateApplicationRecord(target.applicationRecordId, { outreachStatus: 'skipped' })
        continue
      }

      // Track in sequence state so follow-up detector can correlate accepts
      upsertSequenceTarget(target.profileUrl, {
        profileUrl: target.profileUrl,
        firstName: target.firstName || (facts.firstName as string) || '',
        company: target.company,
        headline: target.headline || (facts.headline as string),
        jobTitle: target.jobTitle,
        jobUrl: target.jobUrl,
        applicationRecordId: target.applicationRecordId,
        stage: 'invited',
        invitedAt: new Date().toISOString()
      })

      if (target.applicationRecordId) {
        updateApplicationRecord(target.applicationRecordId, {
          outreachStatus: 'sent',
          outreachTargetUrl: target.profileUrl,
          outreachTargetName: `${target.firstName} (${target.headline || target.company})`,
          outreachSentAt: new Date().toISOString()
        })
      }
      sent++
      appLog.info(`[outreach-run] sent to ${target.firstName} at ${target.company}`)

      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 4000))
    } catch (err) {
      appLog.error(`[outreach-run] failed for ${target.firstName}`, err)
      if (target.applicationRecordId) {
        try { updateApplicationRecord(target.applicationRecordId, { outreachStatus: 'skipped' }) } catch (e) { appLog.debug('[assistant] outreach skip update failed', e instanceof Error ? e.message : String(e)) }
      }
    }
  }

  return { ok: sent > 0, sent, detail: `Sent ${sent}/${p.targets.length} connection invites.` }
}

/**
 * Full-chain batch: for each outreach candidate, search for a hiring manager
 * at the company, then send a connection request with a personalized note.
 */
export async function handleOutreachRunChain(payload: unknown): Promise<OutreachRunChainResult> {
  if (!isExtensionConnected()) return { ok: false, sent: 0, skipped: 0, detail: 'Chrome extension not connected. Open a LinkedIn tab and try again.', results: [] }
  const completeness = getProfileCompleteness(loadApplicantProfile())
  if (!completeness.readyToApply) {
    return { ok: false, sent: 0, skipped: 0, detail: `Upload your resume first so we can personalize your messages. Missing: ${completeness.missingRequired.join(', ')}.`, results: [] }
  }
  const p = parseOutreachRunChainPayload(payload)
  const candidates = buildOutreachCandidatesFromHistory(loadApplicationHistory())
  const toProcess = selectChainCandidates(candidates, p)
  if (toProcess.length === 0) {
    return { ok: true, sent: 0, skipped: 0, detail: 'No candidates need outreach.', results: [] }
  }

  let sent = 0
  let skipped = 0
  const results: OutreachRunChainResult['results'] = []

  const broadcastProgress = (phase: string, current: number, total: number, company: string, applicationRecordId?: string) => {
    broadcastToRenderer('outreach:chainProgress', { phase, current, total, company, applicationRecordId })
  }

  for (let i = 0; i < toProcess.length; i++) {
    const candidate = toProcess[i]
    let hmTarget: HiringManagerPick | null = pickStoredHiringPoster(candidate)
    if (hmTarget) {
      appLog.info(
        `[outreach-chain] found stored job poster for ${candidate.company}: ${hmTarget.firstName || '(unknown name)'}`
      )
    }

    // Step 2: If no stored poster, navigate to job page and try to extract
    if (!hmTarget && candidate.jobUrl && isPermittedLinkedInNavigationUrl(candidate.jobUrl)) {
      broadcastProgress('checking job posting', i + 1, toProcess.length, candidate.company, candidate.applicationRecordId)
      appLog.info(`[outreach-chain] checking job posting for poster: ${candidate.jobUrl}`)
      try {
        await sendCommand('NAVIGATE', { url: candidate.jobUrl })
        await new Promise((r) => setTimeout(r, 2500))
        let jobResult = await sendCommand('EXTRACT_JOB_DETAILS', {})
        if (!jobResult.ok) { await new Promise((r) => setTimeout(r, 3000)); jobResult = await sendCommand('EXTRACT_JOB_DETAILS', {}) }
        const jobData = jobResult.data as Record<string, unknown> | undefined
        const freshHiringTeam = jobData?.hiringTeam as Array<{ name: string; title?: string; profileUrl?: string }> | undefined
        const poster = freshHiringTeam?.find((m) => m.profileUrl?.includes('/in/'))
        if (poster?.profileUrl) {
          appLog.info(`[outreach-chain] found job poster on page for ${candidate.company}: ${poster.name}`)
          hmTarget = {
            profileUrl: poster.profileUrl,
            firstName: (poster.name || '').split(/\s+/)[0] || '',
            company: candidate.company,
            headline: poster.title || ''
          }
          updateApplicationRecord(candidate.applicationRecordId, {
            hiringTeam: freshHiringTeam?.filter((m) => m.name?.length >= 2).slice(0, 5) as typeof candidate.hiringTeam
          })
        }
      } catch (err) {
        appLog.info(`[outreach-chain] could not extract poster from job page: ${err instanceof Error ? err.message : err}`)
      }
    }

    // No blind search fallback — only reach out when we have a clear target from the job posting
    if (!hmTarget) {
      appLog.info(`[outreach-chain] no hiring contact found on job posting for ${candidate.company}, skipping`)
      updateApplicationRecord(candidate.applicationRecordId, { outreachStatus: 'skipped' })
      results.push({ applicationRecordId: candidate.applicationRecordId, status: 'skipped', jobUrl: candidate.jobUrl })
      skipped++
      continue
    }

    // Step 4: Send connection request
    broadcastProgress('connecting', i + 1, toProcess.length, candidate.company, candidate.applicationRecordId)
    appLog.info(`[outreach-chain] connecting with ${hmTarget.firstName} at ${candidate.company}`)

    const outreachResult = await handleOutreachRun({
      targets: [{
        profileUrl: hmTarget.profileUrl,
        firstName: hmTarget.firstName,
        company: hmTarget.company,
        headline: hmTarget.headline,
        jobTitle: candidate.jobTitle,
        jobUrl: candidate.jobUrl,
        applicationRecordId: candidate.applicationRecordId
      }]
    })

    if (outreachResult.sent > 0) {
      results.push({
        applicationRecordId: candidate.applicationRecordId,
        status: 'sent',
        targetName: `${hmTarget.firstName} (${hmTarget.headline})`,
        jobUrl: candidate.jobUrl
      })
      sent++
    } else {
      updateApplicationRecord(candidate.applicationRecordId, { outreachStatus: 'skipped' })
      results.push({
        applicationRecordId: candidate.applicationRecordId,
        status: 'failed',
        jobUrl: candidate.jobUrl,
        detail: outreachResult.detail || 'Connection request could not be sent'
      })
      skipped++
    }

    // Anti-detection delay between candidates
    if (i < toProcess.length - 1) {
      await new Promise((r) => setTimeout(r, 5000 + Math.random() * 5000))
    }
  }

  broadcastProgress('done', toProcess.length, toProcess.length, '')
  const detail = `Chain complete: ${sent} connected, ${skipped} skipped out of ${toProcess.length} candidates.`
  appLog.info(`[outreach-chain] ${detail}`)
  return { ok: sent > 0 || skipped > 0, sent, skipped, detail, results }
}
