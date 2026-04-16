/**
 * Shared types and bridge helpers for easy-apply phases.
 *
 * These are extracted from application-assistant.ts to support the modular
 * easy-apply pipeline without duplicating common concerns.
 */

import type { ApplicationCoverLetterMeta } from '@core/application-types'
import {
  EXPECTED_BACKGROUND_BRIDGE_VERSION,
  EXPECTED_CONTENT_SCRIPT_VERSION,
  STALE_EXTENSION_USER_MESSAGE
} from '@core/extension-version'
import {
  isExtensionConnected,
  sendCommand,
  sendCommandWithRetry
} from '../bridge'
import {
  applyTrace,
  summarizeBridgeDataPreview,
  summarizeBridgePayload
} from '../apply-trace'

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type EasyApplyResult = {
  ok: boolean
  phase: 'preflight' | 'navigate' | 'click_apply' | 'fill_fields' | 'submit' | 'done' | 'review'
  detail: string
  fieldsAttempted?: number
  fieldsFilled?: number
  recordId?: string
  blockReason?: 'extension_stale'
  /** Pipeline stage when blocked (for structured history), e.g. click_apply, fill_fields. */
  blockStage?: string
  /** Labels of required form fields that could not be filled — drives the StuckFieldsPrompt UI. */
  stuckFieldLabels?: string[]
}

/** Parsed arguments for an Easy Apply invocation. */
export type EasyApplyArgs = {
  jobUrl: string
  jobTitle?: string
  company?: string
  location?: string
  descriptionSnippet?: string
  reasonSnippet?: string
}

/** Mutable counters shared across form-fill and final-result phases. */
export type EasyApplyFormCounters = {
  totalFieldsAttempted: number
  totalFieldsFilled: number
  totalFieldsSkipped: number
  pausedReason: string | null
  /** Labels of required form fields that could not be filled — drives the StuckFieldsPrompt UI. */
  stuckFieldLabels?: string[]
  coverLetterMetaForHistory: ApplicationCoverLetterMeta | undefined
}

// ────────────────────────────────────────────────────────────────────────────
// Bridge helpers
// ────────────────────────────────────────────────────────────────────────────

export function bridgeDetailIsUnknownAction(detail: string): boolean {
  return String(detail || '').includes('unknown_action')
}

export function staleExtensionEasyApplyResult(
  phase: EasyApplyResult['phase'],
  blockStage: string
): EasyApplyResult {
  return {
    ok: false,
    phase,
    detail: STALE_EXTENSION_USER_MESSAGE,
    blockReason: 'extension_stale',
    blockStage
  }
}

export function isStaleExtensionResult(
  r: { ok: boolean; detail: string; data?: unknown } | EasyApplyResult
): r is EasyApplyResult {
  return 'blockReason' in r && (r as EasyApplyResult).blockReason === 'extension_stale'
}

type BridgeCommandResult = { ok: boolean; detail: string; data?: unknown }

function normalizeBridgeResult(raw: unknown, fallbackDetail: string): BridgeCommandResult {
  const candidate = raw as Partial<BridgeCommandResult> | null
  if (candidate && typeof candidate === 'object' && typeof candidate.ok === 'boolean') {
    return {
      ok: candidate.ok,
      detail: String(candidate.detail || ''),
      data: candidate.data
    }
  }
  return { ok: false, detail: fallbackDetail }
}

/** Idempotent bridge actions safe for automatic retry. */
const IDEMPOTENT_ACTIONS = new Set([
  'PING', 'CONTENT_SCRIPT_VERSION', 'NAVIGATE', 'EXTRACT_FORM_FIELDS',
  'EXPAND_REPEATABLE_CARDS', 'CHECK_SUCCESS_SCREEN', 'CLICK_EASY_APPLY',
  'LOCATE_EASY_APPLY_BUTTON', 'BROWSE_AROUND', 'SCROLL_PAGE',
  'CDP_ADVANCE_MODAL'
])

