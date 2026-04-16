
var ACTIONS = {
  CONTENT_SCRIPT_VERSION: function() { return { ok: true, data: { version: CONTENT_VERSION } } },
  PING: function() { return { ok: true, detail: 'pong' } },
  EXTRACT_PROFILE: function() { return extractProfile() },
  CLICK_CONNECT_2ND: function() { return clickConnect2nd() },
  CLICK_CONNECT_3RD: function() { return clickConnect3rd() },
  CLICK_CONNECT_ANY: function() { return clickConnectAny() },
  CLICK_ADD_NOTE: function() { return clickAddNote() },
  TYPE_NOTE: function(p) { return typeNote(String(p.text || ''), Number(p.charMin) || 40, Number(p.charMax) || 140) },
  CLICK_SEND: function() { return clickSend() },
  VERIFY_PENDING: function() { return verifyPending() },
  CHECK_PENDING_INVITES: function() { return checkPendingInviteCount() },
  DISMISS_MODAL: function() { return dismissModal() },
  CHECK_ERROR_TOAST: function() { return checkErrorToast() },
  EXTRACT_CONNECTIONS: function(p) { return extractConnections(p) },
  EXTRACT_SEARCH_RESULTS: function(p) { return extractSearchResults(p) },
  CLICK_MESSAGE_FOR_PROFILE: function(p) { return clickMessageForProfile(p) },
  TYPE_CONVERSATION: function(p) { return typeConversation(String(p.text || ''), Number(p.charMin) || 40, Number(p.charMax) || 140) },
  CLICK_SEND_CONVERSATION: function() { return clickSendConversation() },
  EXTRACT_JOB_LISTINGS: function(p) { return extractJobListings(p) },
  EXTRACT_JOB_DETAILS: function() { return extractJobDetails() },
  GET_PAGE_TEXT: function() {
    var text = ''
    try {
      var body = document && document.body ? document.body : null
      var inner = body && typeof body.innerText === 'string' ? body.innerText : ''
      var content = body && typeof body.textContent === 'string' ? body.textContent : ''
      text = String(inner || content || '')
    } catch {
      text = ''
    }
    // Keep payload bounded for bridge reliability and tracing.
    const normalized = text.replace(/\s+/g, ' ').trim().slice(0, 80_000)
    return { ok: true, detail: 'page_text', data: normalized }
  },
  CLICK_EASY_APPLY: function() { return clickEasyApply() },
  LOCATE_EASY_APPLY_BUTTON: function() { return locateEasyApplyButton() },
  FORCE_NAVIGATE: function(p) {
    var url = String(p.url || '').trim()
    if (!url || !url.startsWith('https://')) return { ok: false, detail: 'invalid_url' }
    try {
      var parsed = new URL(url)
      if (!parsed.hostname.endsWith('.linkedin.com') && parsed.hostname !== 'linkedin.com') {
        return { ok: false, detail: 'navigate_blocked_non_linkedin' }
      }
    } catch(e) { return { ok: false, detail: 'invalid_url' } }
    // For SDUI apply URLs, use History API (client-side SPA navigation) instead
    // of window.location.href (server-side navigation). LinkedIn's server redirects
    // /apply/ back to /jobs/view/, but the client-side router opens the SDUI modal.
    if (url.includes('openSDUIApplyFlow')) {
      try {
        var target = new URL(url)
        console.log('[LOA] FORCE_NAVIGATE SPA: pushState', target.pathname + target.search)
        window.history.pushState({}, '', target.pathname + target.search)
        window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
        return { ok: true, detail: 'force_navigated_spa' }
      } catch(e) {
        console.warn('[LOA] FORCE_NAVIGATE SPA failed:', e?.message || e)
        // Fall through to full navigation
      }
    }
    window.location.href = url
    return { ok: true, detail: 'force_navigated' }
  },
  EXPAND_REPEATABLE_CARDS: function() { return expandEasyApplyRepeatableCards() },
  EXTRACT_FORM_FIELDS: function() { return extractApplicationFields() },
  FILL_APPLICATION_FIELD: function(p) { return fillApplicationField(p) },
  UPLOAD_RESUME_FILE: function(p) { return uploadResumeFile(p) },
  UPLOAD_EASY_APPLY_FILE: function(p) { return uploadEasyApplyFile(p) },
  SUBMIT_APPLICATION: function() { return submitApplicationStep() },
  CHECK_SUCCESS_SCREEN: function() { return checkSuccessScreen() },
  DISMISS_EASY_APPLY: function() { return dismissEasyApplyModal() },
  DIAGNOSE_EASY_APPLY: function() { return diagnoseEasyApply() },
  EXTRACT_EXTERNAL_FORM_FIELDS: function() { return extractExternalFormFields() },
  FILL_EXTERNAL_FORM_FIELD: function(p) { return fillExternalFormField(p) },
  SAVE_FORM_ANSWERS: function() { return saveFormAnswers() },
  AUTO_FILL_FROM_MEMORY: function() { return autoFillFromMemory() },
  BROWSE_AROUND: function(p) {
    var durationMs = Math.max(3000, Math.min(30000, Number(p.durationMs) || 10000))
    return simulateIdleBrowsing(durationMs).then(function() {
      return { ok: true, detail: 'browsed_' + durationMs + 'ms' }
    })
  },
  SCROLL_PAGE: function(p) {
    var amount = Number(p.amount) || 300
    var direction = String(p.direction || 'down')
    var scrollY = direction === 'up' ? -Math.abs(amount) : Math.abs(amount)
    window.scrollBy({ top: scrollY, behavior: 'smooth' })
    return { ok: true, detail: 'scrolled_' + direction + '_' + Math.abs(amount) }
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function sanitizePayloadValue(value, depth = 0) {
  if (depth > 5) return null
  if (value == null) return null
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 120).map((entry) => sanitizePayloadValue(entry, depth + 1))
  if (!isPlainObject(value)) return null
  const out = {}
  for (const key of Object.keys(value)) {
    if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    out[key] = sanitizePayloadValue(value[key], depth + 1)
  }
  return out
}

function coerceMessagePayload(payload) {
  if (!isPlainObject(payload)) return {}
  return sanitizePayloadValue(payload) || {}
}

function normalizeBridgeMessage(msg, sender) {
  if (!msg || typeof msg !== 'object') return { ok: false, reason: 'invalid_message' }
  const extId = typeof chrome.runtime?.id === 'string' ? chrome.runtime.id : ''
  if (extId && sender && sender.id !== extId) return { ok: false, reason: 'invalid_sender' }
  const rawAction = msg.action
  const action = typeof rawAction === 'string' && rawAction ? rawAction : null
  if (!action || !Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
    return { ok: false, reason: 'unknown_action', action: action || String(rawAction) }
  }
  return { ok: true, action, payload: coerceMessagePayload(msg.payload) }
}

function loaShouldSkipBridgeForHost() {
  try {
    const h = String(window.location?.hostname || '').toLowerCase()
    const path = String(window.location?.pathname || '').toLowerCase()
    if (h.includes('hcaptcha')) return true
    if ((h.includes('google.com') || h.endsWith('recaptcha.net')) && path.includes('recaptcha')) return true
    if (h.includes('recaptcha')) return true
    if (h === 'www.youtube.com' || h === 'youtube.com' || h === 'm.youtube.com' || h === 'youtu.be')
      return true
    if (h.includes('teams.microsoft.com')) return true
    if (h === 'www.amazon.com' || h === 'amazon.com') {
      const path = String(window.location?.pathname || '').toLowerCase()
      if (path.startsWith('/dp/') || path.startsWith('/gp/') || path.includes('/cart')) return true
    }
  } catch {
    /* ignore */
  }
  return false
}

if (_lrDormant) {
  /* dormant listener already registered in content-utils.js */
} else chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (loaShouldSkipBridgeForHost()) {
    sendResponse({ ok: false, detail: 'loa_render_excluded_host' })
    return false
  }
  ;(async () => {
    var _action = ''
    try {
      const norm = normalizeBridgeMessage(msg, sender)
      if (!norm.ok) {
        const detail =
          norm.reason === 'unknown_action' ? `unknown_action:${norm.action || ''}` : `bridge_msg:${norm.reason}`
        sendResponse({ ok: false, detail })
        return
      }
      _action = norm.action
      const handler = ACTIONS[norm.action]
      sendResponse(await handler(norm.payload))
    } catch (e) {
      if (e instanceof ReferenceError) {
        console.error('[LinkinReachly] content script stale — function missing:', e.message)
        sendResponse({ ok: false, detail: 'content_script_stale:' + _action, stale: true })
      } else {
        sendResponse({ ok: false, detail: String(e?.message || e) })
      }
    }
  })()
  return true
})

