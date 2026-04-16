import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let prevDataDir: string | undefined
let testDir: string

vi.mock('../../../src/main/user-data-path', () => ({
  userDataDir: () => testDir
}))

beforeEach(() => {
  prevDataDir = process.env['LOA_USER_DATA_DIR']
  testDir = mkdtempSync(join(tmpdir(), 'loa-followup-'))
  process.env['LOA_USER_DATA_DIR'] = testDir
  vi.resetModules()
})

afterEach(() => {
  if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
  if (prevDataDir === undefined) delete process.env['LOA_USER_DATA_DIR']
  else process.env['LOA_USER_DATA_DIR'] = prevDataDir
})

describe('followup-state', () => {
  it('returns stage 0 for unknown profile', async () => {
    const { getFollowupStage } = await import('../../../src/main/followup-state')
    expect(getFollowupStage('https://www.linkedin.com/in/nobody/')).toBe(0)
  })

  it('records and retrieves followup stage', async () => {
    const { recordFollowupSent, getFollowupStage } = await import('../../../src/main/followup-state')
    recordFollowupSent('https://www.linkedin.com/in/sam/', 'generic_connection', 1)
    expect(getFollowupStage('https://www.linkedin.com/in/sam/')).toBe(1)
  })

  it('advances stage on second followup', async () => {
    const { recordFollowupSent, getFollowupStage } = await import('../../../src/main/followup-state')
    recordFollowupSent('https://www.linkedin.com/in/sam/', 'generic_connection', 1)
    recordFollowupSent('https://www.linkedin.com/in/sam/', 'generic_connection', 2)
    expect(getFollowupStage('https://www.linkedin.com/in/sam/')).toBe(2)
  })

  it('tracks multiple profiles independently', async () => {
    const { recordFollowupSent, getFollowupStage } = await import('../../../src/main/followup-state')
    recordFollowupSent('https://www.linkedin.com/in/alice/', 'exec_1', 1)
    recordFollowupSent('https://www.linkedin.com/in/bob/', 'exec_2', 2)
    expect(getFollowupStage('https://www.linkedin.com/in/alice/')).toBe(1)
    expect(getFollowupStage('https://www.linkedin.com/in/bob/')).toBe(2)
  })

  it('persists state to disk', async () => {
    const { recordFollowupSent } = await import('../../../src/main/followup-state')
    recordFollowupSent('https://www.linkedin.com/in/persist/', 'exec', 1)
    expect(existsSync(join(testDir, 'followup-state.json'))).toBe(true)
  })

  it('getFollowupState returns structured summary', async () => {
    const { recordFollowupSent, getFollowupState } = await import('../../../src/main/followup-state')
    recordFollowupSent('https://www.linkedin.com/in/sam/', 'exec', 1)
    recordFollowupSent('https://www.linkedin.com/in/jane/', 'exec', 2)
    const state = getFollowupState()
    const samKey = Object.keys(state).find((k) => k.includes('sam'))
    const janeKey = Object.keys(state).find((k) => k.includes('jane'))
    expect(samKey).toBeTruthy()
    expect(state[samKey!].stage).toBe('sent')
    expect(janeKey).toBeTruthy()
    expect(state[janeKey!].stage).toBe('dm_sent')
    expect(state[janeKey!].dmSentAt).toBeTruthy()
  })

  it('handles corrupted state file gracefully', async () => {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(testDir, 'followup-state.json'), '<<<bad json>>>', 'utf8')
    const { getFollowupStage } = await import('../../../src/main/followup-state')
    expect(getFollowupStage('https://www.linkedin.com/in/any/')).toBe(0)
  })
})
