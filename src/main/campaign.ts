import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { TargetRow } from '@core/types'
import { canonicalProfileUrlKey } from '@core/linkedin-url'
import { userDataDir } from './user-data-path'
import { appLog } from './app-log'

export interface Campaign {
  id: string
  createdAt: string
  updatedAt: string
  goal: string
  plan: {
    title: string
    summary: string
    executionId: string
    searchQuery: string
  }
  targets: TargetRow[]
  sentProfileKeys: string[]
  status: 'active' | 'completed' | 'archived'
}

export type CampaignSummary = {
  id: string
  goal: string
  title: string
  totalTargets: number
  sentCount: number
  remainingCount: number
  createdAt: string
  updatedAt: string
  status: Campaign['status']
}

function campaignDir(): string {
  const d = join(userDataDir(), 'campaigns')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function campaignPath(id: string): string {
  return join(campaignDir(), `${id}.json`)
}

function activePointerPath(): string {
  return join(campaignDir(), '_active.json')
}

const _campaignCache = new Map<string, { campaign: Campaign; mtimeMs: number }>()

export function loadCampaign(id: string): Campaign | null {
  const p = campaignPath(id)
  if (!existsSync(p)) return null
  try {
    const mtimeMs = statSync(p).mtimeMs
    const cached = _campaignCache.get(id)
    if (cached && cached.mtimeMs === mtimeMs) return cached.campaign
    const campaign = JSON.parse(readFileSync(p, 'utf8')) as Campaign
    if (!campaign.id || !Array.isArray(campaign.targets)) {
      appLog.warn('[campaign] invalid campaign structure on disk', { id })
      return null
    }
    _campaignCache.set(id, { campaign, mtimeMs })
    return campaign
  } catch (err) {
    appLog.warn('[campaign] failed to parse campaign file', { id, error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

export function saveCampaign(campaign: Campaign): void {
  campaign.updatedAt = new Date().toISOString()
  const dest = campaignPath(campaign.id)
  const tmp = `${dest}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(campaign, null, 2), 'utf8')
    renameSync(tmp, dest)
    try { _campaignCache.set(campaign.id, { campaign, mtimeMs: statSync(dest).mtimeMs }) } catch (e) { appLog.debug('[campaign] cache mtime refresh failed', e instanceof Error ? e.message : String(e)); _campaignCache.delete(campaign.id) }
  } catch (err) {
    appLog.error('[campaign] failed to save campaign', { id: campaign.id, error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

export function getActiveCampaignId(): string | null {
  const p = activePointerPath()
  if (!existsSync(p)) return null
  try {
    const data = JSON.parse(readFileSync(p, 'utf8')) as { id?: string }
    return data.id || null
  } catch (e) {
    appLog.debug('[campaign] active pointer parse failed', e instanceof Error ? e.message : String(e))
    return null
  }
}

function setActiveCampaignId(id: string | null): void {
  const p = activePointerPath()
  const tmp = `${p}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify({ id }), 'utf8')
    renameSync(tmp, p)
  } catch (err) {
    appLog.error('[campaign] failed to write active pointer', { id, error: err instanceof Error ? err.message : String(err) })
  }
}

export function loadActiveCampaign(): Campaign | null {
  const id = getActiveCampaignId()
  if (!id) return null
  const campaign = loadCampaign(id)
  if (!campaign || campaign.status !== 'active') return null
  return campaign
}

export function createCampaign(
  goal: string,
  plan: Campaign['plan'],
  targets: TargetRow[]
): Campaign {
  const campaign: Campaign = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    goal,
    plan,
    targets,
    sentProfileKeys: [],
    status: 'active'
  }
  saveCampaign(campaign)
  setActiveCampaignId(campaign.id)
  appLog.info('[campaign] created', { id: campaign.id, targets: targets.length, goal: goal.slice(0, 80) })
  return campaign
}

export function markTargetsSent(campaignId: string, profileUrls: string[]): void {
  const campaign = loadCampaign(campaignId)
  if (!campaign) return
  const existing = new Set(campaign.sentProfileKeys)
  for (const url of profileUrls) {
    const key = canonicalProfileUrlKey(url)
    if (key) existing.add(key)
  }
  campaign.sentProfileKeys = [...existing]
  const allSent = campaign.targets.every(t => {
    const k = canonicalProfileUrlKey(t.profileUrl)
    return k ? existing.has(k) : false
  })
  if (allSent) {
    campaign.status = 'completed'
    appLog.info('[campaign] all targets sent, campaign auto-completed', { campaignId, totalTargets: campaign.targets.length })
  }
  saveCampaign(campaign)
}

export function archiveCampaign(campaignId: string): void {
  const campaign = loadCampaign(campaignId)
  if (!campaign) return
  campaign.status = 'archived'
  saveCampaign(campaign)
  const activeId = getActiveCampaignId()
  if (activeId === campaignId) setActiveCampaignId(null)
}

export function getCampaignSummary(campaign: Campaign): CampaignSummary {
  const sentKeys = new Set(campaign.sentProfileKeys)
  const sentCount = campaign.targets.filter(t => {
    const k = canonicalProfileUrlKey(t.profileUrl)
    return k ? sentKeys.has(k) : false
  }).length
  return {
    id: campaign.id,
    goal: campaign.goal,
    title: campaign.plan.title,
    totalTargets: campaign.targets.length,
    sentCount,
    remainingCount: campaign.targets.length - sentCount,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    status: campaign.status
  }
}

export function getRemainingTargets(campaign: Campaign): TargetRow[] {
  const sentKeys = new Set(campaign.sentProfileKeys)
  return campaign.targets.filter(t => {
    const k = canonicalProfileUrlKey(t.profileUrl)
    return k ? !sentKeys.has(k) : false
  })
}
