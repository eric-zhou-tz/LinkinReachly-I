/**
 * Phase 2: Navigate — direct the active LinkedIn tab to the job URL and wait
 * for the SPA to hydrate.
 */

import { applyTrace } from '../apply-trace'
import {
  easyApplyBridgeCommand,
  isStaleExtensionResult
} from './shared'
import type { EasyApplyResult } from './shared'

/**
 * Navigate the active LinkedIn tab to the job URL and wait for the SPA to
 * hydrate.  Returns an early-exit result on failure, or null on success.
 */
export async function easyApplyNavigate(
  jobUrl: string,
  onProgress?: (phase: string) => void,
  jobTitle?: string
): Promise<EasyApplyResult | null> {
  try {
    onProgress?.('Navigating to job listing...')
    // Variable wait simulates a human reading the job listing (3–8s)
    const navWaitMs = 3000 + Math.random() * 5000

    // Navigate to the standalone /jobs/view/ page. After clearing SPA state
    // via /feed/, LinkedIn renders real <button> elements. The CDP locate
    // expression clicks the button and detects whether it opens a modal
    // or triggers SDUI navigation (redirect to /apply/ and back).
    const targetUrl = jobUrl

    // Clear SPA search state: navigate to feed first, then to the target.
    // Without this, LinkedIn's SPA router redirects /jobs/view/ back to the
    // user's last /jobs/search/ URL.
    try {
      await easyApplyBridgeCommand('NAVIGATE', { url: 'https://www.linkedin.com/feed/' }, 'navigate', 'clear_spa_state', 10_000)
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1500))
    } catch { /* best effort */ }

    applyTrace('easy_apply:stage', { stage: 'navigate_job_page', waitAfterMs: Math.round(navWaitMs), targetUrl: targetUrl.slice(0, 200) })
    const nav = await easyApplyBridgeCommand('NAVIGATE', { url: targetUrl }, 'navigate', 'navigate')
    if (isStaleExtensionResult(nav)) return nav as EasyApplyResult
    if (!nav.ok) {
      applyTrace('easy_apply:navigate_failed', { detail: String(nav.detail || '').slice(0, 300) })
      return { ok: false, phase: 'navigate', detail: String(nav.detail || 'Navigation failed.') }
    }
    // Wait for LinkedIn SPA to fully hydrate + simulate reading the listing
    await new Promise((r) => setTimeout(r, navWaitMs))

    // Simulate reading the job description — scroll down then back up
    try {
      await easyApplyBridgeCommand('SCROLL_PAGE', { amount: 300 + Math.random() * 400, direction: 'down' }, 'navigate', 'pre_apply_scroll_down', 5_000)
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500))
      await easyApplyBridgeCommand('SCROLL_PAGE', { amount: 200 + Math.random() * 300, direction: 'down' }, 'navigate', 'pre_apply_scroll_down_2', 5_000)
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000))
      await easyApplyBridgeCommand('SCROLL_PAGE', { amount: 400 + Math.random() * 500, direction: 'up' }, 'navigate', 'pre_apply_scroll_up', 5_000)
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200))
    } catch (e) { applyTrace('easy_apply:pre_apply_scroll_failed', { error: e instanceof Error ? e.message : String(e) }) }

    // Post-navigate check: detect if the page already shows success (1-click auto-apply
    // or the user/a previous run already applied). Catches the case where navigating to
    // the job URL triggers an immediate application or shows an "Already applied" badge.
    try {
      const postNavCheck = await easyApplyBridgeCommand(
        'CHECK_SUCCESS_SCREEN', {}, 'navigate', 'post_navigate_success_check', 8_000
      )
      const pnData = 'data' in postNavCheck ? postNavCheck.data : undefined
      const pnDetail = String('detail' in postNavCheck ? postNavCheck.detail || '' : '').toLowerCase()
      const alreadyApplied =
        !isStaleExtensionResult(postNavCheck) && postNavCheck.ok &&
        pnData === 'submit' && pnDetail.includes('success_screen')
      if (alreadyApplied) {
        applyTrace('easy_apply:post_navigate_already_applied', { detail: pnDetail.slice(0, 200) })
        return { ok: true, phase: 'done' as const, detail: 'Application already submitted (detected after navigation).' }
      }
    } catch (e) { applyTrace('easy_apply:post_navigate_check_failed', { error: e instanceof Error ? e.message : String(e) }) }

    // Safety check: detect LinkedIn security warnings (rate-limit, CAPTCHA, verification)
    try {
      const pageTextRes = await easyApplyBridgeCommand(
        'GET_PAGE_TEXT', {}, 'navigate', 'linkedin_warning_check', 5_000
      )
      if (isStaleExtensionResult(pageTextRes)) return pageTextRes as EasyApplyResult
      const ptData = 'data' in pageTextRes ? pageTextRes.data : undefined
      if (pageTextRes.ok && typeof ptData === 'string') {
        const pageText = ptData.toLowerCase()
        if (/unusual activity|security verification|verify your identity|let[''\u2019]s do a quick security check/i.test(pageText)) {
          applyTrace('easy_apply:linkedin_warning_detected', { snippet: pageText.slice(0, 300) })
          return { ok: false, phase: 'navigate', detail: 'linkedin_security_warning: LinkedIn is asking for identity verification. Stop the queue and complete the check manually.' }
        }
      }
    } catch (e) { applyTrace('easy_apply:warning_check_failed', { error: e instanceof Error ? e.message : String(e) }) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    applyTrace('easy_apply:navigate_exception', { message: msg.slice(0, 400) })
    return { ok: false, phase: 'navigate', detail: `Navigation failed: ${msg}` }
  }
  return null
}
