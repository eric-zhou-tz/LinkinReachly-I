/** @vitest-environment jsdom */
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

declare global {
  // Loaded from extension/content.js in test runtime.
  // eslint-disable-next-line no-var
  var clickEasyApply: undefined | (() => Promise<{ ok: boolean; detail: string }>)
}

// jsdom's PointerEvent/MouseEvent reject `view` — replace with thin wrappers that strip it.
const OriginalPointerEvent = globalThis.PointerEvent
globalThis.PointerEvent = class PointerEventShim extends OriginalPointerEvent {
  constructor(type: string, init?: PointerEventInit & { view?: unknown }) {
    const { view: _view, ...rest } = init ?? {}
    super(type, rest)
  }
} as unknown as typeof PointerEvent

const OriginalMouseEvent = globalThis.MouseEvent
globalThis.MouseEvent = class MouseEventShim extends OriginalMouseEvent {
  constructor(type: string, init?: MouseEventInit & { view?: unknown }) {
    const { view: _view, ...rest } = init ?? {}
    super(type, rest)
  }
} as unknown as typeof MouseEvent

function installGeometryStubs(win: Window & typeof globalThis): void {
  const rect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 160,
    bottom: 40,
    width: 160,
    height: 40,
    toJSON: () => ({})
  })
  Object.defineProperty(win.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: rect
  })
  Object.defineProperty(win.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn()
  })
}

