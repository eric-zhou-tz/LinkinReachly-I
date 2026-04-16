import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testDir: string
let prevDataDir: string | undefined

vi.mock('../../../src/main/user-data-path', () => ({
  userDataDir: () => testDir
}))

beforeEach(() => {
  prevDataDir = process.env['LOA_USER_DATA_DIR']
  testDir = mkdtempSync(join(tmpdir(), 'loa-seq-'))
  process.env['LOA_USER_DATA_DIR'] = testDir
  vi.resetModules()
})

afterEach(() => {
  if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
  if (prevDataDir === undefined) delete process.env['LOA_USER_DATA_DIR']
  else process.env['LOA_USER_DATA_DIR'] = prevDataDir
})

describe('sequence-state', () => {
  it('returns null for unknown profiles', async () => {
    const { getSequenceTarget } = await import('../../../src/main/sequence-state')
    expect(getSequenceTarget('https://www.linkedin.com/in/nobody/')).toBeNull()
  })

  it('upserts and retrieves a target', async () => {
    const { upsertSequenceTarget, getSequenceTarget } = await import('../../../src/main/sequence-state')
    const t = upsertSequenceTarget('https://www.linkedin.com/in/sam/', {
      firstName: 'Sam',
      company: 'Acme',
      stage: 'invited'
    })
    expect(t.firstName).toBe('Sam')
    expect(t.stage).toBe('invited')
    const loaded = getSequenceTarget('https://www.linkedin.com/in/sam/')
    expect(loaded?.firstName).toBe('Sam')
  })

  it('merges partial updates without losing existing fields', async () => {
    const { upsertSequenceTarget, getSequenceTarget } = await import('../../../src/main/sequence-state')
    upsertSequenceTarget('https://www.linkedin.com/in/sam/', {
      firstName: 'Sam',
      company: 'Acme',
      stage: 'invited'
    })
    upsertSequenceTarget('https://www.linkedin.com/in/sam/', {
      stage: 'accepted'
    })
    const loaded = getSequenceTarget('https://www.linkedin.com/in/sam/')
    expect(loaded?.firstName).toBe('Sam')
    expect(loaded?.company).toBe('Acme')
    expect(loaded?.stage).toBe('accepted')
  })

  it('advances stage with timestamp', async () => {
    const { upsertSequenceTarget, advanceStage, getSequenceTarget } = await import(
      '../../../src/main/sequence-state'
    )
    upsertSequenceTarget('https://www.linkedin.com/in/sam/', {
      firstName: 'Sam',
      stage: 'new'
    })
    advanceStage('https://www.linkedin.com/in/sam/', 'invited')
    const loaded = getSequenceTarget('https://www.linkedin.com/in/sam/')
    expect(loaded?.stage).toBe('invited')
    expect(loaded?.invitedAt).toBeTruthy()
  })

  it('advanceStage returns null for non-existent profiles', async () => {
    const { advanceStage } = await import('../../../src/main/sequence-state')
    expect(advanceStage('https://www.linkedin.com/in/ghost/', 'accepted')).toBeNull()
  })

  it('advanceStage sets correct timestamp fields per stage', async () => {
    const { upsertSequenceTarget, advanceStage, getSequenceTarget } = await import(
      '../../../src/main/sequence-state'
    )
    upsertSequenceTarget('https://www.linkedin.com/in/jane/', { firstName: 'Jane' })
    advanceStage('https://www.linkedin.com/in/jane/', 'viewed')
    expect(getSequenceTarget('https://www.linkedin.com/in/jane/')?.viewedAt).toBeTruthy()
    advanceStage('https://www.linkedin.com/in/jane/', 'dm_sent')
    expect(getSequenceTarget('https://www.linkedin.com/in/jane/')?.dmSentAt).toBeTruthy()
    advanceStage('https://www.linkedin.com/in/jane/', 'responded')
    expect(getSequenceTarget('https://www.linkedin.com/in/jane/')?.respondedAt).toBeTruthy()
  })

  it('lists all stored targets', async () => {
    const { upsertSequenceTarget, listSequenceTargets } = await import('../../../src/main/sequence-state')
    upsertSequenceTarget('https://www.linkedin.com/in/first/', {
      firstName: 'First',
      stage: 'invited'
    })
    upsertSequenceTarget('https://www.linkedin.com/in/second/', {
      firstName: 'Second',
      stage: 'accepted'
    })
    const all = listSequenceTargets()
    expect(all.length).toBe(2)
    const names = all.map((t) => t.firstName).sort()
    expect(names).toEqual(['First', 'Second'])
  })

  it('filters targets by stage', async () => {
    const { upsertSequenceTarget, listSequenceTargets } = await import('../../../src/main/sequence-state')
    upsertSequenceTarget('https://www.linkedin.com/in/a/', { stage: 'invited' })
    upsertSequenceTarget('https://www.linkedin.com/in/b/', { stage: 'accepted' })
    upsertSequenceTarget('https://www.linkedin.com/in/c/', { stage: 'invited' })
    const invited = listSequenceTargets({ stage: 'invited' })
    expect(invited.length).toBe(2)
  })

  it('getAllSequenceTargets returns same as listSequenceTargets with no filter', async () => {
    const { upsertSequenceTarget, getAllSequenceTargets, listSequenceTargets } = await import(
      '../../../src/main/sequence-state'
    )
    upsertSequenceTarget('https://www.linkedin.com/in/a/', { stage: 'new' })
    expect(getAllSequenceTargets().length).toBe(listSequenceTargets().length)
  })

  it('persists via atomic write (tmp + rename)', async () => {
    const { upsertSequenceTarget } = await import('../../../src/main/sequence-state')
    upsertSequenceTarget('https://www.linkedin.com/in/test/', { firstName: 'Test' })
    expect(existsSync(join(testDir, 'sequence-state.json'))).toBe(true)
    expect(existsSync(join(testDir, 'sequence-state.json.tmp'))).toBe(false)
  })

  it('handles corrupted state file gracefully', async () => {
    writeFileSync(join(testDir, 'sequence-state.json'), '<<<broken>>>', 'utf8')
    const { getSequenceTarget } = await import('../../../src/main/sequence-state')
    expect(getSequenceTarget('https://www.linkedin.com/in/any/')).toBeNull()
  })
})
