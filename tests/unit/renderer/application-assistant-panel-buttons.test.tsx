/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockUploadResume = vi.fn()
const mockRemoveResume = vi.fn()
const mockUploadCoverLetter = vi.fn()
const mockRemoveCoverLetter = vi.fn()
const mockSaveProfile = vi.fn()
const mockRefresh = vi.fn()
const mockImportFromLinkedIn = vi.fn()

let mockAssistantState: Record<string, unknown> = {}

vi.mock('@/features/apply/useApplicationAssistant', () => ({
  useApplicationAssistant: () => mockAssistantState,
}))

vi.mock('@/features/apply/applicant-draft-local-backup', () => ({
  readLocalApplicantDraftBackup: () => null,
  shouldRestoreFromLocalBackup: () => false,
  mergeLocalBackupOverProfile: (p: unknown) => p,
  writeLocalApplicantDraftBackup: () => {},
}))

vi.mock('@/loa-client', () => ({
  getLoa: () => ({}),
}))

import { ApplicationAssistantPanel } from '../../../src/renderer/src/features/apply/ApplicationAssistantPanel'
import type { ApplicantProfile, ApplicantAsset } from '../../../src/core/application-types'

function makeProfile(overrides?: Partial<ApplicantProfile>): ApplicantProfile {
  return {
    version: 1,
    basics: { fullName: 'Test User', email: 'test@example.com' },
    links: {},
    workAuth: { countryCode: 'US' },
    compensation: {},
    background: {},
    assets: [],
    answerBank: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeResumeAsset(overrides?: Partial<ApplicantAsset>): ApplicantAsset {
  return {
    id: 'resume-1',
    kind: 'resume',
    label: 'Resume',
    fileName: 'my-resume.pdf',
    storagePath: '/tmp/resume.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeCoverAsset(overrides?: Partial<ApplicantAsset>): ApplicantAsset {
  return {
    id: 'cover-1',
    kind: 'cover_letter',
    label: 'Cover letter',
    fileName: 'cover.pdf',
    storagePath: '/tmp/cover.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 512,
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function setAssistantState(profile: ApplicantProfile, overrides?: Record<string, unknown>) {
  mockAssistantState = {
    profile,
    loading: false,
    detecting: false,
    saving: false,
    uploading: false,
    importing: false,
    saveFeedback: null,
    error: null,
    status: null,
    detectResult: null,
    history: [],
    insights: null,
    refresh: mockRefresh,
    saveProfile: mockSaveProfile.mockResolvedValue({ ok: true, profile }),
    uploadResume: mockUploadResume,
    removeResume: mockRemoveResume,
    uploadCoverLetter: mockUploadCoverLetter,
    removeCoverLetter: mockRemoveCoverLetter,
    importFromLinkedIn: mockImportFromLinkedIn,
    applyCoverPrefs: { easyApplyTailorCoverLetter: false, easyApplyEnrichCompanyContext: false },
    saveApplyCoverPref: vi.fn(),
    detectCurrentPage: vi.fn(),
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ApplicationAssistantPanel — Resume buttons', () => {
  it('shows Upload button when no resume is attached', () => {
    setAssistantState(makeProfile())
    render(<ApplicationAssistantPanel />)

    const uploadBtn = screen.getByText('Upload')
    expect(uploadBtn).toBeTruthy()
    expect(uploadBtn.tagName).toBe('BUTTON')
    expect(screen.queryByText('Remove')).toBeNull()
  })

  it('Upload button calls assistant.uploadResume', () => {
    setAssistantState(makeProfile())
    render(<ApplicationAssistantPanel />)

    fireEvent.click(screen.getByText('Upload'))
    expect(mockUploadResume).toHaveBeenCalledTimes(1)
  })

  it('shows Replace file and Remove buttons when resume is attached', () => {
    const profile = makeProfile({ assets: [makeResumeAsset()] })
    setAssistantState(profile)
    render(<ApplicationAssistantPanel />)

    expect(screen.getByText('Replace file')).toBeTruthy()
    const removeButtons = screen.getAllByText('Remove')
    expect(removeButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('Remove button calls assistant.removeResume', () => {
    const profile = makeProfile({ assets: [makeResumeAsset()] })
    setAssistantState(profile)
    render(<ApplicationAssistantPanel />)

    const removeButtons = screen.getAllByText('Remove')
    fireEvent.click(removeButtons[0])
    expect(mockRemoveResume).toHaveBeenCalledTimes(1)
  })

  it('shows resume file name when attached', () => {
    const profile = makeProfile({ assets: [makeResumeAsset({ fileName: 'Victor-Resume.pdf' })] })
    setAssistantState(profile)
    render(<ApplicationAssistantPanel />)

    expect(screen.getByText('Victor-Resume.pdf')).toBeTruthy()
  })

  it('shows "None attached." when no resume', () => {
    setAssistantState(makeProfile())
    render(<ApplicationAssistantPanel />)

    expect(screen.getByText('None attached.')).toBeTruthy()
  })

  it('Upload button shows "Uploading…" when uploading', () => {
    setAssistantState(makeProfile(), { uploading: true })
    render(<ApplicationAssistantPanel />)

    const btn = document.getElementById('apply-resume-upload') as HTMLButtonElement
    expect(btn).toBeTruthy()
    expect(btn.textContent).toBe('Uploading…')
    expect(btn.disabled).toBe(true)
  })

  it('Remove button is disabled when saving', () => {
    const profile = makeProfile({ assets: [makeResumeAsset()] })
    setAssistantState(profile, { saving: true })
    render(<ApplicationAssistantPanel />)

    const removeButtons = screen.getAllByText('Remove')
    expect((removeButtons[0] as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ApplicationAssistantPanel — Cover letter buttons', () => {
  it('shows Upload cover file button when no cover attached', () => {
    setAssistantState(makeProfile())
    render(<ApplicationAssistantPanel />)

    expect(screen.getByText('Upload cover file')).toBeTruthy()
  })

  it('Upload cover file button calls assistant.uploadCoverLetter', () => {
    setAssistantState(makeProfile())
    render(<ApplicationAssistantPanel />)

    fireEvent.click(screen.getByText('Upload cover file'))
    expect(mockUploadCoverLetter).toHaveBeenCalledTimes(1)
  })

  it('shows Remove for cover letter when attached', () => {
    const profile = makeProfile({ assets: [makeCoverAsset()] })
    setAssistantState(profile)
    render(<ApplicationAssistantPanel />)

    const removeButtons = screen.getAllByText('Remove')
    expect(removeButtons.length).toBeGreaterThanOrEqual(1)
  })
})

describe('ApplicationAssistantPanel — readiness checklist', () => {
  it('shows "Need Resume file" when resume is missing', () => {
    setAssistantState(makeProfile())
    render(<ApplicationAssistantPanel />)

    expect(screen.getByText('Need Resume file')).toBeTruthy()
  })

  it('shows "All fields done" when all required fields filled including resume', () => {
    const profile = makeProfile({
      basics: {
        fullName: 'Test User',
        email: 'test@example.com',
        phone: '555-0000',
        addressLine1: '123 Main',
        city: 'NYC',
        state: 'NY',
        postalCode: '10001',
        country: 'US',
      },
      links: { linkedInUrl: 'https://linkedin.com/in/test' },
      workAuth: { countryCode: 'US', authorizedToWork: true, requiresSponsorship: false },
      compensation: { startDatePreference: 'Immediately', salaryMin: 100000 },
      background: { yearsOfExperience: '5', educationSummary: 'BS CS' },
      assets: [makeResumeAsset()],
    })
    setAssistantState(profile)
    render(<ApplicationAssistantPanel />)

    expect(screen.getByText('All fields done')).toBeTruthy()
  })
})
