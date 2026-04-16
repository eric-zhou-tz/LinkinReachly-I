/* global chrome */
const DEFAULT_BRIDGE_PORT = 19511
const LOA_HTTP_PORT = 19512
/** Bump when service-worker bridge contract changes (must match app's EXPECTED_BACKGROUND_BRIDGE_VERSION). */
const BACKGROUND_BRIDGE_VERSION = 2

function buildBridgeUrl(port) {
  return `ws://127.0.0.1:${port}`
}

const STORAGE_ARMED = 'bridgeArmed'

/** Badge colors: green = go/live, amber = waiting for app, stop-sign red = user halted bridge. */
const BADGE = {
  on: { text: 'ON', bg: '#2E3FCC' },
  /** Armed: waiting for desktop app (not the same as STOP). */
  wait: { text: 'WAIT', bg: '#B54708' },
  /** Paused: like a street STOP — bridge disconnected by user. */
  stop: { text: 'STOP', bg: '#BE1E2D' },
}

/** @type {WebSocket | null} */
let ws = null
/** User wants the bridge active (click icon to toggle). Default: armed. */
let bridgeArmed = true
let currentBridgePort = DEFAULT_BRIDGE_PORT
let reconnectPortOverride = null

const CONTENT_SCRIPT_FILES = ['content-utils.js', 'content-connect.js', 'content-apply.js', 'content.js']

/** Cache content script version per tab to avoid checking on every command. */
const tabVersionCache = new Map()
/** Any finite positive content version means the script is present and bridge-capable. */
const MIN_BRIDGEABLE_CONTENT_VERSION = 1

function isLinkedInHost(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase()
  return normalized === 'linkedin.com' || normalized.endsWith('.linkedin.com')
}

function isLinkedInUrl(url) {
  try {
    const parsed = new URL(String(url || ''))
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && isLinkedInHost(parsed.hostname)
  } catch {
    return false
  }
}

function isHttpsUrl(url) {
  try {
    return new URL(String(url || '')).protocol === 'https:'
  } catch {
    return false
  }
}

async function ensureContentScriptOnTab(tabId) {
  if (tabVersionCache.get(tabId) >= MIN_BRIDGEABLE_CONTENT_VERSION) return

  let needsInject = false
  try {
    const version = await readContentScriptVersion(tabId)
    if (version < MIN_BRIDGEABLE_CONTENT_VERSION) needsInject = true
    else tabVersionCache.set(tabId, version)
  } catch {
    needsInject = true
  }
  if (needsInject) {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES })
    const ready = await waitForContentScriptReady(tabId, 12_000)
    if (!ready) {
      console.warn('[LinkinReachly] first inject attempt timed out, retrying once')
      await new Promise(r => setTimeout(r, 2000))
      await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES })
      const retryReady = await waitForContentScriptReady(tabId, 8_000)
      if (!retryReady) throw new Error('content_script_timeout')
    }
  }
}

function looksLikeHostPermissionError(err) {
  const msg = String(err?.message || err || '').toLowerCase()
  return (
    msg.includes('cannot access contents of the page') ||
    msg.includes('host permission') ||
    msg.includes('missing host permission') ||
    msg.includes('cannot be scripted')
  )
}

function bridgeSend(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj))
}

const TITLE_OFF_LINKEDIN =
  'LinkinReachly — Open a LinkedIn tab to see ON / WAIT / STOP on the icon (this tab is not LinkedIn).'

function applyBadgeForTab(tabId, spec, title) {
  chrome.action.setBadgeText({ tabId, text: spec.text })
  chrome.action.setBadgeBackgroundColor({ tabId, color: spec.bg })
  try {
    chrome.action.setBadgeTextColor({ tabId, color: '#FFFFFF' })
  } catch {
    /* Chrome 110+ */
  }
  chrome.action.setTitle({ tabId, title })
}

function clearBadgeForTab(tabId) {
  chrome.action.setBadgeText({ tabId, text: '' })
  chrome.action.setTitle({ tabId, title: TITLE_OFF_LINKEDIN })
}

/* ─── Icon flash animation (Lightning Flash — runs only in ON state) ─── */
let flashIntervalId = null
const FLASH_PERIOD_MS = 4000
const FLASH_DURATION_MS = 180