export async function easyApplyBridgeCommand(
  action: string,
  actionPayload: Record<string, unknown>,
  stalePhase: EasyApplyResult['phase'],
  blockStage: string,
  timeoutMs = 30_000
): Promise<{ ok: boolean; detail: string; data?: unknown } | EasyApplyResult> {
  const t0 = Date.now()
  applyTrace('bridge:send', {
    action,
    blockStage,
    stalePhase,
    timeoutMs,
    payload: summarizeBridgePayload(action, actionPayload)
  })
  const send = IDEMPOTENT_ACTIONS.has(action) ? sendCommandWithRetry : sendCommand
  const result = normalizeBridgeResult(
    await send(action, actionPayload, timeoutMs),
    'bridge_invalid_response'
  )
  const ms = Date.now() - t0
  applyTrace('bridge:recv', {
    action,
    ok: result.ok,
    ms,
    detail: String(result.detail || '').slice(0, 500),
    dataPreview: summarizeBridgeDataPreview(action, result.data)
  })
  if (bridgeDetailIsUnknownAction(result.detail)) {
    applyTrace('bridge:stale_extension', { action, blockStage })
    return staleExtensionEasyApplyResult(stalePhase, blockStage)
  }
  return { ok: result.ok, detail: result.detail, data: result.data }
}

