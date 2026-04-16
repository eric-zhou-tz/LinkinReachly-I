import { useEffect, useRef } from 'react'

type Panel = 'connect' | 'history' | 'settings' | 'jobs' | 'dashboard'

export function useKeyboardShortcuts(
  activePanel: Panel,
  setActivePanel: (panel: Panel) => void,
  setDebugLogOpen: (fn: (v: boolean) => boolean) => void
) {
  const activePanelRef = useRef<Panel>(activePanel)
  activePanelRef.current = activePanel

  const setPanelWithRef = (panel: Panel) => {
    activePanelRef.current = panel
    setActivePanel(panel)
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === '1') { e.preventDefault(); setPanelWithRef('jobs') }
      if (meta && e.key === '2') { e.preventDefault(); setPanelWithRef('connect') }
      if (meta && e.key === '3') { e.preventDefault(); setPanelWithRef('history') }
      if (meta && e.key === '4') { e.preventDefault(); setPanelWithRef('settings') }
      if (meta && e.key === 'd') { e.preventDefault(); setDebugLogOpen((v) => !v) }
      if (meta && e.key === 's' && activePanelRef.current === 'settings') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('loa:settings-save'))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