function drawChainIcon(size, yOffset) {
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const s = size
  const r = Math.round(s * 0.3)
  ctx.beginPath()
  ctx.roundRect(0, 0, s, s, r)
  ctx.fillStyle = '#E8192C'
  ctx.fill()
  // Clip to rounded rect so shifted content doesn't bleed
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(0, 0, s, s, r)
  ctx.clip()
  // Apply vertical offset for micro-slide animation
  ctx.translate(0, yOffset)
  const PHI = 1.618
  const lr = s * 0.25
  const dist = lr * (PHI - 0.4) / 2
  const ang = 30 * Math.PI / 180
  const dx = dist * Math.cos(ang)
  const dy = dist * Math.sin(ang)
  const sw = Math.max(2, lr / PHI / PHI)
  const lx = s * 0.5 - dx, ly = s * 0.5 + dy
  const rx = s * 0.5 + dx, ry = s * 0.5 - dy
  // Shadow layers
  const offsets = [[s*.06,'rgba(30,0,2,0.4)'],[s*.03,'rgba(100,8,12,0.3)'],[s*.01,'rgba(140,12,20,0.2)']]
  offsets.forEach(([off, color]) => {
    ctx.strokeStyle = color; ctx.lineWidth = sw
    ctx.beginPath(); ctx.arc(lx + off, ly + off, lr, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.arc(rx + off, ry + off, lr, 0, Math.PI * 2); ctx.stroke()
  })
  ctx.strokeStyle = 'white'
  ctx.lineWidth = sw
  ctx.beginPath(); ctx.arc(lx, ly, lr, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.arc(rx, ry, lr, 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.lineWidth = Math.max(1, s * 0.02)
  ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(s * 0.18, s * 0.82); ctx.lineTo(s * 0.82, s * 0.18); ctx.stroke()
  ctx.restore()
  return ctx.getImageData(0, 0, s, s)
}

function setAnimatedIcon(yOffset) {
  const imageData = {
    16: drawChainIcon(16, yOffset * 1.5),
    32: drawChainIcon(32, yOffset * 2),
  }
  chrome.action.setIcon({ imageData }).catch((e) => console.warn('[LinkinReachly]', e?.message || e))
}

let animFrame = 0
const ANIM_INTERVAL_MS = 50  // 20fps
const SLIDE_PERIOD_MS = 1500
const SLIDE_AMPLITUDE = 1.5  // pixels at 16px

function startIconFlash() {
  if (flashIntervalId) return
  animFrame = 0
  flashIntervalId = setInterval(() => {
    animFrame += ANIM_INTERVAL_MS
    const phase = (animFrame % SLIDE_PERIOD_MS) / SLIDE_PERIOD_MS
    const yOffset = Math.sin(phase * Math.PI * 2) * SLIDE_AMPLITUDE
    setAnimatedIcon(yOffset)
  }, ANIM_INTERVAL_MS)
}

function stopIconFlash() {
  if (flashIntervalId) {
    clearInterval(flashIntervalId)
    flashIntervalId = null
  }
  chrome.action.setIcon({ path: { 16: 'icons/icon16.png', 32: 'icons/icon32.png' } }).catch((e) => console.warn('[LinkinReachly]', e?.message || e))
}

/**
 * Badge is tab-specific: ON / WAIT / STOP only on the active tab when it is linkedin.com.
 * Other tabs show no badge so the extension does not look "on" everywhere.
 */
async function refreshToolbarBadge() {
  const tab = await getActiveTab()
  if (tab?.id == null) {
    chrome.action.setBadgeText({ text: '' })
    return
  }
  const tabId = tab.id
  if (!isLinkedInUrl(tab.url)) {
    clearBadgeForTab(tabId)
    return
  }
  if (!bridgeArmed) {
    applyBadgeForTab(
      tabId,
      BADGE.stop,
      'LinkinReachly — STOP: bridge is off (like a stop sign). Click the icon to go ON and connect to the desktop app.',
    )
    startIconFlash()
    return
  }
  const connected = ws !== null && ws.readyState === 1
  if (connected) {
    applyBadgeForTab(
      tabId,
      BADGE.on,
      'LinkinReachly — ON: linked to the desktop app. Click icon for STOP (disconnect).',
    )
  } else {
    applyBadgeForTab(
      tabId,
      BADGE.wait,
      'LinkinReachly — WAIT: start the desktop app to connect. Click icon for STOP (pause bridge).',
    )
  }
  startIconFlash()
}

function sendResult(id, ok, detail, data) {
  bridgeSend({ type: 'result', id, ok, detail: String(detail || ''), data })
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return tabs[0] || null
}

async function getActiveLinkedInTab() {
  try {
    const tab = await getActiveTab()
    if (tab?.id != null && isLinkedInUrl(tab.url)) return tab
  } catch {
    /* ignore */
  }
  try {
    const linkedInTabs = await chrome.tabs.query({ url: ['*://*.linkedin.com/*', '*://linkedin.com/*'] })
    if (linkedInTabs.length > 0) return linkedInTabs[0]
  } catch {
    /* ignore */
  }
  return null
}

async function activeTabSnapshot() {
  const tab = await getActiveLinkedInTab()
  return {
    activeLinkedInTab: !!tab,
    tabId: tab?.id ?? null,
    tabUrl: String(tab?.url || '')
  }
}

async function sendBridgeReadySnapshot() {
  if (!ws || ws.readyState !== 1) return
  try {
    const snapshot = await activeTabSnapshot()
    bridgeSend({ type: 'bridge-ready', port: currentBridgePort, ...snapshot })
  } catch {
    /* ignore */
  }
}

function waitTabComplete(tabId) {
  return new Promise((resolve) => {
    /** @param {number} id @param {chrome.tabs.TabChangeInfo} info */
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener)
        setTimeout(resolve, 1800)
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }, 45000)
  })
}

