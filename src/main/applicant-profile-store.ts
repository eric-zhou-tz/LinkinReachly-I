import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { appLog } from './app-log'
import { join } from 'node:path'
import type { AnswerBankItem, ApplicantAsset, ApplicantProfile } from '@core/application-types'
import { userDataDir } from './user-data-path'
import { retryStuckItemsIfAnswered } from './apply-queue-store'

/**
 * Applicant profile JSON on disk — single source of truth for autofill (Easy Apply, native CDP / ATS,
 * apply queue, extension bridge snapshot). Renderer mirrors edits here via IPC `applicant:save`; assets
 * (resume PDF, etc.) are separate files referenced by `storagePath`.
 */
const PROFILE_VERSION = 1

function configDir(): string {
  const dir = join(userDataDir(), 'config')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function profilePath(): string {
  return join(configDir(), 'applicant-profile.json')
}

function writeProfileAtomic(json: string): void {
  const finalPath = profilePath()
  const tmpPath = `${finalPath}.tmp`
  writeFileSync(tmpPath, json, 'utf8')
  try {
    renameSync(tmpPath, finalPath)
  } catch (e) {
    appLog.debug('[applicant-profile] atomic profile rename retry', e instanceof Error ? e.message : String(e))
    if (existsSync(finalPath)) unlinkSync(finalPath)
    renameSync(tmpPath, finalPath)
  }
}

function defaultProfile(): ApplicantProfile {
  return {
    version: PROFILE_VERSION,
    basics: {
      fullName: '',
      email: ''
    },
    links: {},
    workAuth: {
      countryCode: 'US'
    },
    compensation: {},
    background: {},
    coverLetterTemplate: undefined,
    assets: [],
    answerBank: [],
    updatedAt: new Date(0).toISOString()
  }
}

function normalizeAssets(raw: unknown): ApplicantAsset[] {
  if (!Array.isArray(raw)) return []
  const assets: ApplicantAsset[] = []
  for (const asset of raw) {
    if (typeof asset !== 'object' || asset == null) continue
    const candidate = asset as Partial<ApplicantAsset>
    const id = String(candidate.id || '').trim()
    const kind = String(candidate.kind || '').trim()
    const fileName = String(candidate.fileName || '').trim()
    const storagePath = String(candidate.storagePath || '').trim()
    if (!id || !kind || !fileName || !storagePath) continue
    assets.push({
      id,
      kind: (
        kind === 'resume' ||
        kind === 'cover_letter' ||
        kind === 'portfolio_pdf' ||
        kind === 'other'
      ) ? kind : 'other',
      label: String(candidate.label || fileName).trim() || fileName,
      fileName,
      storagePath,
      mimeType: String(candidate.mimeType || 'application/octet-stream').trim() || 'application/octet-stream',
      sizeBytes:
        typeof candidate.sizeBytes === 'number' && Number.isFinite(candidate.sizeBytes)
          ? candidate.sizeBytes
          : undefined,
      updatedAt: String(candidate.updatedAt || new Date(0).toISOString())
    })
  }
  return assets
}

function normalizeAnswerBank(raw: unknown): AnswerBankItem[] {
  if (!Array.isArray(raw)) return []
  const entries: AnswerBankItem[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry == null) continue
    const candidate = entry as Partial<AnswerBankItem>
    const id = String(candidate.id || '').trim()
    const prompt = String(candidate.prompt || '').trim()
    if (!id || !prompt) continue
    const answerType = String(candidate.answerType || '').trim()
    const scope = String(candidate.scope || '').trim()
    entries.push({
      id,
      normalizedKey: String(candidate.normalizedKey || '').trim(),
      prompt,
      answerType:
        answerType === 'boolean' || answerType === 'number' || answerType === 'select'
          ? answerType
          : 'text',
      answer:
        typeof candidate.answer === 'boolean' || typeof candidate.answer === 'number'
          ? candidate.answer
          : String(candidate.answer || '').trim(),
      scope: scope === 'adapter' || scope === 'company' ? scope : 'global',
      adapterId: String(candidate.adapterId || '').trim() || undefined,
      company: String(candidate.company || '').trim() || undefined,
      updatedAt: String(candidate.updatedAt || new Date(0).toISOString())
    })
  }
  return entries
}

