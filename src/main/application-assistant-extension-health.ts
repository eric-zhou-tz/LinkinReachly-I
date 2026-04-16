import type { ApplicationExtensionHealthView, ApplicationAssistantStatusView, ApplyQueueView } from '@core/application-types'
import {
  EXPECTED_BACKGROUND_BRIDGE_VERSION,
  EXPECTED_CONTENT_SCRIPT_VERSION,
  EXTENSION_RELOAD_QUEUE_HINT,
  STALE_EXTENSION_USER_MESSAGE
} from '@core/extension-version'
import { getActiveLinkedInTab, isExtensionConnected, sendCommand } from './bridge'
import { appendApplicationRecord } from './application-history-store'
import {
  loadQueue,
  saveQueue,
  updateItemStatus
} from './apply-queue-store'
import { getSupportedAtsLabels } from '@core/ats-detect'
import { notifyApplyQueueTick } from './apply-queue-runner'

export async function getApplicationAssistantStatus(): Promise<ApplicationAssistantStatusView> {
  const detailDefault =
    'Apply assistant is active. Paste a job application URL or use "Probe current page" to detect the ATS.'
  const base: ApplicationAssistantStatusView = {
    ok: true,
    featureEnabled: true,
    phase: 'scaffold',
    bridgeConnected: isExtensionConnected(),
    activeLinkedInTab: getActiveLinkedInTab(),
    extensionScope: 'linkedin_only',
    supportedAts: getSupportedAtsLabels(),
    detail: detailDefault,
    blockedExtensionReload: false
  }
  if (!base.bridgeConnected) {
    return base
  }
  const health = await getApplicationExtensionHealth()
  const blocked = health.status === 'stale_extension' && health.reloadRequired
  return {
    ...base,
    blockedExtensionReload: blocked,
    detail: blocked ? health.detail : detailDefault,
    extensionContentScriptVersion: health.detectedContentVersion,
    extensionBackgroundBridgeVersion: health.detectedBackgroundBridgeVersion
  }
}

