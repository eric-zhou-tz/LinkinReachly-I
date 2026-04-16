import { describe, expect, it } from 'vitest'
import { parseTargetsCsv, parseTargetsCsvWithDiagnostics } from '@core/csv-targets'

describe('parseTargetsCsv', () => {
  it('parses profileUrl header and maps columns', () => {
    const csv = `profileUrl,firstName,company
https://www.linkedin.com/in/alice/,Alice,Acme
`
    const rows = parseTargetsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].profileUrl).toBe('https://www.linkedin.com/in/alice/')
    expect(rows[0].firstName).toBe('Alice')
    expect(rows[0].company).toBe('Acme')
  })

  it('accepts linkedin_url column name', () => {
    const csv = `linkedin_url,name
https://www.linkedin.com/in/bob/,ignored
`
    const rows = parseTargetsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].profileUrl).toContain('linkedin.com/in/bob')
  })

  it('handles quoted fields with commas', () => {
    const csv = `profileUrl,company
"https://www.linkedin.com/in/carlos/","Foo, LLC"
`
    const rows = parseTargetsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].company).toBe('Foo, LLC')
  })

  it('maps principal_name and firm_name to firstName and company', () => {
    const csv = `profileUrl,principal_name,firm_name
https://www.linkedin.com/in/dana/,Dana Smith,North Star Advisors
`
    const rows = parseTargetsCsv(csv)
    expect(rows[0].firstName).toBe('Dana')
    expect(rows[0].company).toBe('North Star Advisors')
  })

  it('sets executionId from execution or signal column', () => {
    const csv = `profileUrl,execution
https://www.linkedin.com/in/x/,ria_connection
https://www.linkedin.com/in/y/,sample_signal
`
    const rows = parseTargetsCsv(csv)
    expect(rows[0].executionId).toBe('ria_connection')
    expect(rows[1].executionId).toBe('sample_signal')
    const csv2 = `profileUrl,signal
https://www.linkedin.com/in/z/,sample
`
    expect(parseTargetsCsv(csv2)[0].executionId).toBe('sample_signal')
  })

  it('skips rows without linkedin.com URL', () => {
    const csv = `profileUrl
https://example.com/not-li
https://www.linkedin.com/in/eve/,,
`
    const rows = parseTargetsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].profileUrl).toContain('linkedin.com/in/eve')
  })

  it('returns empty array for empty input', () => {
    expect(parseTargetsCsv('')).toEqual([])
    expect(parseTargetsCsv('   \n  \n')).toEqual([])
  })

  it('parses multiple data rows', () => {
    const csv = `profileUrl,firstName
https://www.linkedin.com/in/one/,A
https://www.linkedin.com/in/two/,B
https://www.linkedin.com/in/three/,C
`
    expect(parseTargetsCsv(csv)).toHaveLength(3)
  })

  it('parses a single line with URL first and no header row', () => {
    const line = 'https://www.linkedin.com/in/tianyu-leslie-tan/, Leslie, test, test'
    const rows = parseTargetsCsv(line)
    expect(rows).toHaveLength(1)
    expect(rows[0].profileUrl).toBe('https://www.linkedin.com/in/tianyu-leslie-tan/')
    expect(rows[0].firstName).toBe('Leslie')
    expect(rows[0].company).toBe('test')
    expect(rows[0].headline).toBe('test')
  })

  it('parses a single name row without a LinkedIn URL', () => {
    const rows = parseTargetsCsv('Jane Doe, Acme Capital')
    expect(rows).toHaveLength(1)
    expect(rows[0].profileUrl).toBe('')
    expect(rows[0].personName).toBe('Jane Doe')
    expect(rows[0].company).toBe('Acme Capital')
    expect(rows[0].searchQuery).toBe('Jane Doe Acme Capital')
  })

  it('parses multiple plain-text target rows without a header', () => {
    const rows = parseTargetsCsv(`Jane Doe, Acme Capital
Alex Chen
`)
    expect(rows).toHaveLength(2)
    expect(rows[0].searchQuery).toBe('Jane Doe Acme Capital')
    expect(rows[1].searchQuery).toBe('Alex Chen')
  })

  it('rejects a single vague token without company context', () => {
    expect(parseTargetsCsv('Acme')).toEqual([])
    expect(parseTargetsCsv('John')).toEqual([])
  })
})

describe('parseTargetsCsvWithDiagnostics', () => {
  it('flags empty paste', () => {
    const { targets, issues } = parseTargetsCsvWithDiagnostics('')
    expect(targets).toEqual([])
    expect(issues.some((i) => /empty/i.test(i))).toBe(true)
  })

  it('flags header-only', () => {
    const { targets, issues } = parseTargetsCsvWithDiagnostics('profileUrl,firstName\n')
    expect(targets).toEqual([])
    expect(issues.some((i) => /LinkedIn|header|profile URL/i.test(i))).toBe(true)
  })

  it('accepts single-line paste with LinkedIn URL and no issues', () => {
    const { targets, issues } = parseTargetsCsvWithDiagnostics(
      'https://www.linkedin.com/in/demo/,Jamie,Acme,VP Product'
    )
    expect(targets).toHaveLength(1)
    expect(issues).toEqual([])
  })

  it('flags no linkedin URLs in body', () => {
    const { targets, issues } = parseTargetsCsvWithDiagnostics('a,b\nx,y\n')
    expect(targets).toEqual([])
    expect(issues.some((i) => /No usable targets/i.test(i))).toBe(true)
  })

  it('accepts a name column even if another column contains a LinkedIn URL', () => {
    const { targets, issues } = parseTargetsCsvWithDiagnostics(
      'name,note\nJohn,https://www.linkedin.com/in/x/\n'
    )
    expect(targets).toHaveLength(1)
    expect(targets[0].personName).toBe('John')
    expect(issues).toEqual([])
  })

  it('warns when some rows skipped', () => {
    const { targets, issues } = parseTargetsCsvWithDiagnostics(`profileUrl
https://example.com/x
https://www.linkedin.com/in/ok/,
`)
    expect(targets).toHaveLength(1)
    expect(issues.some((i) => /skipped/i.test(i))).toBe(true)
  })

  it('no issues when all rows valid', () => {
    const { targets, issues } = parseTargetsCsvWithDiagnostics(`profileUrl
https://www.linkedin.com/in/a/,
https://www.linkedin.com/in/b/,
`)
    expect(targets).toHaveLength(2)
    expect(issues).toEqual([])
  })

  it('accepts plain-text name rows without issues', () => {
    const { targets, issues } = parseTargetsCsvWithDiagnostics(`Jane Doe, Acme Capital
Alex Chen
`)
    expect(targets).toHaveLength(2)
    expect(issues).toEqual([])
  })
})
