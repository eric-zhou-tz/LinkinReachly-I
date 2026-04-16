/** @vitest-environment jsdom */
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

describe('extractJobDetails selector validation', () => {
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

  it('returns ok:false when title and company are both empty', () => {
    document.body.innerHTML = '<main></main>'
    const hooks = (globalThis as unknown as { __loaContentTestHooks?: { extractJobDetails: () => unknown } })
      .__loaContentTestHooks
    const res = hooks!.extractJobDetails() as { ok: boolean; detail: string }
    expect(res.ok).toBe(false)
    expect(res.detail).toContain('job_selectors_miss')
  })

  it('returns ok:true when job title and company nodes exist', () => {
    document.body.innerHTML = `
      <div>
        <h1 class="jobs-unified-top-card__job-title">Staff Engineer</h1>
        <div class="jobs-unified-top-card__company-name"><a href="#">Acme Corp</a></div>
      </div>
    `
    const hooks = (globalThis as unknown as { __loaContentTestHooks?: { extractJobDetails: () => unknown } })
      .__loaContentTestHooks
    const res = hooks!.extractJobDetails() as { ok: boolean; data: { title: string; company: string } }
    expect(res.ok).toBe(true)
    expect(res.data.title).toContain('Staff Engineer')
    expect(res.data.company).toContain('Acme')
  })
})
