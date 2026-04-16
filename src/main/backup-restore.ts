import { dialog } from 'electron'
import { existsSync, writeFileSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadSettings, saveSettings } from './settings'
import { loadApplicantProfile, saveApplicantProfile } from './applicant-profile-store'
import { loadApplicationHistory } from './application-history-store'
import { loadFollowUpQueue } from './followup-queue'
import { appLog } from './app-log'
import { userDataDir } from './user-data-path'
import type { AppSettings } from './settings'
import type { ApplicantProfile, ApplicationRecord } from '@core/application-types'
import type { PendingFollowUp } from './followup-queue'

type BackupData = {
  version: 1
  exportedAt: string
  settings: Omit<AppSettings, 'apiKeyStored' | 'apiKeyIsEncrypted'>
  profile: ApplicantProfile
  applicationHistory: ApplicationRecord[]
  followUpQueue: PendingFollowUp[]
}

export async function exportBackup(): Promise<{ ok: boolean; path?: string; detail: string }> {
  try {
    const result = await dialog.showSaveDialog({
      title: 'Export Backup',
      defaultPath: `linkinreachly-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePath) {
      return { ok: false, detail: 'Cancelled.' }
    }

    const settings = loadSettings()
    const { apiKeyStored: _k, apiKeyIsEncrypted: _e, ...safeSettings } = settings

    const backup: BackupData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: safeSettings,
      profile: loadApplicantProfile(),
      applicationHistory: loadApplicationHistory(),
      followUpQueue: loadFollowUpQueue()
    }

    writeFileSync(result.filePath, JSON.stringify(backup, null, 2), 'utf8')
    appLog.info('[backup] exported', { path: result.filePath, records: backup.applicationHistory.length })

    return {
      ok: true,
      path: result.filePath,
      detail: `Backup saved: ${backup.applicationHistory.length} applications, profile, settings.`
    }
  } catch (err) {
    appLog.error('[backup] export failed', err)
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

export async function importBackup(): Promise<{ ok: boolean; detail: string }> {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Import Backup',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })

    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, detail: 'Cancelled.' }
    }

    const filePath = result.filePaths[0]
    const fileSize = statSync(filePath).size
    const MAX_BACKUP_SIZE = 50 * 1024 * 1024 // 50 MB
    if (fileSize > MAX_BACKUP_SIZE) {
      return { ok: false, detail: `Backup file too large (${(fileSize / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.` }
    }

    const raw = readFileSync(filePath, 'utf8')
    const data = JSON.parse(raw) as BackupData

    if (typeof data.version !== 'number' || data.version !== 1) {
      return { ok: false, detail: `Unsupported backup version: ${String(data.version)}` }
    }
    if (!data.exportedAt || typeof data.exportedAt !== 'string') {
      return { ok: false, detail: 'Invalid backup: missing exportedAt timestamp.' }
    }

    // Safety-critical fields that must not be overridden by imported backups
    const PROTECTED_SAFETY_FIELDS = [
      'weeklyConnectionCap', 'dailyCap', 'applyDailyCap'
    ] as const

    if (data.settings) {
      const current = loadSettings()
      const importedSettings = { ...data.settings }
      for (const field of PROTECTED_SAFETY_FIELDS) {
        delete (importedSettings as Record<string, unknown>)[field]
      }
      const merged: AppSettings = {
        ...current,
        ...importedSettings,
        apiKeyStored: current.apiKeyStored,
        apiKeyIsEncrypted: current.apiKeyIsEncrypted
      }
      saveSettings(merged)
      const { resetSettingsCache } = await import('./settings')
      resetSettingsCache()
      loadSettings()
    }

    if (data.profile) {
      saveApplicantProfile(data.profile)
    }

    if (data.applicationHistory?.length) {
      const { importApplicationRecords } = await import('./application-history-store')
      importApplicationRecords(data.applicationHistory)
    }

    let followUpCount = 0
    if (data.followUpQueue?.length) {
      const dest = join(userDataDir(), 'followup-queue.json')
      const pendingOnly = data.followUpQueue.filter(i => i.status === 'pending')
      if (pendingOnly.length > 0) {
        let existing: PendingFollowUp[] = []
        if (existsSync(dest)) {
          try {
            existing = (JSON.parse(readFileSync(dest, 'utf8')) as { items?: PendingFollowUp[] }).items ?? []
          } catch (e) {
            appLog.warn('[backup] failed to parse existing follow-up queue, starting fresh', e instanceof Error ? e.message : String(e))
          }
        }
        const existingIds = new Set(existing.map(i => i.id))
        const newItems = pendingOnly.filter(i => !existingIds.has(i.id))
        const merged = [...existing, ...newItems]
        const tmp = `${dest}.tmp`
        writeFileSync(tmp, JSON.stringify({ items: merged, lastUpdated: new Date().toISOString() }, null, 2), 'utf8')
        renameSync(tmp, dest)
        followUpCount = newItems.length
      }
    }

    appLog.info('[backup] imported', {
      path: result.filePaths[0],
      records: data.applicationHistory?.length ?? 0,
      followUps: followUpCount
    })

    return {
      ok: true,
      detail: `Restored: ${data.applicationHistory?.length ?? 0} applications${followUpCount ? `, ${followUpCount} follow-ups` : ''}, profile, settings from ${data.exportedAt?.slice(0, 10) ?? 'unknown date'}.`
    }
  } catch (err) {
    appLog.error('[backup] import failed', err)
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}
