import { describe, expect, it } from 'vitest'
import {
  classifyEasyApplyFileFieldLabel,
  planEasyApplyFileUploads
} from '../../../src/core/easy-apply-file-upload'

describe('easy-apply-file-upload', () => {
  it('classifies resume vs cover labels', () => {
    expect(classifyEasyApplyFileFieldLabel('Résumé/CV')).toBe('resume')
    expect(classifyEasyApplyFileFieldLabel('Cover letter')).toBe('cover_letter')
    expect(classifyEasyApplyFileFieldLabel('Be sure to include an updated cover letter')).toBe('cover_letter')
    expect(classifyEasyApplyFileFieldLabel('Letter of intent')).toBe('cover_letter')
    expect(classifyEasyApplyFileFieldLabel('Attach document')).toBe('unknown')
  })

  it('plans uploads in resume-before-cover order', () => {
    const fields = [{ label: 'Cover letter' }, { label: 'Resume' }]
    expect(planEasyApplyFileUploads(fields, true, true)).toEqual(['resume', 'cover_letter'])
  })

  it('single unknown file field defaults to resume when resume exists', () => {
    expect(planEasyApplyFileUploads([{ label: 'Upload' }], true, false)).toEqual(['resume'])
  })
})
