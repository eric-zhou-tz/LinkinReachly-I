import { useState, useCallback, useEffect } from 'react'
import { getLoa } from '@/loa-client'

type PMFAnswer = 'very_disappointed' | 'somewhat_disappointed' | 'not_disappointed'
type Phase = 'question' | 'followup' | 'done'

const PMF_COOLDOWN_DAYS = 90
const SESSION_KEY = 'loa:pmf_dismissed'

const OPTIONS: { value: PMFAnswer; label: string }[] = [
  { value: 'very_disappointed', label: 'Very disappointed' },
  { value: 'somewhat_disappointed', label: 'Somewhat disappointed' },
  { value: 'not_disappointed', label: 'Not disappointed' },
]

/**
 * Sean Ellis PMF survey. THE metric for product-market fit.
 * Shown once after 3+ days of active use, then respects a 90-day cooldown.
 *
 * "How would you feel if you could no longer use LinkinReachly?"
 * Target: 40%+ "very disappointed" = product-market fit.
 */
export function PMFSurvey({ activeDays }: { activeDays: number }) {
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<Phase>('question')
  const [answer, setAnswer] = useState<PMFAnswer | null>(null)
  const [benefit, setBenefit] = useState('')

  useEffect(() => {
    if (activeDays < 3) return
    if (sessionStorage.getItem(SESSION_KEY)) return

    let cancelled = false
    getLoa()
      .surveyCanShow({ surveyType: 'pmf', cooldownDays: PMF_COOLDOWN_DAYS })
      .then((res) => {
        if (!cancelled && res.canShow) setVisible(true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeDays])

  const dismiss = useCallback(() => {
    sessionStorage.setItem(SESSION_KEY, '1')
    setVisible(false)
  }, [])

  const submitAnswer = useCallback((value: PMFAnswer) => {
    setAnswer(value)
    setPhase('followup')
  }, [])

  const submitFinal = useCallback(async () => {
    if (!answer) return
    sessionStorage.setItem(SESSION_KEY, '1')
    setPhase('done')
    await getLoa().surveySubmit({
      surveyType: 'pmf',
      answers: {
        disappointment: answer,
        benefit: benefit.trim() || undefined,
      },
      score: answer === 'very_disappointed' ? 3 : answer === 'somewhat_disappointed' ? 2 : 1,
    }).catch(() => {})
    setTimeout(() => setVisible(false), 2500)
  }, [answer, benefit])

  if (!visible) return null

  return (
    <div className="pmf-overlay" onClick={dismiss}>
      <div
        className="pmf-modal"
        role="dialog"
        aria-label="Quick question"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="pmf-modal__close"
          onClick={dismiss}
          aria-label="Close"
        >
          {'\u2715'}
        </button>

        {phase === 'question' && (
          <>
            <h3 className="pmf-modal__title">Quick question</h3>
            <p className="pmf-modal__question">
              How would you feel if you could no longer use LinkinReachly?
            </p>
            <div className="pmf-options">
              {OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className="pmf-option-btn"
                  onClick={() => submitAnswer(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}

        {phase === 'followup' && (
          <>
            <h3 className="pmf-modal__title">Thanks! One more thing</h3>
            <p className="pmf-modal__question">
              {answer === 'very_disappointed'
                ? "What's the main benefit you get from LinkinReachly?"
                : answer === 'somewhat_disappointed'
                  ? 'What could we do to make LinkinReachly indispensable for you?'
                  : 'What would make you use LinkinReachly more?'}
            </p>
            <textarea
              className="pmf-textarea"
              placeholder="Your answer\u2026"
              value={benefit}
              onChange={(e) => setBenefit(e.target.value)}
              rows={3}
              maxLength={1000}
              autoFocus
            />
            <div className="pmf-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void submitFinal()}
              >
                Skip
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void submitFinal()}
              >
                Send
              </button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <div className="pmf-done">
            <span className="pmf-done__check">{'\u2713'}</span>
            <p>Thanks {'\u2014'} this genuinely helps us build a better product.</p>
          </div>
        )}
      </div>
    </div>
  )
}
