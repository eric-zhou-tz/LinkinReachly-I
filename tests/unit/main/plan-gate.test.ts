import { describe, expect, it } from 'vitest'
import {
  AUTH_EXEMPT_CHANNELS,
  PLUS_ONLY_CHANNELS,
  getLoaInvokeGateBlock,
} from '../../../src/main/loa-invoke-gates'

describe('loa invoke plan + auth gates', () => {
  const plusChannel = [...PLUS_ONLY_CHANNELS][0]!

  it('blocks free-plan users from Plus-only channels in production when backend + authenticated', () => {
    const block = getLoaInvokeGateBlock({
      channel: plusChannel,
      nodeEnv: 'production',
      isBackendConfigured: true,
      isAuthenticated: true,
      planState: { plan: 'free', isTrialing: false },
    })
    expect(block).toEqual({
      kind: 'plan',
      error: 'This feature requires a Plus subscription. Upgrade to continue.',
    })
  })

  it('allows Plus-plan users to access Plus-only channels', () => {
    expect(
      getLoaInvokeGateBlock({
        channel: plusChannel,
        nodeEnv: 'production',
        isBackendConfigured: true,
        isAuthenticated: true,
        planState: { plan: 'plus', isTrialing: false },
      }),
    ).toBeNull()
  })

  it('allows free users in trial to access Plus-only channels', () => {
    expect(
      getLoaInvokeGateBlock({
        channel: plusChannel,
        nodeEnv: 'production',
        isBackendConfigured: true,
        isAuthenticated: true,
        planState: { plan: 'free', isTrialing: true },
      }),
    ).toBeNull()
  })

  it('does not apply plan gate outside production', () => {
    expect(
      getLoaInvokeGateBlock({
        channel: plusChannel,
        nodeEnv: 'development',
        isBackendConfigured: true,
        isAuthenticated: true,
        planState: { plan: 'free', isTrialing: false },
      }),
    ).toBeNull()
  })

  it('auth-exempt channels work without authentication when backend is configured', () => {
    expect(AUTH_EXEMPT_CHANNELS.has('bridge:status')).toBe(true)
    expect(
      getLoaInvokeGateBlock({
        channel: 'bridge:status',
        nodeEnv: 'production',
        isBackendConfigured: true,
        isAuthenticated: false,
        planState: { plan: 'free', isTrialing: false },
      }),
    ).toBeNull()
  })

  it('blocks non-exempt channels when unauthenticated and backend is configured', () => {
    expect(
      getLoaInvokeGateBlock({
        channel: 'settings:save',
        nodeEnv: 'production',
        isBackendConfigured: true,
        isAuthenticated: false,
        planState: { plan: 'free', isTrialing: false },
      }),
    ).toEqual({
      kind: 'auth',
      error: 'Sign in to continue.',
    })
  })

  it('allows any auth:* channel prefix without authentication when backend is configured', () => {
    expect(
      getLoaInvokeGateBlock({
        channel: 'auth:googleSignIn',
        nodeEnv: 'production',
        isBackendConfigured: true,
        isAuthenticated: false,
        planState: { plan: 'free', isTrialing: false },
      }),
    ).toBeNull()
  })
})