async function readContentScriptVersion(tabId) {
  try {
    const vRes = await chrome.tabs.sendMessage(tabId, { action: 'CONTENT_SCRIPT_VERSION' })
    const version = Number(vRes?.data?.version)
    return Number.isFinite(version) ? version : 0
  } catch {
    return 0
  }
}

async function waitForContentScriptReady(tabId, timeoutMs = 6000, pollMs = 200) {
  const deadline = Date.now() + Math.max(500, Number(timeoutMs) || 6000)
  while (Date.now() < deadline) {
    const version = await readContentScriptVersion(tabId)
    if (version >= MIN_BRIDGEABLE_CONTENT_VERSION) {
      tabVersionCache.set(tabId, version)
      return true
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  console.warn('[LinkinReachly] content script not ready after', timeoutMs, 'ms on tab', tabId)
  return false
}

async function handleCommand(msg) {
  const id = msg.id
  const action = msg.action
  const payload = msg.payload || {}

  try {
    if (action === 'RELOAD_EXTENSION') {
      sendResult(id, true, 'reloading')
      setTimeout(() => chrome.runtime.reload(), 200)
      return
    }
    if (action === 'RELOAD_TAB') {
      const tab = await getActiveLinkedInTab()
      if (!tab) { sendResult(id, false, 'no_linkedin_tab'); return }
      await chrome.tabs.reload(tab.id, { bypassCache: true })
      sendResult(id, true, 'tab_reloaded')
      return
    }
    if (action === 'PING') {
      const activeLinkedInTab = await getActiveLinkedInTab()
      if (!activeLinkedInTab) {
        sendResult(id, false, 'open_a_linkedin_tab')
        return
      }
      sendResult(id, true, 'pong_bridge', {
        tabId: activeLinkedInTab.id ?? null,
        tabUrl: String(activeLinkedInTab.url || ''),
        backgroundBridgeVersion: BACKGROUND_BRIDGE_VERSION
      })
      return
    }

    if (action === 'NAVIGATE') {
      const url = String(payload.url || '').trim()
      const externalApply = payload.externalApply === true

      if (externalApply && isHttpsUrl(url)) {
        const linkedProof = await getActiveLinkedInTab()
        if (!linkedProof?.id) {
          sendResult(id, false, 'open_a_linkedin_tab')
          return
        }
        try {
          // Validate URL shape (new URL throws).
          // eslint-disable-next-line no-new
          new URL(url)
        } catch {
          sendResult(id, false, 'invalid_url')
          return
        }
        if (!isLinkedInUrl(url)) {
          const created = await chrome.tabs.create({ url, active: true })
          if (!created?.id) {
            sendResult(id, false, 'tab_create_failed')
            return
          }
          await waitTabComplete(created.id)
          try {
            await ensureContentScriptOnTab(created.id)
          } catch (e) {
            if (looksLikeHostPermissionError(e)) {
              sendResult(id, true, 'navigated_external_no_host_permission', {
                tabId: created.id,
                injectError: String(e?.message || e)
              })
              return
            }
            sendResult(id, true, 'navigated_external_no_script', {
              tabId: created.id,
              injectError: String(e?.message || e)
            })
            return
          }
          sendResult(id, true, 'navigated_external', { tabId: created.id })
          return
        }
        const tabId = linkedProof.id
        await chrome.tabs.update(tabId, { url })
        await waitTabComplete(tabId)
        tabVersionCache.delete(tabId)
        const updatedTab = await chrome.tabs.get(tabId)
        if (!isLinkedInUrl(updatedTab.url)) {
          sendResult(id, false, 'open_a_linkedin_tab')
          return
        }
        try {
          await ensureContentScriptOnTab(tabId)
        } catch (csErr) {
          sendResult(id, false, `navigate_content_script_failed: ${csErr?.message || csErr}`)
          return
        }
        sendResult(id, true, 'navigated', { tabId })
        return
      }

      const tab = await getActiveLinkedInTab()
      if (!tab?.id) {
        sendResult(id, false, 'open_a_linkedin_tab')
        return
      }
      if (!isLinkedInUrl(url)) {
        sendResult(id, false, 'invalid_linkedin_url')
        return
      }
      const tabId = tab.id
      await chrome.tabs.update(tabId, { url })
      await waitTabComplete(tabId)
      // Navigation destroyed the old content script — invalidate cache
      // and ensure the new page's content script is ready before returning.
      tabVersionCache.delete(tabId)
      const updatedTab = await chrome.tabs.get(tabId)
      if (!isLinkedInUrl(updatedTab.url)) {
        sendResult(id, false, 'open_a_linkedin_tab')
        return
      }
      try {
        await ensureContentScriptOnTab(tabId)
      } catch (csErr) {
        sendResult(id, false, `navigate_content_script_failed: ${csErr?.message || csErr}`)
        return
      }
      sendResult(id, true, 'navigated', { tabId })
      return
    }

    // --- CDP Relay commands (chrome.debugger-based) ---

    if (action === 'CDP_ATTACH') {
      const targetTabId = Number(payload.tabId)
      if (!Number.isFinite(targetTabId)) {
        sendResult(id, false, 'missing_tabId')
        return
      }
      try {
        const result = await cdpAttachTab(targetTabId)
        sendResult(id, true, 'cdp_attached', result)
      } catch (e) {
        sendResult(id, false, `cdp_attach_error:${e?.message || e}`)
      }
      return
    }

    if (action === 'CDP_DETACH') {
      const targetTabId = Number(payload.tabId)
      if (!Number.isFinite(targetTabId)) {
        sendResult(id, false, 'missing_tabId')
        return
      }
      try {
        await cdpDetachTab(targetTabId)
        sendResult(id, true, 'cdp_detached')
      } catch (e) {
        sendResult(id, false, `cdp_detach_error:${e?.message || e}`)
      }
      return
    }

    if (action === 'CDP_COMMAND') {
      const targetTabId = Number(payload.tabId)
      const method = String(payload.method || '')
      const params = payload.params || {}
      if (!Number.isFinite(targetTabId) || !method) {
        sendResult(id, false, 'missing_tabId_or_method')
        return
      }
      if (!cdpAttachedTabs.has(targetTabId)) {
        sendResult(id, false, 'tab_not_attached')
        return
      }
      if (!CDP_RELAY_ALLOWED_METHODS.has(method)) {
        sendResult(id, false, `cdp_method_not_allowed:${method}`)
        return
      }
      if (method === 'Page.navigate' && params.url) {
        try {
          const navUrl = new URL(String(params.url))
          if (navUrl.protocol !== 'https:' && navUrl.protocol !== 'http:') {
            sendResult(id, false, 'cdp_navigate_blocked_scheme')
            return
          }
        } catch {
          sendResult(id, false, 'cdp_navigate_invalid_url')
          return
        }
      }
      try {
        const result = await cdpSendCommand(targetTabId, method, params)
        sendResult(id, true, 'cdp_result', { result })
      } catch (e) {
        sendResult(id, false, `cdp_error:${e?.message || e}`)
      }
      return
    }

    if (action === 'CDP_STATUS') {
      const attached = []
      for (const [tabId, info] of cdpAttachedTabs.entries()) {
        attached.push({ tabId, ...info })
      }
      sendResult(id, true, 'cdp_status', { attached })
      return
    }

    if (action === 'EXTRACT_EXTERNAL_FORM_FIELDS' || action === 'FILL_EXTERNAL_FORM_FIELD') {
      const targetTabId = payload.tabId ? Number(payload.tabId) : null
      const frameId = typeof payload.frameId === 'number' ? payload.frameId : 0
      let extTab
      if (targetTabId) {
        extTab = await chrome.tabs.get(targetTabId)
      } else {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
        extTab = activeTab
      }
      if (!extTab?.id) {
        sendResult(id, false, 'no_active_tab')
        return
      }
      try {
        await chrome.scripting.executeScript({ target: { tabId: extTab.id, frameIds: [frameId] }, files: CONTENT_SCRIPT_FILES })
        await waitForContentScriptReady(extTab.id, 8000)
      } catch {
        // May already be injected via manifest — continue
      }
      const res = await chrome.tabs.sendMessage(extTab.id, { action, payload }, { frameId })
      if (!res) {
        sendResult(id, false, 'no_content_response')
        return
      }
      sendResult(id, !!res.ok, res.detail || '', res.data)
      return
    }

    const tab = await getActiveLinkedInTab()
    if (!tab?.id) {
      sendResult(id, false, 'open_a_linkedin_tab')
      return
    }
    if (!isLinkedInUrl(tab.url)) {
      sendResult(id, false, 'open_a_linkedin_tab')
      return
    }

    const tabId = tab.id

    // Force live check — don't trust cache for commands.
    tabVersionCache.delete(tabId)
    await ensureContentScriptOnTab(tabId)

    let res = await chrome.tabs.sendMessage(tabId, { action, payload })
    // Content script reports a stale reference — re-inject scripts and retry once
    if (res && res.stale) {
      console.warn('[LinkinReachly] content script stale for', action, '— re-injecting')
      tabVersionCache.delete(tabId)
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES })
        await waitForContentScriptReady(tabId, 6000)
        res = await chrome.tabs.sendMessage(tabId, { action, payload })
      } catch (reinjectErr) {
        console.error('[LinkinReachly] re-inject failed:', reinjectErr?.message || reinjectErr)
        // Fall through with original stale response
      }
    }
    if (!res) {
      sendResult(id, false, 'no_content_response')
      return
    }
    sendResult(id, !!res.ok, res.detail || '', res.data)
  } catch (e) {
    sendResult(id, false, String(e?.message || e))
  }
}

