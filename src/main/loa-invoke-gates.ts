/**
 * IPC / HTTP invoke gates (auth + Plus plan). Used by `src/main/index.ts` and unit tests.
 */

import type { UserPlanState } from './auth-service'

/** Channels allowed before login when backend is configured (must stay in sync with index). */
export const AUTH_EXEMPT_CHANNELS = new Set([
  'auth:getServiceConfig',
  'auth:setToken',
  'auth:register',
  'auth:getUser',
  'settings:get',
  'bridge:status',
  'bridge:ping',
  'plan:getState',
  'plan:getCounters',
  'plan:canAct',
  'queue:state',
  'session:token',
  'application:queue:state',
  'jobs:progressState',
])

export const PLUS_ONLY_CHANNELS = new Set([
  'ai:generateFields',
  'resume:tailor',
  'jobs:smartScreen',
  'jobs:smartSearch',
  'jobs:screen',
  'followup:detectNow',
  'application:history:exportCsv',
])

type LoaInvokeGateBlock =
  | { kind: 'auth'; error: string }
  | { kind: 'plan'; error: string }

export function getLoaInvokeGateBlock(input: {
  channel: string
  nodeEnv: string | undefined
  isBackendConfigured: boolean
  isAuthenticated: boolean
  planState: Pick<UserPlanState, 'plan' | 'isTrialing'>
}): LoaInvokeGateBlock | null {
  const { channel, nodeEnv, isBackendConfigured, isAuthenticated, planState } = input

  if (
    nodeEnv === 'production' &&
    isBackendConfigured &&
    !isAuthenticated &&
    !AUTH_EXEMPT_CHANNELS.has(channel) &&
    !channel.startsWith('auth:')
  ) {
    return { kind: 'auth', error: 'Sign in to continue.' }
  }

  if (
    nodeEnv === 'production' &&
    PLUS_ONLY_CHANNELS.has(channel) &&
    isBackendConfigured &&
    isAuthenticated
  ) {
    if (planState.plan === 'free' && !planState.isTrialing) {
      return { kind: 'plan', error: 'This feature requires a Plus subscription. Upgrade to continue.' }
    }
  }

  return null
}
