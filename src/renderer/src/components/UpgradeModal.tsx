import { useCallback, useEffect, useRef, useState } from 'react'
import { getLoa } from '../loa-client'
import { trackUpgradeClicked } from './upgrade-tracking'
import { CREDIT_PACK_LIST, PLAN_LIMITS, PLUS_BONUS_PERCENT, TRIAL_DAYS } from '@core/plan-config'

export type UpgradeTrigger =
  | 'upgrade_cta'
  | 'daily_limit_exhausted'
  | 'trial_ended'
  | 'trial_warning'

interface UpgradeModalProps {
  trigger: UpgradeTrigger
  context?: {
    name?: string
    count?: number
    scores?: string
    trialApps?: number
    trialResponses?: number
  }
  plan: 'free' | 'plus'
  creditBalance?: number
  onDismiss: () => void
  onPlanRefresh?: () => void
}

/* ── Trigger content ─────────────────────────────────────────────── */

const TRIGGER_CONTENT: Record<UpgradeTrigger, {
  heading: (ctx: UpgradeModalProps['context']) => string
  body: (ctx: UpgradeModalProps['context']) => string
  showCredits: boolean
  showProgress: boolean
  showMetrics: boolean
  dismissLabel: string
}> = {
  upgrade_cta: {
    heading: () => 'Get more from LinkinReachly',
    body: () => `Upgrade to Plus for ${PLAN_LIMITS.plus.apply} daily applications, priority support, and cloud sync.`,
    showCredits: false,
    showProgress: false,
    showMetrics: false,
    dismissLabel: 'Not now',
  },
  daily_limit_exhausted: {
    heading: () => 'You\u2019ve hit today\u2019s limit',
    body: () => `Upgrade for ${PLAN_LIMITS.plus.apply} daily applications, or add credits to keep going.`,
    showCredits: true,
    showProgress: false,
    showMetrics: false,
    dismissLabel: 'Maybe tomorrow',
  },
  trial_ended: {
    heading: (ctx) => {
      const apps = ctx?.trialApps || 0
      return apps > 0 ? `${apps} application${apps === 1 ? '' : 's'} sent` : 'Trial complete'
    },
    body: (ctx) => {
      const resp = ctx?.trialResponses || 0
      return resp > 0
        ? `${resp} response${resp === 1 ? '' : 's'} so far. Keep the momentum.`
        : 'Stay on Plus for the same daily limits and AI features.'
    },
    showCredits: true,
    showProgress: true,
    showMetrics: true,
    dismissLabel: 'Continue on Free',
  },
  trial_warning: {
    heading: () => 'You\u2019re building momentum',
    body: (ctx) => {
      const apps = ctx?.trialApps || 0
      return apps > 0
        ? `${apps} application${apps === 1 ? '' : 's'} sent. Upgrade to keep Plus features.`
        : 'Trial ends soon. Plus keeps your current daily limits and AI features.'
    },
    showCredits: false,
    showProgress: true,
    showMetrics: true,
    dismissLabel: 'Remind me later',
  },
}

/* ── Sub-components ──────────────────────────────────────────────── */