function stopWsAndTimers() {
  try {
    chrome.alarms.clear(RECONNECT_ALARM).catch((e) => console.warn('[LinkinReachly]', e?.message || e))
  } catch { /* ignore */ }
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  ws = null
}

async function connectWs() {
  if (!bridgeArmed) return

  if (ws) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      void refreshToolbarBadge()
      return
    }
    try {
      ws.close()
    } catch {
      /* ignore */
    }
    ws = null
  }

  void refreshToolbarBadge()

  let bridgeToken = ''
  try {
    const tokenRes = await fetch(`http://127.0.0.1:${LOA_HTTP_PORT}/bridge-token`)
    if (!tokenRes.ok) throw new Error(`bridge_token_http_${tokenRes.status}`)
    const tokenJson = await tokenRes.json()
    bridgeToken = String(tokenJson?.token || '').trim()
  } catch {
    scheduleReconnect()
    return
  }
  if (!bridgeToken) {
    scheduleReconnect()
    return
  }

  try {
    ws = new WebSocket(buildBridgeUrl(currentBridgePort))
  } catch {
    scheduleReconnect()
    return
  }

  ws.onopen = () => {
    reconnectAttempts = 0
    void refreshToolbarBadge()
    try {
      ws.send(JSON.stringify({ type: 'auth', token: bridgeToken }))
    } catch {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      ws = null
      scheduleReconnect()
    }
  }

  ws.onmessage = async (ev) => {
    let msg
    try {
      msg = JSON.parse(String(ev.data || '{}'))
    } catch {
      return
    }
    if (msg.type === 'hello') {
      const redirectPort = Number(msg.redirectPort || 0)
      if (redirectPort && redirectPort !== currentBridgePort) {
        reconnectPortOverride = redirectPort
        try {
          ws?.close()
        } catch {
          /* ignore */
        }
        return
      }
      chrome.storage.local.set({ bridgeConnected: true }).catch((e) => console.warn('[LinkinReachly]', e?.message || e))
      void sendBridgeReadySnapshot()
      void refreshToolbarBadge()
      // Bridge just connected — proactively inject into all LinkedIn tabs
      // so content scripts are ready before the first command arrives.
      void injectAllLinkedInTabs()
      return
    }
    if (msg.type === 'reload') {
      if (!msg.confirmed) {
        console.warn('[LinkinReachly] Reload command ignored — missing confirmed flag')
        return
      }
      chrome.runtime.reload()
      return
    }
    if (msg.type === 'command') {
      await handleCommand(msg)
    }
  }

  ws.onclose = () => {
    const nextPort = reconnectPortOverride
    reconnectPortOverride = null
    chrome.storage.local.set({ bridgeConnected: false }).catch((e) => console.warn('[LinkinReachly]', e?.message || e))
    ws = null
    void refreshToolbarBadge()
    if (bridgeArmed && nextPort) {
      currentBridgePort = nextPort
      connectWs()
      return
    }
    currentBridgePort = DEFAULT_BRIDGE_PORT
    if (bridgeArmed) scheduleReconnect()
  }

  ws.onerror = () => {
    try {
      ws?.close()
    } catch {
      /* ignore */
    }
  }
}

