import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UserProfile } from '@core/profile-db'
import { loadApplicantProfile, saveApplicantProfile } from '../../../src/main/applicant-profile-store'
import { syncApplicantFromUserProfile } from '../../../src/main/user-applicant-sync'

let prevDataDir: string | undefined

beforeEach(() => {
  prevDataDir = process.env['LOA_USER_DATA_DIR']
  process.env['LOA_USER_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'loa-sync-'))
})

afterEach(() => {
  const d = process.env['LOA_USER_DATA_DIR']
  if (d && existsSync(d)) rmSync(d, { recursive: true, force: true })
  if (prevDataDir === undefined) delete process.env['LOA_USER_DATA_DIR']
  else process.env['LOA_USER_DATA_DIR'] = prevDataDir
})

describe('syncApplicantFromUserProfile', () => {
  it('fills empty applicant basics from structured user profile', () => {
    const user: UserProfile = {
      name: 'Alex Dev',
      location: 'Portland, OR, US',
      email: 'alex@example.com',
      linkedinUrl: 'https://linkedin.com/in/alex',
      summary: '',
      entries: [],
      education: [],
      languages: [],
      countriesWorked: [],
      totalYearsExperience: 5,
      lastUpdated: new Date().toISOString()
    }
    const resumeText = 'Reach me at (503) 555-0199 for references.'
    syncApplicantFromUserProfile(user, resumeText)
    const app = loadApplicantProfile()
    expect(app.basics.fullName).toBe('Alex Dev')
    expect(app.basics.email).toBe('alex@example.com')
    expect(app.basics.phone).toBe('(503) 555-0199')
    expect(app.basics.city).toBe('Portland')
    expect(app.basics.state).toBe('OR')
    expect(app.links.linkedInUrl).toContain('alex')
    expect(app.background.yearsOfExperience).toBe('5')
  })

  it('preserves currentLocationLine and currentResidenceAnswer when filling from user profile', () => {
    saveApplicantProfile({
      basics: {
        fullName: 'Pat',
        email: 'pat@example.com',
        city: 'Austin',
        state: 'TX',
        country: 'US',
        currentLocationLine: 'Austin, TX, USA',
        currentResidenceAnswer: 'I reside in Austin, Texas.'
      }
    })
    const user: UserProfile = {
      name: 'Pat Sync',
      location: 'Denver, CO, US',
      email: 'pat2@example.com',
      linkedinUrl: '',
      summary: '',
      entries: [],
      education: [],
      languages: [],
      countriesWorked: [],
      totalYearsExperience: 0,
      lastUpdated: new Date().toISOString()
    }
    syncApplicantFromUserProfile(user, '')
    const app = loadApplicantProfile()
    expect(app.basics.fullName).toBe('Pat')
    expect(app.basics.email).toBe('pat@example.com')
    expect(app.basics.currentLocationLine).toBe('Austin, TX, USA')
    expect(app.basics.currentResidenceAnswer).toBe('I reside in Austin, Texas.')
  })

  it('detects change when education or languages differ', () => {
    saveApplicantProfile({
      basics: { fullName: 'Edu Test', email: 'edu@test.com' }
    })
    const user: UserProfile = {
      name: 'Edu Test',
      location: '',
      email: 'edu@test.com',
      linkedinUrl: '',
      summary: '',
      entries: [],
      education: [{ id: 'e1', institution: 'MIT', degree: 'BS', field: 'CS', location: '', graduationYear: 2022, highlights: [] }],
      languages: ['English', 'Spanish'],
      countriesWorked: [],
      totalYearsExperience: 0,
      lastUpdated: new Date().toISOString()
    }
    syncApplicantFromUserProfile(user, '')
    const app = loadApplicantProfile()
    expect(app.background.schoolName).toBe('MIT')
    expect(app.background.degreeType).toBe('BS')
    expect(app.background.fieldOfStudy).toBe('CS')
    expect(app.background.languages).toBe('English, Spanish')
    expect(app.background.educationEndYear).toBe(2022)
    expect(app.background.educationStartYear).toBe(2018)
  })

  it('replaces stale mixed education fields even when school name is unchanged', () => {
    saveApplicantProfile({
      basics: { fullName: 'Edu Test', email: 'edu@test.com' },
      background: {
        schoolName: 'Columbia Business School',
        degreeType: 'MBA',
        fieldOfStudy: 'Molecular Biology & Biotech',
        educationStartMonth: 9,
        educationStartYear: 2012,
        educationEndMonth: 6,
        educationEndYear: 2016,
        educationHistory: [
          { school: 'Columbia Business School', degree: 'MBA', field: '', year: 2024 },
          { school: 'Old University', degree: 'BS', field: 'Biotech', year: 2016 }
        ]
      }
    })
    const user: UserProfile = {
      name: 'Edu Test',
      location: '',
      email: 'edu@test.com',
      linkedinUrl: '',
      summary: '',
      entries: [],
      education: [{ id: 'e1', institution: 'Columbia Business School', degree: 'MBA', field: '', location: '', graduationYear: 2024, highlights: [] }],
      languages: [],
      countriesWorked: [],
      totalYearsExperience: 0,
      lastUpdated: new Date().toISOString()
    }
    syncApplicantFromUserProfile(user, '')
    const app = loadApplicantProfile()
    expect(app.background.schoolName).toBe('Columbia Business School')
    expect(app.background.degreeType).toBe('MBA')
    expect(app.background.fieldOfStudy).toBeUndefined()
    expect(app.background.educationStartYear).toBe(2022)
    expect(app.background.educationEndYear).toBe(2024)
  })

  it('persists educationHistory refresh even when top-level education fields are unchanged', () => {
    saveApplicantProfile({
      basics: { fullName: 'Edu Test', email: 'edu@test.com' },
      background: {
        schoolName: 'MIT',
        degreeType: 'BS',
        fieldOfStudy: 'CS',
        educationStartMonth: 9,
        educationStartYear: 2018,
        educationEndMonth: 6,
        educationEndYear: 2022,
        educationHistory: [{ school: 'MIT', degree: 'BS', field: 'CS', year: 2022 }]
      }
    })
    const user: UserProfile = {
      name: 'Edu Test',
      location: '',
      email: 'edu@test.com',
      linkedinUrl: '',
      summary: '',
      entries: [],
      education: [
        { id: 'e1', institution: 'MIT', degree: 'BS', field: 'CS', location: '', graduationYear: 2022, highlights: [] },
        { id: 'e2', institution: 'Stanford University', degree: 'Bootcamp', field: 'AI', location: '', graduationYear: 2020, highlights: [] }
      ],
      languages: [],
      countriesWorked: [],
      totalYearsExperience: 0,
      lastUpdated: new Date().toISOString()
    }
    syncApplicantFromUserProfile(user, '')
    const app = loadApplicantProfile()
    expect(app.background.educationHistory?.length).toBe(2)
    expect(app.background.educationHistory?.[0]?.school).toBe('MIT')
    expect(app.background.educationHistory?.[1]?.school).toBe('Stanford University')
  })

  it('clears stale educationHistory when resume parse has no education entries', () => {
    saveApplicantProfile({
      basics: { fullName: 'Edu Test', email: 'edu@test.com' },
      background: {
        educationHistory: [{ school: 'Old School', degree: 'BS', field: 'CS', year: 2019 }]
      }
    })
    const user: UserProfile = {
      name: 'Edu Test',
      location: '',
      email: 'edu@test.com',
      linkedinUrl: '',
      summary: '',
      entries: [],
      education: [],
      languages: [],
      countriesWorked: [],
      totalYearsExperience: 0,
      lastUpdated: new Date().toISOString()
    }
    syncApplicantFromUserProfile(user, '')
    const app = loadApplicantProfile()
    expect(app.background.educationHistory).toBeUndefined()
  })

  it('does not overwrite existing applicant fields', () => {
    saveApplicantProfile({
      basics: { fullName: 'Keep Name', email: 'keep@example.com' }
    })
    const user: UserProfile = {
      name: 'Other Name',
      location: '',
      email: 'other@example.com',
      linkedinUrl: '',
      summary: '',
      entries: [],
      education: [],
      languages: [],
      countriesWorked: [],
      totalYearsExperience: 0,
      lastUpdated: new Date().toISOString()
    }
    syncApplicantFromUserProfile(user, '')
    const app = loadApplicantProfile()
    expect(app.basics.fullName).toBe('Keep Name')
    expect(app.basics.email).toBe('keep@example.com')
  })
})
