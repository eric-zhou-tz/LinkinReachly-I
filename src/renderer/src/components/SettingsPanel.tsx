import { useState, useCallback, useRef, useEffect } from 'react'
import { AnswerBank } from '@/components/AnswerBank'

import { isFeatureGated, type PlanState } from '@/hooks/usePlanState'
import { DEFAULT_APPLY_DAILY_CAP } from '@core/plan-config'
import { getLoa } from '@/loa-client'
import type { useAppModel } from '@/hooks/useAppModel'

const PACE_PRESETS: Record<string, { min: number; max: number }> = {
  careful: { min: 30, max: 120 },
  normal: { min: 12, max: 45 },
  fast: { min: 5, max: 20 }
}

export interface SettingsPanelProps {
  model: ReturnType<typeof useAppModel>
  planState: PlanState
  answerBankCount: number | null
  addToast: (message: string, tone: 'info' | 'ok' | 'warn' | 'error' | 'success') => void
  onRestartSetup: () => void
}

export function SettingsPanel({ model, planState, answerBankCount, addToast, onRestartSetup }: SettingsPanelProps) {
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const saveStateRef = useRef(saveState)
  saveStateRef.current = saveState
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  const [updateCheckBusy, setUpdateCheckBusy] = useState(false)
  const [backupFeedback, setBackupFeedback] = useState<string | null>(null)
  const [backupBusy, setBackupBusy] = useState<'idle' | 'exporting' | 'importing'>('idle')
  const [cacheClearBusy, setCacheClearBusy] = useState(false)
  const [cacheClearConfirm, setCacheClearConfirm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [restoreBusy, setRestoreBusy] = useState(false)

  const triggerSettingsSave = useCallback(() => {
    if (saveStateRef.current === 'saving') return
    if (!model.setupDirty) return
    setSaveState('saving')
    setSaveError(null)
    void model
      .saveSetup()
      .then((ok) => {
        if (!ok) {
          setSaveState('idle')
          return
        }
        setSaveState('saved')
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => setSaveState('idle'), 1500)
      })
      .catch((err) => {
        setSaveState('idle')
        setSaveError('Couldn\u2019t save settings. Try again.')
      })
  }, [model])

  useEffect(() => {
    const handler = () => triggerSettingsSave()
    window.addEventListener('loa:settings-save', handler)
    return () => window.removeEventListener('loa:settings-save', handler)
  }, [triggerSettingsSave])

  if (!model.settings) return null

  return (
    <div role="tabpanel" id="panel-settings" aria-labelledby="tab-settings" aria-describedby="panel-settings-desc" className="wizard settings-panel settings-panel--s5">
      <p id="panel-settings-desc" className="sr-only">
        Configure AI outreach, daily limits, send pace, and saved answers.
      </p>
      <>

        {/* Section 1: AI Messages */}
        <details className={`settings-card s-card${model.settings.llmEnabled && model.settings.apiKeyPresent ? '' : ' settings-card--unconfigured'}`} id="settings-ai">
          <summary className="settings-card__title">
            <span>AI Outreach</span>
            <span className={`settings-card__status ${model.settings.llmEnabled && model.settings.apiKeyPresent ? 'settings-card__status--configured' : 'settings-card__status--unconfigured'}`}>
              <span className={`settings-card__status-dot ${model.settings.llmEnabled && model.settings.apiKeyPresent ? 'settings-card__status-dot--configured' : 'settings-card__status-dot--unconfigured'}`} />
              {model.settings.llmEnabled && model.settings.apiKeyPresent ? 'Configured' : model.settings.llmEnabled ? 'Needs API key' : 'Not configured'}
            </span>
          </summary>
            <label className={`checkbox-row${isFeatureGated('ai_personalized_messages', planState.plan) ? ' gated' : ''}`} htmlFor="s-llm-enabled">
              <input id="s-llm-enabled" type="checkbox" checked={model.settings.llmEnabled} onChange={(e) => { if (!model.settings) return; model.setSettings({ ...model.settings, llmEnabled: e.target.checked }) }} disabled={isFeatureGated('ai_personalized_messages', planState.plan)} />
              <span>Let AI write personalized messages</span>
              {isFeatureGated('ai_personalized_messages', planState.plan) && <span className="gate-badge">Plus</span>}
            </label>
            {model.settings.llmEnabled && (
              <p className="field-hint">AI drafts are suggestions {'\u2014'} you decide what gets sent.</p>
            )}
            <label className="field field-span" htmlFor="s-must-include">Words to include in every message (optional)
              <textarea id="s-must-include" className="settings-must-include" rows={2} spellCheck={false} maxLength={500} value={model.mustIncludeInput} onChange={(e) => model.setMustIncludeInput(e.target.value)} placeholder="e.g. peer in the allocator space&#10;One phrase per line" />
            </label>

            <hr className="settings-divider settings-divider--light" aria-hidden="true" />

            <p className="field-hint">Custom instructions (optional)</p>
              <div className="wizard-chips wizard-chips--mb">
                {[
                  { label: 'First name', token: '{firstName}' },
                  { label: 'Company', token: '{company}' },
                  { label: 'Headline', token: '{headline}' },
                  { label: 'My background', token: '{senderBackground}' },
                  { label: 'Goal', token: '{goal}' }
                ].map(({ label, token }) => (
                  <button
                    key={token}
                    type="button"
                    className="btn btn-ghost btn-chip"
                    onClick={() => {
                      const el = document.getElementById('s-custom-prompt') as HTMLTextAreaElement | null
                      if (!el) return
                      const start = el.selectionStart
                      const end = el.selectionEnd
                      const current = model.settings?.customOutreachPrompt || ''
                      const next = current.slice(0, start) + token + current.slice(end)
                      model.setSettings({ ...model.settings!, customOutreachPrompt: next })
                      setTimeout(() => {
                        el.focus()
                        el.selectionStart = el.selectionEnd = start + token.length
                      }, 0)
                    }}
                    aria-label={`Insert ${label} placeholder (${token}) into message instructions`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="field field-span" htmlFor="s-custom-prompt">Message instructions
                <textarea
                  id="s-custom-prompt"
                  rows={4}
                  spellCheck={false}
                  value={model.settings.customOutreachPrompt || ''}
                  maxLength={2000}
                  onChange={(e) => model.setSettings({ ...model.settings!, customOutreachPrompt: e.target.value })}
                  placeholder={'Example: Write a warm, concise connection note. Mention {firstName}\'s work at {company} and explain that I\'m exploring AI roles. Keep it under 200 characters. Be genuine, not salesy.'}
                />
              </label>

        </details>

        <hr className="settings-divider" aria-hidden="true" />

        {/* Section 2: Speed and Limits */}
        <details className="settings-card s-card" id="settings-limits">
          <summary className="settings-card__title">
            <span>Speed and limits</span>
            <span className="settings-card__status settings-card__status--configured">
              <span className="settings-card__status-dot settings-card__status-dot--configured" />
              Configured
            </span>
          </summary>
            <div className="two-col">
              <label className="field">Max invites / day<input type="number" min={1} max={Math.min(100, model.settings!.weeklyConnectionCap ?? 60)} value={model.settings.dailyCap} onChange={(e) => { const v = Math.max(1, Math.min(model.settings!.weeklyConnectionCap ?? 60, Number(e.target.value) || 1)); model.setSettings({ ...model.settings!, dailyCap: v }) }} /></label>
              <label className="field">Max applications / day<input type="number" min={1} max={100} value={model.settings.applyDailyCap ?? DEFAULT_APPLY_DAILY_CAP} onChange={(e) => { const v = Math.max(1, Math.min(100, Number(e.target.value) || 1)); model.setSettings({ ...model.settings!, applyDailyCap: v }) }} /></label>
            </div>
            <label className="field mt-xs">Weekly connection limit<input type="number" min={5} max={200} value={model.settings.weeklyConnectionCap ?? 60} onChange={(e) => { const v = Math.max(5, Math.min(200, Number(e.target.value) || 60)); model.setSettings({ ...model.settings!, weeklyConnectionCap: v }) }} /></label>
            <p className="field-hint">Daily invites are clamped to this weekly total. Most users get best results under 100/week.</p>
            {(model.settings.dailyCap > 50 || (model.settings.applyDailyCap ?? DEFAULT_APPLY_DAILY_CAP) > 50) && <div className="sui-warning mt-xs">Higher volumes may slow down. We recommend 20–50 per day for best results.</div>}
            <label className="field mt-sm">Pace
              <select value={
                model.settings.delayBetweenRequestsMin <= 10 && model.settings.delayBetweenRequestsMax <= 30 ? 'fast'
                : model.settings.delayBetweenRequestsMin >= 30 && model.settings.delayBetweenRequestsMax >= 90 ? 'careful'
                : 'normal'
              } onChange={(e) => {
                const p = PACE_PRESETS[e.target.value] || PACE_PRESETS.normal
                model.setSettings({ ...model.settings!, delayBetweenRequestsMin: p.min, delayBetweenRequestsMax: p.max })
              }}>
                <option value="careful">Careful (30–120s between people)</option>
                <option value="normal">Normal (12–45s between people)</option>
                <option value="fast">Fast (5–20s between people)</option>
              </select>
            </label>
            <p className="field-hint">
              <strong>Careful</strong> is the recommended default for natural pacing. <strong>Fast</strong> sends quicker but may see occasional slowdowns.
            </p>
            <label className="checkbox-row mt-sm" htmlFor="s-review-before-submit">
              <input
                id="s-review-before-submit"
                type="checkbox"
                checked={!!model.settings.reviewBeforeSubmit}
                onChange={(e) => model.setSettings({ ...model.settings!, reviewBeforeSubmit: e.target.checked })}
              />
              <span>Review form before submit (pause for manual review)</span>
            </label>
            <p className="field-hint">
              When enabled, Easy Apply pauses after AI fills the form so you can review in Chrome before submitting. Retry the job to submit.
            </p>
            <label className={`checkbox-row mt-sm${isFeatureGated('follow_up_automation', planState.plan) ? ' gated' : ''}`} htmlFor="s-auto-outreach">
              <input
                id="s-auto-outreach"
                type="checkbox"
                checked={model.settings.autoSuggestOutreachAfterApply !== false}
                onChange={(e) => model.setSettings({ ...model.settings!, autoSuggestOutreachAfterApply: e.target.checked })}
                disabled={isFeatureGated('follow_up_automation', planState.plan)}
              />
              <span>Auto-connect with hiring managers after applying</span>
              {isFeatureGated('follow_up_automation', planState.plan) && <span className="gate-badge">Plus</span>}
            </label>
            <p className="field-hint">
              After the apply queue finishes, automatically sends connection requests to hiring managers at companies you applied to.
            </p>
            <label className="field field-span mt-xs" htmlFor="s-custom-followup-dm">Custom follow-up message template (optional)
              <textarea
                id="s-custom-followup-dm"
                rows={3}
                spellCheck={false}
                value={model.settings.customFollowUpDmTemplate || ''}
                maxLength={2000}
                onChange={(e) => model.setSettings({ ...model.settings!, customFollowUpDmTemplate: e.target.value })}
                placeholder={'Hi {firstName}, thanks for connecting! I applied for {jobTitle} at {company} and would love to learn about the team.'}
              />
            </label>
            <p className="field-hint">
              Placeholders: {'{firstName}'}, {'{company}'}, {'{jobTitle}'}. Leave blank for smart defaults that reference the role you applied to.
            </p>
        </details>

        <hr className="settings-divider" aria-hidden="true" />

        {/* Section 3: Answer Bank */}
        <details className={`settings-card s-card${answerBankCount != null && answerBankCount > 0 ? '' : ' settings-card--unconfigured'}`} id="settings-answer-bank">
          <summary className="settings-card__title">
            <span>Saved answers{answerBankCount != null && answerBankCount > 0 ? ` (${answerBankCount})` : ''}</span>
            <span className={`settings-card__status ${answerBankCount != null && answerBankCount > 0 ? 'settings-card__status--configured' : 'settings-card__status--unconfigured'}`}>
              <span className={`settings-card__status-dot ${answerBankCount != null && answerBankCount > 0 ? 'settings-card__status-dot--configured' : 'settings-card__status-dot--unconfigured'}`} />
              {answerBankCount != null && answerBankCount > 0 ? 'Configured' : 'Not configured'}
            </span>
          </summary>
          <div>
            <p className="field-hint">Auto-fill for Easy Apply screening questions.</p>
            <AnswerBank />
          </div>
        </details>

        <hr className="settings-divider" aria-hidden="true" />

        <details className="settings-card s-card" id="settings-backup">
          <summary className="settings-card__title">
            <span>Backup &amp; Data</span>
          </summary>
          <div>
            <div className="wizard-actions settings-actions">
              <button type="button" className="btn btn-ghost" disabled={backupBusy !== 'idle'} aria-busy={backupBusy === 'exporting'} onClick={async () => { setBackupBusy('exporting'); try { const r = await getLoa().backupExport(); setBackupFeedback(r.detail); setTimeout(() => setBackupFeedback(null), 5000) } catch (err) { setBackupFeedback(err instanceof Error ? err.message : 'Couldn\u2019t export backup.'); setTimeout(() => setBackupFeedback(null), 5000) } finally { setBackupBusy('idle') } }}>
                {backupBusy === 'exporting' ? 'Exporting\u2026' : 'Export backup'}
              </button>
              <button type="button" className="btn btn-ghost" disabled={backupBusy !== 'idle'} aria-busy={backupBusy === 'importing'} onClick={async () => { setBackupBusy('importing'); try { const r = await getLoa().backupImport(); if (r.ok) { setBackupFeedback(r.detail); setTimeout(() => window.location.reload(), 1500) } else { setBackupFeedback(r.detail); setTimeout(() => setBackupFeedback(null), 5000) } } catch (err) { setBackupFeedback(err instanceof Error ? err.message : 'Couldn\u2019t import backup.'); setTimeout(() => setBackupFeedback(null), 5000) } finally { setBackupBusy('idle') } }}>
                {backupBusy === 'importing' ? 'Importing\u2026' : 'Import backup'}
              </button>
            </div>
            <div className="settings-danger-zone">
              <p className="muted settings-danger-zone__label">Account</p>
              {!cacheClearConfirm ? (
                <button type="button" className="btn btn-ghost btn--danger" disabled={cacheClearBusy} onClick={() => setCacheClearConfirm(true)}>
                  Clear all cache
                </button>
              ) : (
                <div className="danger-confirm-row">
                  <span className="danger-confirm-row__text">This cannot be undone. Settings preserved.</span>
                  <button type="button" className="btn btn-ghost btn--danger" disabled={cacheClearBusy} aria-busy={cacheClearBusy} onClick={async () => { setCacheClearBusy(true); try { const r = await getLoa().cacheClearAll(); setBackupFeedback(r.detail); try { for (const key of Object.keys(localStorage)) { if (key.startsWith('loa.cache.') || key.startsWith('loa.jobsSearch') || key === 'linkinreachly:v1:local-applicant-draft') localStorage.removeItem(key) } } catch { /* best-effort */ } setTimeout(() => window.location.reload(), 2000) } catch (e) { setBackupFeedback(e instanceof Error ? e.message : String(e)); setTimeout(() => setBackupFeedback(null), 5000) } finally { setCacheClearBusy(false); setCacheClearConfirm(false) } }}>
                    {cacheClearBusy ? 'Clearing\u2026' : 'Confirm clear'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCacheClearConfirm(false)}>Cancel</button>
                </div>
              )}
            </div>
            <label className="checkbox-row mt-sm">
              <input
                type="checkbox"
                checked={!!model.settings?.telemetryOptIn}
                onChange={(e) => model.setSettings({ ...model.settings!, telemetryOptIn: e.target.checked })}
              />
              <span>Share anonymous usage data to help improve LinkinReachly</span>
            </label>
            <hr className="settings-divider" aria-hidden="true" />
            <p className="muted settings-danger-zone__label">Account</p>
            <div className="wizard-actions settings-actions">
              <button type="button" className="btn btn-ghost" disabled={restoreBusy} aria-busy={restoreBusy} onClick={async () => {
                setRestoreBusy(true)
                try {
                  const r = await getLoa().accountRestorePurchases()
                  if (r.ok) { addToast('Plan status refreshed', 'ok') } else { addToast(r.error || 'Could not restore', 'error') }
                } catch (e) { addToast(e instanceof Error ? e.message : 'Something went wrong', 'error') }
                finally { setRestoreBusy(false) }
              }}>
                {restoreBusy ? 'Checking\u2026' : 'Restore purchases'}
              </button>
            </div>
            <div className="settings-danger-zone" style={{ marginTop: '0.75rem' }}>
              {!deleteConfirm ? (
                <button type="button" className="btn btn-ghost btn--danger" onClick={() => setDeleteConfirm(true)}>
                  Delete my account
                </button>
              ) : (
                <div className="danger-confirm-row">
                  <span className="danger-confirm-row__text">This permanently deletes your account and server-side data.</span>
                  <button type="button" className="btn btn-ghost btn--danger" disabled={deleteBusy} aria-busy={deleteBusy} onClick={async () => {
                    setDeleteBusy(true)
                    try {
                      const r = await getLoa().accountDelete()
                      if (r.ok) { addToast('Account deleted. Local data remains on your device.', 'info'); setTimeout(() => window.location.reload(), 2000) }
                      else { addToast(r.error || 'Account couldn\u2019t be deleted', 'error') }
                    } catch (e) { addToast(e instanceof Error ? e.message : 'Something went wrong', 'error') }
                    finally { setDeleteBusy(false); setDeleteConfirm(false) }
                  }}>
                    {deleteBusy ? 'Deleting\u2026' : 'Confirm delete'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(false)}>Cancel</button>
                </div>
              )}
            </div>
            {backupFeedback && <div className="wizard-feedback wizard-feedback--ok" role="status">{backupFeedback}</div>}
          </div>
        </details>

        <div className="settings-about-row">
          <span className="settings-about-version">v{window.loa?.getAppVersion?.() ?? '?.?.?'}</span>
          <button type="button" className="btn btn-ghost btn-xs" disabled={updateCheckBusy} onClick={async () => {
            setUpdateCheckBusy(true)
            try {
              const result = await getLoa().updaterCheckForUpdates()
              if (result.status === 'dev') addToast('Update check skipped (dev mode)', 'info')
              else if (result.status === 'error') addToast(`Update check failed: ${result.message}`, 'error')
              else if (result.version) addToast(`Update v${result.version} available`, 'ok')
              else addToast('You\u2019re on the latest version', 'ok')
            } catch { addToast('Update check failed', 'error') }
            finally { setUpdateCheckBusy(false) }
          }}>{updateCheckBusy ? 'Checking\u2026' : 'Check for updates'}</button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => void getLoa().openExternalUrl('https://linkinreachly.com/help')}>Help & FAQ</button>
        </div>
        <div className="settings-contact-row">
          <span>Bug, idea, or question? Email us directly {'\u2014'} we reply to every message.</span>
          <button type="button" className="btn btn-ghost" onClick={() => void getLoa().openExternalUrl('mailto:hello@linkinreachly.com')}>
            hello@linkinreachly.com
          </button>
        </div>

        <div className="v7-save-footer">
          <button type="button" className="btn btn-ghost" onClick={onRestartSetup}>
            Restart setup guide
          </button>
          <button
            type="button"
            className={`btn btn-primary ${saveState === 'saved' ? 'btn-primary--saved' : ''}`}
            disabled={saveState === 'saving' || !model.setupDirty}
            aria-busy={saveState === 'saving' ? true : undefined}
            onClick={triggerSettingsSave}
            title={model.setupDirty ? 'Save settings (\u2318S)' : 'No changes to save'}
          >
            {saveState === 'saving' ? 'Saving\u2026' : saveState === 'saved' ? '\u2713 Saved' : 'Save'}
          </button>
          {model.setupFeedback?.type === 'success' && <div className="wizard-feedback wizard-feedback--ok" role="status">{model.setupFeedback.message}</div>}
          {saveError && (
            <div className="wizard-feedback wizard-feedback--error" role="alert">
              <strong>Could not save.</strong> {saveError}
              <div className="mt-xs">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSaveError(null); triggerSettingsSave() }}>Retry</button>
              </div>
            </div>
          )}
          {model.setupFeedback?.type === 'error' && (
            <div className="wizard-feedback wizard-feedback--error" role="alert">
              <strong>Could not save.</strong> {model.setupFeedback.message}
              <div className="mt-xs">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={saveState === 'saving'}
                  aria-busy={saveState === 'saving'}
                  onClick={() => triggerSettingsSave()}
                >
                  {saveState === 'saving' ? 'Retrying\u2026' : 'Retry save'}
                </button>
              </div>
            </div>
          )}
        </div>
      </>
    </div>
  )
}
