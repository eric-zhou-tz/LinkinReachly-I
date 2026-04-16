import { describe, expect, it } from 'vitest'
import {
  easyApplyFieldAppearsFilled,
  pickHearAboutSelectOption
} from '@core/easy-apply-field-state'

describe('easyApplyFieldAppearsFilled', () => {
  it('treats radio/checkbox "false" as not filled', () => {
    expect(easyApplyFieldAppearsFilled({ type: 'radio', value: 'false' })).toBe(false)
    expect(easyApplyFieldAppearsFilled({ type: 'checkbox', value: 'false' })).toBe(false)
  })

  it('treats radio/checkbox "true" as filled', () => {
    expect(easyApplyFieldAppearsFilled({ type: 'radio', value: 'true' })).toBe(true)
    expect(easyApplyFieldAppearsFilled({ type: 'checkbox', value: 'true' })).toBe(true)
  })

  it('accepts "1" for boolean-ish controls', () => {
    expect(easyApplyFieldAppearsFilled({ type: 'radio', value: '1' })).toBe(true)
  })

  it('treats non-empty text as filled', () => {
    expect(easyApplyFieldAppearsFilled({ type: 'text', value: 'hello' })).toBe(true)
    expect(easyApplyFieldAppearsFilled({ type: 'text', value: 'false' })).toBe(true)
  })

  it('treats missing or blank as not filled', () => {
    expect(easyApplyFieldAppearsFilled({ type: 'text', value: '' })).toBe(false)
    expect(easyApplyFieldAppearsFilled({ type: 'radio', value: '  ' })).toBe(false)
  })

  it('treats select placeholder labels as not filled', () => {
    expect(easyApplyFieldAppearsFilled({ type: 'select', value: 'Select an option' })).toBe(false)
    expect(easyApplyFieldAppearsFilled({ type: 'select', value: '  select option  ' })).toBe(false)
    expect(easyApplyFieldAppearsFilled({ type: 'select', value: 'Choose one' })).toBe(false)
    expect(easyApplyFieldAppearsFilled({ type: 'select', value: 'Please select…' })).toBe(false)
    expect(easyApplyFieldAppearsFilled({ type: 'select', value: 'Selectionnez une option' })).toBe(false)
    expect(easyApplyFieldAppearsFilled({ type: 'select', value: 'Seleccione una opcion' })).toBe(false)
    expect(easyApplyFieldAppearsFilled({ type: 'select', value: 'Selecione uma opcao' })).toBe(false)
    expect(easyApplyFieldAppearsFilled({ type: 'select', value: "Seleziona un'opzione" })).toBe(false)
    expect(easyApplyFieldAppearsFilled({ type: 'select', value: 'Wahlen Sie eine Option' })).toBe(false)
  })

  it('treats real select values as filled', () => {
    expect(easyApplyFieldAppearsFilled({ type: 'select', value: 'Linked In' })).toBe(true)
    expect(easyApplyFieldAppearsFilled({ type: 'select', value: 'Indeed' })).toBe(true)
  })

  it('pickHearAboutSelectOption prefers Linked In–style labels from options', () => {
    const opts = [
      'Select an option',
      'Social Media (Facebook, Instagram, etc)',
      'Referral',
      'Linked In',
      'Indeed'
    ]
    expect(pickHearAboutSelectOption(opts)).toBe('Linked In')
  })

  it('pickHearAboutSelectOption skips localized placeholder labels', () => {
    const opts = [
      'Selectionnez une option',
      'Seleccione una opcion',
      'LinkedIn',
      'Referral'
    ]
    expect(pickHearAboutSelectOption(opts)).toBe('LinkedIn')
  })
})