const RECONNECT_ALARM = 'bridge-reconnect'
let reconnectAttempts = 0

function scheduleReconnect() {
  if (!bridgeArmed) return
  const backoff = Math.min(0.05 * Math.pow(2, reconnectAttempts), 1)
  reconnectAttempts = Math.min(reconnectAttempts + 1, 6)
  chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: backoff })
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) {
    if (bridgeArmed) connectWs()
  }
})

chrome.action.onClicked.addListener(async () => {
  bridgeArmed = !bridgeArmed
  await chrome.storage.local.set({ [STORAGE_ARMED]: bridgeArmed })
  if (bridgeArmed) {
    currentBridgePort = DEFAULT_BRIDGE_PORT
    connectWs()
  } else {
    stopWsAndTimers()
    await chrome.storage.local.set({ bridgeConnected: false }).catch((e) => console.warn('[LinkinReachly]', e?.message || e))
    void refreshToolbarBadge()
  }
})

/**
 * Proactively inject content scripts into ALL open LinkedIn tabs.
 * Called at extension lifecycle boundaries (install, startup, WS connect)
 * so content scripts are already alive before any command arrives.
 */
async function injectAllLinkedInTabs() {
  let tabs = []
  try {
    tabs = await chrome.tabs.query({ url: ['*://*.linkedin.com/*', '*://linkedin.com/*'] })
  } catch { return }
  const targets = tabs.filter(
    (t) => t.id && t.id !== chrome.tabs.TAB_ID_NONE &&
           !(tabVersionCache.get(t.id) >= MIN_BRIDGEABLE_CONTENT_VERSION)
  )
  if (targets.length === 0) return
  const results = await Promise.allSettled(
    targets.map((t) => ensureContentScriptOnTab(t.id))
  )
  const ok = results.filter((r) => r.status === 'fulfilled').length
  const failed = results.length - ok
  if (failed > 0) {
    console.warn(`[LinkinReachly] proactive inject: ${ok}/${results.length} tabs OK, ${failed} failed`)
  } else {
    console.info(`[LinkinReachly] proactive inject: ${ok} LinkedIn tab(s) ready`)
  }
}

