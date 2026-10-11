import { describe, it, expect } from 'vitest'
import { proofForMethod, mergeDays } from './proof-map'
import { METHOD_COPY } from './copy'
import { HACCP_METHODS } from '@/lib/haccp-pack/methods'
import type { PlanBundle, TemplateProof, DayStatus } from './types'

const days = (fill: DayStatus, over: Record<number, DayStatus> = {}) => Array.from({ length: 28 }, (_, i) => over[i] ?? fill)
const tpl = (o: Partial<TemplateProof>): TemplateProof => ({ templateId: 't', name: 'X', libraryKey: null, sfbbSection: null, frequency: 'daily',
  days: days('none'), completions: 0, flagged: 0, corrected: 0, readings: 0, initials: [], lastCompletedAt: null, ...o })
const proof = (templates: TemplateProof[], deliveries = { count: 0, outOfRange: 0, days: days('none') }): PlanBundle['proof'] =>
  ({ templates, deliveries, corrective: [], lastReview: null })

describe('copy', () => {
  it('covers every pack method', () => {
    for (const m of HACCP_METHODS) expect(METHOD_COPY[m.id], m.id).toBeDefined()
  })
})

describe('mergeDays', () => {
  it('uses precedence flagged > corrected > ok > missed > none', () => {
    const a = days('none', { 0: 'ok', 1: 'missed', 2: 'corrected', 3: 'ok' })
    const b = days('none', { 0: 'flagged', 1: 'ok', 2: 'ok', 4: 'missed' })
    const m = mergeDays([a, b])
    expect(m.slice(0, 5)).toEqual(['flagged', 'ok', 'corrected', 'ok', 'missed'])
  })
  it('returns 28 none for no strips', () => {
    expect(mergeDays([])).toEqual(days('none'))
  })
})

describe('proofForMethod', () => {
  it('matches chilled storage by library key, section or name', () => {
    const p = proofForMethod('chilled_storage', proof([
      tpl({ templateId: 'a', name: 'Fridge & Freezer Temperatures', libraryKey: null, sfbbSection: 'chilling', completions: 56, flagged: 2, corrected: 2, initials: ['TA', 'PK'], days: days('ok') }),
      tpl({ templateId: 'b', name: 'Daily Opening Checks', sfbbSection: 'cleaning', completions: 28 }),
    ]))
    expect(p?.sourceNames).toEqual(['Fridge & Freezer Temperatures'])
    expect(p?.stats[0]).toEqual({ value: '56', label: 'Records in 28 days', tone: 'default' })
    expect(p?.stats[1]).toEqual({ value: '2', label: 'Out of range — 2 corrected', tone: 'amber' })
    expect(p?.stats[2].value).toBe('TA · PK')
  })
  it('does not treat cooking temperature logs as fridge records', () => {
    const p = proofForMethod('chilled_storage', proof([
      tpl({ name: 'Fridge & Freezer Temperatures', libraryKey: 'fridge_temps', completions: 2 }),
      tpl({ name: 'Cooking Temperatures', libraryKey: 'cooking_temps', sfbbSection: 'cooking', completions: 5 }),
      tpl({ name: 'Hot Holding Temperature', sfbbSection: 'cooking', completions: 5 }),
    ]))
    expect(p?.sourceNames).toEqual(['Fridge & Freezer Temperatures'])
  })
  it('uses deliveries for suppliers and stock control', () => {
    const p = proofForMethod('suppliers', proof([], { count: 40, outOfRange: 1, days: days('ok') }))
    expect(p?.title).toBe('Delivery checks')
    expect(p?.stats[0].value).toBe('40')
    expect(p?.stats[1].tone).toBe('amber')
  })
  it('returns null when nothing is linked', () => {
    expect(proofForMethod('cooking_safely', proof([]))).toBeNull()
    expect(proofForMethod('training', proof([tpl({ name: 'Training log' })]))).toBeNull()
  })
  it('daily diary merges every template', () => {
    const p = proofForMethod('daily_diary', proof([tpl({ name: 'A', completions: 3, days: days('ok') }), tpl({ name: 'B', completions: 2 })]))
    expect(p?.stats[0].value).toBe('5')
  })
})