function pickCurrentLocationLine(basics: unknown): string | undefined {
  if (typeof basics !== 'object' || basics == null) return undefined
  const b = basics as Record<string, unknown>
  const fromNew = String(b.currentLocationLine ?? '').trim()
  const fromLegacy = String(b.locationToApply ?? '').trim()
  const v = fromNew || fromLegacy
  return v || undefined
}

function normalizeEducationHistory(raw: unknown): Array<{ school: string; degree: string; field: string; year: number | null }> | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: Array<{ school: string; degree: string; field: string; year: number | null }> = []
  for (const item of raw) {
    if (typeof item !== 'object' || item == null) continue
    const r = item as Record<string, unknown>
    const school = String(r.school || '').trim()
    if (!school) continue
    out.push({
      school,
      degree: String(r.degree || '').trim(),
      field: String(r.field || '').trim(),
      year: typeof r.year === 'number' && Number.isFinite(r.year) ? r.year : null,
    })
  }
  return out.length ? out : undefined
}

function normalizeWorkHistory(raw: unknown): ApplicantProfile['background']['workHistory'] {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: NonNullable<ApplicantProfile['background']['workHistory']> = []
  for (const item of raw) {
    if (typeof item !== 'object' || item == null) continue
    const r = item as Record<string, unknown>
    const title = String(r.title || '').trim()
    const company = String(r.company || '').trim()
    if (!title && !company) continue
    const entry: NonNullable<ApplicantProfile['background']['workHistory']>[number] = {
      title,
      company,
      startYear: typeof r.startYear === 'number' && Number.isFinite(r.startYear) ? r.startYear : null,
      endYear: typeof r.endYear === 'number' && Number.isFinite(r.endYear) ? r.endYear : null,
    }
    if (typeof r.location === 'string' && r.location.trim()) entry.location = r.location.trim()
    if (typeof r.description === 'string' && r.description.trim()) entry.description = r.description.trim()
    if (typeof r.startMonth === 'number' && Number.isFinite(r.startMonth)) entry.startMonth = r.startMonth
    if (typeof r.endMonth === 'number' && Number.isFinite(r.endMonth)) entry.endMonth = r.endMonth
    if (typeof r.currentlyWorkHere === 'boolean') entry.currentlyWorkHere = r.currentlyWorkHere
    out.push(entry)
  }
  return out.length ? out : undefined
}