export async function runEasyApplyExtensionPreflight(): Promise<EasyApplyResult | null> {
  if (!isExtensionConnected()) {
    applyTrace('preflight:skip', { reason: 'extension_not_connected' })
    return null
  }
  try {
    applyTrace('preflight:ping', { action: 'PING' })
    const ping = normalizeBridgeResult(
      await sendCommand('PING', {}, 12_000),
      'bridge_invalid_response'
    )
    applyTrace('preflight:ping_result', {
      ok: ping.ok,
      detail: String(ping.detail || '').slice(0, 240),
      backgroundBridgeVersion: (ping.data as { backgroundBridgeVersion?: unknown } | undefined)
        ?.backgroundBridgeVersion
    })
    if (bridgeDetailIsUnknownAction(ping.detail)) {
      applyTrace('preflight:fail', { stage: 'ping', reason: 'unknown_action_stale_extension' })
      return staleExtensionEasyApplyResult('preflight', 'ping')
    }
    if (!ping.ok) {
      applyTrace('preflight:fail', { stage: 'ping', reason: 'not_ok', detail: String(ping.detail || '').slice(0, 200) })
      return {
        ok: false,
        phase: 'preflight',
        detail:
          ping.detail === 'open_a_linkedin_tab'
            ? 'Open a LinkedIn tab in Chrome.'
            : String(ping.detail || 'Extension not ready.')
      }
    }
    const bg = Number(
      (ping.data as { backgroundBridgeVersion?: unknown } | undefined)?.backgroundBridgeVersion
    )
    if (!Number.isFinite(bg) || bg < EXPECTED_BACKGROUND_BRIDGE_VERSION) {
      applyTrace('preflight:fail', {
        stage: 'background_version',
        bg,
        expected: EXPECTED_BACKGROUND_BRIDGE_VERSION
      })
      return staleExtensionEasyApplyResult('preflight', 'background_version')
    }
    applyTrace('preflight:content_script_version', { action: 'CONTENT_SCRIPT_VERSION' })
    const ver = normalizeBridgeResult(
      await sendCommand('CONTENT_SCRIPT_VERSION', {}, 12_000),
      'bridge_invalid_response'
    )
    applyTrace('preflight:content_script_result', {
      ok: ver.ok,
      detail: String(ver.detail || '').slice(0, 200),
      version: (ver.data as { version?: unknown } | undefined)?.version
    })
    if (bridgeDetailIsUnknownAction(ver.detail)) {
      applyTrace('preflight:fail', { stage: 'content_version', reason: 'unknown_action' })
      return staleExtensionEasyApplyResult('preflight', 'content_version')
    }
    const v = Number((ver.data as { version?: unknown } | undefined)?.version)
    if (!Number.isFinite(v) || v < EXPECTED_CONTENT_SCRIPT_VERSION) {
      applyTrace('preflight:fail', {
        stage: 'content_version',
        reason: 'version_too_low',
        v,
        expected: EXPECTED_CONTENT_SCRIPT_VERSION
      })
      return staleExtensionEasyApplyResult('preflight', 'content_version')
    }
    applyTrace('preflight:ok', {})
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const msgLower = msg.toLowerCase()
    const errnoCode =
      err && typeof err === 'object' && 'code' in err
        ? String((err as NodeJS.ErrnoException).code || '')
        : ''
    applyTrace('preflight:error', { message: msg.slice(0, 400) })
    if (msg.includes('not connected') || msg.includes('Extension not connected')) {
      return { ok: false, phase: 'navigate', detail: msg }
    }
    const transientByMessage =
      msgLower.includes('timeout') ||
      msgLower.includes('econnrefused') ||
      msgLower.includes('econnreset') ||
      msgLower.includes('network')
    const transientByCode = errnoCode === 'ECONNREFUSED' || errnoCode === 'ECONNRESET'
    if (transientByMessage || transientByCode) {
      return {
        ok: false,
        phase: 'preflight',
        detail:
          'The browser connection dropped momentarily. This job will retry automatically.'
      }
    }
    return staleExtensionEasyApplyResult('preflight', 'preflight')
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Utility
// ────────────────────────────────────────────────────────────────────────────

export function historyDetailWithSession(detail: string, sessionId: number | null): string {
  const d = String(detail || '').trim()
  if (sessionId == null) return d
  if (/\bsessionId=\d+/.test(d)) return d
  const tag = `sessionId=${sessionId}`
  return d ? `${d} ${tag}` : tag
}

// ────────────────────────────────────────────────────────────────────────────
// Single-shot CDP advance: click modal button + extract fields in one session
// ────────────────────────────────────────────────────────────────────────────

/**
 * Single-shot bridge command that attaches the debugger, finds and clicks
 * the advance button, waits for the form to load, extracts fields, and
 * detaches — all in one debugger session inside the extension.
 * Avoids multi-round-trip race conditions from separate CDP_ATTACH/CDP_COMMAND calls.
 */
export async function cdpAdvanceModalSingleShot(waitMs = 4000): Promise<{
  ok: boolean
  clickedButton?: string
  fields: CdpFormField[]
  modalText?: string
  inputCount?: number
  detail: string
} | null> {
  const result = await easyApplyBridgeCommand(
    'CDP_ADVANCE_MODAL', { waitMs }, 'fill_fields', 'cdp_advance_modal', 30_000
  )
  if (isStaleExtensionResult(result)) return null
  const data = 'data' in result ? result.data as Record<string, unknown> : undefined
  if (!result.ok || !data) {
    return {
      ok: false,
      fields: [],
      detail: result.detail || 'cdp_advance_failed'
    }
  }
  return {
    ok: true,
    clickedButton: String(data.clickedButton || ''),
    fields: (data.fields || []) as CdpFormField[],
    modalText: String(data.modalText || ''),
    inputCount: Number(data.inputCount || 0),
    detail: `clicked_${data.clickedButton || 'unknown'}_strategy_${data.clickStrategy || 'unknown'}_fields_${(data.fields as unknown[])?.length || 0}_iframes_${data.iframeCount || 0}_shadows_${data.shadowRoots || 0}_buttons_${JSON.stringify(data.buttonTexts || []).slice(0, 200)}_tags_${JSON.stringify(data.tagCounts || {}).slice(0, 300)}`
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CDP trusted click for modal buttons (multi-round-trip, kept as fallback)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Use CDP to find and click the advance button (Next, Submit, Continue, Review)
 * inside the Easy Apply modal. LinkedIn's React buttons require isTrusted:true
 * events — JavaScript .click() and dispatchEvent are silently ignored.
 *
 * Returns { ok, buttonText, detail } or null if CDP is unavailable.
 */
export async function cdpClickModalAdvanceButton(): Promise<{
  ok: boolean; buttonText?: string; detail: string
} | null> {
  const { getActiveLinkedInTabId } = await import('../bridge')
  const tabId = getActiveLinkedInTabId()
  if (tabId == null) return null

  // Expression to find the advance button and focus it for keyboard activation
  const findAndFocusExpr = `(async () => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    // Find the Easy Apply modal dialog
    const dialogs = document.querySelectorAll('[role="dialog"]');
    let modal = null;
    for (const d of dialogs) {
      const r = d.getBoundingClientRect();
      if (r.width < 200 || r.height < 200) continue;
      const t = (d.textContent || '').toLowerCase();
      if (t.includes('apply') || t.includes('application') || t.includes('next step') ||
          t.includes('contact info') || t.includes('resume') || t.includes('work experience')) {
        modal = d; break;
      }
    }
    if (!modal) return JSON.stringify({ ok: false, detail: 'no_modal' });

    // Find advance buttons inside the modal
    const btns = modal.querySelectorAll('button, [role="button"]');
    const ranked = [];
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
      const text = (b.textContent || '').trim().toLowerCase();
      if (!text) continue;
      if (text.includes('dismiss') || text.includes('cancel') || text.includes('discard') ||
          text.includes('save as draft') || text === 'save' || text.includes('close')) continue;
      let rank = 0;
      if (text.includes('submit application')) rank = 300;
      else if (text.includes('submit')) rank = 250;
      else if (text.includes('review')) rank = 200;
      else if (text.includes('continue to next')) rank = 150;
      else if (text === 'next') rank = 140;
      else if (text.includes('next')) rank = 130;
      else if (text.includes('continue')) rank = 120;
      if (rank > 0) ranked.push({ el: b, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), text: text.substring(0, 40), rank });
    }
    ranked.sort((a, b) => b.rank - a.rank);
    if (!ranked.length) return JSON.stringify({ ok: false, detail: 'no_advance_button' });

    const best = ranked[0];
    // Focus the button so keyboard Enter will activate it
    best.el.scrollIntoView({ block: 'center' });
    await sleep(200);
    best.el.focus();
    await sleep(100);
    // Get fresh coordinates after scroll/focus
    const fr = best.el.getBoundingClientRect();
    return JSON.stringify({ ok: true, x: Math.round(fr.left + fr.width/2), y: Math.round(fr.top + fr.height/2), text: best.text, rank: best.rank, focused: document.activeElement === best.el });
  })()`

  try {
    const attachRes = await sendCommand('CDP_ATTACH', { tabId }, 10_000)
    if (!attachRes.ok) return null

    try {
      await new Promise((r) => setTimeout(r, 800))
      const locateResult = await sendCommand('CDP_COMMAND', {
        tabId,
        method: 'Runtime.evaluate',
        params: { expression: findAndFocusExpr, returnByValue: true, awaitPromise: true }
      }, 15_000)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawVal = (locateResult as any)?.data?.result?.result?.value
      const parsed = typeof rawVal === 'string' ? JSON.parse(rawVal) : null
      if (!parsed?.ok) {
        return { ok: false, detail: parsed?.detail || 'cdp_locate_failed' }
      }

      const { x, y, text } = parsed as { x: number; y: number; text: string }
      applyTrace('easy_apply:cdp_modal_click', { x, y, text, focused: parsed.focused })

      // Strategy 1: CDP keyboard Enter on focused button (isTrusted:true)
      try {
        await sendCommand('CDP_COMMAND', { tabId, method: 'Input.dispatchKeyEvent',
          params: { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 } }, 5_000)
        await new Promise((r) => setTimeout(r, 50))
        await sendCommand('CDP_COMMAND', { tabId, method: 'Input.dispatchKeyEvent',
          params: { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 } }, 5_000)
        applyTrace('easy_apply:cdp_enter_dispatched', { text })
      } catch (keyErr) {
        applyTrace('easy_apply:cdp_enter_failed', { error: keyErr instanceof Error ? keyErr.message : String(keyErr) })
      }

      // Strategy 2: CDP mouse click as backup (in case Enter didn't work)
      await new Promise((r) => setTimeout(r, 300))
      try {
        await sendCommand('CDP_COMMAND', { tabId, method: 'Input.dispatchMouseEvent',
          params: { type: 'mouseMoved', x, y, button: 'none', buttons: 0 } }, 5_000)
        await new Promise((r) => setTimeout(r, 100 + Math.random() * 100))
        await sendCommand('CDP_COMMAND', { tabId, method: 'Input.dispatchMouseEvent',
          params: { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 } }, 5_000)
        await new Promise((r) => setTimeout(r, 60 + Math.random() * 80))
        await sendCommand('CDP_COMMAND', { tabId, method: 'Input.dispatchMouseEvent',
          params: { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 } }, 5_000)
      } catch { /* mouse click is backup — don't fail on it */ }

      return { ok: true, buttonText: text, detail: 'cdp_click_dispatched' }
    } finally {
      try { await sendCommand('CDP_DETACH', { tabId }, 5_000) } catch { /* best effort */ }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, detail: `cdp_modal_click_error: ${msg}` }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CDP form field extraction (bypasses content script)
// ────────────────────────────────────────────────────────────────────────────

export type CdpFormField = {
  label: string
  type: string
  value?: string
  required?: boolean
  options?: string[]
}

/**
 * Use CDP Runtime.evaluate to extract form fields directly from the Easy Apply
 * modal DOM. This bypasses the content script entirely — useful when the content
 * script returns 0 fields despite the modal being present.
 *
 * Also searches inside shadow DOMs (LinkedIn SDUI architecture).
 */
export async function cdpExtractFormFields(): Promise<{
  ok: boolean
  fields: CdpFormField[]
  diagnostic: Record<string, unknown>
} | null> {
  const { getActiveLinkedInTabId } = await import('../bridge')
  const tabId = getActiveLinkedInTabId()
  if (tabId == null) return null

  const extractExpr = `(async () => {
    function ct(s) { return (s || '').replace(/\\s+/g, ' ').trim(); }

    // ── Find the Easy Apply modal ──
    function findModal() {
      const sources = [document];
      const outlet = document.querySelector('#interop-outlet');
      if (outlet && outlet.shadowRoot) sources.push(outlet.shadowRoot);

      for (const src of sources) {
        // .jobs-easy-apply-modal is the most specific selector
        const eam = src.querySelector('.jobs-easy-apply-modal');
        if (eam && eam.getBoundingClientRect().width > 200) return eam;
      }
      for (const src of sources) {
        for (const d of src.querySelectorAll('[role="dialog"]')) {
          const r = d.getBoundingClientRect();
          if (r.width < 200 || r.height < 200) continue;
          const t = (d.textContent || '').toLowerCase();
          if (t.includes('easy apply') || t.includes('submit application') ||
              t.includes('contact info') || t.includes('resume') ||
              t.includes('work experience') || t.includes('additional question')) return d;
        }
      }
      return null;
    }

    const modal = findModal();
    if (!modal) return JSON.stringify({ ok: false, fields: [], diagnostic: { reason: 'no_modal_found' } });

    // ── Collect form elements, piercing shadow roots ──
    const fields = [];
    const seen = new Set();
    const radioGroupsSeen = new Set();

    function inferLabel(el, searchRoot) {
      // aria-label / aria-labelledby
      let label = el.getAttribute('aria-label') || '';
      if (!label) {
        const lblId = el.getAttribute('aria-labelledby');
        if (lblId) {
          const ref = (searchRoot || document).getElementById(lblId);
          if (ref) label = ct(ref.textContent);
        }
      }
      // <label for="id">
      if (!label && el.id) {
        const lbl = (searchRoot || document).querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lbl) label = ct(lbl.textContent);
      }
      // Closest <label> ancestor
      if (!label) {
        const p = el.closest('label');
        if (p) label = ct(p.textContent);
      }
      // SDUI: fb-dash-form-element label
      if (!label) {
        const fc = el.closest('.fb-dash-form-element, [class*="form-component"], .artdeco-text-input--container');
        if (fc) {
          const lbl = fc.querySelector('label, .fb-dash-form-element__label, [class*="label"]');
          if (lbl) label = ct(lbl.textContent);
        }
      }
      // LinkedIn: preceding label-like element
      if (!label) {
        const parent = el.parentElement;
        if (parent) {
          const prev = parent.previousElementSibling;
          if (prev && (prev.tagName === 'LABEL' || prev.querySelector('label'))) {
            label = ct(prev.textContent);
          }
        }
      }
      // Placeholder as last resort
      if (!label) label = el.getAttribute('placeholder') || '';
      return ct(label).substring(0, 200);
    }

    function processRoot(root) {
      if (!root || !root.querySelectorAll) return;

      // Handle radio groups first
      const radios = root.querySelectorAll('input[type="radio"]');
      const radioGroups = new Map();
      for (const r of radios) {
        if (r.disabled) continue;
        const name = r.getAttribute('name') || '';
        if (!name || radioGroupsSeen.has(name)) continue;
        if (!radioGroups.has(name)) radioGroups.set(name, []);
        radioGroups.get(name).push(r);
      }
      for (const [name, rads] of radioGroups) {
        radioGroupsSeen.add(name);
        const label = inferLabel(rads[0], root);
        if (!label) continue;
        const options = rads.map(r => {
          const optLabel = r.parentElement ? ct(r.parentElement.textContent) : '';
          return optLabel || r.value || '';
        }).filter(Boolean).slice(0, 15);
        const anyChecked = rads.some(r => r.checked);
        const required = rads.some(r => r.required || r.getAttribute('aria-required') === 'true');
        fields.push({ label, type: 'radio', value: anyChecked ? 'true' : 'false', required, options });
      }

      // Handle inputs, selects, textareas
      for (const el of root.querySelectorAll('input, select, textarea')) {
        if (el.disabled || seen.has(el)) continue;
        seen.add(el);
        const tag = el.tagName.toLowerCase();
        let type = tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase();
        if (type === 'hidden') continue;
        if (type === 'radio') continue; // handled above
        const label = inferLabel(el, root);
        const required = el.required || el.getAttribute('aria-required') === 'true';
        const value = type === 'checkbox' ? (el.checked ? 'true' : 'false') : (el.value || '');
        let options;
        if (type === 'select') options = [...el.options].map(o => ct(o.textContent) || o.value).filter(Boolean).slice(0, 15);
        if (type === 'file') type = 'file';
        fields.push({ label: label || '[unlabeled ' + type + ']', type, value, required, ...(options ? { options } : {}) });
      }

      // Recurse into shadow roots
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) processRoot(el.shadowRoot);
      }
    }

    processRoot(modal);

    // Diagnostic: counts at the modal level
    const allEls = modal.querySelectorAll('*');
    const inputCount = modal.querySelectorAll('input').length;
    const selectCount = modal.querySelectorAll('select').length;
    const textareaCount = modal.querySelectorAll('textarea').length;
    const shadowRootCount = [...allEls].filter(el => el.shadowRoot).length;
    const modalText = ct(modal.textContent).substring(0, 800);

    return JSON.stringify({
      ok: fields.length > 0,
      fields,
      diagnostic: {
        inputCount, selectCount, textareaCount, shadowRootCount,
        totalElements: allEls.length,
        modalTextSnippet: modalText,
        modalTag: modal.tagName,
        modalClass: (modal.className || '').substring(0, 200)
      }
    });
  })()`

  try {
    const attachRes = await sendCommand('CDP_ATTACH', { tabId }, 10_000)
    if (!attachRes.ok) return null

    try {
      const evalResult = await sendCommand('CDP_COMMAND', {
        tabId,
        method: 'Runtime.evaluate',
        params: { expression: extractExpr, returnByValue: true, awaitPromise: true }
      }, 15_000)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawVal = (evalResult as any)?.data?.result?.result?.value
      const parsed = typeof rawVal === 'string' ? JSON.parse(rawVal) : null
      if (!parsed) return { ok: false, fields: [], diagnostic: { reason: 'cdp_eval_no_result' } }
      return parsed as { ok: boolean; fields: CdpFormField[]; diagnostic: Record<string, unknown> }
    } finally {
      try { await sendCommand('CDP_DETACH', { tabId }, 5_000) } catch { /* best effort */ }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, fields: [], diagnostic: { error: msg } }
  }
}
