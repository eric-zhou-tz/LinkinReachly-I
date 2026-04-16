import { describe, expect, it } from 'vitest'
import { parseAllowedRendererDevUrl } from '../../../src/main/electron-security'

describe('parseAllowedRendererDevUrl', () => {
  it('allows http://127.0.0.1 with port', () => {
    expect(parseAllowedRendererDevUrl('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/')
  })

  it('allows http://localhost with path', () => {
    expect(parseAllowedRendererDevUrl('http://localhost:5173/path')).toBe('http://localhost:5173/path')
  })

  it('allows IPv6 loopback ::1', () => {
    expect(parseAllowedRendererDevUrl('http://[::1]:5173')).toBeTruthy()
  })

  it('rejects https (wrong protocol for dev)', () => {
    expect(parseAllowedRendererDevUrl('https://localhost:5173')).toBeNull()
  })

  it('rejects non-loopback hosts', () => {
    expect(parseAllowedRendererDevUrl('http://example.com:5173')).toBeNull()
    expect(parseAllowedRendererDevUrl('http://192.168.1.1:5173')).toBeNull()
    expect(parseAllowedRendererDevUrl('http://10.0.0.1:3000')).toBeNull()
  })

  it('rejects file:// protocol', () => {
    expect(parseAllowedRendererDevUrl('file:///tmp/index.html')).toBeNull()
  })

  it('rejects invalid URLs', () => {
    expect(parseAllowedRendererDevUrl('not-a-url')).toBeNull()
    expect(parseAllowedRendererDevUrl('')).toBeNull()
    expect(parseAllowedRendererDevUrl(undefined as unknown as string)).toBeNull()
  })

  it('rejects javascript: protocol', () => {
    expect(parseAllowedRendererDevUrl('javascript:alert(1)')).toBeNull()
  })

  it('rejects data: protocol', () => {
    expect(parseAllowedRendererDevUrl('data:text/html,<h1>hi</h1>')).toBeNull()
  })
})