function TrialProgress({ daysLeft }: { daysLeft: number }) {
  const elapsed = TRIAL_DAYS - daysLeft
  const pct = Math.min(100, Math.max(0, (elapsed / TRIAL_DAYS) * 100))
  return (
    <div className="upgrade-progress">
      <div className="upgrade-progress__header">
        <span className="upgrade-progress__label">Trial</span>
        <span className="upgrade-progress__badge">
          {daysLeft} day{daysLeft === 1 ? '' : 's'} left
        </span>
      </div>
      <div className="upgrade-progress__track">
        <div className="upgrade-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function TrialMetrics({ trialApps }: { trialApps: number }) {
  return (
    <div className="upgrade-metrics">
      <div className="upgrade-metric">
        <span className="upgrade-metric__value">{trialApps}</span>
        <span className="upgrade-metric__label">Applied</span>
      </div>
      <div className="upgrade-metric">
        <span className="upgrade-metric__value">{PLAN_LIMITS.plus.apply}</span>
        <span className="upgrade-metric__label">Daily limit</span>
      </div>
      <div className="upgrade-metric">
        <span className="upgrade-metric__value">{PLAN_LIMITS.plus.outreach}</span>
        <span className="upgrade-metric__label">Outreach/day</span>
      </div>
    </div>
  )
}

/* ── Main component ──────────────────────────────────────────────── */

export function UpgradeModal({ trigger, context, plan, creditBalance, onDismiss, onPlanRefresh }: UpgradeModalProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const content = TRIGGER_CONTENT[trigger]

  useEffect(() => { trackUpgradeClicked(trigger) }, [trigger])

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    el.querySelector<HTMLElement>('button:not([disabled])')?.focus()
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onDismiss])

  const mountedRef = useRef(true)
  useEffect(() => () => {
    mountedRef.current = false
    if (pollRef.current) clearInterval(pollRef.current)
  }, [])

  const startPlanPoll = useCallback(() => {
    if (!mountedRef.current) return
    if (pollRef.current) clearInterval(pollRef.current)
    let attempts = 0
    pollRef.current = setInterval(() => {
      attempts++
      if (!mountedRef.current || attempts > 30) {
        if (pollRef.current) clearInterval(pollRef.current)
        return
      }
      try { onPlanRefresh?.() } catch { /* poll failure is non-fatal */ }
    }, 5_000)
  }, [onPlanRefresh])

  const handleCheckout = useCallback(async (product: 'plus' | 'boost' | 'bundle' | 'blitz') => {
    setBusy(product)
    setCheckoutError(null)
    try {
      const res = await getLoa().planCreateCheckout(product)
      if (res && typeof res === 'object' && 'ok' in res && !res.ok) {
        setCheckoutError('Couldn\u2019t open checkout. Try again.')
        return
      }
      startPlanPoll()
    } catch (err) {
      setCheckoutError('Couldn\u2019t open checkout. Try again.')
    } finally {
      setBusy(null)
    }
  }, [startPlanPoll])

  const daysLeft = context?.count || 0
  const trialApps = context?.trialApps || 0

  return (
    <div className="upgrade-overlay" role="dialog" aria-labelledby="upgrade-heading" aria-modal="true">
      <div className="upgrade-card" ref={dialogRef}>
        <button type="button" className="upgrade-close" onClick={onDismiss} aria-label="Dismiss">
          {'\u2715'}
        </button>

        {content.showProgress && context?.count != null && (
          <TrialProgress daysLeft={trigger === 'trial_ended' ? 0 : daysLeft} />
        )}

        <h2 id="upgrade-heading" className="upgrade-heading">
          {content.heading(context)}
        </h2>
        <p className="upgrade-body">{content.body(context)}</p>

        {content.showMetrics && <TrialMetrics trialApps={trialApps} />}

        <div className="upgrade-actions">
          {plan === 'free' && (
            <button
              type="button"
              className="btn btn-primary upgrade-btn-plus"
              onClick={() => void handleCheckout('plus')}
              disabled={!!busy}
              aria-busy={busy === 'plus'}
            >
              {busy === 'plus' ? 'Opening checkout\u2026' : trigger === 'trial_ended' ? 'Keep My Features' : trigger === 'daily_limit_exhausted' ? 'Unlock Full Speed' : 'Upgrade to Plus'}
            </button>
          )}

          {content.showCredits && (
            <>
              {typeof creditBalance === 'number' && creditBalance > 0 && (
                <p className="upgrade-credit-balance" role="status">
                  {creditBalance} credit{creditBalance === 1 ? '' : 's'} remaining
                </p>
              )}
              <div className="upgrade-packs">
                {CREDIT_PACK_LIST.map((pack) => (
                  <button
                    key={pack.id}
                    type="button"
                    className={`upgrade-btn-credits${pack.featured ? ' upgrade-btn-credits--featured' : ''}`}
                    onClick={() => void handleCheckout(pack.id)}
                    disabled={!!busy}
                    aria-busy={busy === pack.id}
                    aria-label={`${pack.credits} credits for ${pack.price}`}
                  >
                    {busy === pack.id ? 'Opening\u2026' : (
                      <>
                        <span className="upgrade-pack-name">{pack.label}</span>
                        <span className="upgrade-pack-detail">{pack.credits} cr {'\u00b7'} {pack.price}</span>
                        {pack.featured && <span className="upgrade-pack-badge">Popular</span>}
                      </>
                    )}
                  </button>
                ))}
              </div>
              {plan === 'plus' && (
                <p className="upgrade-bonus-hint">+{PLUS_BONUS_PERCENT}% bonus on every pack</p>
              )}
            </>
          )}
        </div>

        {checkoutError && (
          <p className="upgrade-error" role="alert">{checkoutError}</p>
        )}

        <button type="button" className="upgrade-dismiss" onClick={onDismiss}>
          {content.dismissLabel}
        </button>
      </div>
    </div>
  )
}
