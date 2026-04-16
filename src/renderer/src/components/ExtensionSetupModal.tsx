/**
 * ExtensionSetupModal — just-in-time Chrome extension setup.
 *
 * Shown as a modal overlay when the user attempts to start the apply queue
 * but the Chrome extension is not connected. Replaces the old onboarding
 * Screen 3 (extension phase) with a point-of-need prompt.
 *
 * Auto-dismisses when the extension signals connection.
 */
import { useEffect, useRef, useState } from 'react'
import { getLoa } from '@/loa-client'

type Props = {
  extensionConnected: boolean
  onDismiss: () => void
  onConnected: () => void
}

function track(step: string): void {
  void getLoa().trackOnboarding(step).catch(() => {})
}

export function ExtensionSetupModal({ extensionConnected, onDismiss, onConnected }: Props) {
  const [tipVisible, setTipVisible] = useState(false)
  const trackedRef = useRef(false)

  useEffect(() => {
    if (!trackedRef.current) {
      trackedRef.current = true
      track('extension_jit_modal_shown')
    }
  }, [])

  // Auto-dismiss when extension connects
  useEffect(() => {
    if (extensionConnected) {
      track('extension_jit_connected')
      onConnected()
    }
  }, [extensionConnected, onConnected])

  // Show troubleshooting tip after 30s
  useEffect(() => {
    if (extensionConnected) return
    const t = setTimeout(() => setTipVisible(true), 30_000)
    return () => clearTimeout(t)
  }, [extensionConnected])

  return (
    <div className="ext-setup-modal" role="dialog" aria-labelledby="ext-setup-heading" aria-modal="true">
      <div className="ext-setup-modal__card">
        <h2 id="ext-setup-heading" className="ext-setup-modal__heading">Connect to Chrome</h2>
        <p className="ext-setup-modal__lede">
          One-time setup. LinkinReachly needs a Chrome extension to submit Easy Apply forms on your behalf.
        </p>

        <ol className="ext-setup-modal__steps">
          <li>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                track('extension_jit_cws_opened')
                void getLoa().openExternalUrl('https://chromewebstore.google.com/detail/linkinreachly/fgmmmaipkllkmnnhfoehnakjelhpkffk').catch(() => {})
              }}
            >
              Open Chrome Web Store
            </button>
          </li>
          <li>Click <strong>Add to Chrome</strong> and confirm the install.</li>
          <li>Open <strong>linkedin.com</strong> in Chrome.</li>
        </ol>

        <div className={`ext-setup-modal__status ${extensionConnected ? 'ext-setup-modal__status--ok' : ''}`} role="status" aria-live="polite">
          <span className="ext-setup-modal__status-dot" />
          <span>{extensionConnected ? 'Extension connected' : 'Waiting for connection\u2026'}</span>
        </div>

        {tipVisible && !extensionConnected && (
          <div className="ext-setup-modal__tip" role="note">
            <strong>Still waiting?</strong> Check: (1) the extension is installed from the Chrome Web Store, (2) linkedin.com is open in Chrome, (3) the desktop app is running.
          </div>
        )}

        <div className="ext-setup-modal__actions">
          <button type="button" className="btn btn-ghost" onClick={onDismiss}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
