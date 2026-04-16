import type { ApplicantProfile } from '@core/application-types'

const STORAGE_KEY = 'linkinreachly:v1:local-applicant-draft'

export type LocalApplicantDraftBackup = {
  v: 1
  localSavedAt: number
  basics: ApplicantProfile['basics']
  links: ApplicantProfile['links']
  workAuth: ApplicantProfile['workAuth']
  compensation: ApplicantProfile['compensation']
  background: ApplicantProfile['background']
  coverLetterTemplate?: string
  answerBank: ApplicantProfile['answerBank']
  screeningAnswerCache?: ApplicantProfile['screeningAnswerCache']
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function parseBackup(raw: string | null): LocalApplicantDraftBackup | null {
  if (raw == null || raw === '') return null
  try {
    const o = JSON.parse(raw) as unknown
    if (!isRecord(o) || o.v !== 1) return null
    if (typeof o.localSavedAt !== 'number' || !Number.isFinite(o.localSavedAt)) return null
    if (!isRecord(o.basics) || !isRecord(o.links) || !isRecord(o.workAuth)) return null
    return o as LocalApplicantDraftBackup
  } catch {
    return null
  }
}

/** Prefer server copy time; missing/invalid → 0. */
export function profileUpdatedAtMs(profile: ApplicantProfile): number {
  const t = Date.parse(profile.updatedAt)
  return Number.isFinite(t) ? t : 0
}

/**
 * Fields the user can edit in the Application profile UI (excluding assets — paths stay on disk).
 */
export function draftToLocalBackup(draft: ApplicantProfile): LocalApplicantDraftBackup {
  return {
    v: 1,
    localSavedAt: Date.now(),
    basics: draft.basics,
    links: draft.links,
    workAuth: draft.workAuth,
    compensation: draft.compensation,
    background: draft.background,
    coverLetterTemplate: draft.coverLetterTemplate,
    answerBank: draft.answerBank,
    screeningAnswerCache: draft.screeningAnswerCache
  }
}

export function writeLocalApplicantDraftBackup(draft: ApplicantProfile): void {
  try {
    const payload = draftToLocalBackup(draft)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* quota / private mode — disk save remains */
  }
}

export function readLocalApplicantDraftBackup(): LocalApplicantDraftBackup | null {
  if (typeof localStorage === 'undefined') return null
  return parseBackup(localStorage.getItem(STORAGE_KEY))
}

/** Merge local draft fields over server profile; keep assets and version from server. */
export function mergeLocalBackupOverProfile(
  profile: ApplicantProfile,
  backup: LocalApplicantDraftBackup
): ApplicantProfile {
  return {
    ...profile,
    basics: { ...profile.basics, ...backup.basics },
    links: { ...profile.links, ...backup.links },
    workAuth: { ...profile.workAuth, ...backup.workAuth },
    compensation: { ...profile.compensation, ...backup.compensation },
    background: { ...profile.background, ...backup.background },
    coverLetterTemplate:
      backup.coverLetterTemplate !== undefined ? backup.coverLetterTemplate : profile.coverLetterTemplate,
    answerBank: Array.isArray(backup.answerBank) ? backup.answerBank : profile.answerBank,
    screeningAnswerCache:
      backup.screeningAnswerCache !== undefined ? backup.screeningAnswerCache : profile.screeningAnswerCache
  }
}

/**
 * Local backup is newer than what last made it to applicant-profile.json (e.g. refresh before IPC save finished).
 */
export function shouldRestoreFromLocalBackup(profile: ApplicantProfile, backup: LocalApplicantDraftBackup): boolean {
  const diskMs = profileUpdatedAtMs(profile)
  const skewMs = 750
  if (backup.localSavedAt <= diskMs + skewMs) return false
  const diskFingerprint = JSON.stringify({
    basics: profile.basics,
    links: profile.links,
    workAuth: profile.workAuth,
    compensation: profile.compensation,
    background: profile.background,
    coverLetterTemplate: profile.coverLetterTemplate,
    answerBank: profile.answerBank,
    screeningAnswerCache: profile.screeningAnswerCache
  })
  const backupFingerprint = JSON.stringify({
    basics: backup.basics,
    links: backup.links,
    workAuth: backup.workAuth,
    compensation: backup.compensation,
    background: backup.background,
    coverLetterTemplate: backup.coverLetterTemplate,
    answerBank: backup.answerBank,
    screeningAnswerCache: backup.screeningAnswerCache
  })
  return diskFingerprint !== backupFingerprint
}
