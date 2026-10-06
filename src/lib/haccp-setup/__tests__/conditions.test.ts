import { describe, it, expect } from 'vitest'
import { evalCond, condRefs } from '../conditions'
import type { Answers } from '../types'

const a: Answers = {
  venue_type: 'restaurant',
  processes: ['cook_hot', 'reheat'],
  handwash_basin: true,
  equipment: [{ kind: 'fridge', label: 'Walk-in' }, { kind: 'probe', label: 'Probe' }],
}

describe('evalCond', () => {
  it('always', () => expect(evalCond({ always: true }, {})).toBe(true))
  it('eq on boolean and string', () => {
    expect(evalCond({ q: 'handwash_basin', eq: true }, a)).toBe(true)
    expect(evalCond({ q: 'venue_type', eq: 'bakery' }, a)).toBe(false)
  })
  it('eq on unanswered question is false', () => expect(evalCond({ q: 'missing', eq: true }, a)).toBe(false))
  it('has on multi answers', () => {
    expect(evalCond({ q: 'processes', has: 'reheat' }, a)).toBe(true)
    expect(evalCond({ q: 'processes', has: 'hot_hold' }, a)).toBe(false)
    expect(evalCond({ q: 'venue_type', has: 'restaurant' }, a)).toBe(false) // not an array
  })
  it('equipment matches any listed kind', () => {
    expect(evalCond({ equipment: ['freezer', 'probe'] }, a)).toBe(true)
    expect(evalCond({ equipment: ['dishwasher'] }, a)).toBe(false)
    expect(evalCond({ equipment: ['fridge'] }, {})).toBe(false)
  })
  it('all / any / not', () => {
    expect(evalCond({ all: [{ q: 'processes', has: 'cook_hot' }, { equipment: ['probe'] }] }, a)).toBe(true)
    expect(evalCond({ any: [{ q: 'processes', has: 'bake' }, { q: 'venue_type', eq: 'bakery' }] }, a)).toBe(false)
    expect(evalCond({ not: { q: 'processes', has: 'bake' } }, a)).toBe(true)
  })
})

describe('condRefs', () => {
  it('collects referenced question ids, equipment refers to "equipment"', () => {
    expect(condRefs({ all: [{ q: 'processes', has: 'x' }, { not: { equipment: ['probe'] } }, { always: true }] }).sort())
      .toEqual(['equipment', 'processes'])
  })
})
