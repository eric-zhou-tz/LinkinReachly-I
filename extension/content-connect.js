if (!_lrDormant) {

function pendingStateVisible() {
  for (const b of document.querySelectorAll('button')) {
    const t = nodeText(b)
    const al = nodeAria(b)
    if (t.includes('pending') || al.includes('pending')) {
      return true
    }
  }
  for (const s of document.querySelectorAll('span, div')) {
    if (nodeText(s) === 'pending' || nodeAria(s).includes('pending')) {
      return true
    }
  }
  return false
}

function clickConnect2nd() {
  const early = hasPendingOrMessage()
  if (early.pending) return { ok: false, detail: 'already_pending' }
  if (early.messageBtn) return { ok: false, detail: 'message_btn_first_degree' }

  const links = document.querySelectorAll('a[href*="custom-invite"]')
  for (const a of links) {
    const t = nodeText(a)
    const al = nodeAria(a)
    if (t.includes('connect') || al.includes('connect') || al.includes('invite')) {
      a.scrollIntoView({ block: 'center' })
      a.click()
      return { ok: true, detail: 'clicked_connect_link' }
    }
  }
  return { ok: false, detail: 'no_direct_connect_link' }
}

function hasPendingOrMessage() {
  if (pendingStateVisible()) return { pending: true }

  const buttons = document.querySelectorAll('button')
  for (const b of buttons) {
    const t = nodeText(b)
    const al = nodeAria(b)
    if ((t === 'message' || t.includes('message')) && al.includes('message') && !al.includes('connect')) {
      return { messageBtn: true }
    }
  }
  // LinkedIn renders Message as <a> on profile pages — only count if it's in the
  // main profile header (not nav bar or sidebar ads). Check for nearby profile-specific elements.
  const profileHeader = document.querySelector('.pv-top-card, .scaffold-layout__main, [class*="profile-top"]')
  if (profileHeader) {
    const msgLinks = profileHeader.querySelectorAll('a[href*="/messaging/compose"]')
    for (const a of msgLinks) {
      if (nodeText(a) === 'message') return { messageBtn: true }
    }
  }
  return {}
}

function clickMoreThenConnect() {
  const buttons = document.querySelectorAll('button')
  for (const b of buttons) {
    const al = nodeAria(b)
    const t = nodeText(b)
    if ((al.includes('more') || t.includes('more')) && al.indexOf('business') < 0 && t.indexOf('business') < 0) {
      b.scrollIntoView({ block: 'center' })
      b.click()
      return 'clicked_more'
    }
  }
  return 'no_more'
}

function clickConnectMenuitem() {
  const items = document.querySelectorAll('[role="menuitem"]')
  for (const it of items) {
    const t = nodeText(it)
    if (
      t.includes('connect') &&
      t.indexOf('remove') < 0 &&
      t.indexOf('pending') < 0 &&
      t.indexOf('send profile') < 0
    ) {
      it.click()
      return 'clicked_connect_menu'
    }
    if (t.includes('pending')) return 'already_pending'
  }
  return 'no_connect_menu'
}

function clickConnect3rd() {
  const early = hasPendingOrMessage()
  if (early.pending) return { ok: false, detail: 'already_pending' }
  if (early.messageBtn) return { ok: false, detail: 'message_btn_first_degree' }

  const m = clickMoreThenConnect()
  if (m !== 'clicked_more') {
    const follow = [...document.querySelectorAll('button')].some(
      (b) => nodeText(b) === 'follow'
    )
    if (follow) return { ok: false, detail: 'follow_only_no_connect' }
    return { ok: false, detail: 'no_connect_path' }
  }

  return new Promise((resolve) => {
    setTimeout(() => {
      const r = clickConnectMenuitem()
      if (r === 'clicked_connect_menu') resolve({ ok: true, detail: 'clicked_connect_3rd' })
      else if (r === 'already_pending') resolve({ ok: false, detail: 'already_pending' })
      else resolve({ ok: false, detail: `after_more:${r}` })
    }, 600)
  })
}

var clickConnectAny = async function() {
  const direct = clickConnect2nd()
  if (direct.ok) return direct
  if (String(direct.detail).includes('pending') || String(direct.detail).includes('message_btn')) {
    return direct
  }
  return clickConnect3rd()
}

function shadowRootsThemeLight() {
  const out = []
  for (const el of document.querySelectorAll('div.theme--light')) {
    if (el.shadowRoot) out.push(el.shadowRoot)
  }
  return out
}

function connectModalScopes() {
  return [...shadowRootsThemeLight(), document]
}

function detectEmailRequiredConnectGate() {
  for (const scope of connectModalScopes()) {
    const text = compactText(scope?.textContent || '')
    if (!text) continue
    const hasEmailPrompt =
      text.includes('enter their email to connect') ||
      text.includes('to verify this member knows you') ||
      text.includes('please enter their email to connect') ||
      text.includes('email to connect')
    if (!hasEmailPrompt) continue

    const emailField = scope.querySelector(
      'input[type="email"], input[autocomplete="email"], input[name*="email" i], input[placeholder*="email" i]'
    )
    const noteField = scope.querySelector('textarea')
    if (emailField || noteField) {
      return { ok: false, detail: 'email_required_to_connect' }
    }
  }
  return null
}

function clickAddNote() {
  const emailGate = detectEmailRequiredConnectGate()
  if (emailGate) return emailGate
  for (const sr of shadowRootsThemeLight()) {
    const btns = sr.querySelectorAll('button, span[role="button"]')
    for (const b of btns) {
      if (nodeText(b).includes('add a note') || nodeAria(b).includes('add a note')) {
        b.click()
        return { ok: true, detail: 'clicked_add_note' }
      }
    }
  }
  return { ok: false, detail: 'add_note_not_found' }
}

function typeNote(text, charMin = 40, charMax = 140) {
  const emailGate = detectEmailRequiredConnectGate()
  if (emailGate) return Promise.resolve(emailGate)
  for (const sr of shadowRootsThemeLight()) {
    const ta = sr.querySelector('textarea')
    if (ta) {
      const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
      if (!desc || !desc.set) return Promise.resolve({ ok: false, detail: 'textarea_setter_unavailable' })
      const native = desc.set
      native.call(ta, '')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return (async () => {
        for (const ch of text) {
          const cur = ta.value + ch
          native.call(ta, cur)
          ta.dispatchEvent(new Event('input', { bubbles: true }))
          const ms = charMin + Math.random() * Math.max(0, charMax - charMin)
          await sleep(ms)
        }
        ta.dispatchEvent(new Event('change', { bubbles: true }))
        return { ok: true, detail: `typed_${ta.value.length}` }
      })()
    }
  }
  return Promise.resolve({ ok: false, detail: 'no_textarea' })
}

function clickSend() {
  const emailGate = detectEmailRequiredConnectGate()
  if (emailGate) return emailGate
  for (const sr of shadowRootsThemeLight()) {
    const btns = sr.querySelectorAll('button')
    for (const b of btns) {
      if ((nodeText(b).includes('send') || nodeAria(b).includes('send')) && !b.disabled) {
        b.click()
        return { ok: true, detail: 'clicked_send' }
      }
    }
  }
  return { ok: false, detail: 'send_not_found' }
}

function dismissModal() {
  for (const scope of connectModalScopes()) {
    const btns = scope.querySelectorAll('button')
    for (const b of btns) {
      const t = nodeText(b)
      const al = nodeAria(b)
      if (
        t.includes('discard') ||
        t === 'cancel' ||
        t.includes('close') ||
        al.includes('discard') ||
        al === 'cancel' ||
        al.includes('close')
      ) {
        b.click()
        return { ok: true, detail: 'dismiss_attempt' }
      }
    }
  }
  return { ok: true, detail: 'no_modal' }
}

function checkErrorToast() {
  const err = document.querySelector(
    'div.artdeco-toast-item--error, [data-test-artdeco-toast-item-type="error"]'
  )
  if (err) return { ok: false, detail: `error_toast:${err.textContent.trim().slice(0, 200)}` }
  return { ok: true, detail: 'no_error_toast' }
}

function verifyPending() {
  if (pendingStateVisible()) {
    return { ok: true, detail: 'pending_visible', data: { pending: true } }
  }
  return { ok: false, detail: 'pending_not_confirmed', data: { pending: false } }
}

function checkPendingInviteCount() {
  // Strategy 0: nav-bar badge count (works on ANY LinkedIn page)
  const navBadge = document.querySelector('#mynetwork-tab-icon + .notification-badge__count, [data-test-icon="people"] ~ .notification-badge__count, a[href*="/mynetwork"] .notification-badge__count, .global-nav__a11y-menu .notification-badge__count')
  if (navBadge) {
    const m = (navBadge.textContent || '').match(/(\d+)/)
    if (m) return { ok: true, detail: 'counted_from_nav_badge', data: { pendingCount: parseInt(m[1], 10) } }
  }
  // Strategy 1: specific invitation card selectors (legacy + current)
  const badges = document.querySelectorAll('.invitation-card, [data-test-invitation-card], .mn-invitation-list li, .artdeco-list__item')
  if (badges.length > 0) {
    return { ok: true, detail: 'counted_from_page', data: { pendingCount: badges.length } }
  }
  // Strategy 2: count badge in header
  const countBadge = document.querySelector('.mn-invitations-preview__header .t-14, .invitation-card__header .t-normal')
  if (countBadge) {
    const match = (countBadge.textContent || '').match(/(\d+)/)
    if (match) return { ok: true, detail: 'counted_from_badge', data: { pendingCount: parseInt(match[1], 10) } }
  }
  // Strategy 3: tab badge (Sent tab, etc.)
  const tabBadge = document.querySelector('[data-test-tab-label="Sent"] .t-14, .mn-tabs__badge')
  if (tabBadge) {
    const match = (tabBadge.textContent || '').match(/(\d+)/)
    if (match) return { ok: true, detail: 'counted_from_tab', data: { pendingCount: parseInt(match[1], 10) } }
  }
  // Strategy 4: broad — look for <li> items within main that have /in/ links (connection cards)
  const main = document.querySelector('main') || document.body
  const liWithProfile = [...main.querySelectorAll('li')].filter(li => li.querySelector('a[href*="/in/"]'))
  if (liWithProfile.length > 0) {
    return { ok: true, detail: 'counted_from_li', data: { pendingCount: liWithProfile.length } }
  }
  // Strategy 5: look for "Sent" or "Received" tab context and count any card-like items
  const isInvitationPage = /invitation-manager|manage.*invit/i.test(location.href)
  if (isInvitationPage) {
    const cards = main.querySelectorAll('li, [class*="card"], [class*="invitation"]')
    if (cards.length > 0) {
      return { ok: true, detail: 'counted_from_invitation_page', data: { pendingCount: cards.length } }
    }
    // On the page but no items = 0 pending (valid answer, not an error)
    return { ok: true, detail: 'invitation_page_empty', data: { pendingCount: 0 } }
  }
  return { ok: false, detail: 'not_on_invitations_page', data: { pendingCount: -1 } }
}

var extractConnections = async function(payload) {
  const scrollPasses = Math.max(1, Math.min(8, Number(payload.scrollPasses) || 2))
  const root = document.querySelector('main.scaffold-layout__main') || document.querySelector('main') || document.body
  for (let i = 0; i < scrollPasses; i++) {
    root.scrollTo(0, root.scrollHeight)
    await sleep(700 + Math.random() * 400)
  }
  /** @type {{ profileUrl: string, displayName: string, path: string }[]} */
  const items = []
  const seen = new Set()
  const links = document.querySelectorAll('a[href*="/in/"]')
  for (const a of links) {
    const href = String(a.href || '')
    if (!href.includes('/in/')) continue
    let path = ''
    try {
      path = new URL(href).pathname.replace(/\/$/, '').toLowerCase()
    } catch {
      continue
    }
    if (!path || path.length < 4 || seen.has(path)) continue
    const lines = (a.innerText || '')
      .trim()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const displayName = lines[0] || ''
    if (displayName.length < 2) continue
    seen.add(path)
    items.push({ profileUrl: href, displayName, path })
  }
  return { ok: true, detail: `connections_${items.length}`, data: { items } }
}

var extractSearchResults = async function(payload) {
  const scrollPasses = Math.max(1, Math.min(6, Number(payload.scrollPasses) || 2))
  const root = document.querySelector('main.scaffold-layout__main') || document.querySelector('main') || document.body
  for (let i = 0; i < scrollPasses; i++) {
    root.scrollTo(0, root.scrollHeight)
    await sleep(700 + Math.random() * 400)
  }
  /** @type {{ profileUrl: string, displayName: string, firstName: string, company: string, headline: string }[]} */
  const items = []
  const seen = new Set()
  const links = document.querySelectorAll('a[href*="/in/"]')
  for (const anchor of links) {
    const href = String(anchor.href || '')
    if (!href.includes('/in/')) continue
    let path = ''
    try {
      path = new URL(href).pathname.replace(/\/$/, '').toLowerCase()
    } catch {
      continue
    }
    if (!path || seen.has(path)) continue
    const card =
      anchor.closest('li') ||
      anchor.closest('.reusable-search__result-container') ||
      anchor.closest('.entity-result') ||
      anchor.parentElement
    const lines = String(card?.innerText || anchor.innerText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^(1st|2nd|3rd|\d+(?:st|nd|rd|th))$/i.test(line))
    const displayName = lines[0] || String(anchor.innerText || '').trim().split('\n')[0] || ''
    if (displayName.length < 2) continue
    const headline = lines.find((line, index) => index > 0 && line.length > 6) || ''
    const companyLine =
      lines.find((line) => /\bat\b/i.test(line)) ||
      lines.find((line) => /recruit|talent|partner|capital|fund|ventures|advisors|management/i.test(line)) ||
      ''
    const firstName = displayName.split(/\s+/)[0] || ''
    seen.add(path)
    items.push({
      profileUrl: href,
      displayName,
      firstName,
      company: companyLine.slice(0, 120),
      headline: headline.slice(0, 200)
    })
  }
  return { ok: true, detail: `search_results_${items.length}`, data: { items } }
}

var clickMessageForProfile = async function(payload) {
  const needle = String(payload.profileUrl || '')
  let pathNeedle = ''
  try {
    pathNeedle = new URL(needle).pathname.replace(/\/$/, '').toLowerCase()
  } catch {
    pathNeedle = ''
  }
  const nameNeedle = String(payload.displayName || '')
    .trim()
    .toLowerCase()

  // Retry up to 3 times with 2s waits — profile page Message button renders async
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2000)

    // Strategy 1: find profile anchor, walk up DOM to find nearby Message button
    const links = [...document.querySelectorAll('a[href*="/in/"]')]
    let anchor = links.find((a) => {
      try {
        const p = new URL(a.href).pathname.replace(/\/$/, '').toLowerCase()
        return pathNeedle && p === pathNeedle
      } catch {
        return false
      }
    })
    if (!anchor && nameNeedle) {
      const firstToken = nameNeedle.split(/\s+/)[0]
      anchor = links.find((a) => (a.innerText || '').toLowerCase().includes(firstToken))
    }

    if (anchor) {
      let el = anchor
      for (let i = 0; i < 14 && el; i++) {
        el = el.parentElement
        if (!el) break
        const btns = el.querySelectorAll('button')
        for (const b of btns) {
          const t = nodeText(b)
          const al = nodeAria(b)
          if (t === 'message' || (al.includes('message') && !al.includes('connect'))) {
            b.scrollIntoView({ block: 'center' })
            b.click()
            return { ok: true, detail: 'clicked_message' }
          }
        }
      }
    }

    // Strategy 2: search ALL buttons on page (Message button may be far from anchor)
    const allBtns = document.querySelectorAll('button')
    for (const b of allBtns) {
      const t = nodeText(b)
      const al = nodeAria(b)
      if ((t === 'message' || t.includes('message')) && al.includes('message') && !al.includes('connect')) {
        b.scrollIntoView({ block: 'center' })
        b.click()
        return { ok: true, detail: 'clicked_message' }
      }
    }
    // Relaxed match: text OR aria-label
    for (const b of allBtns) {
      const t = nodeText(b)
      const al = nodeAria(b)
      if ((t === 'message' || al.includes('message')) && !al.includes('connect') && !t.includes('connect')) {
        b.scrollIntoView({ block: 'center' })
        b.click()
        return { ok: true, detail: 'clicked_message' }
      }
    }

    // Strategy 3: LinkedIn renders Message as <a> linking to /messaging/compose/
    const msgLinks = document.querySelectorAll('a[href*="/messaging/compose"]')
    for (const a of msgLinks) {
      const t = nodeText(a)
      if (t === 'message' || t.includes('message')) {
        a.scrollIntoView({ block: 'center' })
        a.click()
        return { ok: true, detail: 'clicked_message_link' }
      }
    }
    // Broader <a> tag check: any link with "message" text that isn't the nav messaging link
    const allAnchors = document.querySelectorAll('a')
    for (const a of allAnchors) {
      const t = nodeText(a)
      const href = (a.href || '').toLowerCase()
      if (t === 'message' && href.includes('/messaging/') && !href.endsWith('/messaging/')) {
        a.scrollIntoView({ block: 'center' })
        a.click()
        return { ok: true, detail: 'clicked_message_link' }
      }
    }

    // Strategy 4: check inside shadow DOMs (LinkedIn SDUI)
    const shadowHosts = document.querySelectorAll('*')
    for (const host of shadowHosts) {
      if (!host.shadowRoot) continue
      const shadowBtns = host.shadowRoot.querySelectorAll('button, a[href*="/messaging/compose"]')
      for (const b of shadowBtns) {
        const t = nodeText(b)
        const al = nodeAria(b)
        if ((t === 'message' || t.includes('message') || al.includes('message')) && !al.includes('connect') && !t.includes('connect')) {
          b.scrollIntoView({ block: 'center' })
          b.click()
          return { ok: true, detail: 'clicked_message_shadow' }
        }
      }
    }
  }

  // Diagnostic: collect ALL button texts for debugging (first 15)
  const btnSample = []
  const allBtns = document.querySelectorAll('button')
  let idx = 0
  for (const b of allBtns) {
    if (idx >= 15) break
    const t = nodeText(b)
    const al = nodeAria(b)
    if (t || al) {
      btnSample.push({ text: t.slice(0, 30), aria: al.slice(0, 50) })
      idx++
    }
  }
  // Also check <a> tags that might be styled as buttons
  const aSample = []
  const allAs = document.querySelectorAll('a')
  for (const a of allAs) {
    const t = nodeText(a)
    const al = nodeAria(a)
    if (t.includes('messag') || al.includes('messag')) {
      aSample.push({ text: t.slice(0, 40), aria: al.slice(0, 60), href: (a.href || '').slice(0, 80) })
    }
  }

  if (!document.querySelector('a[href*="/in/"]')) {
    return { ok: false, detail: 'profile_link_not_found', data: { btnSample, aSample } }
  }
  return { ok: false, detail: 'message_button_not_found', data: { btnSample, aSample, totalButtons: allBtns.length, url: location.href } }
}

