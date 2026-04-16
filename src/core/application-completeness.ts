import type { ApplicantProfile } from './application-types'

type CompletenessField = {
  key: string
  label: string
  category: 'required' | 'recommended' | 'optional'
  filled: boolean
}

type ProfileCompleteness = {
  complete: boolean
  readyToApply: boolean
  score: number
  fields: CompletenessField[]
  missingRequired: string[]
  missingRecommended: string[]
}

const resumePresent = (p: ApplicantProfile): boolean => p.assets.some((a) => a.kind === 'resume')

export function getProfileCompleteness(profile: ApplicantProfile): ProfileCompleteness {
  const fields: CompletenessField[] = [
    { key: 'fullName', label: 'Full name', category: 'required', filled: !!profile.basics.fullName?.trim() },
    { key: 'email', label: 'Email', category: 'required', filled: !!profile.basics.email?.trim() },
    { key: 'phone', label: 'Phone', category: 'recommended', filled: !!profile.basics.phone?.trim() },
    { key: 'city', label: 'City', category: 'recommended', filled: !!profile.basics.city?.trim() },
    { key: 'linkedInUrl', label: 'LinkedIn URL', category: 'recommended', filled: !!profile.links.linkedInUrl?.trim() },
    {
      key: 'authorizedToWork',
      label: 'Work authorization',
      category: 'recommended',
      filled: typeof profile.workAuth.authorizedToWork === 'boolean'
    },
    {
      key: 'requiresSponsorship',
      label: 'Sponsorship need',
      category: 'recommended',
      filled: typeof profile.workAuth.requiresSponsorship === 'boolean'
    },
    { key: 'resume', label: 'Resume uploaded', category: 'required', filled: resumePresent(profile) },
    { key: 'state', label: 'State / region', category: 'optional', filled: !!profile.basics.state?.trim() },
    { key: 'country', label: 'Country', category: 'optional', filled: !!profile.basics.country?.trim() },
    {
      key: 'currentLocationLine',
      label: 'Current location (single line)',
      category: 'optional',
      filled: !!profile.basics.currentLocationLine?.trim()
    },
    {
      key: 'currentResidenceAnswer',
      label: 'Where you are currently residing',
      category: 'optional',
      filled: !!profile.basics.currentResidenceAnswer?.trim()
    },
    { key: 'portfolioUrl', label: 'Portfolio URL', category: 'optional', filled: !!profile.links.portfolioUrl?.trim() },
    { key: 'githubUrl', label: 'GitHub URL', category: 'optional', filled: !!profile.links.githubUrl?.trim() },
    { key: 'websiteUrl', label: 'Website URL', category: 'optional', filled: !!profile.links.websiteUrl?.trim() },
    {
      key: 'salaryMin',
      label: 'Salary expectation',
      category: 'optional',
      filled: profile.compensation.salaryMin != null && Number.isFinite(profile.compensation.salaryMin)
    },
    { key: 'noticePeriod', label: 'Notice period', category: 'optional', filled: !!profile.compensation.noticePeriod?.trim() },
    {
      key: 'startDatePreference',
      label: 'Start date preference',
      category: 'optional',
      filled: !!profile.compensation.startDatePreference?.trim()
    },
    {
      key: 'workLocationPreference',
      label: 'Work location preference',
      category: 'optional',
      filled: !!profile.compensation.workLocationPreference?.trim()
    }
  ]

  const required = fields.filter((f) => f.category === 'required')
  const recommended = fields.filter((f) => f.category === 'recommended')
  const optional = fields.filter((f) => f.category === 'optional')

  const missingRequired = required.filter((f) => !f.filled).map((f) => f.label)
  const missingRecommended = recommended.filter((f) => !f.filled).map((f) => f.label)

  const readyToApply = missingRequired.length === 0
  const complete = missingRequired.length === 0 && missingRecommended.length === 0

  let points = 0
  let max = 0
  const weigh = (list: CompletenessField[], weightEach: number) => {
    for (const f of list) {
      max += weightEach
      if (f.filled) points += weightEach
    }
  }
  weigh(required, 10)
  weigh(recommended, 10)
  const optW =
    optional.length > 0
      ? (100 - required.length * 10 - recommended.length * 10) / optional.length
      : 0
  weigh(optional, optW)
  const score = max > 0 ? Math.min(100, Math.round((100 * points) / max)) : 0

  return {
    complete,
    readyToApply,
    score,
    fields,
    missingRequired,
    missingRecommended
  }
}