function normalizeProfile(raw: unknown): ApplicantProfile {
  const fallback = defaultProfile()
  if (typeof raw !== 'object' || raw == null) return fallback
  const profile = raw as Partial<ApplicantProfile>

  return {
    version: PROFILE_VERSION,
    basics: {
      fullName: String(profile.basics?.fullName || '').trim(),
      email: String(profile.basics?.email || '').trim(),
      phone: String(profile.basics?.phone || '').trim() || undefined,
      addressLine1: String(profile.basics?.addressLine1 || '').trim() || undefined,
      addressLine2: String(profile.basics?.addressLine2 || '').trim() || undefined,
      city: String(profile.basics?.city || '').trim() || undefined,
      state: String(profile.basics?.state || '').trim() || undefined,
      postalCode: String(profile.basics?.postalCode || '').trim() || undefined,
      country: String(profile.basics?.country || '').trim() || undefined,
      currentLocationLine: pickCurrentLocationLine(profile.basics),
      currentResidenceAnswer:
        String(profile.basics?.currentResidenceAnswer || '')
          .trim()
          .slice(0, 4000) || undefined
    },
    links: {
      linkedInUrl: String(profile.links?.linkedInUrl || '').trim() || undefined,
      portfolioUrl: String(profile.links?.portfolioUrl || '').trim() || undefined,
      githubUrl: String(profile.links?.githubUrl || '').trim() || undefined,
      websiteUrl: String(profile.links?.websiteUrl || '').trim() || undefined
    },
    workAuth: {
      countryCode: String(profile.workAuth?.countryCode || fallback.workAuth.countryCode).trim() || fallback.workAuth.countryCode,
      authorizedToWork:
        typeof profile.workAuth?.authorizedToWork === 'boolean' ? profile.workAuth.authorizedToWork : undefined,
      requiresSponsorship:
        typeof profile.workAuth?.requiresSponsorship === 'boolean' ? profile.workAuth.requiresSponsorship : undefined,
      clearanceEligible:
        typeof profile.workAuth?.clearanceEligible === 'boolean' ? profile.workAuth.clearanceEligible : undefined
      ,
      willingToRelocate:
        typeof profile.workAuth?.willingToRelocate === 'boolean' ? profile.workAuth.willingToRelocate : undefined,
      willingToTravel:
        typeof profile.workAuth?.willingToTravel === 'boolean' ? profile.workAuth.willingToTravel : undefined,
      over18:
        typeof profile.workAuth?.over18 === 'boolean' ? profile.workAuth.over18 : undefined,
      hasDriversLicense:
        typeof profile.workAuth?.hasDriversLicense === 'boolean' ? profile.workAuth.hasDriversLicense : undefined,
      canPassBackgroundCheck:
        typeof profile.workAuth?.canPassBackgroundCheck === 'boolean' ? profile.workAuth.canPassBackgroundCheck : undefined,
      canPassDrugTest:
        typeof profile.workAuth?.canPassDrugTest === 'boolean' ? profile.workAuth.canPassDrugTest : undefined
    },
    compensation: {
      salaryMin:
        typeof profile.compensation?.salaryMin === 'number' && Number.isFinite(profile.compensation.salaryMin)
          ? profile.compensation.salaryMin
          : undefined,
      salaryMax:
        typeof profile.compensation?.salaryMax === 'number' && Number.isFinite(profile.compensation.salaryMax)
          ? profile.compensation.salaryMax
          : undefined,
      salaryCurrency: String(profile.compensation?.salaryCurrency || '').trim() || undefined,
      noticePeriod: String(profile.compensation?.noticePeriod || '').trim() || undefined,
      startDatePreference: String(profile.compensation?.startDatePreference || '').trim() || undefined,
      workLocationPreference: String(profile.compensation?.workLocationPreference || '').trim() || undefined
    },
    background: {
      yearsOfExperience: String(profile.background?.yearsOfExperience || '').trim() || undefined,
      educationSummary: String(profile.background?.educationSummary || '').trim() || undefined,
      languages: String(profile.background?.languages || '').trim() || undefined,
      certifications: String(profile.background?.certifications || '').trim() || undefined,
      educationStartMonth:
        typeof profile.background?.educationStartMonth === 'number' && Number.isFinite(profile.background.educationStartMonth)
          ? profile.background.educationStartMonth
          : undefined,
      educationStartYear:
        typeof profile.background?.educationStartYear === 'number' && Number.isFinite(profile.background.educationStartYear)
          ? profile.background.educationStartYear
          : undefined,
      educationEndMonth:
        typeof profile.background?.educationEndMonth === 'number' && Number.isFinite(profile.background.educationEndMonth)
          ? profile.background.educationEndMonth
          : undefined,
      educationEndYear:
        typeof profile.background?.educationEndYear === 'number' && Number.isFinite(profile.background.educationEndYear)
          ? profile.background.educationEndYear
          : undefined,
      currentlyAttending:
        typeof profile.background?.currentlyAttending === 'boolean' ? profile.background.currentlyAttending : undefined,
      schoolName: String(profile.background?.schoolName || '').trim() || undefined,
      degreeType: String(profile.background?.degreeType || '').trim() || undefined,
      fieldOfStudy: String(profile.background?.fieldOfStudy || '').trim() || undefined,
      educationHistory: normalizeEducationHistory(profile.background?.educationHistory),
      workHistory: normalizeWorkHistory(profile.background?.workHistory),
    },
    coverLetterTemplate:
      profile.coverLetterTemplate !== undefined && profile.coverLetterTemplate !== null
        ? String(profile.coverLetterTemplate).slice(0, 48_000)
        : undefined,
    assets: normalizeAssets(profile.assets),
    answerBank: normalizeAnswerBank(profile.answerBank),
    screeningAnswerCache:
      normalizeScreeningAnswerCache(profile.screeningAnswerCache) ?? fallback.screeningAnswerCache,
    updatedAt: String(profile.updatedAt || fallback.updatedAt)
  }
}

function normalizeScreeningAnswerCache(raw: unknown): Record<string, string> | undefined {
  if (typeof raw !== 'object' || raw == null) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k || '').trim()
    if (!key || key.length > 500) continue
    const val = String(v ?? '').trim()
    if (!val) continue
    out[key] = val.slice(0, 8000)
  }
  return Object.keys(out).length ? out : undefined
}