function findConversationInput() {
  // Standard messaging overlay/thread
  const ta =
    document.querySelector('.msg-form textarea') ||
    document.querySelector('.compose-two__text-field textarea') ||
    document.querySelector('textarea[name="message"]') ||
    document.querySelector('.msg-overlay-conversation-bubble textarea')
  if (ta) return { el: ta, kind: 'textarea' }
  const ce = document.querySelector('.msg-form [contenteditable="true"]')
  if (ce) return { el: ce, kind: 'ce' }
  // Messaging compose page (/messaging/compose/ or /messaging/thread/)
  const composeCe =
    document.querySelector('[contenteditable="true"][role="textbox"]') ||
    document.querySelector('.msg-form__contenteditable [contenteditable="true"]') ||
    document.querySelector('[data-artdeco-is-focused] [contenteditable="true"]')
  if (composeCe) return { el: composeCe, kind: 'ce' }
  // Broader: any contenteditable in the messaging area
  const msgArea = document.querySelector('[class*="msg-"], [class*="messaging"]')
  if (msgArea) {
    const msgCe = msgArea.querySelector('[contenteditable="true"]')
    if (msgCe) return { el: msgCe, kind: 'ce' }
  }
  // Last resort: any visible textarea or contenteditable on page
  const allTa = document.querySelectorAll('textarea')
  for (const t of allTa) {
    if (t.offsetParent !== null) return { el: t, kind: 'textarea' }
  }
  const allCe = document.querySelectorAll('[contenteditable="true"]')
  for (const c of allCe) {
    if (c.offsetParent !== null && c.getBoundingClientRect().height > 20) return { el: c, kind: 'ce' }
  }
  return null
}

