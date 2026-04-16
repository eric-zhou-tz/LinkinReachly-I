/**
 * Authoritative store for outreach sequence lifecycle (`sequence-state.json`): per-profile
 * `SequenceTarget` including `stage` (invite → accept → DM, etc.). `followup-state.ts`
 * persists parallel follow-up nudge counters for queue gating and legacy IPC; prefer this
 * module for semantic lifecycle state, and keep the two in sync when recording sends.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalProfileUrlKey } from '@core/linkedin-url'
import type { SequenceTarget, SequenceStage } from '@core/outreach-sequence'
import { userDataDir } from './user-data-path'
import { appLog } from './app-log'

const SEQUENCE_FILE = 'sequence-state.json'

type SequenceStore = {
  targets: Record<string, SequenceTarget>
  updatedAt: string
}

let _storeCache: SequenceStore | null = null
let _storeCacheMtimeMs = 0

function filePath(): string {
  return join(userDataDir(), SEQUENCE_FILE)
}

function loadStore(): SequenceStore {
  const p = filePath()
  if (!existsSync(p)) return { targets: {}, updatedAt: new Date().toISOString() }
  try {
    const mtimeMs = statSync(p).mtimeMs
    if (_storeCache && mtimeMs === _storeCacheMtimeMs) return _storeCache
    const raw = JSON.parse(readFileSync(p, 'utf8')) as SequenceStore
    if (raw.targets && typeof raw.targets === 'object') {
      _storeCache = raw
      _storeCacheMtimeMs = mtimeMs
      return raw
    }
  } catch (err) {
    appLog.warn('[sequence-state] failed to parse store', { error: err instanceof Error ? err.message : String(err) })
  }
  return { targets: {}, updatedAt: new Date().toISOString() }
}

function saveStore(store: SequenceStore): void {
  store.updatedAt = new Date().toISOString()
  const dest = filePath()
  const tmp = `${dest}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
    renameSync(tmp, dest)
  } catch (err) {
    appLog.error('[sequence-state] failed to save store', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
  _storeCache = store
  try { _storeCacheMtimeMs = statSync(dest).mtimeMs } catch (e) { appLog.debug('[sequence-state] mtime read failed', e instanceof Error ? e.message : String(e)); _storeCacheMtimeMs = 0 }
}

export function getSequenceTarget(profileUrl: string): SequenceTarget | null {
  const key = canonicalProfileUrlKey(profileUrl)
  if (!key) return null
  const store = loadStore()
  return store.targets[key] ?? null
}

export function upsertSequenceTarget(profileUrl: string, partial: Partial<SequenceTarget>): SequenceTarget {
  const key = canonicalProfileUrlKey(profileUrl)
  const store = loadStore()
  const existing = store.targets[key]
  const now = new Date().toISOString()

  const target: SequenceTarget = {
    profileUrl: partial.profileUrl ?? existing?.profileUrl ?? profileUrl,
    firstName: partial.firstName ?? existing?.firstName ?? '',
    company: partial.company ?? existing?.company ?? '',
    headline: partial.headline ?? existing?.headline,
    jobTitle: partial.jobTitle ?? existing?.jobTitle,
    jobUrl: partial.jobUrl ?? existing?.jobUrl,
    applicationRecordId: partial.applicationRecordId ?? existing?.applicationRecordId,
    stage: partial.stage ?? existing?.stage ?? 'new',
    viewedAt: partial.viewedAt ?? existing?.viewedAt,
    invitedAt: partial.invitedAt ?? existing?.invitedAt,
    acceptedAt: partial.acceptedAt ?? existing?.acceptedAt,
    dmSentAt: partial.dmSentAt ?? existing?.dmSentAt,
    respondedAt: partial.respondedAt ?? existing?.respondedAt,
    lastUpdated: now
  }

  store.targets[key] = target
  saveStore(store)
  return target
}

const STAGE_ORDER: SequenceStage[] = ['new', 'viewed', 'invited', 'accepted', 'dm_sent', 'responded', 'archived']

function isValidTransition(from: SequenceStage, to: SequenceStage): boolean {
  const fromIdx = STAGE_ORDER.indexOf(from)
  const toIdx = STAGE_ORDER.indexOf(to)
  if (fromIdx === -1 || toIdx === -1) return false
  return toIdx >= fromIdx
}

export function advanceStage(profileUrl: string, stage: SequenceStage): SequenceTarget | null {
  const key = canonicalProfileUrlKey(profileUrl)
  if (!key) return null
  const store = loadStore()
  const existing = store.targets[key]
  if (!existing) return null

  if (!isValidTransition(existing.stage, stage)) return existing

  const now = new Date().toISOString()

  const timestampField: Partial<SequenceTarget> = {}
  if (stage === 'viewed') timestampField.viewedAt = now
  if (stage === 'invited') timestampField.invitedAt = now
  if (stage === 'accepted') timestampField.acceptedAt = now
  if (stage === 'dm_sent') timestampField.dmSentAt = now
  if (stage === 'responded') timestampField.respondedAt = now

  const updated: SequenceTarget = {
    ...existing,
    ...timestampField,
    stage,
    lastUpdated: now
  }

  store.targets[key] = updated
  saveStore(store)
  return updated
}

export function listSequenceTargets(filter?: { stage?: SequenceStage }): SequenceTarget[] {
  const store = loadStore()
  let targets = Object.values(store.targets)
  if (filter?.stage) {
    targets = targets.filter((t) => t.stage === filter.stage)
  }
  return targets.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
}

export function getAllSequenceTargets(): SequenceTarget[] {
  return listSequenceTargets()
}
