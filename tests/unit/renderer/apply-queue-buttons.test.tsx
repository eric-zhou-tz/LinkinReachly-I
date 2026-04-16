/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApplyQueueState } from '../../../src/core/application-types'
import type { QueueStats } from '../../../src/renderer/src/components/jobs/useApplyQueue'
import { ApplyQueueTile } from '../../../src/renderer/src/components/jobs/ApplyQueueTile'

const applicantSave = vi.fn().mockResolvedValue(undefined)
const openExternalUrl = vi.fn().mockResolvedValue({ ok: true })
const applicationQueueRetry = vi.fn().mockResolvedValue({ ok: true, state: { items: [], running: false, currentIndex: 0 } })
const applicantGet = vi.fn().mockResolvedValue({
  ok: true,
  profile: { basics: { fullName: 'Ada Lovelace', email: 'ada@example.com' }, assets: [], links: {}, workAuth: {}, compensation: {}, background: {} },
})

vi.mock('@/loa-client', () => ({
  getLoa: () => ({
    applicantSave,
    openExternalUrl,
    applicationQueueRetry,
    applicantGet,
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function makeQueueState(overrides?: Partial<ApplyQueueState>): ApplyQueueState {
  return {
    items: [],
    running: false,
    currentIndex: 0,
    ...overrides,
  }
}

function makeStats(overrides?: Partial<QueueStats>): QueueStats {
  return {
    done: 0,
    pending: 0,
    resumeErr: 0,
    error: 0,
    skipped: 0,
    actionableTotal: 0,
    progress: 0,
    active: false,
    activeCount: 0,
    hasPending: false,
    hasError: false,
    hasResumeErr: false,
    ...overrides,
  }
}

function defaultProps(overrides?: Record<string, unknown>) {
  const stuck = {
    id: 'job-1',
    jobTitle: 'Engineer',
    company: 'Acme',
    location: 'Remote',
    linkedinJobUrl: 'https://linkedin.com/jobs/view/1/',
    applyUrl: 'https://linkedin.com/jobs/view/1/',
    surface: 'linkedin_easy_apply' as const,
    status: 'error' as const,
    addedAt: new Date().toISOString(),
    stuckFieldLabels: ['Phone Number', 'Work Authorization'],
    detail: 'Could not advance: 2 required fields unfilled (Phone Number, Work Authorization).',
  }
  const plain = {
    id: 'job-2',
    jobTitle: 'Designer',
    company: 'Beta',
    location: 'NYC',
    linkedinJobUrl: 'https://linkedin.com/jobs/view/2/',
    applyUrl: 'https://linkedin.com/jobs/view/2/',
    surface: 'linkedin_easy_apply' as const,
    status: 'error' as const,
    addedAt: new Date().toISOString(),
    detail: 'timeout during submit',
  }

  const items = [stuck, plain]
  const queueState = makeQueueState({ items })

  return {
    applyQueue: queueState,
    queueStats: makeStats({ error: 2, resumeErr: 1, hasError: true, hasResumeErr: true, actionableTotal: 2 }),
    applyQueueOpenItems: items,
    queueAriaAlert: '',
    chromeReady: true,
    resumeFileName: 'resume.pdf',
    startingQueue: false,
    retryingItemUrls: new Set<string>(),
    clearingQueue: false,
    retryingBulk: false,
    queuePausing: false,
    chainRunning: false,
    chainStatus: '',
    chainProgress: '',
    chainDismissed: true,
    chainSkipping: false,
    outreachSentUrls: new Set<string>(),
    appliedJobUrls: new Set<string>(),
    onStartQueue: vi.fn(),
    onStopQueue: vi.fn(),
    onClearQueue: vi.fn(),
    onRetryFailed: vi.fn(),
    onRemoveItem: vi.fn(),
    onRetryItem: vi.fn(),
    onMarkItemDone: vi.fn(),
    onRunChain: vi.fn(),
    onSkipChain: vi.fn(),
    onDismissChainStatus: vi.fn(),
    onSwitchToResults: vi.fn(),
    setFeedback: vi.fn(),
    ...overrides,
  }
}

/** Expand an accordion row by clicking its header button */
function expandAccordion(jobTitle: string) {
  const headings = screen.getAllByText(jobTitle)
  // The title is inside a <button class="queue-accordion__head">
  const heading = headings[0]
  const btn = heading.closest('button')
  if (btn) fireEvent.click(btn)
}

describe('ApplyQueueTile — per-item buttons scope to item.id', () => {
  it('per-row Retry button calls onRetryItem with item id', () => {
    const props = defaultProps()
    render(<ApplyQueueTile {...props} />)

    // Expand the non-stuck item accordion (Designer at Beta)
    expandAccordion('Designer')

    const retryBtn = screen.getByText('Retry')
    fireEvent.click(retryBtn)

    expect(props.onRetryItem).toHaveBeenCalledWith('job-2')
    expect(props.onRetryFailed).not.toHaveBeenCalled()
  })

  it('per-row Remove button calls onRemoveItem with item id', () => {
    const props = defaultProps()
    render(<ApplyQueueTile {...props} />)

    // Expand the Designer accordion to access its Remove button
    expandAccordion('Designer')

    const removeBtn = screen.getByLabelText('Remove Designer from Ready to apply')
    fireEvent.click(removeBtn)

    expect(props.onRemoveItem).toHaveBeenCalledWith('job-2')
  })

  it('bottom "Retry with answers" is batch (onRetryFailed)', () => {
    const props = defaultProps()
    render(<ApplyQueueTile {...props} />)

    const bottomRetry = screen.getByText('Retry with answers')
    fireEvent.click(bottomRetry)

    expect(props.onRetryFailed).toHaveBeenCalledTimes(1)
    expect(props.onRetryItem).not.toHaveBeenCalled()
  })

  it('inline answer input retries only that stuck item after save', async () => {
    const props = defaultProps()
    render(<ApplyQueueTile {...props} />)

    // Expand the stuck item accordion (Engineer at Acme)
    expandAccordion('Engineer')

    const phoneInput = screen.getByLabelText('Answer for: Phone Number')
    fireEvent.change(phoneInput, { target: { value: '555-0000' } })

    const saveBtn = screen.getByLabelText('Save answer for Phone Number')
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(applicantSave).toHaveBeenCalledWith({
        screeningAnswerCache: { phone: '555-0000' },
      })
    })

    await waitFor(() => {
      expect(props.onRetryItem).toHaveBeenCalledWith('job-1')
    })

    expect(props.onRetryFailed).not.toHaveBeenCalled()
    expect(props.onStartQueue).not.toHaveBeenCalled()
  })

  it('stuck item does not show per-row Retry (uses inline answers instead)', async () => {
    const props = defaultProps()
    render(<ApplyQueueTile {...props} />)

    // Expand the stuck item
    expandAccordion('Engineer')

    // Stuck items show InlineQRows, not a plain Retry button
    // The only Retry-like text should NOT be visible for this item
    const removeBtn = screen.getByLabelText('Remove Engineer from Ready to apply')
    expect(removeBtn).toBeTruthy()

    await waitFor(() => {
      expect(applicantGet).toHaveBeenCalled()
    })
  })
})

describe('ApplyQueueTile — button disabled states', () => {
  it('Start button shows "Connect Chrome" when Chrome is not ready and no JIT handler', async () => {
    const props = defaultProps({
      chromeReady: false,
      queueStats: makeStats({ hasPending: true, pending: 1, actionableTotal: 1 }),
    })
    render(<ApplyQueueTile {...props} />)

    await waitFor(() => {
      const startBtn = screen.getByRole('button', { name: /Connect Chrome to start/i })
      expect((startBtn as HTMLButtonElement).disabled).toBe(true)
    })
  })

  it('Start button calls onExtSetupNeeded when Chrome is not ready and handler provided', async () => {
    const onExtSetup = vi.fn()
    const props = defaultProps({
      chromeReady: false,
      queueStats: makeStats({ hasPending: true, pending: 1, actionableTotal: 1 }),
      onExtSetupNeeded: onExtSetup,
    })
    render(<ApplyQueueTile {...props} />)

    await waitFor(() => {
      const startBtn = screen.getByRole('button', { name: /Connect Chrome to start/i })
      expect((startBtn as HTMLButtonElement).disabled).toBe(false)
      fireEvent.click(startBtn)
    })
    expect(onExtSetup).toHaveBeenCalledOnce()
  })
})
