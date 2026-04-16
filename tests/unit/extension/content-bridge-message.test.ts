/** @vitest-environment jsdom */
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

describe('content script bridge message normalization', () => {
  beforeAll(() => {
    ;(globalThis as unknown as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        onMessage: { addListener: vi.fn() }
      }
    }
    const scripts = ['content-utils.js', 'content-connect.js', 'content-apply.js', 'content.js']
    const code = scripts.map(f => {
      let src = readFileSync(resolve(process.cwd(), 'extension', f), 'utf8')
      // Unwrap the dormant guard so function declarations are top-level in the VM
      if (src.startsWith('if (!_lrDormant) {\n')) {
        src = src.slice('if (!_lrDormant) {\n'.length, src.lastIndexOf('\n}'))
      }
      return src
    }).join('\n')
    vm.runInThisContext(code, { filename: 'content-bundle.js' })
  })

  it('rejects non-string action', () => {
    const hooks = (globalThis as unknown as { __loaContentTestHooks?: { normalizeBridgeMessage: Function } })
      .__loaContentTestHooks
    expect(hooks).toBeDefined()
    const norm = hooks!.normalizeBridgeMessage(
      { action: { toString: () => 'PING' } },
      { id: 'test-extension-id' }
    )
    expect(norm.ok).toBe(false)
  })

  it('rejects wrong sender id', () => {
    const hooks = (globalThis as unknown as { __loaContentTestHooks?: { normalizeBridgeMessage: Function } })
      .__loaContentTestHooks
    const norm = hooks!.normalizeBridgeMessage({ action: 'PING', payload: {} }, { id: 'other-ext' })
    expect(norm.ok).toBe(false)
    expect((norm as { reason?: string }).reason).toBe('invalid_sender')
  })

  it('accepts PING from self', () => {
    const hooks = (globalThis as unknown as { __loaContentTestHooks?: { normalizeBridgeMessage: Function } })
      .__loaContentTestHooks
    const norm = hooks!.normalizeBridgeMessage({ action: 'PING' }, { id: 'test-extension-id' })
    expect(norm.ok).toBe(true)
    expect((norm as { action?: string }).action).toBe('PING')
  })

  it('sanitizes payload to plain serializable values', () => {
    const hooks = (globalThis as unknown as { __loaContentTestHooks?: { normalizeBridgeMessage: Function } })
      .__loaContentTestHooks
    const payload = {
      ok: true,
      nested: {
        keep: 'value',
        dropFn: () => 'x'
      },
      arr: [1, { a: 2 }, () => 'x']
    }
    const norm = hooks!.normalizeBridgeMessage(
      { action: 'TYPE_NOTE', payload },
      { id: 'test-extension-id' }
    ) as { ok: boolean; payload: Record<string, unknown> }
    expect(norm.ok).toBe(true)
    expect(norm.payload.ok).toBe(true)
    expect(norm.payload.nested).toEqual({ keep: 'value', dropFn: null })
    expect(norm.payload.arr).toEqual([1, { a: 2 }, null])
  })

  it('drops payload objects with a non-plain prototype', () => {
    const hooks = (globalThis as unknown as { __loaContentTestHooks?: { normalizeBridgeMessage: Function } })
      .__loaContentTestHooks
    const nonPlain = Object.create({ injected: 'x' }) as { value?: string }
    nonPlain.value = 'keep?'
    const norm = hooks!.normalizeBridgeMessage(
      { action: 'TYPE_NOTE', payload: nonPlain },
      { id: 'test-extension-id' }
    ) as { ok: boolean; payload: Record<string, unknown> }
    expect(norm.ok).toBe(true)
    expect(norm.payload).toEqual({})
  })

  it('includes connect-related actions', () => {
    const hooks = (globalThis as unknown as { __loaContentTestHooks?: { ACTIONS: () => Record<string, unknown> } })
      .__loaContentTestHooks
    const names = Object.keys(hooks!.ACTIONS())
    expect(names).toEqual(
      expect.arrayContaining([
        'CLICK_CONNECT_ANY',
        'TYPE_NOTE',
        'CLICK_SEND',
        'PING',
        'EXTRACT_FORM_FIELDS',
        'SUBMIT_APPLICATION'
      ])
    )
  })
})
