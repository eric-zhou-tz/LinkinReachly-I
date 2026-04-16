import type {
  ApplicationCompanySignals,
  ApplicationInsights,
  ApplicationInsightsBucket,
  ApplicationRecord,
  ApplicationRecordInput
} from '@core/application-types'

type RuleSet = Array<{ label: string; patterns: RegExp[] }>

const COMPANY_TYPE_RULES: RuleSet = [
  { label: 'startup', patterns: [/startup/i, /early[- ]stage/i, /\bseed\b/i, /venture[- ]backed/i] },
  { label: 'scale_up', patterns: [/series [bcdef]/i, /growth[- ]stage/i, /scale[- ]up/i] },
  { label: 'public_company', patterns: [/\bpublic company\b/i, /\bnasdaq\b/i, /\bnyse\b/i, /\bipo\b/i] },
  { label: 'enterprise', patterns: [/fortune 500/i, /global leader/i, /enterprise/i, /multinational/i] },
  { label: 'nonprofit', patterns: [/non[- ]profit/i, /\bnonprofit\b/i, /\bcharity\b/i, /foundation/i] },
  { label: 'government', patterns: [/government/i, /public sector/i, /federal/i, /state agency/i] },
  { label: 'agency', patterns: [/agency/i, /consultancy/i, /consulting firm/i, /services firm/i] }
]

const STAGE_RULES: RuleSet = [
  { label: 'seed_to_series_a', patterns: [/\bseed\b/i, /series a/i, /pre-seed/i, /early[- ]stage/i] },
  { label: 'series_b_to_c', patterns: [/series b/i, /series c/i, /growth[- ]stage/i] },
  { label: 'late_stage', patterns: [/series d/i, /series e/i, /late[- ]stage/i, /pre-ipo/i] },
  { label: 'public', patterns: [/\bpublic company\b/i, /\bipo\b/i, /\bnasdaq\b/i, /\bnyse\b/i] },
  { label: 'enterprise', patterns: [/fortune 500/i, /global leader/i, /mature business/i] }
]

const INDUSTRY_RULES: RuleSet = [
  { label: 'ai_ml', patterns: [/\bai\b/i, /machine learning/i, /\bllm\b/i, /artificial intelligence/i] },
  { label: 'fintech', patterns: [/fintech/i, /payments/i, /banking/i, /capital markets/i, /investment/i] },
  { label: 'healthtech', patterns: [/healthtech/i, /digital health/i, /biotech/i, /clinical/i, /medical/i] },
  { label: 'developer_tools', patterns: [/developer tools/i, /\bapi\b/i, /\bplatform engineering\b/i, /\bdevops\b/i] },
  { label: 'cybersecurity', patterns: [/security/i, /cyber/i, /identity/i, /threat/i] },
  { label: 'commerce', patterns: [/e-?commerce/i, /marketplace/i, /retail/i, /shopping/i] },
  { label: 'enterprise_software', patterns: [/\bsaas\b/i, /enterprise software/i, /workflow/i, /b2b software/i] },
  { label: 'consumer', patterns: [/\bconsumer\b/i, /\bb2c\b/i, /creator/i, /social/i] },
  { label: 'education', patterns: [/education/i, /learning/i, /edtech/i] }
]

const WORK_MODEL_RULES: RuleSet = [
  { label: 'remote', patterns: [/\bremote\b/i, /work from home/i, /distributed team/i] },
  { label: 'hybrid', patterns: [/\bhybrid\b/i, /in office \d days/i, /\bon-site\/remote\b/i] },
  { label: 'onsite', patterns: [/\bonsite\b/i, /on-site/i, /in office/i, /relocation required/i] }
]

function combinedText(input: ApplicationRecordInput): string {
  return [
    input.company,
    input.title,
    input.location,
    input.detail,
    input.descriptionSnippet,
    input.reasonSnippet
  ]
    .filter(Boolean)
    .join(' ')
}

function matchRule(text: string, rules: RuleSet, fallback = 'unknown'): string {
  for (const rule of rules) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return rule.label
  }
  return fallback
}

export function inferCompanySignals(input: ApplicationRecordInput): ApplicationCompanySignals {
  const text = combinedText(input)
  const workModel = matchRule(text, WORK_MODEL_RULES)
  let stage = matchRule(text, STAGE_RULES)
  let companyType = matchRule(text, COMPANY_TYPE_RULES)
  const industry = matchRule(text, INDUSTRY_RULES)

  if (companyType === 'unknown') {
    if (stage === 'seed_to_series_a' || stage === 'series_b_to_c' || stage === 'late_stage') {
      companyType = stage === 'series_b_to_c' ? 'scale_up' : 'startup'
    } else if (stage === 'public' || stage === 'enterprise') {
      companyType = stage === 'public' ? 'public_company' : 'enterprise'
    }
  }

  if (stage === 'unknown') {
    if (companyType === 'startup') stage = 'seed_to_series_a'
    if (companyType === 'scale_up') stage = 'series_b_to_c'
    if (companyType === 'public_company') stage = 'public'
    if (companyType === 'enterprise') stage = 'enterprise'
  }

  return {
    companyType,
    stage,
    industry,
    workModel
  }
}

function toBuckets(values: string[]): ApplicationInsightsBucket[] {
  const counts = new Map<string, number>()
  for (const value of values) {
    const key = String(value || 'unknown').trim() || 'unknown'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: key.replace(/_/g, ' '),
      count
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function buildApplicationInsights(records: ApplicationRecord[]): ApplicationInsights {
  return {
    total: records.length,
    submittedCount: records.filter((record) => record.outcome === 'submitted' || record.outcome === 'autofilled').length,
    activeCount: records.filter((record) => record.outcome === 'opened').length,
    needsReviewCount: records.filter((record) => record.outcome === 'needs_review').length,
    blockedCount: records.filter((record) => record.outcome === 'blocked').length,
    outreachSentCount: records.filter((record) => record.outreachStatus === 'sent').length,
    outreachPendingCount: records.filter((record) => record.outreachStatus === 'pending').length,
    byCompanyType: toBuckets(records.map((record) => record.companySignals.companyType)),
    byStage: toBuckets(records.map((record) => record.companySignals.stage)),
    byIndustry: toBuckets(records.map((record) => record.companySignals.industry)),
    byWorkModel: toBuckets(records.map((record) => record.companySignals.workModel))
  }
}
