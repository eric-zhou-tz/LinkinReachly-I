import { useEffect, useRef, useState } from 'react'
import { normalizeFieldLabelForSnapshotMatch } from '@core/field-name-aliases'

interface StuckFieldsPromptProps {
  labels: string[]
  onSave: (answers: Record<string, string>) => Promise<void>
  onNavigateToAnswerBank?: () => void
  /** Called after answers are saved — retries failed items then starts queue */
  onAfterSave?: () => void | Promise<void>
  /** Compact layout: inline input+save, shorter copy */
  compact?: boolean
}

export function StuckFieldsPrompt({ labels, onSave, onNavigateToAnswerBank, onAfterSave, compact }: StuckFieldsPromptProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [savedLabels, setSavedLabels] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const labelsKey = labels.join('\u0001')

  const allSaved = compact ? (labels.length > 0 && savedLabels.size >= labels.length) : saved

  useEffect(() => {
    setSaved(false)
    setSavedLabels(new Set())
    setSaveError(null)
    setDismissed(false)
    setAnswers((prev) => {
      const next: Record<string, string> = {}
      for (const label of labels) {
        const value = prev[label]
        if (typeof value === 'string') next[label] = value
      }
      return next
    })
  }, [labelsKey])

  // Auto-dismiss the "saved" banner after 2s when auto-resume is active
  useEffect(() => {
    if (allSaved && onAfterSave) {
      const t = setTimeout(() => setDismissed(true), 2000)
      return () => clearTimeout(t)
    }
  }, [allSaved, onAfterSave])

  if (dismissed) return null

  if (allSaved) return (
    <div className="sui-stuck-fields sui-stuck-fields--saved" role="status">
      <strong>
        {'\u2713'}{' '}
        {onAfterSave
          ? (savedLabels.size === 1 ? 'Answer saved — retrying job' : 'Answers saved — retrying jobs')
          : (savedLabels.size === 1 ? 'Answer saved' : 'Answers saved')}
      </strong>
      {!onAfterSave && (
        <p className="sui-muted">These questions will auto-fill on your next run. Retry to apply them now.</p>
      )}
      {onNavigateToAnswerBank && !onAfterSave && (
        <button type="button" className="link-button" onClick={onNavigateToAnswerBank}>
          View all saved answers in Settings
        </button>
      )}
    </div>
  )

  const filledCount = Object.values(answers).filter(v => v.trim()).length

  if (compact) {
    return (
      <div className="sui-stuck-fields sui-stuck-fields--compact" role="region" aria-label="Answer stuck form questions">
        {labels.map((label) => {
          const isSaved = savedLabels.has(label)
          const thisValue = (answers[label] || '').trim()
          if (isSaved) {
            return (
              <div key={label} className="sui-stuck-fields__compact-row sui-stuck-fields__compact-row--saved">
                <label className="sui-stuck-fields__label">{label}</label>
                <span className="sui-stuck-fields__saved-badge">{'\u2713'} Saved — will auto-fill next time</span>
              </div>
            )
          }
          return (
            <div key={label} className="sui-stuck-fields__compact-row">
              <label className="sui-stuck-fields__label">{label}</label>
              <div className="sui-stuck-fields__compact-input-row">
                <input
                  ref={(el) => { inputRefs.current[label] = el }}
                  className="sui-input"
                  type="text"
                  value={answers[label] || ''}
                  onChange={(e) => setAnswers(prev => ({ ...prev, [label]: e.target.value }))}
                  placeholder="Your answer"
                  aria-label={`Answer for: ${label}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && thisValue) {
                      e.preventDefault()
                      void handleSaveSingle(label)
                    }
                  }}
                />
                <button
                  type="button"
                  className="sui-btn-save"
                  disabled={!thisValue || saving}
                  aria-busy={saving}
                  onClick={() => void handleSaveSingle(label)}
                >
                  {saving ? 'Saving\u2026' : (onAfterSave ? 'Save & retry' : 'Save')}
                </button>
              </div>
            </div>
          )
        })}
        {saveError && <span className="sui-error-inline" role="alert">{saveError}</span>}
        <div className="sui-stuck-fields__compact-actions">
          <button type="button" className="sui-btn-ghost sui-btn-ghost--sm" onClick={() => setDismissed(true)} aria-label="Skip">
            Skip
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="sui-stuck-fields" role="region" aria-label="Answer stuck form questions">
      <div className="sui-stuck-fields__header">
        <strong>{labels.length} question{labels.length === 1 ? '' : 's'} need your answer</strong>
        <button type="button" className="sui-btn-ghost sui-btn-ghost--sm" onClick={() => setDismissed(true)} aria-label="Dismiss">
          Skip
        </button>
      </div>
      <p className="sui-muted">Answer once and every future application fills them automatically.</p>
      <div className="sui-stuck-fields__list">
        {labels.map((label) => (
          <div key={label} className="sui-stuck-fields__item">
            <label className="sui-stuck-fields__label">{label}</label>
            <input
              ref={(el) => { inputRefs.current[label] = el }}
              className="sui-input"
              type="text"
              value={answers[label] || ''}
              onChange={(e) => setAnswers(prev => ({ ...prev, [label]: e.target.value }))}
              placeholder="Your answer"
              aria-label={`Answer for: ${label}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filledCount > 0) {
                  e.preventDefault()
                  void handleSave()
                }
              }}
            />
          </div>
        ))}
      </div>
      <div className="sui-stuck-fields__actions">
        <button
          type="button"
          className="sui-btn-primary sui-btn-sm"
          disabled={filledCount === 0 || saving}
          aria-busy={saving}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving\u2026' : `Save ${filledCount}/${labels.length} answer${filledCount === 1 ? '' : 's'}`}
        </button>
        {saveError && <span className="sui-error-inline" role="alert">{saveError}</span>}
        {onNavigateToAnswerBank && (
          <button type="button" className="link-button" onClick={onNavigateToAnswerBank}>
            Manage all answers
          </button>
        )}
      </div>
    </div>
  )

  async function handleSaveSingle(label: string) {
    const val = (answers[label] || '').trim()
    if (!val) return
    setSaving(true)
    setSaveError(null)
    try {
      const key = normalizeAnswerKey(label)
      await onSave({ [key]: val })
      setSavedLabels(prev => new Set([...prev, label]))
      if (onAfterSave) await onAfterSave()
    } catch (err) {
      setSaveError('Couldn\u2019t save that answer. Try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const toSave: Record<string, string> = {}
      for (const [label, val] of Object.entries(answers)) {
        const key = normalizeAnswerKey(label)
        if (val.trim() && key) toSave[key] = val.trim()
      }
      if (Object.keys(toSave).length > 0) {
        await onSave(toSave)
        setSaved(true)
        if (onAfterSave) await onAfterSave()
      }
    } catch (err) {
      setSaveError('Couldn\u2019t save answers. Try again.')
    } finally {
      setSaving(false)
    }
  }

  function normalizeAnswerKey(label: string): string {
    return normalizeFieldLabelForSnapshotMatch(label).toLowerCase().replace(/\s+/g, ' ').trim()
  }
}
