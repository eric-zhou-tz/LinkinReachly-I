import { useCallback, useEffect, useRef, useState } from 'react'
import type { useAppModel } from '@/hooks/useAppModel'
import { getLoa } from '@/loa-client'

function track(step: string, meta?: Record<string, unknown>): void {
  void getLoa().trackOnboarding(step, meta).catch(() => {})
}

export function OnboardingOverlay({
  model,
  onComplete
}: {
  model: ReturnType<typeof useAppModel>
  onComplete: (initialSearch?: { keywords: string; location?: string }) => void
}) {
  const [extTipVisible, setExtTipVisible] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const trackedStartRef = useRef(false)
  const extPhaseStartRef = useRef<number | null>(null)

  useEffect(() => {
    if (!trackedStartRef.current) {
      trackedStartRef.current = true
      track('onboarding_started')
      track('onboarding_extension_prompt_seen')
      extPhaseStartRef.current = Date.now()
    }
  }, [])

  const finishOnboarding = useCallback(() => {
    track('onboarding_completed', {
      had_resume: !!model.settings?.resumeFileName,
      extension_connected: !!model.bridge.extensionConnected,
    })
    void model.dismissOnboarding()
    onComplete()
  }, [model, onComplete])

  const skipAll = useCallback(() => {
    track('onboarding_skipped', { skipped_from: 'extension' })
    void model.dismissOnboarding()
    onComplete()
  }, [model, onComplete])

  useEffect(() => {
    if (model.bridge.extensionConnected) {
      const elapsed = extPhaseStartRef.current ? Math.round((Date.now() - extPhaseStartRef.current) / 1000) : undefined
      track('onboarding_extension_connected', { seconds_to_connect: elapsed })
    }
  }, [model.bridge.extensionConnected])

  useEffect(() => {
    if (model.bridge.extensionConnected) return
    const timer = setTimeout(() => {
      setExtTipVisible(true)
      track('onboarding_extension_troubleshoot_shown')
    }, 30_000)
    return () => clearTimeout(timer)
  }, [model.bridge.extensionConnected])

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        skipAll()
        return
      }
      if (e.key !== 'Tab' || !el) return
      const focusable = el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    el.addEventListener('keydown', handleKeyDown)
    return () => el.removeEventListener('keydown', handleKeyDown)
  }, [skipAll])

  const totalSteps = 4

  return (
    <div className="onboarding-overlay" role="dialog" aria-labelledby="onboarding-heading" aria-modal="true">
      <div className="onboarding-card" ref={cardRef} aria-live="polite">
        <div className="onboarding-progress" aria-hidden="true">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              className={`onboarding-dot${i < totalSteps - 1 ? ' onboarding-dot--done' : ' onboarding-dot--active'}`}
            />
          ))}
        </div>
        <p className="onboarding-time-estimate">
          Most users finish in under 2 minutes
        </p>
        <div className="onboarding-step onboarding-step--extension">
          <h2 id="onboarding-heading">Last step {'\u2014'} connect Chrome</h2>
          <div className="ext-visual" aria-hidden="true">
            <div className="ext-visual__bar">
              <span className="ext-visual__title">Chrome Web Store</span>
            </div>
            <div className="ext-visual__actions">
              <span className="ext-visual__btn ext-visual__btn--highlight">Add to Chrome</span>
            </div>
          </div>
          <ol className="onboarding-ext-steps">
            <li>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  track('onboarding_extension_cws_opened')
                  void getLoa().openExternalUrl('https://chromewebstore.google.com/detail/linkinreachly/fgmmmaipkllkmnnhfoehnakjelhpkffk').catch(() => {})
                }}
              >
                Install from Chrome Web Store
              </button>
            </li>
            <li>Click <strong>Add to Chrome</strong> and confirm the install.</li>
            <li>Open <strong>linkedin.com</strong> in Chrome.</li>
          </ol>
          <div className={`onboarding-ext-status ${model.bridge.extensionConnected ? 'onboarding-ext-status--ok' : ''}`} role="status" aria-live="polite">
            <span className="onboarding-ext-status__dot" />
            <span>{model.bridge.extensionConnected ? 'Extension connected' : 'Waiting for extension\u2026'}</span>
          </div>
          {model.bridge.extensionConnected && (
            <div className="onboarding-trial-activated" role="status">
              <strong>Plus trial activated!</strong> 7 days of full AI-powered applications.
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary btn-go onboarding-go"
            disabled={!model.bridge.extensionConnected}
            onClick={finishOnboarding}
          >
            {model.bridge.extensionConnected ? 'Get started' : 'Connect extension above to continue'}
          </button>
          {extTipVisible && !model.bridge.extensionConnected && (
            <div className="onboarding-ext-troubleshoot" role="note">
              <strong>Still waiting?</strong> Check that the extension is installed from the Chrome Web Store, linkedin.com is open in Chrome, and the desktop app is running.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