export function loadApplicantProfile(): ApplicantProfile {
  const path = profilePath()
  const tmpPath = `${path}.tmp`
  if (existsSync(tmpPath) && existsSync(path)) {
    try {
      unlinkSync(tmpPath)
    } catch (e) {
      appLog.warn('[applicant-profile] tmp file cleanup failed', e instanceof Error ? e.message : String(e))
    }
  }
  if (!existsSync(path)) return defaultProfile()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return normalizeProfile(raw)
  } catch (e) {
    appLog.debug('[applicant-profile] load parse failed, using default', e instanceof Error ? e.message : String(e))
    return defaultProfile()
  }
}

export function saveApplicantProfile(
  partial: Partial<ApplicantProfile> & {
    basics?: Partial<ApplicantProfile['basics']>
    links?: Partial<ApplicantProfile['links']>
    workAuth?: Partial<ApplicantProfile['workAuth']>
    compensation?: Partial<ApplicantProfile['compensation']>
    background?: Partial<ApplicantProfile['background']>
    coverLetterTemplate?: string
  }
): ApplicantProfile {
  const current = loadApplicantProfile()
  const mergedScreeningCache =
    partial.screeningAnswerCache !== undefined
      ? {
          ...(current.screeningAnswerCache || {}),
          ...(typeof partial.screeningAnswerCache === 'object' && partial.screeningAnswerCache
            ? (partial.screeningAnswerCache as Record<string, string>)
            : {})
        }
      : current.screeningAnswerCache
  const next = normalizeProfile({
    ...current,
    ...partial,
    basics: { ...current.basics, ...partial.basics },
    links: { ...current.links, ...partial.links },
    workAuth: { ...current.workAuth, ...partial.workAuth },
    compensation: { ...current.compensation, ...partial.compensation },
    background: { ...current.background, ...partial.background },
    coverLetterTemplate:
      partial.coverLetterTemplate !== undefined
        ? String(partial.coverLetterTemplate).slice(0, 48_000) || undefined
        : current.coverLetterTemplate,
    assets: Array.isArray(partial.assets) ? partial.assets : current.assets,
    answerBank: Array.isArray(partial.answerBank) ? partial.answerBank : current.answerBank,
    screeningAnswerCache: mergedScreeningCache,
    updatedAt: new Date().toISOString()
  })
  writeProfileAtomic(JSON.stringify(next, null, 2))
  if (Array.isArray(partial.answerBank)) {
    triggerAnswerBankRetry(next)
  }
  return next
}

/**
 * Promote screening answer cache entries into the permanent answer bank.
 * Skips entries whose normalizedKey already exists in the bank.
 * Returns the count of newly promoted entries.
 */
export function promoteScreeningToAnswerBank(): { promoted: number; profile: ApplicantProfile } {
  const profile = loadApplicantProfile()
  const cache = profile.screeningAnswerCache
  if (!cache || Object.keys(cache).length === 0) return { promoted: 0, profile }

  const existingKeys = new Set(profile.answerBank.map((item) => item.normalizedKey))
  const newEntries: AnswerBankItem[] = []
  const now = new Date().toISOString()

  for (const [key, value] of Object.entries(cache)) {
    if (existingKeys.has(key)) continue
    if (!value || typeof value !== 'string') continue
    newEntries.push({
      id: randomUUID(),
      normalizedKey: key,
      prompt: key,
      answerType: 'text',
      answer: value,
      scope: 'global',
      updatedAt: now
    })
  }

  if (newEntries.length === 0) return { promoted: 0, profile }

  const updated = saveApplicantProfile({
    answerBank: [...profile.answerBank, ...newEntries]
  })
  appLog.info('[applicant-profile] promoted screening answers to answer bank', { promoted: newEntries.length })
  triggerAnswerBankRetry(updated)
  return { promoted: newEntries.length, profile: updated }
}

function normalizeForRetry(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function triggerAnswerBankRetry(profile: ApplicantProfile): void {
  try {
    const keys = new Set(profile.answerBank.map((item) => normalizeForRetry(item.normalizedKey)))
    const { retriedCount } = retryStuckItemsIfAnswered(keys)
    if (retriedCount > 0) {
      appLog.info('[applicant-profile] auto-retried stuck queue items after answer bank update', { retriedCount })
    }
  } catch { /* queue store may not be initialized yet */ }
}

export function retryAllStuckFromCurrentAnswerBank(): { retriedCount: number } {
  const profile = loadApplicantProfile()
  const keys = new Set(profile.answerBank.map((item) => normalizeForRetry(item.normalizedKey)))
  return retryStuckItemsIfAnswered(keys)
}
