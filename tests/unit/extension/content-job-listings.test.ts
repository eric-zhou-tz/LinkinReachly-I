/** @vitest-environment jsdom */
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type JobListingsResult = {
  ok: boolean
  detail: string
  data?: {
    items?: Array<{ title: string; company: string; location: string; jobUrl: string; easyApply?: boolean; applyUrl?: string }>
  }
}

describe('extractJobListings selector diagnostics', () => {
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
    Object.defineProperty(window.HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn()
    })
  })

  it('returns selector miss when no job cards are present', async () => {
    document.body.innerHTML = '<main></main>'
    const hooks = (
      globalThis as unknown as {
        __loaContentTestHooks?: { extractJobListings: (payload: { scrollPasses: number }) => Promise<JobListingsResult> }
      }
    ).__loaContentTestHooks
    const res = await hooks!.extractJobListings({ scrollPasses: 0 })
    expect(res.ok).toBe(false)
    expect(res.detail).toContain('job_listings_selectors_miss:no_cards')
  })

  it('returns selector miss when cards exist but title selectors do not match', async () => {
    document.body.innerHTML = `
      <main>
        <div class="job-card-container">
          <span class="job-card-container__primary-description">Acme Corp</span>
        </div>
      </main>
    `
    const hooks = (
      globalThis as unknown as {
        __loaContentTestHooks?: { extractJobListings: (payload: { scrollPasses: number }) => Promise<JobListingsResult> }
      }
    ).__loaContentTestHooks
    const res = await hooks!.extractJobListings({ scrollPasses: 0 })
    expect(res.ok).toBe(false)
    expect(res.detail).toContain('job_listings_selectors_miss:no_items')
  })

  it('extracts listings when expected selectors are present', async () => {
    document.body.innerHTML = `
      <main>
        <div class="job-card-container">
          <a class="job-card-container__link" href="https://www.linkedin.com/jobs/view/123456/">Staff Engineer</a>
          <div class="job-card-container__primary-description">Acme Corp</div>
          <div class="job-card-container__metadata-wrapper"><li>New York, NY</li></div>
          <time datetime="2026-03-30">3 days ago</time>
        </div>
      </main>
    `
    const hooks = (
      globalThis as unknown as {
        __loaContentTestHooks?: { extractJobListings: (payload: { scrollPasses: number }) => Promise<JobListingsResult> }
      }
    ).__loaContentTestHooks
    const res = await hooks!.extractJobListings({ scrollPasses: 0 })
    expect(res.ok).toBe(true)
    expect(res.data?.items?.length).toBe(1)
    expect(res.data?.items?.[0]?.title).toContain('Staff Engineer')
    expect(res.data?.items?.[0]?.company).toContain('Acme')
    expect(res.data?.items?.[0]?.easyApply).toBeFalsy()
  })

  it('sets easyApply when listing card text includes Easy Apply outside legacy footer selectors', async () => {
    document.body.innerHTML = `
      <main>
        <div class="job-card-container">
          <a class="job-card-container__link" href="https://www.linkedin.com/jobs/view/999001/">Product Manager</a>
          <div class="job-card-container__primary-description">Nooks</div>
          <div class="job-card-container__metadata-wrapper"><li>San Francisco, CA</li></div>
          <div class="jobs-search-results__apply-line"><span class="tvm__text">Easy Apply</span></div>
        </div>
      </main>
    `
    const hooks = (
      globalThis as unknown as {
        __loaContentTestHooks?: { extractJobListings: (payload: { scrollPasses: number }) => Promise<JobListingsResult> }
      }
    ).__loaContentTestHooks
    const res = await hooks!.extractJobListings({ scrollPasses: 0 })
    expect(res.ok).toBe(true)
    expect(res.data?.items?.[0]?.easyApply).toBe(true)
  })

  it('reconciles card Easy Apply hints with detail CTA during enrichment', async () => {
    document.body.innerHTML = `
      <main>
        <div class="job-card-container">
          <a class="job-card-container__link" href="https://www.linkedin.com/jobs/view/321654/">Research Engineer</a>
          <div class="job-card-container__primary-description">Stealth Labs</div>
          <div class="job-card-container__metadata-wrapper"><li>New York, NY</li></div>
          <div class="jobs-search-results__apply-line"><span>Easy Apply</span></div>
        </div>
        <div class="job-details-jobs-unified-top-card__job-title">
          <a href="https://www.linkedin.com/jobs/view/321654/">Research Engineer</a>
        </div>
        <div class="jobs-description__content">Role details...</div>
        <a
          class="jobs-apply-button"
          href="https://careers.example.com/jobs/321654"
          aria-label="Apply on company website"
        >
          Apply on company website
        </a>
      </main>
    `
    const hooks = (
      globalThis as unknown as {
        __loaContentTestHooks?: {
          extractJobListings: (payload: { scrollPasses: number; enrichTop?: number }) => Promise<JobListingsResult>
        }
      }
    ).__loaContentTestHooks
    const res = await hooks!.extractJobListings({ scrollPasses: 0, enrichTop: 1 })
    expect(res.ok).toBe(true)
    expect(res.data?.items?.[0]?.easyApply).toBe(false)
    expect(res.data?.items?.[0]?.applyUrl).toContain('careers.example.com/jobs/321654')
  })

  it('does not override card Easy Apply when detail panel is explicitly on a different job', async () => {
    document.body.innerHTML = `
      <main>
        <div class="job-card-container">
          <a class="job-card-container__link" href="https://www.linkedin.com/jobs/view/777111/">Applied Scientist</a>
          <div class="job-card-container__primary-description">Orbit Labs</div>
          <div class="job-card-container__metadata-wrapper"><li>Boston, MA</li></div>
          <div class="jobs-search-results__apply-line"><span>Easy Apply</span></div>
        </div>
        <div class="job-details-jobs-unified-top-card__job-title">
          <a href="https://www.linkedin.com/jobs/view/999222/">Different Job</a>
        </div>
        <a
          class="jobs-apply-button"
          href="https://careers.example.com/jobs/999222"
          aria-label="Apply on company website"
        >
          Apply on company website
        </a>
      </main>
    `
    const hooks = (
      globalThis as unknown as {
        __loaContentTestHooks?: {
          extractJobListings: (payload: { scrollPasses: number; enrichTop?: number }) => Promise<JobListingsResult>
        }
      }
    ).__loaContentTestHooks
    const res = await hooks!.extractJobListings({ scrollPasses: 0, enrichTop: 1 })
    expect(res.ok).toBe(true)
    expect(res.data?.items?.[0]?.easyApply).toBe(true)
    expect(res.data?.items?.[0]?.applyUrl).toContain('/jobs/view/777111/')
  })
})
