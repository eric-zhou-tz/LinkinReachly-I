import { describe, expect, it, vi } from 'vitest'
import { withRetry, isRetryableHttpStatus } from '@core/transport-retry'

describe('withRetry', () => {
  it('returns on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on transient errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue('recovered')

    const result = await withRetry(fn, { baseDelayMs: 10, maxDelayMs: 50 })
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws after max retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'))
    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50 })
    ).rejects.toThrow('timeout')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('invalid_api_key'))
    await expect(
      withRetry(fn, { maxRetries: 3, baseDelayMs: 10 })
    ).rejects.toThrow('invalid_api_key')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('calls onRetry callback', async () => {
    const onRetry = vi.fn()
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValue('ok')

    await withRetry(fn, { baseDelayMs: 10, onRetry })
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number))
  })

  it('respects custom isRetryable', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('custom_retriable'))
      .mockResolvedValue('ok')

    const result = await withRetry(fn, {
      baseDelayMs: 10,
      isRetryable: (e) => e instanceof Error && e.message === 'custom_retriable'
    })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on 429 status in error message', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 429 Too Many Requests'))
      .mockResolvedValue('ok')

    const result = await withRetry(fn, { baseDelayMs: 10 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on 500/502/503/504 in error message', async () => {
    for (const code of [500, 502, 503, 504]) {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error(`Server error ${code}`))
        .mockResolvedValue('ok')
      const result = await withRetry(fn, { baseDelayMs: 10 })
      expect(result).toBe('ok')
    }
  })

  it('applies exponential backoff with jitter', async () => {
    const delays: number[] = []
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue('ok')

    await withRetry(fn, {
      baseDelayMs: 100,
      maxDelayMs: 5000,
      onRetry: (_attempt, _error, delay) => delays.push(delay)
    })

    expect(delays).toHaveLength(2)
    expect(delays[0]).toBeGreaterThanOrEqual(50)
    expect(delays[0]).toBeLessThanOrEqual(100)
    expect(delays[1]).toBeGreaterThanOrEqual(100)
    expect(delays[1]).toBeLessThanOrEqual(200)
  })
})

describe('isRetryableHttpStatus', () => {
  it('marks 429 as retryable', () => {
    expect(isRetryableHttpStatus(429)).toBe(true)
  })

  it('marks 5xx as retryable', () => {
    expect(isRetryableHttpStatus(500)).toBe(true)
    expect(isRetryableHttpStatus(502)).toBe(true)
    expect(isRetryableHttpStatus(503)).toBe(true)
  })

  it('marks 4xx (except 429) as non-retryable', () => {
    expect(isRetryableHttpStatus(400)).toBe(false)
    expect(isRetryableHttpStatus(401)).toBe(false)
    expect(isRetryableHttpStatus(403)).toBe(false)
    expect(isRetryableHttpStatus(404)).toBe(false)
  })

  it('marks 2xx as non-retryable', () => {
    expect(isRetryableHttpStatus(200)).toBe(false)
  })
})
