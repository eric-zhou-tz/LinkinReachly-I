/**
 * ResumeGateScreen — full-screen blocking gate.
 *
 * Shown whenever `readyToApply` is false (missing name, email, or resume).
 * Replaces 6 scattered onboarding/profile surfaces with a single gate.
 *
 * Two sub-states:
 *   1. Drop zone — user uploads resume (drag-and-drop + click-to-browse)
 *   2. Profile confirm — checklist card (V5 design) with inline editing
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getLoa } from '@/loa-client'

type EducationEntry = { school: string; degree: string; field: string; year: number | null }
type WorkEntry = { title: string; company: string; startYear: number | null; endYear: number | null }

type ProfileSnapshot = {
  firstName: string
  lastName: string
  email: string
  phone: string
  location: string
  resumeFileName: string
  resumeSizeBytes: number
  experienceCount: number
  educationSummary: string
  skillCount: number
  educationHistory: EducationEntry[]
  workHistory: WorkEntry[]
}

type Props = {
  onReady: () => void
}

const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.md']
const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown'
]
const LINKEDIN_SIZE_LIMIT = 2 * 1024 * 1024 // 2 MB

type EditableField = 'firstName' | 'lastName' | 'email' | 'phone' | 'location'

function fileAccepted(file: File): boolean {
  if (ACCEPTED_MIME_TYPES.includes(file.type)) return true
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  return ACCEPTED_EXTENSIONS.includes(ext)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function track(step: string, meta?: Record<string, unknown>): void {
  void getLoa().trackOnboarding(step, meta).catch(() => {})
}

export function ResumeGateScreen({ onReady }: Props) {
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null)

  // Inline edit state for confirm card
  const [editingField, setEditingField] = useState<EditableField | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)

  const dragCounterRef = useRef(0)
  const trackedRef = useRef(false)

  useEffect(() => {
    if (!trackedRef.current) {
      trackedRef.current = true
      track('resume_gate_shown')
    }
  }, [])

  // On mount, check if profile already has data (e.g. user deleted resume then re-uploaded)
  useEffect(() => {
    void (async () => {
      try {
        const r = await getLoa().applicantGet()
        if (r.ok) {
          const p = r.profile
          const resume = p.assets.find((a: { kind: string }) => a.kind === 'resume')
          const firstName = (p.basics.fullName || '').split(/\s+/)[0]?.trim()
          const lastName = (p.basics.fullName || '').split(/\s+/).slice(1).join(' ').trim()
          if (resume && firstName && lastName && p.basics.email.trim()) {
            onReady()
          }
        }
      } catch { /* best effort */ }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-open the first empty required field for editing when profile arrives
  useEffect(() => {
    if (!profile || editingField) return
    if (!profile.firstName.trim()) { setEditingField('firstName'); setEditValue('') }
    else if (!profile.lastName.trim()) { setEditingField('lastName'); setEditValue('') }
    else if (!profile.email.trim()) { setEditingField('email'); setEditValue('') }
    else if (!profile.phone.trim()) { setEditingField('phone'); setEditValue('') }
  }, [profile, editingField])

  const buildSnapshot = useCallback(async (): Promise<ProfileSnapshot | null> => {
    try {
      const r = await getLoa().applicantGet()
      if (!r.ok) return null
      const p = r.profile
      const resume = p.assets.find((a: { kind: string }) => a.kind === 'resume')
      const expCount = p.background.yearsOfExperience
        ? 1 // We don't have a positions array, just the summary
        : 0
      // Split fullName into first/last
      const fullName = p.basics.fullName || ''
      const nameParts = fullName.trim().split(/\s+/)
      const firstName = nameParts[0] || ''
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : ''
      return {
        firstName,
        lastName,
        email: p.basics.email || '',
        phone: p.basics.phone || '',
        location: [p.basics.city, p.basics.state].filter(Boolean).join(', '),
        resumeFileName: resume?.fileName || '',
        resumeSizeBytes: resume?.sizeBytes || 0,
        experienceCount: expCount,
        educationSummary: p.background.educationSummary || '',
        skillCount: 0,
        educationHistory: Array.isArray(p.background.educationHistory) ? p.background.educationHistory : [],
        workHistory: Array.isArray(p.background.workHistory) ? p.background.workHistory : [],
      }
    } catch {
      return null
    }
  }, [])

  const handleUploadClick = useCallback(async () => {
    if (uploading) return
    setUploading(true)
    setError(null)
    try {
      const result = await getLoa().applicantUploadResume()
      if (result.ok) {
        track('resume_gate_uploaded', { method: 'click' })
        const snap = await buildSnapshot()
        if (snap) setProfile(snap)
      } else if (result.detail !== 'No file selected.') {
        setError('Couldn\u2019t process this file. Try a different format.')
      }
    } catch {
      setError('Couldn\u2019t upload the file. Please try again.')
    } finally {
      setUploading(false)
    }
  }, [uploading, buildSnapshot])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setDragOver(false)
    if (uploading) return

    const file = e.dataTransfer.files[0]
    if (!file) return

    if (!fileAccepted(file)) {
      setError('Upload a PDF, DOCX, TXT, or Markdown file.')
      return
    }

    if (file.size > LINKEDIN_SIZE_LIMIT * 2) {
      setError(`File is too large (${formatSize(file.size)}). LinkedIn limits resumes to 2 MB.`)
      return
    }

    setUploading(true)
    setError(null)
    try {
      const result = await getLoa().uploadResumeFile(file)
      if (result.ok) {
        track('resume_gate_uploaded', { method: 'drop' })
        const snap = await buildSnapshot()
        if (snap) setProfile(snap)
      } else {
        setError('Couldn\u2019t process this file. Try a different format.')
      }
    } catch {
      setError('Couldn\u2019t upload the file. Please try again.')
    } finally {
      setUploading(false)
    }
  }, [uploading, buildSnapshot])

  const handleFieldEdit = useCallback((field: EditableField) => {
    if (!profile) return
    setEditingField(field)
    setEditValue(
      field === 'firstName' ? profile.firstName :
      field === 'lastName' ? profile.lastName :
      field === 'email' ? profile.email :
      field === 'phone' ? profile.phone :
      profile.location
    )
  }, [profile])

  const handleFieldSave = useCallback(async () => {
    if (!profile || !editingField) return
    const value = editValue.trim()

    // Required fields — don't allow blank
    if ((editingField === 'firstName' || editingField === 'lastName' || editingField === 'email') && !value) return

    setSaving(true)
    try {
      const patch: Record<string, string> = {}
      if (editingField === 'firstName') {
        // Combine with existing last name for fullName
        patch.fullName = `${value} ${profile.lastName}`.trim()
      } else if (editingField === 'lastName') {
        patch.fullName = `${profile.firstName} ${value}`.trim()
      } else if (editingField === 'email') patch.email = value
      else if (editingField === 'phone') patch.phone = value
      else if (editingField === 'location') {
        const parts = value.split(',').map(s => s.trim())
        patch.city = parts[0] || ''
        patch.state = parts[1] || ''
      }
      await getLoa().applicantSave({ basics: patch } as never)
      setProfile(prev => {
        if (!prev) return prev
        return {
          ...prev,
          firstName: editingField === 'firstName' ? value : prev.firstName,
          lastName: editingField === 'lastName' ? value : prev.lastName,
          email: editingField === 'email' ? value : prev.email,
          phone: editingField === 'phone' ? value : prev.phone,
          location: editingField === 'location' ? value : prev.location
        }
      })
      setEditingField(null)
    } catch { /* best effort */ }
    finally { setSaving(false) }
  }, [profile, editingField, editValue])

  const handleFieldCancel = useCallback(() => {
    setEditingField(null)
    setEditValue('')
  }, [])

  // Editing state for education / work entries
  const [editingEdu, setEditingEdu] = useState<number | 'new' | null>(null)
  const [eduDraft, setEduDraft] = useState<EducationEntry>({ school: '', degree: '', field: '', year: null })
  const [editingWork, setEditingWork] = useState<number | 'new' | null>(null)
  const [workDraft, setWorkDraft] = useState<WorkEntry>({ title: '', company: '', startYear: null, endYear: null })

  const canProceed = !!(profile && profile.firstName.trim() && profile.lastName.trim() && profile.email.trim())

  const saveEduEntry = useCallback(async (entry: EducationEntry, index: number | 'new') => {
    if (!profile || !entry.school.trim()) return
    const list = [...profile.educationHistory]
    if (index === 'new') list.push(entry)
    else list[index] = entry
    setSaving(true)
    try {
      await getLoa().applicantSave({ background: { educationHistory: list } } as never)
      setProfile(prev => prev ? { ...prev, educationHistory: list } : prev)
      setEditingEdu(null)
    } catch { /* best effort */ }
    finally { setSaving(false) }
  }, [profile])

  const removeEduEntry = useCallback(async (index: number) => {
    if (!profile) return
    const list = profile.educationHistory.filter((_, i) => i !== index)
    setSaving(true)
    try {
      await getLoa().applicantSave({ background: { educationHistory: list.length ? list : [] } } as never)
      setProfile(prev => prev ? { ...prev, educationHistory: list } : prev)
    } catch { /* best effort */ }
    finally { setSaving(false) }
  }, [profile])

  const saveWorkEntry = useCallback(async (entry: WorkEntry, index: number | 'new') => {
    if (!profile || (!entry.title.trim() && !entry.company.trim())) return
    const list = [...profile.workHistory]
    if (index === 'new') list.push(entry)
    else list[index] = entry
    setSaving(true)
    try {
      await getLoa().applicantSave({ background: { workHistory: list } } as never)
      setProfile(prev => prev ? { ...prev, workHistory: list } : prev)
      setEditingWork(null)
    } catch { /* best effort */ }
    finally { setSaving(false) }
  }, [profile])

  const removeWorkEntry = useCallback(async (index: number) => {
    if (!profile) return
    const list = profile.workHistory.filter((_, i) => i !== index)
    setSaving(true)
    try {
      await getLoa().applicantSave({ background: { workHistory: list.length ? list : [] } } as never)
      setProfile(prev => prev ? { ...prev, workHistory: list } : prev)
    } catch { /* best effort */ }
    finally { setSaving(false) }
  }, [profile])

  const handleProceed = useCallback(() => {
    if (!canProceed) return
    track('resume_gate_completed', {
      had_phone: !!profile?.phone,
      had_location: !!profile?.location
    })
    onReady()
  }, [canProceed, profile, onReady])

  // --- Drop zone screen ---
  if (!profile) {
    return (
      <div className="resume-gate" role="dialog" aria-labelledby="rg-heading" aria-modal="true">
        <div
          className={`resume-gate__dropzone${dragOver ? ' resume-gate__dropzone--drag' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setDragOver(true) }}
          onDragLeave={() => { dragCounterRef.current--; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDragOver(false) } }}
          onDrop={handleDrop}
        >
          <div className="resume-gate__dropzone-icon" aria-hidden="true">
            {uploading ? '\u21BB' : '\u2B1A'}
          </div>
          <h1 id="rg-heading" className="resume-gate__heading">
            {uploading ? 'Reading your resume\u2026' : 'Drop your resume here to start'}
          </h1>
          <p className="resume-gate__formats">PDF, DOCX, or TXT</p>
          <button
            type="button"
            className="btn btn-primary resume-gate__choose-btn"
            disabled={uploading}
            aria-busy={uploading}
            onClick={handleUploadClick}
          >
            {uploading ? 'Uploading\u2026' : 'Choose file'}
          </button>
          <p className="resume-gate__privacy">
            Your resume stays on your device.
            We extract your name, email, and phone to auto-fill Easy Apply forms. Your data stays on this device and is never uploaded.
          </p>
          {error && (
            <div className="resume-gate__error" role="alert">{error}</div>
          )}
        </div>
      </div>
    )
  }

  // --- Simplified confirm screen ---
  const sizeOk = profile.resumeSizeBytes <= LINKEDIN_SIZE_LIMIT
  const summaryName = `${profile.firstName} ${profile.lastName}`.trim()

  const coreFields: Array<{ field: EditableField; label: string; value: string; placeholder: string }> = [
    { field: 'firstName', label: 'First name', value: profile.firstName, placeholder: 'Your first name' },
    { field: 'lastName', label: 'Last name', value: profile.lastName, placeholder: 'Your last name' },
    { field: 'email', label: 'Email', value: profile.email, placeholder: 'you@example.com' },
  ]

  return (
    <div className="resume-gate" role="dialog" aria-labelledby="rg-heading" aria-modal="true">
      <div className="resume-gate__confirm">
        <div className="rg-checklist-header">
          <div className="rg-checklist-header__icon" aria-hidden="true">{'\u2713'}</div>
          <div className="rg-checklist-header__text">
            <h1 id="rg-heading" className="rg-checklist-header__title">
              {canProceed ? `Looking good, ${profile.firstName}` : 'Resume uploaded'}
            </h1>
            <p className="rg-checklist-header__subtitle">
              {canProceed
                ? 'We pulled this from your resume. You can edit details in Settings later.'
                : 'Fix the highlighted fields to continue.'}
            </p>
          </div>
        </div>

        <ul className="rg-checklist" role="list">
          {coreFields.map(({ field, label, value, placeholder }) => {
            const filled = !!value.trim()
            const isEditing = editingField === field

            return (
              <li key={field} className="rg-checklist__item">
                <div className={`rg-checklist__dot ${filled ? 'rg-checklist__dot--done' : 'rg-checklist__dot--missing'}`}>
                  {filled ? '\u2713' : '\u2022'}
                </div>
                <div className="rg-checklist__body">
                  <div className="rg-checklist__label">
                    {label}
                    {!filled && <span className="rg-checklist__req">{'\u00b7'} required</span>}
                  </div>
                  {isEditing ? (
                    <div className="rg-checklist__edit-row">
                      <ChecklistInput
                        type={field === 'email' ? 'email' : 'text'}
                        value={editValue}
                        placeholder={placeholder}
                        onChange={setEditValue}
                        onSave={handleFieldSave}
                        onCancel={handleFieldCancel}
                      />
                      <button
                        type="button"
                        className="rg-checklist__save-btn"
                        disabled={saving || !editValue.trim()}
                        aria-busy={saving}
                        onClick={handleFieldSave}
                      >
                        {saving ? '\u2026' : 'Save'}
                      </button>
                      <button type="button" className="rg-checklist__cancel-btn" onClick={handleFieldCancel}>Cancel</button>
                    </div>
                  ) : (
                    <div className={`rg-checklist__value ${!filled ? 'rg-checklist__value--empty' : ''}`}>
                      {filled ? value : 'Required'}
                    </div>
                  )}
                </div>
                {!isEditing && (
                  <div className="rg-checklist__action">
                    <button
                      type="button"
                      className={`rg-checklist__action-btn ${!filled ? 'rg-checklist__action-btn--missing' : ''}`}
                      onClick={() => handleFieldEdit(field)}
                    >
                      {filled ? 'Edit' : 'Add'}
                    </button>
                  </div>
                )}
              </li>
            )
          })}

          <li className="rg-checklist__item">
            <div className="rg-checklist__dot rg-checklist__dot--done">{'\u2713'}</div>
            <div className="rg-checklist__body">
              <div className="rg-checklist__label">Resume</div>
              <div className="rg-checklist__value rg-checklist__value--file">
                {profile.resumeFileName}
                <span className={`rg-checklist__size-badge ${sizeOk ? 'rg-checklist__size-badge--ok' : 'rg-checklist__size-badge--warn'}`}>
                  {formatSize(profile.resumeSizeBytes)}
                </span>
              </div>
            </div>
          </li>
        </ul>

        {!sizeOk && (
          <p className="resume-gate__size-warn" role="alert">
            {'\u26A0'} LinkedIn limits resumes to 2 MB. Yours is {formatSize(profile.resumeSizeBytes)}.
          </p>
        )}

        <button
          type="button"
          className="btn btn-primary resume-gate__proceed-btn"
          disabled={!canProceed}
          onClick={handleProceed}
        >
          Looks good {'\u2192'}
        </button>

        <button
          type="button"
          className="link-button resume-gate__change-resume"
          onClick={() => { setProfile(null); setError(null) }}
        >
          Upload a different resume
        </button>
      </div>
    </div>
  )
}

// --- Checklist input with auto-focus ---
function ChecklistInput({
  type,
  value,
  placeholder,
  onChange,
  onSave,
  onCancel
}: {
  type: string
  value: string
  placeholder: string
  onChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <input
      ref={inputRef}
      type={type}
      className="rg-checklist__input"
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') void onSave()
        if (e.key === 'Escape') onCancel()
      }}
    />
  )
}