function typeConversation(text, charMin = 40, charMax = 140) {
  const found = findConversationInput()
  if (!found) return Promise.resolve({ ok: false, detail: 'no_conversation_input' })
  const { el, kind } = found
  if (kind === 'textarea') {
    const ta = el
    const native = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    native.call(ta, '')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return (async () => {
      for (const ch of text) {
        const cur = ta.value + ch
        native.call(ta, cur)
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        const ms = charMin + Math.random() * Math.max(0, charMax - charMin)
        await sleep(ms)
      }
      ta.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, detail: `typed_dm_${ta.value.length}` }
    })()
  }
  el.textContent = ''
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return (async () => {
    for (const ch of text) {
      el.textContent += ch
      el.dispatchEvent(new Event('input', { bubbles: true }))
      const ms = charMin + Math.random() * Math.max(0, charMax - charMin)
      await sleep(ms)
    }
    return { ok: true, detail: `typed_ce_${el.textContent.length}` }
  })()
}

function clickSendConversation() {
  const form = document.querySelector('.msg-form') || document.querySelector('.msg-overlay-conversation-bubble')
  const scope = form || document
  const btns = scope.querySelectorAll('button')
  for (const b of btns) {
    const t = b.textContent.trim().toLowerCase()
    if (t === 'send' && !b.disabled) {
      b.click()
      return { ok: true, detail: 'clicked_send_conversation' }
    }
  }
  for (const b of btns) {
    const al = (b.getAttribute('aria-label') || '').toLowerCase()
    if (al.includes('send') && !b.disabled) {
      b.click()
      return { ok: true, detail: 'clicked_send_aria' }
    }
  }
  return { ok: false, detail: 'send_conversation_not_found' }
}

