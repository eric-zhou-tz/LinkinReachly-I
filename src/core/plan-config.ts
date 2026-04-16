/**
 * Single source of truth for plan tiers, limits, trial duration, and credit packs.
 *
 * Imported by auth-service, firestore-client, cloud functions, and UI.
 * To change pricing or limits, edit ONLY this file.
 */

export type UserPlan = 'free' | 'plus'

export const PLAN_LIMITS: Record<UserPlan, { apply: number; outreach: number }> = {
  free: { apply: 5, outreach: 3 },
  plus: { apply: 30, outreach: 15 },
}

export const TRIAL_LIMITS: { apply: number; outreach: number } = {
  apply: PLAN_LIMITS.plus.apply,
  outreach: PLAN_LIMITS.plus.outreach,
}

export const TRIAL_DAYS = 7

export const CREDIT_PACKS = {
  boost: { credits: 50, label: 'Boost', price: '$4.99', featured: false },
  bundle: { credits: 150, label: 'Bundle', price: '$9.99', featured: true },
  blitz: { credits: 400, label: 'Blitz', price: '$19.99', featured: false },
} as const

export const CREDIT_PACK_LIST = Object.entries(CREDIT_PACKS).map(
  ([id, pack]) => ({ id: id as CreditPackId, ...pack })
)

export type CreditPackId = keyof typeof CREDIT_PACKS

/** Default user-level daily cap for Easy Apply (LinkedIn safety throttle, NOT a plan limit). */
export const DEFAULT_APPLY_DAILY_CAP = 25

export const PLUS_PRICE_LABEL = '$19/mo'
export const PLUS_BONUS_PERCENT = 20

/** Features gated behind Plus (used by UI and IPC gates). */
export const PLUS_FEATURES = new Set([
  'ai_vision_fill',
  'ai_personalized_messages',
  'ai_job_screening',
  'follow_up_automation',
  'answer_bank_sync',
  'analytics_export',
])