describe('extension clickEasyApply draft handling', () => {
  beforeAll(() => {
    ;(globalThis as unknown as { chrome?: unknown }).chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
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
    installGeometryStubs(window)
  })

  it('dismisses delayed "Save this application?" dialog after clicking Easy Apply', async () => {
    let discarded = false

    const btn = document.createElement('a')
    btn.className = 'jobs-apply-button'
    btn.setAttribute('aria-label', 'Easy Apply')
    btn.textContent = 'Easy Apply'
    btn.addEventListener('click', () => {
      setTimeout(() => {
        const dialog = document.createElement('div')
        dialog.setAttribute('role', 'dialog')
        const heading = document.createElement('div')
        heading.textContent = 'Save this application?'
        const discardBtn = document.createElement('button')
        discardBtn.textContent = 'Discard'
        discardBtn.addEventListener('click', () => {
          discarded = true
          dialog.remove()
        })
        dialog.appendChild(heading)
        dialog.appendChild(discardBtn)
        document.body.appendChild(dialog)
      }, 40)
    })
    document.body.appendChild(btn)

    expect(typeof globalThis.clickEasyApply).toBe('function')
    const result = await globalThis.clickEasyApply?.()

    expect(result?.ok).toBe(true)
    expect(result?.detail).toBe('clicked_easy_apply_discarded_draft')
    expect(discarded).toBe(true)
  })

  it('reports missing easy apply modal for field extraction', () => {
    document.body.innerHTML = '<main></main>'
    const hooks = (globalThis as unknown as { __loaContentTestHooks?: { easyApplyModalRoot: () => unknown } })
      .__loaContentTestHooks
    expect(hooks?.easyApplyModalRoot()).toBeNull()
  })

  it('collectApplicationFields: one radio group with options and value false when none checked', () => {
    document.body.innerHTML = `
      <div class="jobs-easy-apply-modal" style="width:400px;height:500px">
        <p>Apply to Test Co</p>
        <fieldset>
          <legend>How many years have you delivered tough freight?*</legend>
          <label><input type="radio" name="freight_years" value="0"> None</label>
          <label><input type="radio" name="freight_years" value="1"> 1-2 Years</label>
          <label><input type="radio" name="freight_years" value="2"> 3-4 Years</label>
          <label><input type="radio" name="freight_years" value="3"> Over 5 Years</label>
        </fieldset>
      </div>
    `
    const hooks = (globalThis as unknown as { __loaContentTestHooks?: { collectApplicationFields: (r: Element) => unknown[] } })
      .__loaContentTestHooks
    const modal = document.querySelector('.jobs-easy-apply-modal')
    expect(modal).toBeTruthy()
    const fields = hooks?.collectApplicationFields(modal!) as Array<{
      label: string
      type: string
      value: string
      required: boolean
      options: string[]
    }>
    expect(fields?.length).toBe(1)
    expect(fields?.[0].type).toBe('radio')
    expect(fields?.[0].value).toBe('false')
    expect(fields?.[0].required).toBe(true)
    expect(fields?.[0].options?.length).toBe(4)
    expect(fields?.[0].options).toContain('None')
    expect(fields?.[0].options).toContain('1-2 Years')
  })

  it('collectApplicationFields: radio group value true when an option is checked', () => {
    document.body.innerHTML = `
      <div class="jobs-easy-apply-modal" style="width:400px;height:500px">
        Apply to X
        <fieldset>
          <legend>Pick one*</legend>
          <label><input type="radio" name="grp" value="a"> A</label>
          <label><input type="radio" name="grp" value="b" checked> B</label>
        </fieldset>
      </div>
    `
    const hooks = (globalThis as unknown as { __loaContentTestHooks?: { collectApplicationFields: (r: Element) => unknown[] } })
      .__loaContentTestHooks
    expect(hooks?.collectApplicationFields).toBeDefined()
    const modal = document.querySelector('.jobs-easy-apply-modal')!
    const fields = hooks!.collectApplicationFields(modal) as Array<{ value: string }>
    expect(fields.length).toBe(1)
    expect(fields[0].value).toBe('true')
  })

  it('FILL_APPLICATION_FIELD clears a prefilled text field when allowEmpty is true', async () => {
    document.body.innerHTML = `
      <div class="jobs-easy-apply-modal" style="width:400px;height:500px">
        <div class="artdeco-form__group">
          <label for="major">Field of study</label>
          <input id="major" type="text" value="Molecular Biology & Biotech">
        </div>
      </div>
    `
    const hooks = (globalThis as unknown as { __loaContentTestHooks?: { ACTIONS: () => Record<string, (payload: unknown) => Promise<{ ok: boolean; detail: string }>> } })
      .__loaContentTestHooks
    const actions = hooks?.ACTIONS()
    expect(actions?.FILL_APPLICATION_FIELD).toBeDefined()

    const result = await actions!.FILL_APPLICATION_FIELD({
      label: 'Field of study',
      type: 'text',
      value: '',
      allowEmpty: true
    })

    const input = document.querySelector('input') as HTMLInputElement
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('filled_field')
    expect(input.value).toBe('')
  })

  it('FILL_APPLICATION_FIELD honors fieldIndex when duplicate labels exist', async () => {
    document.body.innerHTML = `
      <div class="jobs-easy-apply-modal" style="width:400px;height:500px">
        <div class="artdeco-form__group">
          <label for="degree-1">Degree</label>
          <input id="degree-1" type="text" value="BA">
        </div>
        <div class="artdeco-form__group">
          <label for="degree-2">Degree</label>
          <input id="degree-2" type="text" value="BS">
        </div>
      </div>
    `
    const hooks = (globalThis as unknown as { __loaContentTestHooks?: { ACTIONS: () => Record<string, (payload: unknown) => Promise<{ ok: boolean; detail: string }>> } })
      .__loaContentTestHooks
    const actions = hooks?.ACTIONS()
    expect(actions?.FILL_APPLICATION_FIELD).toBeDefined()

    const result = await actions!.FILL_APPLICATION_FIELD({
      label: 'Degree',
      type: 'text',
      value: 'MBA',
      fieldIndex: 1
    })

    const inputs = [...document.querySelectorAll('input')] as HTMLInputElement[]
    expect(result.ok).toBe(true)
    expect(inputs[0]?.value).toBe('BA')
    expect(inputs[1]?.value).toBe('MBA')
  })

  it('GET_PAGE_TEXT returns normalized body text', async () => {
    document.body.innerHTML = `
      <main>
        <h1>LinkedIn Easy Apply</h1>
        <p>Security verification required</p>
      </main>
    `
    const hooks = (globalThis as unknown as { __loaContentTestHooks?: { ACTIONS: () => Record<string, (payload?: unknown) => unknown> } })
      .__loaContentTestHooks
    const actions = hooks?.ACTIONS()
    expect(actions?.GET_PAGE_TEXT).toBeDefined()

    const result = await actions!.GET_PAGE_TEXT()
    expect((result as { ok: boolean }).ok).toBe(true)
    expect((result as { detail: string }).detail).toBe('page_text')
    expect(String((result as { data?: unknown }).data || '')).toContain('LinkedIn Easy Apply')
    expect(String((result as { data?: unknown }).data || '')).toContain('Security verification required')
  })
})