export async function getApplicationExtensionHealth(): Promise<ApplicationExtensionHealthView> {
  const expContent = EXPECTED_CONTENT_SCRIPT_VERSION
  const expBg = EXPECTED_BACKGROUND_BRIDGE_VERSION

  if (!isExtensionConnected()) {
    return {
      ok: false,
      status: 'bridge_disconnected',
      reloadRequired: false,
      expectedContentVersion: expContent,
      expectedBackgroundBridgeVersion: expBg,
      detail: 'Chrome extension is not connected. Open LinkedIn and ensure the LinkinReachly extension is active.'
    }
  }

  try {
    const ping = await sendCommand('PING', {}, 12_000)
    const pingDetail = String(ping.detail || '')
    if (pingDetail.includes('unknown_action')) {
      return {
        ok: false,
        status: 'stale_extension',
        reloadRequired: true,
        expectedContentVersion: expContent,
        expectedBackgroundBridgeVersion: expBg,
        detail: STALE_EXTENSION_USER_MESSAGE
      }
    }
    if (!ping.ok) {
      const noTab = pingDetail === 'open_a_linkedin_tab'
      return {
        ok: false,
        status: noTab ? 'no_linkedin_tab' : 'content_unreachable',
        reloadRequired: false,
        expectedContentVersion: expContent,
        expectedBackgroundBridgeVersion: expBg,
        detail: noTab
          ? 'Open a LinkedIn tab in Chrome before starting the apply queue.'
          : pingDetail || 'Couldn\u2019t reach the extension.'
      }
    }

    const bgRaw = (ping.data as { backgroundBridgeVersion?: unknown } | undefined)?.backgroundBridgeVersion
    const bgVer = Number(bgRaw)
    if (!Number.isFinite(bgVer) || bgVer < expBg) {
      return {
        ok: false,
        status: 'stale_extension',
        reloadRequired: true,
        expectedContentVersion: expContent,
        expectedBackgroundBridgeVersion: expBg,
        detectedBackgroundBridgeVersion: Number.isFinite(bgVer) ? bgVer : undefined,
        detail:
          'Extension needs a reload. Open Chrome\u2019s Extensions page, reload LinkinReachly, then restart the queue.'
      }
    }

    if (!getActiveLinkedInTab()) {
      return {
        ok: false,
        status: 'no_linkedin_tab',
        reloadRequired: false,
        expectedContentVersion: expContent,
        expectedBackgroundBridgeVersion: expBg,
        detectedBackgroundBridgeVersion: bgVer,
        detail: 'Open a LinkedIn tab in Chrome before starting the apply queue.'
      }
    }

    const result = await sendCommand('CONTENT_SCRIPT_VERSION', {}, 12_000)
    const detail = String(result.detail || '')
    const detectedVersion = Number((result.data as { version?: unknown } | undefined)?.version || 0)
    const hasVersion = Number.isFinite(detectedVersion) && detectedVersion > 0

    if (detail.includes('unknown_action')) {
      return {
        ok: false,
        status: 'stale_extension',
        reloadRequired: true,
        expectedContentVersion: expContent,
        expectedBackgroundBridgeVersion: expBg,
        detectedBackgroundBridgeVersion: bgVer,
        detail: STALE_EXTENSION_USER_MESSAGE
      }
    }

    if (result.ok && hasVersion && detectedVersion >= expContent) {
      return {
        ok: true,
        status: 'healthy',
        reloadRequired: false,
        expectedContentVersion: expContent,
        expectedBackgroundBridgeVersion: expBg,
        detectedContentVersion: detectedVersion,
        detectedBackgroundBridgeVersion: bgVer,
        detail: 'Extension health check passed.'
      }
    }

    if (hasVersion && detectedVersion < expContent) {
      return {
        ok: false,
        status: 'stale_extension',
        reloadRequired: true,
        expectedContentVersion: expContent,
        expectedBackgroundBridgeVersion: expBg,
        detectedContentVersion: detectedVersion,
        detectedBackgroundBridgeVersion: bgVer,
        detail: `Extension content script v${detectedVersion} is outdated (expected v${expContent}). Reload the extension.`
      }
    }

    return {
      ok: false,
      status: 'content_unreachable',
      reloadRequired: false,
      expectedContentVersion: expContent,
      expectedBackgroundBridgeVersion: expBg,
      detectedBackgroundBridgeVersion: bgVer,
      detail: result.ok
        ? 'Could not read extension content-script version from the active LinkedIn tab.'
        : detail || 'Couldn\u2019t reach the content script.'
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      status: 'content_unreachable',
      reloadRequired: false,
      expectedContentVersion: expContent,
      expectedBackgroundBridgeVersion: expBg,
      detail: `Couldn\u2019t check extension health: ${message}`
    }
  }
}

export function blockPendingEasyApplyItemsForStaleExtension(detail: string): ApplyQueueView {
  const current = loadQueue()
  const nowIso = new Date().toISOString()
  const pendingEasyItems = current.items.filter(
    (item) => item.status === 'pending' && item.surface === 'linkedin_easy_apply'
  )

  if (pendingEasyItems.length === 0) {
    const state = {
      ...current,
      running: false,
      pausedAt: nowIso,
      lastError: EXTENSION_RELOAD_QUEUE_HINT,
      lastErrorCode: 'extension_stale'
    }
    saveQueue(state)
    notifyApplyQueueTick()
    return { ok: false, reason: 'extension_stale', detail, state }
  }

  for (const item of pendingEasyItems) {
    const record = appendApplicationRecord({
      company: item.company,
      title: item.jobTitle,
      location: item.location || undefined,
      jobUrl: item.linkedinJobUrl || item.applyUrl || undefined,
      easyApply: true,
      atsId: 'linkedin_easy_apply',
      source: 'linkedin_easy_apply',
      outcome: 'failed',
      detail: 'extension_stale',
      descriptionSnippet: item.descriptionSnippet,
      reasonSnippet: 'extension_stale'
    })

    updateItemStatus(item.id, 'error', {
      applicationRecordId: record.id,
      detail: 'Blocked: stale extension',
      processedAt: nowIso
    })
  }

  const latest = loadQueue()
  const nextState = {
    ...latest,
    running: false,
    pausedAt: nowIso,
    lastError: EXTENSION_RELOAD_QUEUE_HINT,
    lastErrorCode: 'extension_stale'
  }
  saveQueue(nextState)
  notifyApplyQueueTick()

  return { ok: false, reason: 'extension_stale', detail, state: nextState }
}