function extractProfile() {
  const topCard =
    document.querySelector('main section') ||
    document.querySelector('.ph5.pb5') ||
    document.querySelector('main')
  const topLines = visibleLinesFrom(topCard, 24)
  const ignoredTopLines = new Set([
    'resources',
    'enhance profile',
    'add profile section',
    'add section',
    'open to',
    'contact info',
    'for business',
    'home',
    'my network',
    'jobs',
    'messaging',
    'notifications',
    'me'
  ])

  let displayName = compactText(document.querySelector('h1')?.textContent || '')
  if (!displayName) {
    displayName =
      topLines.find((line) => {
        const lower = line.toLowerCase()
        return (
          line.split(/\s+/).length >= 2 &&
          line.split(/\s+/).length <= 4 &&
          !ignoredTopLines.has(lower) &&
          !looksLikeLocationLine(line) &&
          !/\b(?:followers|connections|contact info|open to|profile|section)\b/i.test(lower)
        )
      }) || ''
  }

  const firstName = displayName.split(/\s+/)[0] || ''

  let headline = compactText(
    document.querySelector('.text-body-medium.break-words')?.textContent ||
    document.querySelector('[data-generated-suggestion-target]')?.textContent ||
    document.querySelector('.pv-text-details__left-panel .text-body-medium')?.textContent ||
    ''
  )
  if (/^[•·.\-]+$/.test(headline) || headline.length < 3) headline = ''
  if (!headline) {
    const nameIdx = topLines.findIndex((line) => line === displayName)
    const candidateLines = nameIdx >= 0 ? topLines.slice(nameIdx + 1) : topLines
    headline =
      candidateLines.find((line) => {
        const lower = line.toLowerCase()
        return (
          !ignoredTopLines.has(lower) &&
          !looksLikeLocationLine(line) &&
          !/^(contact info|500\+|followers|connections|open to)$/i.test(lower)
        )
      }) || ''
  }

  let location = cleanLocationLine(
    document.querySelector('.text-body-small.inline.t-black--light.break-words')?.textContent ||
    document.querySelector('.pv-text-details__left-panel .text-body-small.inline')?.textContent ||
    ''
  )
  if (location.includes('|')) location = ''
  if (!location) {
    location = cleanLocationLine(topLines.find((line) => looksLikeLocationLine(line)) || '')
  }

  const about = compactText(findSectionLines('About').join(' '))
    .replace(/\s*[.…]\s*more$/i, '')
    .slice(0, 1200)

  const experienceSection =
    document.querySelector('section.artdeco-card[id="experience"]') ||
    document.querySelector('section[data-section="experience"]') ||
    document.querySelector('#experience')

  const experienceHighlights = []
  const experienceNodes = experienceSection
    ? experienceSection.querySelectorAll('li, .artdeco-list__item, [data-view-name="profile-component-entity"]')
    : []
  const seenExperience = new Set()
  let company = inferCompanyFromHeadline(headline)
  for (const node of experienceNodes) {
    const text = compactText(readCardText(node) || node.textContent || '')
    if (!text || text.length < 8) continue
    const lines = text
      .split(/(?:\n| {2,})/)
      .map((line) => compactText(line))
      .filter(Boolean)
    const summary = compactText(lines.slice(0, 2).join(' - ')).slice(0, 180)
    if (!summary) continue
    const key = summary.toLowerCase()
    if (seenExperience.has(key)) continue
    seenExperience.add(key)
    experienceHighlights.push(summary)
    if (!company && lines[1]) company = lines[1]
    if (experienceHighlights.length >= 4) break
  }

  const rawText = [
    displayName,
    headline,
    location,
    company,
    about,
    ...experienceHighlights
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2400)

  return {
    ok: true,
    detail: 'extracted',
    data: {
      profileUrl: window.location.href,
      displayName,
      firstName,
      headline,
      location,
      company,
      about,
      experienceHighlights,
      rawText
    }
  }
}

}