async function init() {
  const stored = await chrome.storage.local.get(STORAGE_ARMED)
  bridgeArmed = stored[STORAGE_ARMED] !== false
  currentBridgePort = DEFAULT_BRIDGE_PORT
  try {
    chrome.action.setBadgeText({ text: '' })
  } catch {
    /* ignore */
  }
  void refreshToolbarBadge()
  if (bridgeArmed) {
    connectWs()
  }
}

void init()

// Proactively inject into existing LinkedIn tabs on install/update/startup.
// This is the root fix: without this, tabs open before the extension loads
// have no content script, and every command fails until a manual reload.
chrome.runtime.onInstalled.addListener(() => {
  void injectAllLinkedInTabs()
  chrome.contextMenus.create({
    id: 'linkinreachly-fill-form',
    title: 'Fill form with LinkinReachly',
    contexts: ['page', 'frame', 'editable']
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'linkinreachly-fill-form' || !tab?.id) return
  const tabId = tab.id
  const frameId = typeof info.frameId === 'number' ? info.frameId : 0
  const msgOpts = { frameId }
  try {
    try {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: CONTENT_SCRIPT_FILES })
    } catch {
      // May already be injected via manifest in this frame — continue
    }
    await waitForContentScriptReady(tabId, 8000)

    // Fill from memory first (previously answered questions)
    try {
      const memResult = await chrome.tabs.sendMessage(tabId, { action: 'AUTO_FILL_FROM_MEMORY', payload: {} }, msgOpts)
      if (memResult?.data?.filled > 0) {
        console.info(`[LinkinReachly] memory-filled ${memResult.data.filled} fields on ${tab.url} frame=${frameId}`)
      }
    } catch { /* no memory yet — continue */ }

    // Extract remaining empty fields and send to Electron for profile matching
    const result = await chrome.tabs.sendMessage(tabId, { action: 'EXTRACT_EXTERNAL_FORM_FIELDS', payload: {} }, msgOpts)
    if (result && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'external_form_request',
        tabId,
        frameId,
        url: tab.url || '',
        fields: result.data
      }))
    }

    // Save all field values after Electron fills remaining fields
    setTimeout(async () => {
      try {
        await chrome.tabs.sendMessage(tabId, { action: 'SAVE_FORM_ANSWERS', payload: {} }, msgOpts)
      } catch { /* tab may have navigated */ }
    }, 6000)
  } catch (e) {
    console.error('[LinkinReachly] context menu fill error:', e?.message || e)
  }
})
chrome.runtime.onStartup.addListener(() => {
  void injectAllLinkedInTabs()
})

const KEEPALIVE_ALARM = 'bridge-keepalive'
chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 })

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    if (bridgeArmed && ws && ws.readyState === 1) {
      void sendBridgeReadySnapshot()
    } else if (bridgeArmed && (!ws || ws.readyState !== 1)) {
      connectWs()
    }
  }
})

chrome.tabs.onActivated.addListener(() => {
  void sendBridgeReadySnapshot()
  void refreshToolbarBadge()
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url != null) {
    tabVersionCache.delete(tabId)
    void sendBridgeReadySnapshot()
    void refreshToolbarBadge()
    // Proactively inject when a LinkedIn tab finishes loading —
    // don't wait for the first command to discover it's missing.
    const url = changeInfo.url || tab?.url
    if (changeInfo.status === 'complete' && url && isLinkedInUrl(url)) {
      void ensureContentScriptOnTab(tabId).catch((e) => console.warn('[LinkinReachly]', e?.message || e))
    }
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  tabVersionCache.delete(tabId)
})

if (chrome.windows && chrome.windows.onFocusChanged) {
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return
    void sendBridgeReadySnapshot()
    void refreshToolbarBadge()
  })
}

// ---------------------------------------------------------------------------
// CDP Relay — chrome.debugger-based CDP bridge for external ATS fills
// ---------------------------------------------------------------------------

/**
 * Allowlist for `CDP_COMMAND` → `chrome.debugger.sendCommand`.
 * Must match every `relayCdpCommand('Domain.method', …)` in
 * `src/main/cdp-browser.ts` (and any future main-process callers).
 * Internal attach path uses `Page.enable` / `Target.getTargetInfo` in
 * `cdpAttachTab` only — not routed through `CDP_COMMAND`.
 * @type {ReadonlySet<string>}
 */
const CDP_RELAY_ALLOWED_METHODS = new Set([
  'Page.navigate',
  'Input.dispatchMouseEvent',
  'Runtime.evaluate'
])

/** @type {Map<number, {sessionId:string, targetId:string}>} */
const cdpAttachedTabs = new Map()
/** @type {Set<number>} */
const cdpReattachPending = new Set()
let cdpNextSession = 1
let cdpOpSeq = 0
function cdpOpId() { return `cdp-${++cdpOpSeq}` }

