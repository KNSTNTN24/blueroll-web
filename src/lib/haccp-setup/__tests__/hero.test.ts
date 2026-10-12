import { describe, it, expect } from 'vitest'
import { setupHero } from '../hero'

describe('setupHero', () => {
  it('no session: start', () => {
    expect(setupHero(null)).toEqual({ mode: 'start', pct: 0, next: null, left: 0 })
  })
  it('in progress: continue with percent and the next section', () => {
    const h = setupHero({ status: 'in_progress', answers: { venue_type: 'coffee_shop', processes: ['rte_prep'], extra_care: [], equipment: [] } })
    expect(h.mode).toBe('continue')
    expect(h.pct).toBeGreaterThan(0)
    expect(h.pct).toBeLessThan(100)
    expect(h.next).toBe('Cross-contamination')
    expect(h.left).toBeGreaterThan(0)
  })
  it('applied: review with questions', () => {
    expect(setupHero({ status: 'applied', answers: {} }).mode).toBe('review')
  })
})
