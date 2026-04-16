import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { userDataDir } from './user-data-path'
import { appLog } from './app-log'
import { loadSettings } from './settings'
import { BrowserWindow } from 'electron'

export type PendingFollowUp = {
  id: string
  profileUrl: string
  displayName: string
  company?: string
  jobTitle?: string
  acceptedAt: string
  scheduledSendAt: string
  status: 'pending' | 'sent' | 'cancelled' | 'failed'
  detail?: string
  retryCount?: number
}

type FollowUpQueueData = {
  items: PendingFollowUp[]
  lastUpdated: string
}

const FOLLOWUP_QUEUE_FILE = 'followup-queue.json'
function queuePath(): string {
  return join(userDataDir(), FOLLOWUP_QUEUE_FILE)
}

export function loadFollowUpQueue(): PendingFollowUp[] {
  const p = queuePath()
  if (!existsSync(p)) return []
  try {
    const data = JSON.parse(readFileSync(p, 'utf8')) as FollowUpQueueData
    return data.items || []
  } catch (e) {
    appLog.debug('[followup-queue] load parse failed, using empty queue', e instanceof Error ? e.message : String(e))
    return []
  }
}

function saveFollowUpQueue(items: PendingFollowUp[]): void {
  const dest = queuePath()
  const tmp = `${dest}.tmp`
  const data: FollowUpQueueData = { items, lastUpdated: new Date().toISOString() }
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, dest)
}

function broadcastQueueUpdate(): void {
  const pending = loadFollowUpQueue().filter(i => i.status === 'pending')
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('followupQueueUpdate', { items: pending })
    }
  } catch (e) { appLog.warn('[followup-queue] broadcastQueueUpdate failed', e instanceof Error ? e.message : String(e)) }
}

export function scheduleFollowUp(
  profileUrl: string,
  displayName: string,
  company?: string,
  jobTitle?: string
): PendingFollowUp {
  const settings = loadSettings()
  const delayMs = (settings.autoFollowUpDelayMinutes ?? 60) * 60_000
  const now = new Date()
  const sendAt = new Date(now.getTime() + delayMs)

  const item: PendingFollowUp = {
    id: `fu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    profileUrl,
    displayName,
    company,
    jobTitle,
    acceptedAt: now.toISOString(),
    scheduledSendAt: sendAt.toISOString(),
    status: 'pending'
  }

  const queue = loadFollowUpQueue()
  const exists = queue.some(
    i => i.profileUrl === profileUrl && (i.status === 'pending' || i.status === 'sent')
  )
  if (exists) return item

  queue.push(item)
  saveFollowUpQueue(queue)

  appLog.info(`[followup-queue] scheduled`, {
    id: item.id,
    displayName,
    sendAt: sendAt.toISOString(),
    delayMinutes: settings.autoFollowUpDelayMinutes ?? 60
  })

  broadcastQueueUpdate()
  return item
}

export function cancelFollowUp(id: string): boolean {
  const queue = loadFollowUpQueue()
  const item = queue.find(i => i.id === id)
  if (!item || item.status !== 'pending') return false
  item.status = 'cancelled'
  saveFollowUpQueue(queue)
  broadcastQueueUpdate()
  appLog.info(`[followup-queue] cancelled`, { id, displayName: item.displayName })
  return true
}

export function getPendingFollowUps(): PendingFollowUp[] {
  return loadFollowUpQueue().filter(i => i.status === 'pending')
}