if (!_lrDormant) {
  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.__loaContentTestHooks = {
        normalizeBridgeMessage,
        clickEasyApply,
        extractProfile,
        extractJobDetails,
        extractJobListings,
        easyApplyModalRoot,
        collectApplicationFields,
        ACTIONS: () => Object.freeze({ ...ACTIONS })
      }
      globalThis.clickEasyApply = clickEasyApply
    }
  } catch {
    /* ignore */
  }

  // Auto-fill from memory on known ATS domains
  ;(function() {
    try {
      var host = String(window.location.hostname || '').toLowerCase()
      var isLinkedIn = host === 'linkedin.com' || host.endsWith('.linkedin.com')
      if (isLinkedIn) return
      var atsHosts = [
        'greenhouse.io', 'lever.co', 'myworkdayjobs.com', 'myworkdaysite.com',
        'ashbyhq.com', 'smartrecruiters.com', 'smrtr.io', 'icims.com',
        'workable.com', 'jobvite.com', 'applytojob.com', 'jazzhr.com',
        'recruitee.com', 'bamboohr.com', 'breezy.hr', 'teamtailor.com',
        'phenom.com', 'phenompeople.com', 'homerun.hr', 'homerun.co',
        'eightfold.ai', 'taleo.net', 'brassring.com', 'successfactors.com',
        'dayforcehcm.com', 'dayforce.com', 'ultipro.com', 'paylocity.com',
        'rippling.com', 'adp.com', 'comeet.co', 'comeet.com',
        'avature.net', 'jobscore.com', 'freshteam.com', 'polymer.co',
        'indeed.com', 'trinethire.com', 'tal.net', 'oraclecloud.com',
        'amazon.jobs', 'metacareers.com', 'facebookcareers.com',
        'joinhandshake.com', 'welcometothejungle.com'
      ]
      var isATS = atsHosts.some(function(d) { return host.includes(d) }) ||
                  host === 'jobs.apple.com' || host === 'careers.google.com' ||
                  host === 'jobs.netflix.com' || host === 'careers.ibm.com' ||
                  host === 'jobs.bytedance.com'
      if (!isATS) return
      setTimeout(function() {
        try {
          var forms = document.querySelectorAll('form')
          if (forms.length === 0) return
          autoFillFromMemory().then(function(result) {
            if (result && result.data && result.data.filled > 0) {
              console.info('[LinkinReachly] Auto-filled', result.data.filled, 'fields from memory')
            }
          }).catch(function() {})
        } catch { /* ignore */ }
      }, 2500)
    } catch { /* ignore */ }
  })()
}