async function cdpAttachTab(tabId) {
  const op = cdpOpId()
  console.info(`[${op}] attach tab=${tabId}`)
  try {
    await chrome.debugger.attach({ tabId }, '1.3')
  } catch (e) {
    console.warn(`[${op}] attach FAIL tab=${tabId}: ${e.message || e}`)
    throw new Error(`debugger_attach_failed: ${e.message || e}`)
  }
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable')
  } catch { /* best effort */ }

  const sessionId = `cdp-relay-${cdpNextSession++}`
  let targetId = ''
  try {
    const info = await chrome.debugger.sendCommand({ tabId }, 'Target.getTargetInfo')
    targetId = String(info?.targetInfo?.targetId || tabId)
  } catch {
    targetId = String(tabId)
  }

  cdpAttachedTabs.set(tabId, { sessionId, targetId })
  console.info(`[${op}] attach OK tab=${tabId} session=${sessionId}`)
  return { sessionId, targetId, tabId }
}

async function cdpDetachTab(tabId) {
  const op = cdpOpId()
  console.info(`[${op}] detach tab=${tabId}`)
  cdpAttachedTabs.delete(tabId)
  cdpReattachPending.delete(tabId)
  try {
    await chrome.debugger.detach({ tabId })
    console.info(`[${op}] detach OK tab=${tabId}`)
  } catch (e) {
    console.info(`[${op}] detach already-detached tab=${tabId}: ${e?.message || e}`)
  }
}

async function cdpSendCommand(tabId, method, params) {
  const op = cdpOpId()
  try {
    const result = await Promise.race([
      chrome.debugger.sendCommand({ tabId }, method, params || {}),
      new Promise((_, reject) => setTimeout(() => reject(new Error('cdp_timeout')), 4000))
    ])
    console.info(`[${op}] command OK tab=${tabId} method=${method}`)
    return result
  } catch (e) {
    console.warn(`[${op}] command FAIL tab=${tabId} method=${method}: ${e.message || e}`)
    throw new Error(`cdp_command_failed: ${method} — ${e.message || e}`)
  }
}

chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId
  if (!tabId || !cdpAttachedTabs.has(tabId)) return
  const op = cdpOpId()
  console.info(`[${op}] onDetach tab=${tabId} reason=${reason}`)

  if (reason === 'canceled_by_user' || reason === 'replaced_with_devtools') {
    cdpAttachedTabs.delete(tabId)
    return
  }

  cdpReattachPending.add(tabId)
  const delays = [400, 800, 1500]
  ;(async () => {
    for (let i = 0; i < delays.length; i++) {
      await new Promise((r) => setTimeout(r, delays[i]))
      if (!cdpReattachPending.has(tabId)) return
      try {
        await chrome.tabs.get(tabId)
      } catch {
        console.info(`[${op}] reattach ABORT tab=${tabId} tab-gone`)
        cdpReattachPending.delete(tabId)
        cdpAttachedTabs.delete(tabId)
        return
      }
      try {
        await cdpAttachTab(tabId)
        cdpReattachPending.delete(tabId)
        console.info(`[${op}] reattach OK tab=${tabId} attempt=${i + 1}`)
        return
      } catch { /* retry */ }
    }
    console.warn(`[${op}] reattach EXHAUSTED tab=${tabId}`)
    cdpReattachPending.delete(tabId)
    cdpAttachedTabs.delete(tabId)
  })()
})

const CDP_RELAY_ALLOWED_EVENTS = new Set([
  'Page.frameNavigated',
  'Page.loadEventFired',
  'Page.domContentEventFired'
])

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId
  if (!tabId || !cdpAttachedTabs.has(tabId)) return
  if (!CDP_RELAY_ALLOWED_EVENTS.has(method)) return
  if (ws && ws.readyState === 1) {
    const tab = cdpAttachedTabs.get(tabId)
    try {
      ws.send(JSON.stringify({
        type: 'cdp_event',
        tabId,
        sessionId: tab?.sessionId,
        method,
        params
      }))
    } catch { /* relay may be down */ }
  }
})

// ---------------------------------------------------------------------------
// Content-script → background trusted CDP click
// ---------------------------------------------------------------------------
// Content scripts cannot produce isTrusted:true click events. For LinkedIn
// SDUI Easy Apply <a> tags, we need a trusted click to trigger LinkedIn's SPA
// handler (which opens the modal). The content script sends the button's
// viewport coordinates; the background script uses chrome.debugger to dispatch
// a real Input.dispatchMouseEvent (trusted) at those coordinates.

chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (msg?.type === 'ENRICH_PROGRESS') {
    bridgeSend({ type: 'enrich_progress', completed: msg.completed, total: msg.total })
    return false
  }
  return false
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.action !== 'CDP_TRUSTED_CLICK') return false
  const tabId = sender.tab?.id
  if (!tabId) { sendResponse({ ok: false, error: 'no_tab_id' }); return false }
  const { x, y } = msg
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    sendResponse({ ok: false, error: 'invalid_coordinates' })
    return false
  }
  const op = cdpOpId()
  console.info(`[${op}] trusted-click START tab=${tabId} x=${x} y=${y} selector=${msg.selector || 'none'}`)
  ;(async () => {
    try {
      const relocateSelector = msg.selector || null
      const expectedText = (msg.expectedText || '').toLowerCase()
      if (!relocateSelector) {
        console.warn(`[${op}] trusted-click REJECT no-selector tab=${tabId}`)
        sendResponse({ ok: false, error: 'selector_required' })
        return
      }
      await chrome.debugger.attach({ tabId }, '1.3')
      await new Promise(r => setTimeout(r, 300))
      let cx = x, cy = y
      try {
        const relocateExpr = `(() => {
          const el = document.querySelector(${JSON.stringify(relocateSelector)});
          if (!el) return JSON.stringify({ok:false, reason:'selector_not_found'});
          const text = (el.textContent || '').trim().toLowerCase() + ' ' + (el.getAttribute('aria-label') || '').toLowerCase();
          const r = el.getBoundingClientRect();
          return JSON.stringify({ok:true, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), text: text.slice(0, 200)});
        })()`
        const locResult = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
          expression: relocateExpr,
          returnByValue: true
        })
        const loc = JSON.parse(locResult?.result?.value || '{}')
        if (!loc.ok) {
          console.warn(`[${op}] trusted-click relocate FAIL tab=${tabId}: ${loc.reason || 'unknown'}`)
          await chrome.debugger.detach({ tabId })
          sendResponse({ ok: false, error: `relocate_failed:${loc.reason || 'unknown'}` })
          return
        }
        if (expectedText && loc.text && !loc.text.includes(expectedText)) {
          console.warn(`[${op}] trusted-click identity MISMATCH tab=${tabId}: got="${loc.text?.slice(0, 60)}" want="${expectedText}"`)
          await chrome.debugger.detach({ tabId })
          sendResponse({ ok: false, error: 'identity_mismatch', detail: `expected "${expectedText}" in element text` })
          return
        }
        console.info(`[${op}] trusted-click relocate OK tab=${tabId} (${x},${y})->(${loc.x},${loc.y})`)
        cx = loc.x
        cy = loc.y
      } catch (relocErr) {
        console.warn(`[${op}] trusted-click relocate ERROR tab=${tabId}: ${relocErr?.message || relocErr}`)
        await chrome.debugger.detach({ tabId }).catch((e) => console.warn('[LinkinReachly]', e?.message || e))
        sendResponse({ ok: false, error: `relocate_error:${relocErr?.message || relocErr}` })
        return
      }
      // Mouse approach: move to nearby offset then to target (triggers
      // pointermove/mousemove/mouseenter/mouseover which LinkedIn's SPA handler
      // needs to set up internal state before accepting the click)
      const offX = cx - 40 - Math.round(Math.random() * 30)
      const offY = cy - 25 - Math.round(Math.random() * 20)
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: offX, y: offY
      })
      await new Promise(r => setTimeout(r, 60 + Math.random() * 80))
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: cx, y: cy, button: 'none', buttons: 0
      })
      // Hover dwell before click (150-350ms)
      await new Promise(r => setTimeout(r, 150 + Math.random() * 200))
      // buttons bitmask: 1=left pressed — LinkedIn checks event.buttons
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1
      })
      await new Promise(r => setTimeout(r, 60 + Math.random() * 80))
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1
      })
      await new Promise(r => setTimeout(r, 2000))
      await chrome.debugger.detach({ tabId })
      console.info(`[${op}] trusted-click OK tab=${tabId} coords=(${cx},${cy})`)
      sendResponse({ ok: true, coords: { x: cx, y: cy } })
    } catch (e) {
      console.warn(`[${op}] trusted-click FAIL tab=${tabId}: ${e?.message || e}`)
      try { await chrome.debugger.detach({ tabId }) } catch { /* ignore */ }
      sendResponse({ ok: false, error: e?.message || String(e) })
    }
  })()
  return true // async sendResponse
})

// CDP_TRUSTED_ENTER: dispatch a trusted Enter key to activate a focused <a> element.
// The content script focuses the element first; we just send the key event.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.action !== 'CDP_TRUSTED_ENTER') return false
  const tabId = sender.tab?.id
  if (!tabId) { sendResponse({ ok: false, error: 'no_tab_id' }); return false }
  const op = cdpOpId()
  console.info(`[${op}] trusted-enter START tab=${tabId}`)
  ;(async () => {
    try {
      await chrome.debugger.attach({ tabId }, '1.3')
      await new Promise(r => setTimeout(r, 200))
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
      })
      await new Promise(r => setTimeout(r, 50))
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
      })
      await new Promise(r => setTimeout(r, 1500))
      await chrome.debugger.detach({ tabId })
      console.info(`[${op}] trusted-enter OK tab=${tabId}`)
      sendResponse({ ok: true })
    } catch (e) {
      console.warn(`[${op}] trusted-enter FAIL tab=${tabId}: ${e?.message || e}`)
      try { await chrome.debugger.detach({ tabId }) } catch { /* ignore */ }
      sendResponse({ ok: false, error: e?.message || String(e) })
    }
  })()
  return true
})
