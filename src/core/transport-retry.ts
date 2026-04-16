/**
 * OpenHarness-inspired centralized transport retry.
 *
 * Instead of scattering sleep/retry across every CDP call and bridge command,
 * wrap the transport layer with exponential backoff + jitter.
 *
 * Retryable conditions: timeouts, connection errors, 429/5xx from LLM APIs.
 * Non-retryable: validation errors, auth failures, user cancellation.
 */

interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  jitter?: boolean
  isRetryable?: (error: unknown) => boolean
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void
}

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BASE_DELAY_MS = 1000
const DEFAULT_MAX_DELAY_MS = 15000

function isTransientError(error: unknown): boolean {
  if (!error) return false
  const msg = error instanceof Error ? error.message : String(error)
  const lower = msg.toLowerCase()
  if (lower.includes('timeout') || lower.includes('timed out')) return true
  if (lower.includes('econnreset') || lower.includes('econnrefused')) return true
  if (lower.includes('epipe') || lower.includes('socket hang up')) return true
  if (lower.includes('network') || lower.includes('fetch failed')) return true
  if (/\b(429|500|502|503|504|529)\b/.test(msg)) return true
  return false
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES
  const baseDelay = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelay = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const shouldRetry = opts.isRetryable ?? isTransientError
  const jitter = opts.jitter !== false

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (attempt >= maxRetries || !shouldRetry(e)) throw e

      const expDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
      const delay = jitter ? expDelay * (0.5 + Math.random() * 0.5) : expDelay
      opts.onRetry?.(attempt + 1, e, delay)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastError
}

/**
 * Check whether an LLM API response status suggests a retryable condition.
 * Maps to OpenHarness's RETRYABLE_STATUS_CODES pattern.
 */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500
}
