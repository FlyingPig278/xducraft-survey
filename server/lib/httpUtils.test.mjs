import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { isHttpUrl, readJsonBody, validateSecret } from './httpUtils.mjs'

const requestFrom = (body) => {
  const request = Readable.from([Buffer.from(body)])
  request.headers = {}
  request.socket = { remoteAddress: '127.0.0.1' }
  return request
}

describe('HTTP boundaries', () => {
  it('accepts JSON objects and rejects malformed, array and oversized bodies', async () => {
    await expect(readJsonBody(requestFrom('{"ok":true}'), 100)).resolves.toEqual({ ok: true })
    await expect(readJsonBody(requestFrom('{broken'), 100)).rejects.toMatchObject({ status: 400 })
    await expect(readJsonBody(requestFrom('[]'), 100)).rejects.toMatchObject({ status: 400 })
    await expect(readJsonBody(requestFrom('{"large":"value"}'), 4)).rejects.toMatchObject({ status: 413 })
  })

  it('rejects placeholder and short production secrets', () => {
    expect(() => validateSecret('SESSION_SECRET', 'replace-with-a-long-random-string')).toThrow()
    expect(() => validateSecret('SESSION_SECRET', 'too-short')).toThrow()
    expect(validateSecret('SESSION_SECRET', 'a'.repeat(32))).toBe('a'.repeat(32))
  })

  it('allows only HTTP and HTTPS candidate links', () => {
    expect(isHttpUrl('https://example.com/path')).toBe(true)
    expect(isHttpUrl('http://example.com')).toBe(true)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('file:///etc/passwd')).toBe(false)
  })
})
