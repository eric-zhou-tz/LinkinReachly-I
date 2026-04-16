import http from 'node:http'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      if (typeof addr === 'object' && addr?.port) {
        const p = addr.port
        s.close((err) => (err ? reject(err) : resolve(p)))
      } else {
        reject(new Error('no listen address'))
      }
    })
  })
}

async function closeServer(server: http.Server | null): Promise<void> {
  if (!server) return
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
}

async function getJson(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body })
      })
    })
    req.on('error', reject)
  })
}

async function postRaw(
  port: number,
  path: string,
  body: string,
  headers: Record<string, string>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers
        }
      },
      (res) => {
        let out = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          out += chunk
        })
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, body: out })
        })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function setupBridgeForPort(port: number) {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }

  vi.doMock('electron', () => ({
    app: {
      isPackaged: false,
      getPath: () => '/tmp',
      setName: vi.fn(),
      setPath: vi.fn()
    }
  }))
  vi.doMock('electron-log/main.js', () => ({
    default: {
      scope: () => logger,
      functions: {},
      transports: {
        file: {},
        console: {}
      },
      initialize: vi.fn()
    }
  }))
  vi.doMock('@core/runtime-ports', () => ({
    defaultBridgePortForPackaging: () => port + 1,
    defaultLoaHttpPortForPackaging: () => port
  }))

  const mod = await import('../../../src/main/loa-http')
  return { ...mod, logger }
}

describe('startLoaHttpBridge', () => {
  let server: http.Server | null = null

  afterEach(async () => {
    await closeServer(server)
    server = null
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('survives a client disconnecting before the invoke response is written', async () => {
    const port = await getFreePort()
    const { getSessionToken, startLoaHttpBridge, logger } = await setupBridgeForPort(port)

    let releaseInvoke: (() => void) | undefined
    let markInvokeStarted: (() => void) | undefined
    const invokeStarted = new Promise<void>((resolve) => {
      markInvokeStarted = resolve
    })

    const invoke = vi.fn().mockImplementation(async () => {
      markInvokeStarted?.()
      await new Promise<void>((resolve) => {
        releaseInvoke = resolve
      })
      return { ok: true }
    })

    server = await startLoaHttpBridge(invoke)

    expect(server).not.toBeNull()

    const body = JSON.stringify({ channel: 'jobs:smartSearch', payload: { keywords: 'designer' } })
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/invoke',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getSessionToken()}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    })
    req.on('error', () => {
      /* client was intentionally disconnected before the response completed */
    })
    req.write(body)
    req.end()

    await invokeStarted
    req.destroy()
    if (releaseInvoke) releaseInvoke()

    await new Promise((resolve) => setTimeout(resolve, 50))

    const health = await getJson(`http://127.0.0.1:${port}/health`)
    expect(health.status).toBe(200)
    expect(health.body).toContain('"ok":true')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('ignores an aborted invoke request body without crashing or warning', async () => {
    const port = await getFreePort()
    const { getSessionToken, startLoaHttpBridge, logger } = await setupBridgeForPort(port)
    const invoke = vi.fn().mockResolvedValue({ ok: true })
    server = await startLoaHttpBridge(invoke)
    expect(server).not.toBeNull()

    const partialBody = '{"channel":"jobs:smartSearch","payload":{"keywords":"design'
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/invoke',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getSessionToken()}`,
        'Content-Type': 'application/json',
        // Intentionally larger than bytes written to force an aborted/incomplete body
        'Content-Length': Buffer.byteLength(partialBody) + 20
      }
    })
    req.on('error', () => {
      /* aborted client request */
    })
    req.write(partialBody)
    req.destroy()

    await new Promise((resolve) => setTimeout(resolve, 50))

    const health = await getJson(`http://127.0.0.1:${port}/health`)
    expect(health.status).toBe(200)
    expect(invoke).toHaveBeenCalledTimes(0)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('rejects non-allowlisted invoke channels over HTTP', async () => {
    const port = await getFreePort()
    const { getSessionToken, startLoaHttpBridge } = await setupBridgeForPort(port)
    const invoke = vi.fn().mockResolvedValue({ ok: true })
    server = await startLoaHttpBridge(invoke)
    expect(server).not.toBeNull()

    const body = JSON.stringify({ channel: 'bridge:rawCommand', payload: { command: 'ls' } })
    const res = await postRaw(port, '/invoke', body, {
      Authorization: `Bearer ${getSessionToken()}`
    })

    expect(res.status).toBe(403)
    expect(res.body).toContain('channel not available over HTTP')
    expect(invoke).toHaveBeenCalledTimes(0)
  })

  it('returns 413 for oversized invoke payloads and skips handler execution', async () => {
    const port = await getFreePort()
    const { getSessionToken, startLoaHttpBridge } = await setupBridgeForPort(port)
    const invoke = vi.fn().mockResolvedValue({ ok: true })
    server = await startLoaHttpBridge(invoke)
    expect(server).not.toBeNull()

    const huge = 'x'.repeat(1_050_000)
    const body = JSON.stringify({ channel: 'jobs:search', payload: { keywords: huge } })
    const res = await postRaw(port, '/invoke', body, {
      Authorization: `Bearer ${getSessionToken()}`
    })

    expect(res.status).toBe(413)
    expect(res.body).toContain('payload too large')
    expect(invoke).toHaveBeenCalledTimes(0)
  })
})
