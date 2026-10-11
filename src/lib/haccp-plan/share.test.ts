import { describe, it, expect } from 'vitest'
import { newToken, sha256Hex, planUrl } from './share'

describe('share tokens', () => {
  it('are 43-char base64url and unique', () => {
    const a = newToken(), b = newToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
  })
  it('hash to lowercase sha256 hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('builds the public url', () => {
    expect(planUrl('https://app.blueroll.app', 'tok')).toBe('https://app.blueroll.app/plan/tok')
  })
})
