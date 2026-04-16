import { describe, expect, it } from 'vitest'
import { normalizeFieldLabelForSnapshotMatch } from '@core/field-name-aliases'

describe('normalizeFieldLabelForSnapshotMatch', () => {
  it('normalizes work authorization variants', () => {
    expect(normalizeFieldLabelForSnapshotMatch('Work auth question')).toContain('Work Authorization')
    expect(normalizeFieldLabelForSnapshotMatch('work authorization status')).toContain('Work Authorization')
  })

  it('normalizes country/region to Country', () => {
    expect(normalizeFieldLabelForSnapshotMatch('Country / Region')).toBe('Country')
    expect(normalizeFieldLabelForSnapshotMatch('country/region')).toBe('Country')
  })

  it('normalizes LinkedIn URL variants', () => {
    expect(normalizeFieldLabelForSnapshotMatch('LinkedIn profile URL')).toBe('LinkedIn')
    expect(normalizeFieldLabelForSnapshotMatch('LinkedIn URL')).toBe('LinkedIn')
    expect(normalizeFieldLabelForSnapshotMatch('LinkedIn')).toBe('LinkedIn')
  })

  it('normalizes phone variants', () => {
    expect(normalizeFieldLabelForSnapshotMatch('Phone Number')).toBe('Phone')
    expect(normalizeFieldLabelForSnapshotMatch('Mobile phone')).toBe('Phone')
  })

  it('normalizes email variants', () => {
    expect(normalizeFieldLabelForSnapshotMatch('Email address')).toBe('Email')
    expect(normalizeFieldLabelForSnapshotMatch('E-mail Address')).toBe('Email')
    expect(normalizeFieldLabelForSnapshotMatch('sign-in email')).toBe('Email')
    expect(normalizeFieldLabelForSnapshotMatch('account email')).toBe('Email')
  })

  it('normalizes name variants', () => {
    expect(normalizeFieldLabelForSnapshotMatch('Full Legal Name')).toBe('Legal Name')
    expect(normalizeFieldLabelForSnapshotMatch('First & Last Name')).toBe('Full Name')
  })

  it('strips Workday "Legal Name -" prefix', () => {
    expect(normalizeFieldLabelForSnapshotMatch('Legal Name - First Name*')).toBe('First Name*')
    expect(normalizeFieldLabelForSnapshotMatch('Legal Name - Last Name*')).toBe('Last Name*')
    expect(normalizeFieldLabelForSnapshotMatch('Legal Name – Middle Name')).toBe('Middle Name')
  })

  it('normalizes salary/compensation variants', () => {
    expect(normalizeFieldLabelForSnapshotMatch('Desired Salary')).toBe('Desired Salary')
    expect(normalizeFieldLabelForSnapshotMatch('Salary expectation')).toBe('Salary Expectation')
    expect(normalizeFieldLabelForSnapshotMatch('salary expected')).toBe('Salary Expectation')
    expect(normalizeFieldLabelForSnapshotMatch('Compensation expectation')).toBe('Compensation Expectation')
  })

  it('normalizes education variants', () => {
    expect(normalizeFieldLabelForSnapshotMatch('Highest level of education')).toBe('Highest Education')
    expect(normalizeFieldLabelForSnapshotMatch('Highest degree')).toBe('Highest Education')
    expect(normalizeFieldLabelForSnapshotMatch('Educational background')).toBe('Education')
    expect(normalizeFieldLabelForSnapshotMatch('Educational level')).toBe('Education')
  })

  it('normalizes sponsorship and location variants', () => {
    expect(normalizeFieldLabelForSnapshotMatch('visa sponsorship')).toBe('Sponsorship')
    expect(normalizeFieldLabelForSnapshotMatch('Notice Period')).toBe('Notice Period')
    expect(normalizeFieldLabelForSnapshotMatch('Work location preference')).toBe('Work Location Preference')
    expect(normalizeFieldLabelForSnapshotMatch('work arrangement preferred')).toBe('Work Location Preference')
  })

  it('normalizes location question variants', () => {
    expect(normalizeFieldLabelForSnapshotMatch('What is your current location')).toBe(
      'What is your current location'
    )
    expect(normalizeFieldLabelForSnapshotMatch('Where do you currently live')).toBe(
      'Where do you currently live'
    )
  })

  it('passes through unrecognized labels unchanged', () => {
    expect(normalizeFieldLabelForSnapshotMatch('Cover Letter')).toBe('Cover Letter')
    expect(normalizeFieldLabelForSnapshotMatch('Custom Question 1')).toBe('Custom Question 1')
  })

  it('handles empty and whitespace input', () => {
    expect(normalizeFieldLabelForSnapshotMatch('')).toBe('')
    expect(normalizeFieldLabelForSnapshotMatch('   ')).toBe('')
  })
})
