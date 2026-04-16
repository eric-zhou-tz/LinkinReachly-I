/** Pure policy helpers for the apply queue runner (no I/O). */

type SessionBreakEverySettings = {
  sessionBreaksEnabled: boolean
  sessionBreakEveryMin: number
  sessionBreakEveryMax: number
}

export function isDailyCapReached(todayCount: number, dailyCap: number): boolean {
  return todayCount >= dailyCap
}

/** True when a session break should run after the current batch of items. */
export function shouldTakeSessionBreak(
  consecutiveForBreak: number,
  itemsUntilBreak: number | null
): boolean {
  return itemsUntilBreak != null && consecutiveForBreak >= itemsUntilBreak
}

function randomIntInclusive(min: number, max: number): number {
  const lo = Math.max(1, Math.round(Math.min(min, max)))
  const hi = Math.max(lo, Math.round(Math.max(min, max)))
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

/** Random "every N items" threshold for session breaks, or null if disabled. */
export function nextSessionBreakEveryItems(settings: SessionBreakEverySettings): number | null {
  if (!settings.sessionBreaksEnabled) return null
  return randomIntInclusive(settings.sessionBreakEveryMin, settings.sessionBreakEveryMax)
}

function logNormalSample(minSec: number, maxSec: number): number {
  const u1 = Math.random()
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2)
  const t = 1 / (1 + Math.exp(-z * 0.8))
  return minSec + t * (maxSec - minSec)
}

/**
 * Random inter-item or cooldown delay in milliseconds.
 * @param minSec — minimum seconds
 * @param maxSec — maximum seconds
 * @param variancePercent — timing jitter as a percent of base delay (e.g. 30 = ±30% band)
 */
export function computeDelay(minSec: number, maxSec: number, variancePercent: number): number {
  const variancePct = variancePercent / 100
  const baseMs = logNormalSample(minSec, maxSec) * 1000
  const jitter = baseMs * variancePct * (Math.random() * 2 - 1)
  return Math.max(0, baseMs + jitter)
}
