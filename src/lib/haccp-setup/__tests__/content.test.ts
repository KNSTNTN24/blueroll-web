// src/lib/haccp-setup/__tests__/content.test.ts
import { describe, it, expect } from 'vitest'
import { QUESTIONS } from '../content/questions'
import { CHECKLIST_LIBRARY } from '../content/checklists'
import { FIELD_RULES } from '../content/haccp-mapping'
import { THRESHOLDS } from '../content/thresholds'
import { condRefs } from '../conditions'
import type { Ctx, Equipment } from '../types'

const ids = QUESTIONS.map((q) => q.id)
const ITEM_TYPES = ['tick', 'temperature', 'text', 'yes_no', 'photo', 'initials']
const FREQS = ['daily', 'weekly', 'monthly', 'four_weekly', 'custom']

describe('questionnaire content', () => {
  it('question ids are unique and every question has a section and why', () => {
    expect(new Set(ids).size).toBe(ids.length)
    for (const q of QUESTIONS) { expect(q.section).toBeTruthy(); expect(q.why.length).toBeGreaterThan(10) }
  })
  it('showIf only refers to EARLIER questions (no dead or circular branches)', () => {
    QUESTIONS.forEach((q, i) => {
      for (const ref of q.showIf ? condRefs(q.showIf) : []) expect(ids.slice(0, i), `${q.id} → ${ref}`).toContain(ref)
    })
  })
  it('option values referenced by conditions exist', () => {
    const optionsOf = (id: string) => {
      const a = QUESTIONS.find((q) => q.id === id)!.answer
      return 'options' in a ? a.options.map((o) => o.value) : []
    }
    const walk = (c: any): void => {
      if (!c || 'always' in c || 'equipment' in c) return
      if ('all' in c) return c.all.forEach(walk)
      if ('any' in c) return c.any.forEach(walk)
      if ('not' in c) return walk(c.not)
      if ('has' in c) expect(optionsOf(c.q), `${c.q}:${c.has}`).toContain(c.has)
      if ('eq' in c && typeof c.eq === 'string') expect(optionsOf(c.q), `${c.q}:${c.eq}`).toContain(c.eq)
    }
    QUESTIONS.forEach((q) => walk(q.showIf))
    CHECKLIST_LIBRARY.forEach((l) => walk(l.includeIf))
  })
  it('library conditions refer to existing questions', () => {
    for (const l of CHECKLIST_LIBRARY) for (const ref of condRefs(l.includeIf)) expect(ids).toContain(ref)
  })
  it('library items use allowed types/frequencies and temperatures inside FSA-sane bounds', () => {
    const eq: Equipment[] = [{ kind: 'fridge', label: 'F' }, { kind: 'freezer', label: 'Z' }, { kind: 'probe', label: 'P' }, { kind: 'dishwasher', label: 'D' }]
    const ctx: Ctx = { scotland: false, answers: { equipment: eq, processes: ['delivery_out'] } }
    for (const l of CHECKLIST_LIBRARY) {
      expect(FREQS).toContain(l.frequency)
      for (const it of l.items(ctx)) {
        expect(ITEM_TYPES).toContain(it.item_type)
        if (it.item_type === 'temperature') {
          expect(it.min_value, `${l.key}/${it.name}`).toBeTypeOf('number')
          expect(it.max_value, `${l.key}/${it.name}`).toBeTypeOf('number')
          expect(it.min_value!).toBeLessThan(it.max_value!)
          expect(it.unit).toBe('°C')
        } else {
          expect(it.min_value).toBeUndefined()
        }
      }
    }
  })
  it('fridge ranges come from THRESHOLDS', () => {
    const fridge = CHECKLIST_LIBRARY.find((l) => l.key === 'fridge_temps')!
    const [line] = fridge.items({ scotland: false, answers: { equipment: [{ kind: 'fridge', label: 'X' }] } })
    expect([line.min_value, line.max_value]).toEqual([THRESHOLDS.fridge.min, THRESHOLDS.fridge.max])
  })
  it('field rules are unique per field', () => {
    const f = FIELD_RULES.map((r) => r.fieldId)
    expect(new Set(f).size).toBe(f.length)
  })
})
