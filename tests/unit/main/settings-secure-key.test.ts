import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let prevDataDir: string | undefined

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => new ArrayBuffer(0),
    decryptString: () => ''
  }
}))

beforeEach(() => {
  prevDataDir = process.env['LOA_USER_DATA_DIR']
  process.env['LOA_USER_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'loa-settings-'))
})

afterEach(() => {
  const d = process.env['LOA_USER_DATA_DIR']
  if (d && existsSync(d)) rmSync(d, { recursive: true, force: true })
  if (prevDataDir === undefined) delete process.env['LOA_USER_DATA_DIR']
  else process.env['LOA_USER_DATA_DIR'] = prevDataDir
  vi.resetModules()
})

describe('settings API key handling without safeStorage', () => {
  it('does not persist plaintext API keys to settings.json', async () => {
    const { saveSettingsWithApiKey, loadSettings } = await import('../../../src/main/settings')
    const cur = loadSettings()
    saveSettingsWithApiKey(cur, 'sk-test-secret-key')
    const raw = readFileSync(join(process.env['LOA_USER_DATA_DIR']!, 'config', 'settings.json'), 'utf8')
    expect(raw).not.toContain('sk-test-secret-key')
    expect(JSON.parse(raw).apiKeyStored).toBeNull()
  })

  it('getApiKey returns session key after save when encryption unavailable', async () => {
    const { saveSettingsWithApiKey, loadSettings, getApiKey } = await import('../../../src/main/settings')
    const cur = loadSettings()
    saveSettingsWithApiKey(cur, 'session-only-key')
    expect(getApiKey()).toBe('session-only-key')
  })

  it('migrates obsolete llmBaseUrl on load to local Grok defaults', async () => {
    const base = process.env['LOA_USER_DATA_DIR']!
    const cfg = join(base, 'config')
    mkdirSync(cfg, { recursive: true })
    writeFileSync(
      join(cfg, 'settings.json'),
      JSON.stringify({
        llmBaseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
        llmModel: 'qwen3-coder-plus',
        llmProvider: 'openai',
        bridgePort: 19511,
        templates: ['Hi {firstName}'],
        mustInclude: [],
        dailyCap: 20
      }),
      'utf8'
    )
    vi.resetModules()
    const { loadSettings } = await import('../../../src/main/settings')
    const s = loadSettings()
    expect(s.llmBaseUrl).toBe('http://api.linkinreachly.com:8000/v1')
    expect(s.llmModel).toBe('grok-4.1-fast')
    expect(s.llmProvider).toBe('grok')
    const saved = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'))
    expect(saved.llmBaseUrl).toBe('http://api.linkinreachly.com:8000/v1')
    expect(saved.llmModel).toBe('grok-4.1-fast')
    expect(saved.llmProvider).toBe('grok')
  })

  it('strips legacy openclaw* keys from settings.json on load', async () => {
    const base = process.env['LOA_USER_DATA_DIR']!
    const cfg = join(base, 'config')
    mkdirSync(cfg, { recursive: true })
    writeFileSync(
      join(cfg, 'settings.json'),
      JSON.stringify({
        bridgePort: 19511,
        templates: ['Hi {firstName}'],
        mustInclude: [],
        dailyCap: 20,
        openclawEnabled: true,
        openclawBaseUrl: 'http://127.0.0.1:18791'
      }),
      'utf8'
    )
    vi.resetModules()
    const { loadSettings } = await import('../../../src/main/settings')
    loadSettings()
    const saved = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'))
    expect(saved.openclawEnabled).toBeUndefined()
    expect(saved.openclawBaseUrl).toBeUndefined()
  })
})
