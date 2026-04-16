import { existsSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, extname } from 'node:path'
import type { UserProfile } from '@core/profile-db'
import { parseResumeMarkdown } from '@core/resume-parser'
import { parseResumeWithLlm } from './llm-resume-parser'
import { saveUserProfile } from './profile-store'
import { syncApplicantFromUserProfile } from './user-applicant-sync'
import { loadApplicantProfile, saveApplicantProfile } from './applicant-profile-store'
import { loadSettings } from './settings'
import { userDataDir } from './user-data-path'
import { appLog } from './app-log'

function resumeDir(): string {
  return join(userDataDir(), 'resume')
}

function resolveMimeType(ext: string): string {
  return ext === '.pdf' ? 'application/pdf' :
    ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
    ext === '.doc' ? 'application/msword' :
    'application/octet-stream'
}

export async function persistStructuredProfileFromResumeText(resumeText: string): Promise<UserProfile> {
  let profile: UserProfile
  try {
    profile = await parseResumeWithLlm(resumeText)
    appLog.info('[profile-sync] LLM resume parse succeeded', { name: profile.name, entries: profile.entries.length })
  } catch (err) {
    appLog.warn('[profile-sync] LLM parse failed, falling back to heuristic parser', err instanceof Error ? err.message : String(err))
    profile = parseResumeMarkdown(resumeText)
  }

  saveUserProfile(profile)
  syncApplicantFromUserProfile(profile, resumeText)

  // Fire-and-forget Firestore sync (imported lazily to avoid circular deps)
  import('./firestore-profile').then(({ syncProfileToFirestore }) =>
    syncProfileToFirestore(profile).catch((e) =>
      appLog.debug('[profile-sync] Firestore sync failed (non-blocking)', e instanceof Error ? e.message : String(e))
    )
  ).catch(() => {})

  const settings = loadSettings()
  const fileName = settings.resumeFileName
  if (fileName) {
    const storagePath = join(resumeDir(), fileName)
    if (existsSync(storagePath)) {
      const current = loadApplicantProfile()
      const hasResume = current.assets.some((a) => a.kind === 'resume')
      if (!hasResume) {
        const ext = extname(fileName).toLowerCase()
        const stat = statSync(storagePath)
        const asset = {
          id: randomUUID(),
          kind: 'resume' as const,
          label: 'Resume',
          fileName,
          storagePath,
          mimeType: resolveMimeType(ext),
          sizeBytes: stat.size,
          updatedAt: new Date().toISOString()
        }
        saveApplicantProfile({ assets: [...current.assets, asset] })
      }
    }
  }

  return profile
}
