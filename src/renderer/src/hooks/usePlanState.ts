import { useState, useEffect, useCallback } from 'react'
import { getLoa } from '../loa-client'
import { getAuthState, onAuthChange, type AuthState } from '../auth'
import { PLAN_LIMITS, PLUS_FEATURES } from '@core/plan-config'

export interface PlanState {
  isLoggedIn: boolean
  userId: string | null
  plan: 'free' | 'plus'
  creditBalance: number
  dailyApplyLimit: number
  dailyOutreachLimit: number
  isPlus: boolean
  isTrialing: boolean
  trialDaysRemaining: number
  hadTrial: boolean
}

const DEFAULT_PLAN_STATE: PlanState = {
  isLoggedIn: false,
  userId: null,
  plan: 'free',
  creditBalance: 0,
  dailyApplyLimit: PLAN_LIMITS.free.apply,
  dailyOutreachLimit: PLAN_LIMITS.free.outreach,
  isPlus: false,
  isTrialing: false,
  trialDaysRemaining: 0,
  hadTrial: false,
}

export function usePlanState(): PlanState & {
  refresh: () => Promise<void>
  authState: AuthState
} {
  const [planState, setPlanState] = useState<PlanState>(DEFAULT_PLAN_STATE)
  const [authState, setAuthState] = useState<AuthState>(getAuthState())

  useEffect(() => {
    return onAuthChange(setAuthState)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const result = await getLoa().planGetState()
      setPlanState({
        isLoggedIn: authState.status === 'authenticated',
        userId: result.userId,
        plan: result.plan,
        creditBalance: result.creditBalance,
        dailyApplyLimit: result.dailyApplyLimit,
        dailyOutreachLimit: result.dailyOutreachLimit,
        isPlus: result.plan === 'plus' && !(result.isTrialing ?? false),
        isTrialing: result.isTrialing ?? false,
        trialDaysRemaining: result.trialDaysRemaining ?? 0,
        hadTrial: !!result.trialStartedAt,
      })
    } catch {
      // Backend not available — use defaults
    }
  }, [authState.status])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.loa?.onPlanStateChanged) return
    return window.loa.onPlanStateChanged((raw: unknown) => {
      const r = raw as Partial<PlanState & { trialStartedAt?: string }>
      if (!r || typeof r !== 'object') return
      setPlanState({
        isLoggedIn: authState.status === 'authenticated',
        userId: r.userId ?? null,
        plan: r.plan === 'plus' ? 'plus' : 'free',
        creditBalance: r.creditBalance ?? 0,
        dailyApplyLimit: r.dailyApplyLimit ?? PLAN_LIMITS.free.apply,
        dailyOutreachLimit: r.dailyOutreachLimit ?? PLAN_LIMITS.free.outreach,
        isPlus: r.plan === 'plus' && !(r.isTrialing ?? false),
        isTrialing: r.isTrialing ?? false,
        trialDaysRemaining: r.trialDaysRemaining ?? 0,
        hadTrial: !!r.trialStartedAt,
      })
    })
  }, [authState.status])

  return { ...planState, refresh, authState }
}

export function isFeatureGated(feature: string, plan: 'free' | 'plus'): boolean {
  return plan === 'free' && PLUS_FEATURES.has(feature)
}
