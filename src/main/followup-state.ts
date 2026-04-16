/**
 * Parallel persistence for follow-up *nudge* progress (`followup-state.json`): numeric
 * `lastStage` per profile, used by the outreach queue (`getFollowupStage`) and aggregated
 * for IPC (`getFollowupState`). Canonical outreach lifecycle semantics live in
 * `sequence-state.ts` (`sequence-state.json`, `SequenceTarget.stage`); this module is the
 * compatibility / dedicated store for follow-up wave bookkeeping kept in sync on send paths.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { appLog } from './app-log'
import { join } from 'node:path'
import { canonicalProfileUrlKey } from '@core/linkedin-url'
import { userDataDir } from './user-data-path'

type FollowupNudgeRecord = {
  lastStage: number
  updatedAt: string
  lastExecutionId?: string
}

type FollowupStateFile = {
  byProfileKey: Record<string, FollowupNudgeRecord>
}

function statePath(): string {
  return join(userDataDir(), 'followup-state.json')
}

function loadFollowupState(): FollowupStateFile {
  const p = statePath()
  if (!existsSync(p)) return { byProfileKey: {} }
  try {
    const j = JSON.parse(readFileSync(p, 'utf8')) as Partial<FollowupStateFile>
    if (j.byProfileKey && typeof j.byProfileKey === 'object') return { byProfileKey: j.byProfileKey }
  } catch (e) {
    appLog.warn('[followup-state] failed to load state file', e instanceof Error ? e.message : String(e))
  }
  return { byProfileKey: {} }
}

function saveFollowupState(s: FollowupStateFile): void {
  const dest = statePath()
  const tmp = `${dest}.tmp`
  writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8')
  renameSync(tmp, dest)
}

export function recordFollowupSent(profileUrl: string, executionId: string, stage: number): void {
  const st = loadFollowupState()
  const k = canonicalProfileUrlKey(profileUrl)
  st.byProfileKey[k] = {
    lastStage: stage,
    updatedAt: new Date().toISOString(),
    lastExecutionId: executionId
  }
  saveFollowupState(st)
}

export function getFollowupStage(profileUrl: string): number {
  const st = loadFollowupState()
  const k = canonicalProfileUrlKey(profileUrl)
  return st.byProfileKey[k]?.lastStage ?? 0
}

export function getFollowupState(): Record<string, { stage: string; sentAt?: string; dmSentAt?: string }> {
  const st = loadFollowupState()
  const result: Record<string, { stage: string; sentAt?: string; dmSentAt?: string }> = {}
  for (const [key, record] of Object.entries(st.byProfileKey)) {
    result[key] = {
      stage: record.lastStage >= 2 ? 'dm_sent' : record.lastStage >= 1 ? 'sent' : 'accepted',
      sentAt: record.updatedAt,
      dmSentAt: record.lastStage >= 2 ? record.updatedAt : undefined
    }
  }
  return result
}
