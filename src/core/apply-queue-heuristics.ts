/** True when Easy Apply failed with text that suggests CAPTCHA / verification (stop queue). */
export function detailSuggestsLinkedInChallenge(detail: string): boolean {
  const d = detail.toLowerCase()
  return (
    d.includes('captcha') ||
    d.includes('challenge') ||
    d.includes('verify it') ||
    d.includes('unusual activity') ||
    d.includes('security check') ||
    d.includes('linkedin_account_restricted') ||
    d.includes('account_restricted') ||
    d.includes('temporarily restricted') ||
    d.includes('temporarily limited') ||
    d.includes('too many requests')
  )
}

/** True when Easy Apply is unavailable on this listing (no actionable user input can fix it). */
export function detailSuggestsEasyApplyUnavailable(detail: string | undefined): boolean {
  const d = String(detail || '').toLowerCase()
  return (
    d.includes('easy_apply_not_available_for_job') ||
    d.includes('easy_apply_button_not_found') ||
    d.includes('could not find easy apply') ||
    d.includes("easy apply form didn't open") ||
    d.includes('easy apply form didn’t open') ||
    d.includes('may not support easy apply') ||
    d.includes('does not offer easy apply')
  )
}

/**
 * True when the queue item stopped before LinkedIn confirmed submit — same IPC retry
 * re-queues the job; UI can say "resume" instead of a hard failure.
 */
export function detailSuggestsUnconfirmedEasyApply(detail: string | undefined): boolean {
  const d = String(detail || '').toLowerCase()
  return (
    d.includes('not confirmed') ||
    d.includes('verify manually') ||
    d.includes('finish the upload and submit manually') ||
    d.includes('needs manual completion') ||
    d.includes('auto-fill paused') ||
    d.includes('ai form-fill') ||
    d.includes('could not advance') ||
    d.includes("couldn't confirm") ||
    d.includes('check linkedin') ||
    d.includes('required field') ||
    d.includes('unfilled')
  )
}
