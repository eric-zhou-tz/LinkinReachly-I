import { useCallback, useState } from 'react'
import { DEV_BRIDGE_PORT, PROD_BRIDGE_PORT } from '@core/runtime-ports'
import { getLoa, isElectronLoaAvailable, loaHttpHealthUrl } from '@/loa-client'

const DEFAULT_BRIDGE_PORT = import.meta.env.DEV ? DEV_BRIDGE_PORT : PROD_BRIDGE_PORT

export function useBridgeState() {
  const [bridge, setBridge] = useState({
    port: DEFAULT_BRIDGE_PORT,
    extensionConnected: false,
    activeLinkedInTab: false
  })
  const [ping, setPing] = useState<string>('')
  const [electronIpcAvailable] = useState(() => isElectronLoaAvailable())
  const [localBackendAvailable, setLocalBackendAvailable] = useState<boolean | null>(() =>
    isElectronLoaAvailable() ? true : null
  )
  const [bridgeProbed, setBridgeProbed] = useState(false)

  const bridgeReady = bridge.extensionConnected && bridge.activeLinkedInTab
  const desktopBackendReady = electronIpcAvailable || localBackendAvailable === true

  const probeLocalBackend = useCallback(async () => {
    if (isElectronLoaAvailable()) {
      setLocalBackendAvailable(true)
      return true
    }
    try {
      const r = await fetch(loaHttpHealthUrl())
      setLocalBackendAvailable(r.ok)
      return r.ok
    } catch {
      setLocalBackendAvailable(false)
      return false
    }
  }, [])

  const probeBridge = useCallback(async () => {
    const backendReady = await probeLocalBackend()
    if (!backendReady) {
      setPing('Start the desktop app window to sync with Chrome.')
      const next = {
        port: bridge.port,
        extensionConnected: false,
        activeLinkedInTab: false
      }
      setBridge(next)
      return {
        ...next,
        ok: false,
        detail: 'desktop_app_offline'
      }
    }
    const loa = getLoa()
    const st = await loa.bridgeStatus()
    const activeLinkedInTab = !!st.activeLinkedInTab
    let detail = ''
    if (!st.extensionConnected) {
      detail = 'Extension not connected — install it and keep Chrome open.'
    } else if (!activeLinkedInTab) {
      detail = 'Open a LinkedIn tab in Chrome to arm automation.'
    } else {
      detail = 'Chrome ready'
    }
    const next = { ...st, activeLinkedInTab }
    setPing(detail)
    setBridge(next)
    return {
      ...next,
      ok: !!(next.extensionConnected && activeLinkedInTab),
      detail
    }
  }, [bridge.port, probeLocalBackend])

  const refreshBridge = useCallback(async () => {
    await probeBridge()
    setBridgeProbed(true)
  }, [probeBridge])

  return {
    bridge,
    ping,
    electronIpcAvailable,
    localBackendAvailable,
    setLocalBackendAvailable,
    bridgeReady,
    bridgeProbed,
    desktopBackendReady,
    probeBridge,
    refreshBridge,
    probeLocalBackend
  }
}
