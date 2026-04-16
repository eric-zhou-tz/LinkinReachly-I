import { createServer } from 'node:net'
import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bridgeEvents,
  getBridgeAuthToken,
  isExtensionConnected,
  startBridge,
  stopBridge,
} from '../../../src/main/bridge'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      if (typeof addr === 'object' && addr?.port) {
        const p = addr.port
        s.close((err) => (err ? reject(err) : resolve(p)))
      } else reject(new Error('no listen address'))
    })
  })
}

function waitForConnected(): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('bridge connected timeout')), 5_000)
    bridgeEvents.once('connected', () => {
      clearTimeout(t)
      resolve()
    })
  })
}

afterEach(() => {
  stopBridge()
})

describe('bridge WebSocket auth', () => {
  it('accepts a valid token and establishes the extension connection', async () => {
    const port = await getFreePort()
    startBridge(port, { enableDiscoveryRedirect: false })
    const token = getBridgeAuthToken()
    expect(token.length).toBeGreaterThan(10)

    const connectedP = waitForConnected()
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    await new Promise<void>((resolve, reject) => {
      ws.on('error', reject)
      ws.on('open', resolve)
    })
    ws.send(JSON.stringify({ type: 'auth', token }))
    await connectedP
    expect(isExtensionConnected()).toBe(true)

    await new Promise<void>((resolve, reject) => {
      ws.once('error', reject)
      ws.close(1000)
      ws.once('close', () => resolve())
    })
  })

  it('rejects an invalid token by closing the connection', async () => {
    const port = await getFreePort()
    startBridge(port, { enableDiscoveryRedirect: false })

    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const close = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('close timeout')), 5_000)
      ws.on('error', reject)
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token: 'definitely-not-the-bridge-token' }))
      })
      ws.on('close', (code, reason) => {
        clearTimeout(timer)
        resolve({ code, reason: reason.toString() })
      })
    })

    expect(close.code).toBe(1008)
    expect(close.reason).toMatch(/auth/i)
    expect(isExtensionConnected()).toBe(false)
  })

  it(
    'closes the connection after 5s without valid auth',
    async () => {
      const port = await getFreePort()
      startBridge(port, { enableDiscoveryRedirect: false })

      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      const close = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('close timeout')), 12_000)
        ws.on('error', reject)
        ws.on('open', () => {
          /* intentionally no auth message */
        })
        ws.on('close', (code, reason) => {
          clearTimeout(timer)
          resolve({ code, reason: reason.toString() })
        })
      })

      expect(close.code).toBe(4401)
      expect(close.reason).toMatch(/timeout|auth/i)
      expect(isExtensionConnected()).toBe(false)
    },
    15_000,
  )
})
