import { useCallback, useEffect, useState } from 'react'
import { getLoa } from '@/loa-client'

/** Strip doubled question labels like "foo?foo?" → "foo?" (mirrors core dedupeRepeatedScreeningLabel). */
function dedupeLabel(label: string): string {
  const text = label.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
  if (text.length < 12) return text
  for (let size = Math.floor(text.length / 2); size >= 8; size--) {
    if (text.length % size !== 0) continue
    const chunk = text.slice(0, size)
    if (chunk.repeat(text.length / size) === text) return chunk.trim()
  }
  const half = Math.floor(text.length / 2)
  for (let size = half; size >= 8; size--) {
    const chunk = text.slice(0, size).trim()
    if (text.startsWith(chunk + chunk)) return chunk
    if (text.startsWith(chunk + ' ' + chunk)) return chunk
  }
  return text
}

/** Merge duplicated keys into a clean map, keeping the latest value for collisions. */
function cleanAnswerKeys(raw: Record<string, string>): { cleaned: Record<string, string>; changed: boolean } {
  const cleaned: Record<string, string> = {}
  let changed = false
  for (const [key, value] of Object.entries(raw)) {
    const deduped = dedupeLabel(key)
    if (deduped !== key) changed = true
    cleaned[deduped] = value // later wins on collision, which is fine
  }
  return { cleaned, changed }
}

export function AnswerBank() {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newValue, setNewValue] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)

  const loadAnswers = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await getLoa().applicantGet()
      if (res.ok) {
        const raw = res.profile.screeningAnswerCache || {}
        const { cleaned, changed } = cleanAnswerKeys(raw)
        setAnswers(cleaned)
        if (changed) {
          try { await getLoa().applicantSave({ screeningAnswerCache: cleaned }) } catch { /* best-effort */ }
        }
      } else {
        setLoadError(true)
        setFeedback('Couldn\u2019t load saved answers.')
      }
    } catch {
      setLoadError(true)
      setFeedback('Couldn\u2019t load saved answers.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadAnswers() }, [loadAnswers])

  const saveAnswers = useCallback(async (next: Record<string, string>) => {
    setSaving(true)
    try {
      await getLoa().applicantSave({ screeningAnswerCache: next })
      setAnswers(next)
      setFeedback('Saved')
      setTimeout(() => setFeedback(null), 2500)
    } catch {
      setFeedback('Couldn\u2019t save \u2014 try again')
      setTimeout(() => setFeedback(null), 5000)
    } finally {
      setSaving(false)
    }
  }, [])

  const handleDelete = useCallback((key: string) => {
    if (confirmDelete !== key) {
      setConfirmDelete(key)
      return
    }
    setConfirmDelete(null)
    const next = { ...answers }
    delete next[key]
    void saveAnswers(next)
  }, [answers, saveAnswers, confirmDelete])

  const handleAdd = useCallback(async () => {
    const normKey = newLabel.trim().toLowerCase().replace(/\s+/g, ' ')
    const val = newValue.trim()
    if (!normKey || !val) return
    if (normKey in answers) {
      if (!window.confirm(`An answer for "${newLabel.trim()}" already exists. Overwrite it?`)) return
    }
    await saveAnswers({ ...answers, [normKey]: val })
    setNewLabel('')
    setNewValue('')
    setShowAddForm(false)
  }, [answers, newLabel, newValue, saveAnswers])

  const handleEditSave = useCallback((key: string) => {
    const val = editValue.trim()
    if (!val) return
    void saveAnswers({ ...answers, [key]: val })
    setEditingKey(null)
    setEditValue('')
  }, [answers, editValue, saveAnswers])

  const entries = Object.entries(answers).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="answer-bank">
      <div className="answer-bank__header">
        <h4 className="answer-bank__title">Saved Answers <span className="muted">({entries.length})</span></h4>
        {feedback && <span className="answer-bank__feedback" role="status" aria-live="polite">{feedback}</span>}
        {!showAddForm && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowAddForm(true)}
          >
            + Add answer
          </button>
        )}
      </div>

      {showAddForm && (
        <div className="answer-bank__add-inline">
          <input
            className="answer-bank__input"
            type="text"
            placeholder="Question (e.g. Years of experience with React?)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setShowAddForm(false); setNewLabel(''); setNewValue('') }
            }}
          />
          <input
            className="answer-bank__input"
            type="text"
            placeholder="Answer (e.g. 5 years)"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newLabel.trim() && newValue.trim()) void handleAdd()
              if (e.key === 'Escape') { setShowAddForm(false); setNewLabel(''); setNewValue('') }
            }}
          />
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!newLabel.trim() || !newValue.trim() || saving}
              onClick={() => void handleAdd()}
            >
              {saving ? 'Saving\u2026' : 'Add'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setShowAddForm(false); setNewLabel(''); setNewValue('') }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="wizard-feedback mt-xs" role="status" aria-live="polite">
          <span className="s-spinner" aria-hidden="true" /> Loading…
        </div>
      ) : loadError ? (
        <div className="wizard-feedback wizard-feedback--error mt-xs" role="alert">
          Couldn{'\u2019'}t load saved answers.
          <button type="button" className="btn btn-ghost btn-sm ml-sm" onClick={() => void loadAnswers()}>Retry</button>
        </div>
      ) : entries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon" aria-hidden="true">{'\u2261'}</div>
          <h3 className="empty-state__title">No saved answers yet</h3>
          <p className="empty-state__body">They&apos;ll appear here as you apply or add them below.</p>
        </div>
      ) : (
        <div className="answer-bank__list" role="list">
          {entries.map(([key, value]) => (
            <div key={key} className="answer-bank__item" role="listitem">
              {editingKey === key ? (
                <div className="answer-bank__edit-row">
                  <span className="answer-bank__label">{key}</span>
                  <input
                    className="answer-bank__input"
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleEditSave(key)}
                    autoFocus
                    aria-label={`Edit answer for: ${key}`}
                  />
                  <div className="answer-bank__item-actions">
                    <button type="button" className="btn btn-primary btn-sm" disabled={saving || !editValue.trim()} aria-busy={saving} onClick={() => handleEditSave(key)}>
                      {saving ? 'Saving\u2026' : 'Save'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingKey(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="answer-bank__content">
                    <span className="answer-bank__label">{key}</span>
                    <span className="answer-bank__value">{value}</span>
                  </div>
                  <div className="answer-bank__item-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={saving}
                      aria-busy={saving}
                      onClick={() => { setEditingKey(key); setEditValue(value) }}
                      aria-label={`Edit answer for: ${key}`}
                    >
                      {saving ? 'Working\u2026' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={saving}
                      aria-busy={saving}
                      onClick={() => handleDelete(key)}
                      aria-label={confirmDelete === key ? `Confirm delete for: ${key}` : `Delete answer for: ${key}`}
                    >
                      {saving ? 'Working\u2026' : confirmDelete === key ? 'Confirm?' : 'Delete'}
                    </button>
                    {confirmDelete === key && (
                      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setConfirmDelete(null)}>Cancel</button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
