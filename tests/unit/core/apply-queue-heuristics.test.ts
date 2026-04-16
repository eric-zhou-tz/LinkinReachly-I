import { describe, expect, it } from 'vitest'
import {
  detailSuggestsEasyApplyUnavailable,
  detailSuggestsLinkedInChallenge,
  detailSuggestsUnconfirmedEasyApply
} from '@core/apply-queue-heuristics'

describe('detailSuggestsLinkedInChallenge heuristics', () => {
  it('matches common verification phrases', () => {
    expect(detailSuggestsLinkedInChallenge('Please complete the CAPTCHA')).toBe(true)
    expect(detailSuggestsLinkedInChallenge('Security check required')).toBe(true)
    expect(detailSuggestsLinkedInChallenge('Unusual activity detected')).toBe(true)
    expect(detailSuggestsLinkedInChallenge('verify it now')).toBe(true)
    expect(detailSuggestsLinkedInChallenge('Challenge page')).toBe(true)
  })

  it('returns false for normal failures', () => {
    expect(detailSuggestsLinkedInChallenge('Modal not found')).toBe(false)
    expect(detailSuggestsLinkedInChallenge('already_applied')).toBe(false)
  })
})

describe('detailSuggestsUnconfirmedEasyApply', () => {
  it('matches unconfirmed / manual-verify copy from handleEasyApply', () => {
    expect(
      detailSuggestsUnconfirmedEasyApply(
        'Automatic submission was not confirmed. Filled 0/0 fields. Please verify manually.'
      )
    ).toBe(true)
    expect(detailSuggestsUnconfirmedEasyApply('Please finish the upload and submit manually.')).toBe(true)
    expect(detailSuggestsUnconfirmedEasyApply('Auto-fill paused after 1/2 fields.')).toBe(true)
  })

  it('matches new AI form-fill stuck messages', () => {
    expect(
      detailSuggestsUnconfirmedEasyApply(
        'Easy Apply stuck: 2 required fields unfilled. AI form-fill exhausted after 2 attempts. Filled 1/12 fields. Needs manual completion.'
      )
    ).toBe(true)
    expect(
      detailSuggestsUnconfirmedEasyApply(
        'Easy Apply stuck: 0 required fields unfilled. AI form-fill form stuck despite all required fields filled. Filled 9/26 fields. Needs manual completion.'
      )
    ).toBe(true)
  })

  it('returns false for CAPTCHA and unrelated errors', () => {
    expect(detailSuggestsUnconfirmedEasyApply('LinkedIn showed a security check (CAPTCHA).')).toBe(false)
    expect(detailSuggestsUnconfirmedEasyApply('Could not find Easy Apply button.')).toBe(false)
  })
})

describe('detailSuggestsEasyApplyUnavailable', () => {
  it('matches non-actionable Easy Apply unavailable variants', () => {
    expect(detailSuggestsEasyApplyUnavailable('easy_apply_button_not_found')).toBe(true)
    expect(
      detailSuggestsEasyApplyUnavailable(
        "The Easy Apply form didn't open on this page. The job may have been removed or may not support Easy Apply."
      )
    ).toBe(true)
    expect(detailSuggestsEasyApplyUnavailable('Could not find Easy Apply button.')).toBe(true)
    expect(detailSuggestsEasyApplyUnavailable('easy_apply_not_available_for_job')).toBe(true)
  })

  it('returns false for actionable manual-review cases', () => {
    expect(detailSuggestsEasyApplyUnavailable('2 required fields unfilled.')).toBe(false)
    expect(detailSuggestsEasyApplyUnavailable('Automatic submission was not confirmed. Check LinkedIn.')).toBe(false)
  })
})
