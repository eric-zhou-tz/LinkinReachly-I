/** @vitest-environment jsdom */
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type ProfileResult = {
  ok: boolean
  detail: string
  data: {
    displayName: string
    firstName: string
    headline: string
    location: string
    company: string
    about: string
    experienceHighlights: string[]
    rawText: string
  }
}

describe('extractProfile', () => {
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

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('extracts top-card profile fields and infers company from headline', () => {
    document.body.innerHTML = `
      <main>
        <section>
          <h1>Jamie Smith</h1>
          <div class="text-body-medium break-words">Staff Engineer at Acme Corp</div>
          <div class="text-body-small inline t-black--light break-words">New York, United States</div>
        </section>
        <section>
          <h2>About</h2>
          <p>Builder of reliable automation systems for recruiting workflows.</p>
        </section>
      </main>
    `
    const hooks = (
      globalThis as unknown as { __loaContentTestHooks?: { extractProfile: () => ProfileResult } }
    ).__loaContentTestHooks
    const res = hooks!.extractProfile()
    expect(res.ok).toBe(true)
    expect(res.data.displayName).toBe('Jamie Smith')
    expect(res.data.firstName).toBe('Jamie')
    expect(res.data.headline).toContain('Staff Engineer')
    expect(res.data.location).toContain('New York')
    expect(res.data.company).toContain('Acme')
    expect(res.data.about).toContain('reliable automation systems')
  })

  it('captures experience highlights into rawText summary', () => {
    document.body.innerHTML = `
      <main>
        <section>
          <h1>Sam Lee</h1>
          <div class="text-body-medium break-words">Engineering Manager at Northwind</div>
        </section>
        <section id="experience" class="artdeco-card">
          <li>
            <div>Engineering Manager</div>
            <div>Northwind</div>
          </li>
          <li>
            <div>Senior Software Engineer</div>
            <div>Contoso</div>
          </li>
        </section>
      </main>
    `
    const hooks = (
      globalThis as unknown as { __loaContentTestHooks?: { extractProfile: () => ProfileResult } }
    ).__loaContentTestHooks
    const res = hooks!.extractProfile()
    expect(res.ok).toBe(true)
    expect(res.data.experienceHighlights.length).toBeGreaterThan(0)
    expect(res.data.rawText).toContain('Sam Lee')
    expect(res.data.rawText).toContain('Engineering Manager')
  })
})

