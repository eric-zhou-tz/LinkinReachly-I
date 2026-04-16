import { describe, expect, it } from 'vitest'
import type { ApplicantProfile } from '@core/application-types'
import {
  mergeLocalBackupOverProfile,
  profileUpdatedAtMs,
  shouldRestoreFromLocalBackup,
  type LocalApplicantDraftBackup
} from '@/features/apply/applicant-draft-local-backup'

function baseProfile(over: Partial<ApplicantProfile> = {}): ApplicantProfile {
  return {
    version: 1,
    basics: { fullName: 'A', email: 'a@b.c' },
    links: {},
    workAuth: { countryCode: 'US' },
    compensation: {},
    background: {},
    assets: [{ id: 'r1', kind: 'resume', label: 'R', fileName: 'x.pdf', storagePath: '/tmp/x', mimeType: 'application/pdf', updatedAt: '2020-01-01' }],
    answerBank: [],
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...over
  }
}

describe('applicant-draft-local-backup', () => {
  it('profileUpdatedAtMs parses ISO', () => {
    expect(profileUpdatedAtMs(baseProfile())).toBeGreaterThan(0)
    expect(profileUpdatedAtMs(baseProfile({ updatedAt: 'invalid' }))).toBe(0)
  })

  it('shouldRestore when local backup is newer and content differs', () => {
    const profile = baseProfile({ updatedAt: '2020-01-01T00:00:00.000Z' })
    const backup: LocalApplicantDraftBackup = {
      v: 1,
      localSavedAt: Date.parse('2026-04-01T00:00:00.000Z'),
      basics: { ...profile.basics, addressLine1: '123 Road' },
      links: profile.links,
      workAuth: profile.workAuth,
      compensation: profile.compensation,
      background: profile.background,
      answerBank: []
    }
    expect(shouldRestoreFromLocalBackup(profile, backup)).toBe(true)
  })

  it('should not restore when disk profile is newer', () => {
    const profile = baseProfile({ updatedAt: '2026-04-02T00:00:00.000Z' })
    const backup: LocalApplicantDraftBackup = {
      v: 1,
      localSavedAt: Date.parse('2026-04-01T00:00:00.000Z'),
      basics: { ...profile.basics, addressLine1: '123 Road' },
      links: profile.links,
      workAuth: profile.workAuth,
      compensation: profile.compensation,
      background: profile.background,
      answerBank: []
    }
    expect(shouldRestoreFromLocalBackup(profile, backup)).toBe(false)
  })

  it('mergeLocalBackupOverProfile keeps server assets', () => {
    const profile = baseProfile()
    const backup: LocalApplicantDraftBackup = {
      v: 1,
      localSavedAt: 1,
      basics: { ...profile.basics, postalCode: '10001' },
      links: profile.links,
      workAuth: profile.workAuth,
      compensation: profile.compensation,
      background: profile.background,
      answerBank: []
    }
    const merged = mergeLocalBackupOverProfile(profile, backup)
    expect(merged.assets).toEqual(profile.assets)
    expect(merged.basics.postalCode).toBe('10001')
  })
})
