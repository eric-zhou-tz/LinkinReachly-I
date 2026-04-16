// ---------------------------------------------------------------------------
// profile-store.ts — JSON persistence for UserProfile (structured resume).
// Follows the same pattern as applicant-profile-store.ts.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { UserProfile } from '@core/profile-db'
import { isProfileUsableForJobFit } from '@core/profile-db'
import { userDataDir } from './user-data-path'
import { appLog } from './app-log'

// ── Paths ─────────────────────────────────────────────────────────────────

function configDir(): string {
  const dir = join(userDataDir(), 'config')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function profilePath(): string {
  return join(configDir(), 'user-profile.json')
}

// ── Default ───────────────────────────────────────────────────────────────

function defaultProfile(): UserProfile {
  return {
    name: '',
    location: '',
    email: '',
    linkedinUrl: '',
    summary: '',
    entries: [],
    education: [],
    languages: [],
    countriesWorked: [],
    totalYearsExperience: 0,
    lastUpdated: new Date(0).toISOString()
  }
}

// ── Normalize ─────────────────────────────────────────────────────────────

function normalizeProfile(raw: unknown): UserProfile {
  const fallback = defaultProfile()
  if (typeof raw !== 'object' || raw == null) return fallback
  const p = raw as Partial<UserProfile>

  return {
    name: String(p.name || '').trim(),
    location: String(p.location || '').trim(),
    email: String(p.email || '').trim(),
    linkedinUrl: String(p.linkedinUrl || '').trim(),
    summary: String(p.summary || '').trim(),
    entries: Array.isArray(p.entries) ? p.entries : [],
    education: Array.isArray(p.education) ? p.education : [],
    languages: Array.isArray(p.languages) ? p.languages : [],
    countriesWorked: Array.isArray(p.countriesWorked) ? p.countriesWorked : [],
    totalYearsExperience: typeof p.totalYearsExperience === 'number'
      ? p.totalYearsExperience
      : fallback.totalYearsExperience,
    lastUpdated: String(p.lastUpdated || fallback.lastUpdated)
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export function loadUserProfile(): UserProfile {
  const path = profilePath()
  if (!existsSync(path)) return defaultProfile()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return normalizeProfile(raw)
  } catch (err) {
    appLog.warn('[profile-store] failed to parse user profile', { error: err instanceof Error ? err.message : String(err) })
    return defaultProfile()
  }
}

export function saveUserProfile(profile: UserProfile): UserProfile {
  const normalized = normalizeProfile({
    ...profile,
    lastUpdated: new Date().toISOString()
  })
  const dest = profilePath()
  const tmp = `${dest}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8')
    renameSync(tmp, dest)
  } catch (err) {
    appLog.error('[profile-store] failed to save user profile', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
  return normalized
}

/**
 * True when persisted profile can drive heuristic job ranking (aligned with job-search ranker gate).
 */
export function hasUserProfile(): boolean {
  return isProfileUsableForJobFit(loadUserProfile())
}
