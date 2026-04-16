import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC_ROOT = join(__dirname, '..', '..', 'src')

const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{FE0F}\u{200D}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}]/gu

const SAFE_CHARS = new Set([
  '\u2713', '\u2717', '\u2715', '\u2192', '\u25CB', '\u2022',
  '\u2261', '\u2630', '\u2609', '\u21BB', '\u2139',
  '\u25A0', '\u25B2', '\u25C6', '\u2014', '\u00B7',
  '\u2715',
])

const ESCAPE_PATTERNS = [
  /\\uD83[CD]\\u[Dd][A-Fa-f0-9]{3}/g,
  /\\u\{1[Ff][0-9A-Fa-f]{2,4}\}/g,
  /\\uFE0F/g,
  /\\u2714/g,
  /\\u2709/g,
  /\\u2638/g,
  /\\u26D3/g,
  /\\u2605/g,
  /\\u270[Dd]/g,
  /\\u23F3/g,
]

function walk(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      results.push(...walk(full))
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      results.push(full)
    }
  }
  return results
}

describe('no-emoji rule', () => {
  const files = walk(SRC_ROOT)

  it('source tree has files to scan', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('no literal emoji characters in source files', () => {
    const violations: string[] = []

    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        for (const match of line.matchAll(EMOJI_REGEX)) {
          const char = match[0]
          if (SAFE_CHARS.has(char)) continue
          const rel = relative(SRC_ROOT, file)
          violations.push(`${rel}:${i + 1}: U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')} "${char}"`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('no emoji escape sequences in source files', () => {
    const violations: string[] = []

    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        for (const pattern of ESCAPE_PATTERNS) {
          pattern.lastIndex = 0
          let m
          while ((m = pattern.exec(line)) !== null) {
            const rel = relative(SRC_ROOT, file)
            violations.push(`${rel}:${i + 1}: escape "${m[0]}"`)
          }
        }
      }
    }

    expect(violations).toEqual([])
  })
})
