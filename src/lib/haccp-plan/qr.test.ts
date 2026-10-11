import { describe, it, expect } from 'vitest'
import { qrMatrix } from './qr'

describe('qrMatrix', () => {
  it('returns a square module grid for a plan URL', () => {
    const m = qrMatrix('https://app.blueroll.app/plan/' + 'a'.repeat(43))
    expect(m.length).toBeGreaterThanOrEqual(21)
    expect(m.every((row) => row.length === m.length)).toBe(true)
    // finder pattern: top-left 7x7 corner is dark on its border
    expect(m[0].slice(0, 7).every(Boolean)).toBe(true)
  })
})
