import { sendCommand } from './bridge'
import { getFollowupState } from './followup-state'
import { getSequenceTarget, advanceStage as advanceSequenceStage } from './sequence-state'
import { canonicalProfileUrlKey } from '@core/linkedin-url'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { userDataDir } from './user-data-path'
import { appLog } from './app-log'
import { BrowserWindow } from 'electron'

const CONNECTIONS_URL = 'https://www.linkedin.com/mynetwork/invite-connect/connections/'
const DETECT_INTERVAL_MS = 30 * 60 * 1000
const KNOWN_ACCEPTS_FILE = 'known-accepts.json'

let detectTimer: ReturnType<typeof setInterval> | null = null
let lastDetectAt = 0
let detecting = false

type KnownAccepts = {
  keys: string[]
  lastUpdated: string
}

function knownAcceptsPath(): string {
  return join(userDataDir(), KNOWN_ACCEPTS_FILE)
}

function loadKnownAccepts(): Set<string> {
  const p = knownAcceptsPath()
  if (!existsSync(p)) return new Set()
  try {
    const data = JSON.parse(readFileSync(p, 'utf8')) as KnownAccepts
    return new Set(data.keys || [])
  } catch (err) {
    appLog.warn('[followup-detector] failed to parse known-accepts', { error: err instanceof Error ? err.message : String(err) })
    return new Set()
  }
}

function saveKnownAccepts(keys: Set<string>): void {
  const data: KnownAccepts = {
    keys: [...keys],
    lastUpdated: new Date().toISOString()
  }
  const dest = knownAcceptsPath()
  const tmp = `${dest}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    renameSync(tmp, dest)
  } catch (err) {
    appLog.error('[followup-detector] failed to save known-accepts', { error: err instanceof Error ? err.message : String(err) })
  }
}

type NewAccept = {
  profileUrl: string
  displayName: string
}

let pendingNewAccepts: NewAccept[] = []

export function getNewAccepts(): NewAccept[] {
  return pendingNewAccepts
}

export function clearNewAccepts(): void {
  pendingNewAccepts = []
}

/** Fetch connections from LinkedIn via bridge. */
async function fetchConnectionItems(): Promise<Array<{ profileUrl: string; displayName: string }>> {
  const navRes = await sendCommand('NAVIGATE', { url: CONNECTIONS_URL })
  if (!navRes.ok) return []
  await new Promise((r) => setTimeout(r, 3000))
  const exRes = await sendCommand('EXTRACT_CONNECTIONS', { scrollPasses: 2 })
  return (exRes.data as { items?: Array<{ profileUrl: string; displayName: string }> })?.items ?? []
}

/** Filter fetched items to only truly new accepts. */
function filterNewAccepts(
  items: Array<{ profileUrl: string; displayName: string }>,
  known: Set<string>,
  followupState: Record<string, { dmSentAt?: string }>
): NewAccept[] {
  const newAccepts: NewAccept[] = []
  for (const item of items) {
    const key = canonicalProfileUrlKey(item.profileUrl)
    if (!key || known.has(key) || followupState[key]?.dmSentAt) continue
    known.add(key)
    newAccepts.push({ profileUrl: item.profileUrl, displayName: item.displayName })
  }
  return newAccepts
}

/** Update sequence + application records for new accepts. */
async function reconcileAcceptedConnections(accepts: NewAccept[]): Promise<void> {
  for (const accept of accepts) {
    const seqTarget = getSequenceTarget(accept.profileUrl)
    if (!seqTarget || !(['invited', 'viewed', 'new'] as string[]).includes(seqTarget.stage)) continue

    advanceSequenceStage(accept.profileUrl, 'accepted')
    if (seqTarget.applicationRecordId) {
      try {
        const { updateApplicationRecord } = await import('./application-history-store')
        updateApplicationRecord(seqTarget.applicationRecordId, {
          outreachStatus: 'connected',
          pipelineStage: 'response'
        })
      } catch (err) {
        appLog.warn('[followup-detector] failed to update application record', { profileUrl: accept.profileUrl, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
}

/** Broadcast new accepts to renderer and optionally schedule auto follow-ups. */
async function broadcastAndSchedule(accepts: NewAccept[]): Promise<void> {
  pendingNewAccepts = [...pendingNewAccepts, ...accepts]
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('followup:newAccepts', { accepts })
  }

  try {
    const settings = (await import('./settings')).loadSettings()
    if (!settings.autoFollowUpOnAccept) return
    const { scheduleFollowUp } = await import('./followup-queue')
    for (const accept of accepts) {
      const seqTarget = getSequenceTarget(accept.profileUrl)
      scheduleFollowUp(accept.profileUrl, accept.displayName, seqTarget?.company, seqTarget?.jobTitle)
    }
  } catch (err) {
    appLog.warn('[followup-detector] auto-followup scheduling failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

async function detectNewAccepts(): Promise<NewAccept[]> {
  if (detecting) return []
  try {
    const { isExtensionConnected } = await import('./bridge')
    if (!isExtensionConnected()) return []
  } catch (e) { appLog.debug('[followup-detector] bridge check failed', e instanceof Error ? e.message : String(e)); return [] }
  try {
    const { isApplyQueueRunnerBusy } = await import('./apply-queue-runner')
    if (isApplyQueueRunnerBusy()) {
      appLog.debug('[followup-detector] skipping: apply queue is running')
      return []
    }
  } catch { /* module not loaded yet */ }
  detecting = true
  try {
    const known = loadKnownAccepts()
    const followupState = getFollowupState()

    const items = await fetchConnectionItems()
    if (!items.length) return []

    const newAccepts = filterNewAccepts(items, known, followupState)

    await reconcileAcceptedConnections(newAccepts)

    saveKnownAccepts(known)
    lastDetectAt = Date.now()

    if (newAccepts.length > 0) {
      await broadcastAndSchedule(newAccepts)
      appLog.info('[followup-detector] detected new accepts', { count: newAccepts.length })
      const { broadcastToRenderer } = await import('./broadcast-to-renderer')
      const names = newAccepts.slice(0, 3).map((a) => a.displayName).join(', ')
      const more = newAccepts.length > 3 ? ` and ${newAccepts.length - 3} more` : ''
      broadcastToRenderer('app:toast', {
        message: `${names}${more} accepted your connection.`,
        tone: 'ok'
      })
    }

    return newAccepts
  } catch (err) {
    appLog.error('[followup-detector] detection failed', { error: err instanceof Error ? err.message : String(err) })
    return []
  } finally {
    detecting = false
  }
}

/**
 * Start the background follow-up detector timer.
 * DISABLED: Background detection that navigates Chrome every 30 minutes was removed.
 * Detection is only triggered when the user explicitly opens the Follow Up panel
 * or clicks "Scan" / "Detect" in the UI.
 */
export function startFollowupDetector(): void {
  // No-op: background detection is disabled.
  // Detection is user-initiated only via runDetectNow().
}

export function stopFollowupDetector(): void {
  if (detectTimer) {
    clearInterval(detectTimer)
    detectTimer = null
  }
}

export async function runDetectNow(): Promise<NewAccept[]> {
  return detectNewAccepts()
}

