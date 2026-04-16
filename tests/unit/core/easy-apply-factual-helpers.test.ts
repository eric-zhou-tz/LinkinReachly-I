import { describe, expect, it } from 'vitest'
import type { ApplicantProfile } from '@core/application-types'
import {
  commutableDistanceScreeningAnswer,
  coerceAiAnswerToProfileLocation,
  profileFillValueForLabel
} from '@core/easy-apply-factual-helpers'

function makeProfile(partial: Partial<ApplicantProfile>): ApplicantProfile {
  const base: ApplicantProfile = {
    version: 1,
    basics: { fullName: 'Pat Example', email: 'pat@example.com' },
    links: {},
    workAuth: { countryCode: 'US' },
    compensation: {},
    background: {},
    assets: [],
    answerBank: [],
    updatedAt: new Date(0).toISOString()
  }
  return {
    ...base,
    ...partial,
    basics: { ...base.basics, ...(partial.basics || {}) },
    workAuth: { ...base.workAuth, ...(partial.workAuth || {}) },
    compensation: { ...base.compensation, ...(partial.compensation || {}) },
    background: { ...base.background, ...(partial.background || {}) }
  }
}

describe('commutableDistanceScreeningAnswer', () => {
  const quizletStyle =
    'This position requires in-person attendance, reporting to our San Francisco office a minimum of three days per week (Monday, Wednesday, and Thursday), or as required by Quizlet. Do you currently reside within a commutable distance?'

  it('returns No when applicant is NYC and office is San Francisco in the question', () => {
    const p = makeProfile({ basics: { fullName: 'V B', email: 'v@e.co', city: 'New York', state: 'NY', country: 'US' } })
    expect(commutableDistanceScreeningAnswer(quizletStyle, p, 'San Francisco, CA')).toBe('No')
  })

  it('returns Yes when applicant is in SF and office is SF', () => {
    const p = makeProfile({
      basics: { fullName: 'V B', email: 'v@e.co', city: 'San Francisco', state: 'CA', country: 'US' }
    })
    expect(commutableDistanceScreeningAnswer(quizletStyle, p, undefined)).toBe('Yes')
  })

  it('returns null when profile location is missing', () => {
    const p = makeProfile({ basics: { fullName: 'V B', email: 'v@e.co', country: 'US' } })
    expect(commutableDistanceScreeningAnswer(quizletStyle, p, 'CA')).toBe(null)
  })
})

describe('profileFillValueForLabel', () => {
  it('uses city+state when label asks for both', () => {
    const p = makeProfile({
      basics: { fullName: 'V B', email: 'v@e.co', city: 'New York', state: 'NY', country: 'US' }
    })
    expect(profileFillValueForLabel('What city & state do you currently reside in?', 'New York', p)).toBe('New York, NY')
  })
})

describe('coerceAiAnswerToProfileLocation', () => {
  it('overwrites hallucinated location when profile has city+state', () => {
    const p = makeProfile({
      basics: { fullName: 'V B', email: 'v@e.co', city: 'New York', state: 'NY', country: 'US' }
    })
    expect(coerceAiAnswerToProfileLocation('What is your current location?', p, 'San Francisco, CA')).toBe('New York, NY')
    expect(coerceAiAnswerToProfileLocation('Bonus question', p, 'San Francisco, CA')).toBe('San Francisco, CA')
  })
})
