/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('loa-client electron bridge fallback', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetModules()
    delete window.loa
    global.fetch = originalFetch
  })

  afterEach(() => {
    delete window.loa
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('does not throw for read-only non-configurable bridge methods', async () => {
    const onBridgeActivity = vi.fn().mockReturnValue(() => {})
    const base: Record<string, unknown> = {}
    Object.defineProperty(base, 'onBridgeActivity', {
      value: onBridgeActivity,
      enumerable: true,
      writable: false,
      configurable: false
    })
    window.loa = base as unknown as Window['loa']

    const { getLoa } = await import('../../../src/renderer/src/loa-client')
    const loa = getLoa()

    expect(() => loa.onBridgeActivity(() => {})).not.toThrow()
    expect(onBridgeActivity).toHaveBeenCalledTimes(1)
  })

  it('falls back to HTTP when IPC reports missing handler', async () => {
    const jobsSmartSearch = vi
      .fn()
      .mockRejectedValue(new Error("No handler registered for 'jobs:smartSearch'"))

    window.loa = {
      jobsSmartSearch
    } as unknown as Window['loa']

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ result: { ok: true, detail: 'http-fallback' } })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const { getLoa } = await import('../../../src/renderer/src/loa-client')
    const result = (await getLoa().jobsSmartSearch({
      background: 'machine learning engineer'
    })) as {
      ok: boolean
      detail: string
    }

    expect(result).toEqual({ ok: true, detail: 'http-fallback' })
    expect(jobsSmartSearch).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const firstCall = fetchMock.mock.calls[0] as [string, { body?: unknown }]
    expect(firstCall[0]).toContain('/invoke')
    expect(String(firstCall[1]?.body || '')).toContain('"channel":"jobs:smartSearch"')
  })

  it('falls back to /session-token when preload sessionToken IPC is missing', async () => {
    const jobsSearch = vi
      .fn()
      .mockRejectedValue(new Error("No handler registered for 'jobs:search'"))
    const sessionToken = vi
      .fn()
      .mockRejectedValue(new Error("No handler registered for 'session:token'"))

    window.loa = {
      jobsSearch,
      sessionToken
    } as unknown as Window['loa']

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
        text: async () => JSON.stringify({ error: 'unauthorized' })
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ token: 'http-session-token' })
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ result: { ok: true, jobs: [] } })
      })
    global.fetch = fetchMock as unknown as typeof fetch

    const { getLoa } = await import('../../../src/renderer/src/loa-client')
    const result = (await getLoa().jobsSearch({
      keywords: 'anthropic'
    })) as {
      ok: boolean
      jobs: unknown[]
    }

    expect(result.ok).toBe(true)
    expect(Array.isArray(result.jobs)).toBe(true)
    expect(jobsSearch).toHaveBeenCalledTimes(1)
    expect(sessionToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/session-token')

    const invokeOpts = fetchMock.mock.calls[2]?.[1] as {
      headers?: Record<string, string>
    }
    expect(invokeOpts.headers?.Authorization).toBe('Bearer http-session-token')
  })

  it('refreshes token from /session-token when preload token is stale', async () => {
    const jobsSearch = vi
      .fn()
      .mockRejectedValue(new Error("No handler registered for 'jobs:search'"))
    const sessionToken = vi.fn().mockResolvedValue('stale-preload-token')

    window.loa = {
      jobsSearch,
      sessionToken
    } as unknown as Window['loa']

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
        text: async () => JSON.stringify({ error: 'unauthorized' })
      })
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
        text: async () => JSON.stringify({ error: 'unauthorized' })
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ token: 'canonical-token' })
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ result: { ok: true, jobs: [{ title: 'AI Engineer' }] } })
      })
    global.fetch = fetchMock as unknown as typeof fetch

    const { getLoa } = await import('../../../src/renderer/src/loa-client')
    const result = (await getLoa().jobsSearch({
      keywords: 'anthropic'
    })) as {
      ok: boolean
      jobs: Array<{ title?: string }>
    }

    expect(result.ok).toBe(true)
    expect(result.jobs[0]?.title).toBe('AI Engineer')
    expect(jobsSearch).toHaveBeenCalledTimes(1)
    expect(sessionToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[2]?.[0]).toContain('/session-token')

    const secondInvokeOpts = fetchMock.mock.calls[1]?.[1] as {
      headers?: Record<string, string>
    }
    expect(secondInvokeOpts.headers?.Authorization).toBe('Bearer stale-preload-token')

    const finalInvokeOpts = fetchMock.mock.calls[3]?.[1] as {
      headers?: Record<string, string>
    }
    expect(finalInvokeOpts.headers?.Authorization).toBe('Bearer canonical-token')
  })

  it('uses legacy jobs channels when smartSearch channel is unknown', async () => {
    const jobsSmartSearch = vi.fn().mockRejectedValue(new Error('Unknown channel: jobs:smartSearch'))
    window.loa = { jobsSmartSearch } as unknown as Window['loa']

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        text: async () => JSON.stringify({ error: 'Unknown channel: jobs:smartSearch' })
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            result: {
              ok: true,
              jobs: [{ title: 'AI Engineer', company: 'Anthropic', location: 'New York, NY', jobUrl: 'https://www.linkedin.com/jobs/view/1/' }]
            }
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            result: {
              ok: true,
              results: [{ title: 'AI Engineer', company: 'Anthropic', location: 'New York, NY', jobUrl: 'https://www.linkedin.com/jobs/view/1/', score: 9, reason: 'Strong match.' }]
            }
          })
      })
    global.fetch = fetchMock as unknown as typeof fetch

    const { getLoa } = await import('../../../src/renderer/src/loa-client')
    const result = (await getLoa().jobsSmartSearch({
      background: 'anthropic in new york'
    })) as {
      ok: boolean
      jobs: Array<{ company: string }>
      scored: Array<{ score: number }>
    }

    expect(result.ok).toBe(true)
    expect(result.jobs[0]?.company).toBe('Anthropic')
    expect(result.scored[0]?.score).toBe(9)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const bodies = fetchMock.mock.calls.map((c) => String((c[1] as { body?: unknown })?.body || ''))
    expect(bodies[0]).toContain('"channel":"jobs:smartSearch"')
    expect(bodies[1]).toContain('"channel":"jobs:search"')
    expect(bodies[1]).toContain('"keywords":"anthropic"')
    expect(bodies[1]).toContain('"location":"new york"')
    expect(bodies[2]).toContain('"channel":"jobs:screen"')
  })

  it('returns a friendly compatibility error when legacy jobs:search is also unavailable', async () => {
    const jobsSmartSearch = vi.fn().mockRejectedValue(new Error('Unknown channel: jobs:smartSearch'))
    window.loa = { jobsSmartSearch } as unknown as Window['loa']

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        text: async () => JSON.stringify({ error: 'Unknown channel: jobs:smartSearch' })
      })
      .mockResolvedValueOnce({
        ok: false,
        text: async () => JSON.stringify({ error: 'Unknown channel: jobs:search' })
      })
    global.fetch = fetchMock as unknown as typeof fetch

    const { getLoa } = await import('../../../src/renderer/src/loa-client')
    const result = (await getLoa().jobsSmartSearch({
      background: 'anthropic in new york'
    })) as {
      ok: boolean
      detail: string
    }

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('too old for Jobs search compatibility')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('preserves canceled state when compatibility mode jobs:search is canceled', async () => {
    const jobsSmartSearch = vi.fn().mockRejectedValue(new Error('Unknown channel: jobs:smartSearch'))
    window.loa = { jobsSmartSearch } as unknown as Window['loa']

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        text: async () => JSON.stringify({ error: 'Unknown channel: jobs:smartSearch' })
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ result: { ok: false, canceled: true, detail: 'Search canceled.' } })
      })
    global.fetch = fetchMock as unknown as typeof fetch

    const { getLoa } = await import('../../../src/renderer/src/loa-client')
    const result = (await getLoa().jobsSmartSearch({
      background: 'anthropic in new york'
    })) as {
      ok: boolean
      canceled?: boolean
      detail?: string
    }

    expect(result.ok).toBe(false)
    expect(result.canceled).toBe(true)
    expect(result.detail).toBe('Search canceled.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('parses location from the last \"in\" segment in compatibility mode', async () => {
    const jobsSmartSearch = vi.fn().mockRejectedValue(new Error('Unknown channel: jobs:smartSearch'))
    window.loa = { jobsSmartSearch } as unknown as Window['loa']

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        text: async () => JSON.stringify({ error: 'Unknown channel: jobs:smartSearch' })
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ result: { ok: true, jobs: [] } })
      })
    global.fetch = fetchMock as unknown as typeof fetch

    const { getLoa } = await import('../../../src/renderer/src/loa-client')
    const result = (await getLoa().jobsSmartSearch({
      background: 'machine learning in healthcare in new york'
    })) as {
      ok: boolean
      jobs: unknown[]
    }

    expect(result.ok).toBe(true)
    expect(Array.isArray(result.jobs)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const searchBody = String((fetchMock.mock.calls[1]?.[1] as { body?: unknown })?.body || '')
    expect(searchBody).toContain('"channel":"jobs:search"')
    expect(searchBody).toContain('"keywords":"machine learning in healthcare"')
    expect(searchBody).toContain('"location":"new york"')
  })

  it('blocks unsafe external URLs before any backend or window.open call', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const { getLoa } = await import('../../../src/renderer/src/loa-client')
    const result = await getLoa().openExternalUrl('javascript:alert(1)')

    expect(result).toEqual({
      ok: false,
      detail: 'Only secure https:// links, mailto: links, and local http:// URLs are allowed.'
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('falls back to a safe local browser open when shell:openExternal is unavailable', async () => {
    const openExternalUrl = vi
      .fn()
      .mockRejectedValue(new Error("No handler registered for 'shell:openExternal'"))
    window.loa = { openExternalUrl } as unknown as Window['loa']

    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => JSON.stringify({ error: 'Unknown channel: shell:openExternal' })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const { getLoa } = await import('../../../src/renderer/src/loa-client')
    const result = await getLoa().openExternalUrl('https://example.com/docs')

    expect(result).toEqual({ ok: true })
    expect(openExternalUrl).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/docs',
      '_blank',
      'noopener,noreferrer'
    )
  })

  it('returns a safe no-op when shell:openLogsFolder is unavailable', async () => {
    const openLogsFolder = vi
      .fn()
      .mockRejectedValue(new Error("No handler registered for 'shell:openLogsFolder'"))
    window.loa = { openLogsFolder } as unknown as Window['loa']

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => JSON.stringify({ error: 'Unknown channel: shell:openLogsFolder' })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const { getLoa } = await import('../../../src/renderer/src/loa-client')

    await expect(getLoa().openLogsFolder()).resolves.toBe('')
    expect(openLogsFolder).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('loads runtime log tail via GET /runtime-log-tail (browser-only loa)', async () => {
    delete window.loa
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
        text: async () => JSON.stringify({ error: 'unauthorized' })
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ token: 'http-test-token' })
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ ok: true, lines: ['alpha', 'beta'] })
      })
    global.fetch = fetchMock as unknown as typeof fetch

    const { getLoa } = await import('../../../src/renderer/src/loa-client')
    const r = await getLoa().runtimeLogTail({ maxLines: 50 })

    expect(r).toEqual({ ok: true, lines: ['alpha', 'beta'] })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const tailUrl = String(fetchMock.mock.calls[2]![0])
    expect(tailUrl).toContain('/runtime-log-tail')
    expect(tailUrl).toContain('maxLines=50')
  })
})
