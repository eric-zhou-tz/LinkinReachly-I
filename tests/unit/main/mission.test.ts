import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../../../src/main/settings'

const { mockGetApiKey } = vi.hoisted(() => ({
  mockGetApiKey: vi.fn<() => string | null>(() => null)
}))

vi.mock('../../../src/main/settings', () => ({
  getApiKey: mockGetApiKey
}))

import { linkedInPeopleSearchUrl, planMission } from '../../../src/main/llm'

const baseSettings: AppSettings = {
  seenOnboarding: true,
  bridgePort: 19511,
  llmProvider: 'grok',
  llmBaseUrl: 'http://127.0.0.1:8000',
  llmModel: 'grok-4.1-fast',
  llmEnabled: true,
  llmMode: 'bundled' as const,
  apiKeyStored: null,
  apiKeyIsEncrypted: false,
  lastExecutionId: 'generic_connection',
  templates: ['Hi {firstName}'],
  mustInclude: [],
  dailyCap: 20,
  weeklyConnectionCap: 60,
  sessionBreaksEnabled: true,
  sessionBreakEveryMin: 5,
  sessionBreakEveryMax: 8,
  sessionBreakDurationMin: 2,
  sessionBreakDurationMax: 5,
  delayBetweenRequestsMin: 45,
  delayBetweenRequestsMax: 90,
  delayBetweenActionsMin: 1,
  delayBetweenActionsMax: 3,
  resumeText: '',
  resumeFileName: '',
  jobsSearchKeywords: '',
  jobsSearchLocation: '',
  jobsSearchHistory: [],
  userBackground: '',
  outreachTone: 'peer' as const,
  easyApplyTailorCoverLetter: false,
  easyApplyEnrichCompanyContext: false,
  jobsSearchRecencySeconds: 86400,
  jobsSearchSortBy: 'DD' as const,
  jobsSearchDistanceMiles: 0,
  jobsSearchExperienceLevels: [],
  jobsSearchJobTypes: [],
  jobsSearchRemoteTypes: [],
  jobsSearchSalaryFloor: 0,
  jobsSearchFewApplicants: false,
  jobsSearchVerifiedOnly: false,
  jobsSearchEasyApplyOnly: true,
  jobsScreeningCriteria: '',
  customOutreachPrompt: ''
}

describe('planMission', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockGetApiKey.mockReturnValue(null)
  })

  it('falls back heuristically when no API key is available', async () => {
    const result = await planMission(
      baseSettings,
      'Connect with hiring managers and recruiters at hedge funds that may be looking for junior talent.'
    )

    expect(result.route).toBe('heuristic')
    expect(result.detail).toBe('no_api_key')
    expect(result.executionId).toBe('job_signal_connection')
    expect(result.csvSeed.startsWith('profileUrl,firstName,company,headline')).toBe(true)
    expect(result.searchUrl).toBe(linkedInPeopleSearchUrl(result.searchQuery))
    expect(result.templates.length).toBeGreaterThan(0)
  })

  it('uses the LLM path when a key exists', async () => {
    mockGetApiKey.mockReturnValue('test-key')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"title":"Hedge fund hiring plan","summary":"Target recruiters and hiring managers.","executionId":"job_signal_connection","searchQuery":"hedge fund recruiter OR hiring manager","csvSeed":"profileUrl,firstName,company,headline\\n","templates":["Hi {firstName} - would love to connect regarding hiring needs at {company}."],"mustInclude":[],"nextStep":"Run that search, paste the profiles into Run, then start."}'
            }
          }
        ]
      })
    } as Response)

    const result = await planMission(
      baseSettings,
      'Connect with hedge fund hiring managers and recruiters.',
      'test-key'
    )

    expect(result.route).toBe('llm')
    expect(result.executionId).toBe('job_signal_connection')
    expect(result.title).toBe('Hedge fund hiring plan')
    expect(result.searchQuery).toContain('hedge fund')
    expect(result.searchUrl).toBe(linkedInPeopleSearchUrl(result.searchQuery))
  })
})
