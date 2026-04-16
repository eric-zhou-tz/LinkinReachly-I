/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HistoryPanel } from '../../../src/renderer/src/components/HistoryPanel'
import type { AppModel } from '../../../src/renderer/src/hooks/useAppModel'

const emptyApplicationHistory = {
  ok: true as const,
  records: [],
  insights: {
    total: 0,
    submittedCount: 0,
    activeCount: 0,
    needsReviewCount: 0,
    blockedCount: 0,
    outreachSentCount: 0,
    outreachPendingCount: 0,
    byCompanyType: [] as { key: string; label: string; count: number }[],
    byStage: [] as { key: string; label: string; count: number }[],
    byIndustry: [] as { key: string; label: string; count: number }[],
    byWorkModel: [] as { key: string; label: string; count: number }[]
  },
  detail: ''
}

function createModel(logs: unknown[]): AppModel {
  return {
    logs,
    logsBusy: false,
    historyFeedback: null,
    refreshLogs: vi.fn().mockResolvedValue(undefined),
    clearLogs: vi.fn().mockResolvedValue(undefined),
    exportLogs: vi.fn().mockResolvedValue(undefined)
  } as unknown as AppModel
}

describe('HistoryPanel', () => {
  beforeEach(() => {
    window.loa = {
      applicationHistory: vi.fn().mockResolvedValue(emptyApplicationHistory),
      applicationHistoryDelete: vi.fn().mockResolvedValue({ ok: true, records: [], insights: emptyApplicationHistory.insights, detail: '' })
    } as unknown as Window['loa']
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    delete window.loa
  })

  it('renders campaign log entries', async () => {
    const model = createModel([
      {
        timestamp: '2026-03-28T11:58:00.000Z',
        status: 'info',
        eventType: 'outreach_stage',
        summary: 'Opened the LinkedIn connect dialog',
        stageCode: 'open_connect',
        stageLabel: 'Opened the LinkedIn connect dialog',
        stageStatus: 'completed',
        profileUrl: 'https://www.linkedin.com/in/ava-lee/',
        name: 'Ava Lee',
        company: 'Northbridge Labs',
        detail: 'connect_dialog_open'
      },
      {
        timestamp: '2026-03-28T12:00:00.000Z',
        status: 'info',
        eventType: 'prospects_search',
        summary: 'Saved 2 people from LinkedIn search.',
        searchQuery: 'fintech founders new york',
        searchUrl: 'https://www.linkedin.com/search/results/people/',
        resultCount: 2,
        people: [
          {
            profileUrl: 'https://www.linkedin.com/in/ava-lee/',
            name: 'Ava Lee',
            company: 'Northbridge Labs',
            headline: 'Founder'
          },
          {
            profileUrl: 'https://www.linkedin.com/in/miles-chen/',
            name: 'Miles Chen',
            company: 'Harbor Peak',
            headline: 'Investor'
          }
        ]
      },
      {
        timestamp: '2026-03-28T12:05:00.000Z',
        status: 'info',
        eventType: 'jobs_search',
        summary: 'Saved 2 jobs from smart search and AI screening.',
        searchQuery: 'ai product roles',
        criteria: 'Remote product role in AI',
        resultCount: 2,
        jobs: [
          {
            title: 'Senior Product Manager',
            company: 'Anthropic',
            location: 'Remote',
            jobUrl: 'https://www.linkedin.com/jobs/view/1/',
            score: 9,
            reason: 'Strong match.'
          },
          {
            title: 'AI Platform PM',
            company: 'OpenAI',
            location: 'San Francisco, CA',
            jobUrl: 'https://www.linkedin.com/jobs/view/2/',
            score: 7,
            reason: 'Good but less aligned on location.'
          }
        ]
      }
    ])

    render(<HistoryPanel model={model} initialTab="campaign" />)

    await waitFor(() => {
      expect(window.loa?.applicationHistory).toHaveBeenCalled()
    })

    // Campaign log (default tab) entries should be visible
    expect(screen.getByText('Opened the LinkedIn connect dialog')).toBeTruthy()
    expect(screen.getByText('2 people')).toBeTruthy()
    expect(screen.getByText('2 jobs')).toBeTruthy()

    fireEvent.click(screen.getByText('Show 2 people saved here'))
    expect(screen.getByText('Ava Lee')).toBeTruthy()
    expect(screen.getByText('Miles Chen')).toBeTruthy()

    fireEvent.click(screen.getByText('Show 2 jobs saved here'))
    expect(screen.getByText('Senior Product Manager')).toBeTruthy()
    expect(screen.getByText('Score 9')).toBeTruthy()
  })

  it('treats auto-filled applications as submitted in the applications tab', async () => {
    const model = createModel([])
    const nowIso = '2026-04-14T15:00:00.000Z'

    window.loa = {
      applicationHistory: vi.fn().mockResolvedValue({
        ...emptyApplicationHistory,
        records: [
          {
            id: 'rec-1',
            createdAt: nowIso,
            company: 'Chronicle Creations Inc',
            title: 'Content Creator & Social Media Manager',
            location: 'United States (Remote)',
            jobUrl: 'https://www.linkedin.com/jobs/view/1234567890/',
            source: 'linkedin_easy_apply',
            outcome: 'autofilled',
            detail: 'Filled 3/3 fields (2 pre-filled by LinkedIn).',
            companySignals: {
              companyType: 'unknown',
              stage: 'unknown',
              industry: 'unknown',
              workModel: 'remote'
            }
          }
        ]
      }),
      applicationHistoryDelete: vi.fn().mockResolvedValue({ ok: true, records: [], insights: emptyApplicationHistory.insights, detail: '' })
    } as unknown as Window['loa']

    render(<HistoryPanel model={model} initialTab="applications" />)

    await waitFor(() => {
      expect(window.loa?.applicationHistory).toHaveBeenCalled()
    })

    expect(screen.getByText('Auto-filled')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Track outcome/i })).toBeTruthy()
  })
})
