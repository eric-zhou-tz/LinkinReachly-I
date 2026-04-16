import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXECUTION_ID,
  persistedTemplatesForExecutionSelect,
  sourceConnectionExecutionForLogEntry
} from '@core/executions'
import { DEMO_STARTER_TEMPLATES } from '@core/demo-presets'

describe('persistedTemplatesForExecutionSelect', () => {
  it('saves pack templates for ria_connection', () => {
    const t = persistedTemplatesForExecutionSelect('ria_connection')
    expect(t?.length).toBeGreaterThan(1)
  })

  it('saves demo starter for generic_connection (no pack)', () => {
    const t = persistedTemplatesForExecutionSelect('generic_connection')
    expect(t).toEqual([...DEMO_STARTER_TEMPLATES])
  })

  it('does not overwrite setup templates for post_accept_followup', () => {
    expect(persistedTemplatesForExecutionSelect('post_accept_followup')).toBeUndefined()
  })
})

describe('DEFAULT_EXECUTION_ID', () => {
  it('defaults new installs to generic_connection', () => {
    expect(DEFAULT_EXECUTION_ID).toBe('generic_connection')
  })
})

describe('sourceConnectionExecutionForLogEntry', () => {
  it('resolves follow-up source by execution id first', () => {
    expect(sourceConnectionExecutionForLogEntry({ executionId: 'ria_connection', logChannel: 'sample' })?.id).toBe(
      'ria_connection'
    )
  })

  it('falls back to log channel when older logs lack execution id', () => {
    expect(sourceConnectionExecutionForLogEntry({ logChannel: 'job' })?.id).toBe('job_signal_connection')
  })
})
