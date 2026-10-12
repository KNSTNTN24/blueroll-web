import { describe, it, expect } from 'vitest'
import { ASSISTANT_CHIPS } from '../content/assistant-chips'
import { checklistsFor } from '../context'
import { QUESTIONS } from '../content/questions'
import { HACCP_METHODS } from '@/lib/haccp-pack/methods'

const q = (id: string) => QUESTIONS.find((x) => x.id === id)!

describe('assistant chips', () => {
  it('every method has 2–3 short suggested questions', () => {
    for (const m of HACCP_METHODS) {
      const chips = ASSISTANT_CHIPS[m.id]
      expect(chips, m.id).toBeDefined()
      expect(chips.length, m.id).toBeGreaterThanOrEqual(2)
      expect(chips.length, m.id).toBeLessThanOrEqual(3)
      for (const c of chips) { expect(c.length, c).toBeLessThanOrEqual(60); expect(c.endsWith('?'), c).toBe(true) }
    }
  })
})

describe('checklistsFor', () => {
  it('names the checklists an answer switches on', () => {
    expect(checklistsFor(q('processes'), { processes: ['cook_hot', 'reheat'] })).toEqual(['Cooking Temperatures', 'Reheating Record'])
    expect(checklistsFor(q('pest_control'), { pest_control: 'contractor' })).toEqual(['Pest Contractor Visit'])
  })
  it('links the fridge questions to the fridge log when there is a fridge', () => {
    const eq = [{ kind: 'fridge' as const, label: 'Fridge 1' }]
    expect(checklistsFor(q('fridge_check_method'), { equipment: eq, fridge_check_method: 'probe' })).toEqual(['Fridge & Freezer Temperatures'])
    expect(checklistsFor(q('fridge_check_method'), { fridge_check_method: 'probe' })).toEqual([])
  })
  it('is empty before the answer turns anything on', () => {
    expect(checklistsFor(q('processes'), {})).toEqual([])
  })
})
