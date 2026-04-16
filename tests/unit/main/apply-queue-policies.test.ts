import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  computeDelay,
  isDailyCapReached,
  nextSessionBreakEveryItems,
  shouldTakeSessionBreak
} from '../../../src/main/apply-queue-policies'

describe('apply-queue-policies', () => {
  describe('isDailyCapReached', () => {
    it('is false when todayCount is below cap', () => {
      expect(isDailyCapReached(0, 20)).toBe(false)
      expect(isDailyCapReached(19, 20)).toBe(false)
    })
    it('is true when todayCount equals cap', () => {
      expect(isDailyCapReached(20, 20)).toBe(true)
    })
    it('is true when todayCount exceeds cap', () => {
      expect(isDailyCapReached(21, 20)).toBe(true)
    })
  })

  describe('computeDelay', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('with zero variance returns base delay only (deterministic when random is fixed)', () => {
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
      const ms = computeDelay(10, 20, 0)
      expect(spy).toHaveBeenCalled()
      const expectedSec = (() => {
        const u1 = 0.5
        const u2 = 0.5
        const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2)
        const t = 1 / (1 + Math.exp(-z * 0.8))
        return 10 + t * (20 - 10)
      })()
      expect(ms).toBeCloseTo(expectedSec * 1000, 5)
    })

    it('keeps samples within min-max seconds (in ms) across many draws with jitter', () => {
      const minSec = 5
      const maxSec = 15
      const variancePercent = 30
      for (let i = 0; i < 80; i++) {
        const ms = computeDelay(minSec, maxSec, variancePercent)
        expect(ms).toBeGreaterThanOrEqual(0)
        const maxWithJitter = maxSec * 1000 * (1 + variancePercent / 100)
        expect(ms).toBeLessThanOrEqual(maxWithJitter + 1)
        const minWithJitter = minSec * 1000 * (1 - variancePercent / 100)
        expect(ms).toBeGreaterThanOrEqual(Math.max(0, minWithJitter - 1))
      }
    })
  })

  describe('shouldTakeSessionBreak', () => {
    it('is false when session break is disabled (null threshold)', () => {
      expect(shouldTakeSessionBreak(99, null)).toBe(false)
    })
    it('is false when consecutive count is below threshold', () => {
      expect(shouldTakeSessionBreak(2, 3)).toBe(false)
    })
    it('is true when consecutive count reaches threshold', () => {
      expect(shouldTakeSessionBreak(3, 3)).toBe(true)
      expect(shouldTakeSessionBreak(5, 3)).toBe(true)
    })
  })

  describe('nextSessionBreakEveryItems', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('returns null when session breaks are disabled', () => {
      expect(
        nextSessionBreakEveryItems({
          sessionBreaksEnabled: false,
          sessionBreakEveryMin: 3,
          sessionBreakEveryMax: 8
        })
      ).toBeNull()
    })

    it('returns an integer between min and max when breaks are enabled', () => {
      for (let i = 0; i < 120; i++) {
        const n = nextSessionBreakEveryItems({
          sessionBreaksEnabled: true,
          sessionBreakEveryMin: 4,
          sessionBreakEveryMax: 9
        })
        expect(n).not.toBeNull()
        expect(Number.isInteger(n)).toBe(true)
        expect(n!).toBeGreaterThanOrEqual(4)
        expect(n!).toBeLessThanOrEqual(9)
      }
    })
  })
})
