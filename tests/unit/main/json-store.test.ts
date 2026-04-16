import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonStore } from '../../../src/main/json-store'

describe('JsonStore', () => {
  let dir: string

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  })

  it('returns default when file is missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'loa-json-'))
    const path = join(dir, 'nested', 'data.json')
    const def = { count: 0 }
    const store = new JsonStore(path, def)
    expect(store.load()).toEqual(def)
  })

  it('returns default when JSON is corrupt', () => {
    dir = mkdtempSync(join(tmpdir(), 'loa-json-'))
    const path = join(dir, 'bad.json')
    writeFileSync(path, '{ not json', 'utf8')
    const store = new JsonStore(path, { ok: true })
    expect(store.load()).toEqual({ ok: true })
  })

  it('save creates parent directories and load round-trips', () => {
    dir = mkdtempSync(join(tmpdir(), 'loa-json-'))
    const path = join(dir, 'a', 'b', 'state.json')
    const store = new JsonStore<{ n: number }>(path, { n: 0 })
    store.save({ n: 42 })
    expect(existsSync(path)).toBe(true)
    expect(store.load()).toEqual({ n: 42 })
    const raw = readFileSync(path, 'utf8')
    expect(raw).toContain('"n"')
    expect(raw).toContain('42')
  })

  it('update composes load, fn, and save', () => {
    dir = mkdtempSync(join(tmpdir(), 'loa-json-'))
    const path = join(dir, 'counter.json')
    const store = new JsonStore<{ n: number }>(path, { n: 0 })
    store.update((c) => ({ n: c.n + 1 }))
    expect(store.load().n).toBe(1)
    store.update((c) => ({ n: c.n + 5 }))
    expect(store.load().n).toBe(6)
  })

  it('non-atomic save writes directly to destination', () => {
    dir = mkdtempSync(join(tmpdir(), 'loa-json-'))
    const path = join(dir, 'direct.json')
    const store = new JsonStore<{ x: string }>(path, { x: '' }, { atomic: false })
    store.save({ x: 'hi' })
    expect(existsSync(path)).toBe(true)
    expect(existsSync(`${path}.tmp`)).toBe(false)
    expect(store.load()).toEqual({ x: 'hi' })
  })

  it('lazy filePath resolver is evaluated on each operation', () => {
    dir = mkdtempSync(join(tmpdir(), 'loa-json-'))
    let target = join(dir, 'one.json')
    const store = new JsonStore(() => target, { v: 1 })
    store.save({ v: 2 })
    target = join(dir, 'two.json')
    store.save({ v: 3 })
    expect(JSON.parse(readFileSync(join(dir, 'one.json'), 'utf8'))).toEqual({ v: 2 })
    expect(JSON.parse(readFileSync(join(dir, 'two.json'), 'utf8'))).toEqual({ v: 3 })
  })
})
