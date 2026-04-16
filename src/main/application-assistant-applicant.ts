import { BrowserWindow, dialog } from 'electron'
import type { ApplicantAsset, ApplicantProfile, ApplicantProfileSaveView, ApplicantProfileView } from '@core/application-types'
import { parseResumeMarkdown } from '@core/resume-parser'
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadApplicantProfile, saveApplicantProfile } from './applicant-profile-store'
import { saveUserProfile } from './profile-store'
import { importResumeFromPath } from './resume'
import { loadSettings } from './settings'
import { userDataDir } from './user-data-path'
import { appLog } from './app-log'
import { syncApplicantFromUserProfile } from './user-applicant-sync'

export function getApplicantProfile(): ApplicantProfileView {
  return { ok: true, profile: loadApplicantProfile() }
}

function assetsDir(): string {
  const dir = join(userDataDir(), 'assets')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function saveApplicantProfileView(payload: unknown): ApplicantProfileSaveView {
  const saved = saveApplicantProfile((payload || {}) as Partial<ApplicantProfile>)
  return {
    ok: true,
    profile: saved,
    detail: 'Applicant profile saved.'
  }
}

/** Overlapping saves used the same read-merge-write pattern; a slow/stale save completing last could wipe newer basics. */
let applicantSaveChain: Promise<void> = Promise.resolve()

export async function enqueueApplicantSave(payload: unknown): Promise<ApplicantProfileSaveView> {
  const done = applicantSaveChain.then(() => saveApplicantProfileView(payload))
  applicantSaveChain = done.then(
    () => undefined,
    () => undefined
  )
  return done
}

function resolveMimeType(ext: string): string {
  return ext === '.pdf' ? 'application/pdf' :
    ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
    ext === '.doc' ? 'application/msword' :
    'application/octet-stream'
}

const ASSET_META: Record<'resume' | 'cover_letter', { label: string; dialogTitle: string; filterName: string }> = {
  resume: { label: 'Resume', dialogTitle: 'Select your resume', filterName: 'Resume files' },
  cover_letter: { label: 'Cover letter', dialogTitle: 'Select your cover letter', filterName: 'Cover letter' }
}

export async function handleAssetUpload(kind: 'resume' | 'cover_letter'): Promise<{
  ok: boolean
  profile?: ApplicantProfile
  detail: string
}> {
  const meta = ASSET_META[kind]

  const parentWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined
  const result = await dialog.showOpenDialog(
    ...(parentWindow ? [parentWindow] : []) as [BrowserWindow],
    {
      title: meta.dialogTitle,
      filters: [
        { name: meta.filterName, extensions: ['pdf', 'docx', 'doc'] }
      ],
      properties: ['openFile']
    }
  )

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, detail: 'No file selected.' }
  }

  const filePath = result.filePaths[0]
  const fileName = basename(filePath)
  const ext = extname(fileName).toLowerCase()
  const mimeType = resolveMimeType(ext)

  // For resumes, keep the general resume store in sync so smart search/screening can reuse it.
  if (kind === 'resume') {
    let importResult: { ok: true; fileName: string; charCount: number } | { ok: false; detail: string }
    try {
      importResult = await importResumeFromPath(filePath)
    } catch (err) {
      return {
        ok: false,
        detail: `Could not read resume: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    if (!importResult.ok) {
      return { ok: false, detail: importResult.detail }
    }
  }

  const id = randomUUID()
  const storageName = `${id}${ext}`
  const storagePath = join(assetsDir(), storageName)

  try {
    copyFileSync(filePath, storagePath)
  } catch (err) {
    return {
      ok: false,
      detail: `Could not copy ${meta.label.toLowerCase()}: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  const stat = statSync(storagePath)
  const asset: ApplicantAsset = {
    id,
    kind,
    label: meta.label,
    fileName,
    storagePath,
    mimeType,
    sizeBytes: stat.size,
    updatedAt: new Date().toISOString()
  }

  // Load current profile and replace any existing asset of this kind
  const current = loadApplicantProfile()
  const oldAssets = current.assets.filter((a) => a.kind === kind)

  // Clean up old files
  for (const old of oldAssets) {
    try {
      if (existsSync(old.storagePath)) unlinkSync(old.storagePath)
    } catch (e) { appLog.debug('[assistant] asset cleanup failed', e instanceof Error ? e.message : String(e)) }
  }

  const otherAssets = current.assets.filter((a) => a.kind !== kind)
  const saved = saveApplicantProfile({
    ...current,
    assets: [...otherAssets, asset],
    updatedAt: new Date().toISOString()
  })

  // For resumes, sync parsed data to user profile
  let finalProfile = saved
  if (kind === 'resume') {
    try {
      const settings = loadSettings()
      if (settings.resumeText) {
        const parsed = parseResumeMarkdown(settings.resumeText)
        saveUserProfile(parsed)
        finalProfile = syncApplicantFromUserProfile(parsed, settings.resumeText)
      }
    } catch (err) {
      appLog.warn(
        '[applicant] Resume parsed for asset upload failed:',
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  return {
    ok: true,
    profile: finalProfile,
    detail: `${meta.label} "${fileName}" uploaded successfully.`
  }
}

export function handleResumeRemove(): {
  ok: boolean
  profile?: ApplicantProfile
  detail: string
} {
  const current = loadApplicantProfile()
  const resumes = current.assets.filter((a) => a.kind === 'resume')

  for (const r of resumes) {
    try {
      if (existsSync(r.storagePath)) unlinkSync(r.storagePath)
    } catch (e) {
      appLog.warn('[application-assistant] resume file cleanup failed', e instanceof Error ? e.message : String(e))
    }
  }

  const saved = saveApplicantProfile({
    ...current,
    assets: current.assets.filter((a) => a.kind !== 'resume'),
    updatedAt: new Date().toISOString()
  })

  return {
    ok: true,
    profile: saved,
    detail: 'Resume removed.'
  }
}

export function handleCoverLetterRemove(): {
  ok: boolean
  profile?: ApplicantProfile
  detail: string
} {
  const current = loadApplicantProfile()
  const covers = current.assets.filter((a) => a.kind === 'cover_letter')

  for (const c of covers) {
    try {
      if (existsSync(c.storagePath)) unlinkSync(c.storagePath)
    } catch (e) {
      appLog.warn('[application-assistant] cover letter file cleanup failed', e instanceof Error ? e.message : String(e))
    }
  }

  const saved = saveApplicantProfile({
    ...current,
    assets: current.assets.filter((a) => a.kind !== 'cover_letter'),
    updatedAt: new Date().toISOString()
  })

  return {
    ok: true,
    profile: saved,
    detail: 'Cover letter removed.'
  }
}
