// src/lib/haccp-setup/__tests__/own-words.test.ts
import { describe, it, expect } from 'vitest'
import { QUESTIONS } from '../content/questions'
import { DRAFT_METHODS } from '../../../../supabase/functions/_shared/draft-method'
import { evalCond } from '../conditions'
import { visibleQuestions } from '../engine'
import { buildPackDraft, EMPTY_PACK } from '../draft-pack'
import { buildSetupContext, fillsPreview, planQuote } from '../context'
import { asOwnWords, ownWordsValues, SKIP } from '../own-words'
import { makeRichBundle } from '@/lib/haccp-plan/fixtures'
import type { Answers, OwnWordsAnswer } from '../types'

const q = (id: string) => QUESTIONS.find((x) => x.id === id)!
const WORDS: [string, string][] = [
  ['pest_words', 'pest_control'], ['cooling_words', 'chilling_down'], ['defrost_words', 'defrosting'],
  ['freezing_words', 'freezing'], ['probe_words', 'temperature_probes'], ['training_words', 'training'],
]
const cooling: OwnWordsAnswer = { text: 'trays then walk-in', draft: 'Cooked food is split into shallow trays.', ticks: { cd_portions: true, cd_fridge: false, cd_90min: true } }

describe('own-words questions', () => {
  it('match the server method table: method, target, ticks, fills', () => {
    for (const [id, method] of WORDS) {
      const x = q(id)
      expect(x, id).toBeTruthy()
      expect(x.method).toBe(method)
      expect(x.answer.kind).toBe('own_words')
      if (x.answer.kind !== 'own_words') continue
      const s = DRAFT_METHODS[method]
      expect(x.answer.target).toBe(s.target)
      expect(x.answer.ticks).toEqual(s.ticks.map((t) => t.id))
      expect(x.fills).toEqual([s.target, ...s.ticks.map((t) => t.id)])
    }
  })
  it('read as an optional description for the plan, not a repeat of the yes/no questions before them', () => {
    for (const [id] of WORDS) {
      expect(q(id).text, id).toMatch(/^Describe /)
      expect(q(id).why, id).toMatch(/skip/i)
    }
  })
  it('hide when Blueroll already fills the field', () => {
    const answers: Answers = { processes: ['cool_cooked'] }
    expect(visibleQuestions(QUESTIONS, answers, {}).some((x) => x.id === 'cooling_words')).toBe(true)
    expect(visibleQuestions(QUESTIONS, answers, { autoFilled: ['cd_method'] }).some((x) => x.id === 'cooling_words')).toBe(false)
  })
})

describe('{ auto } condition', () => {
  it('is true only when the field is auto-filled', () => {
    expect(evalCond({ auto: 'cd_method' }, {}, { autoFilled: ['cd_method'] })).toBe(true)
    expect(evalCond({ auto: 'cd_method' }, {}, {})).toBe(false)
  })
  it('buildSetupContext lists auto-filled fields, none with auto-fill off', () => {
    const b = makeRichBundle()
    const on = buildSetupContext(b.sources, 'site-1', b.sources.documents)
    expect(on.flags.autoFilled).toEqual(Object.keys(on.auto).filter((k) => !!on.auto[k]))
    expect(on.flags.autoFilled!.length).toBeGreaterThan(0)
    expect(buildSetupContext(b.sources, 'site-1', b.sources.documents, { autoFill: false }).flags.autoFilled).toEqual([])
  })
})

describe('own-words answers in the draft', () => {
  it('set the plan text and only the confirmed points', () => {
    const fields = buildPackDraft({ answers: { processes: ['cool_cooked'], cooling_words: cooling }, scotland: false }, null)
    const by = Object.fromEntries(fields.map((f) => [f.fieldId, f.value]))
    expect(by.cd_method).toBe('Cooked food is split into shallow trays.')
    expect(by.cd_portions).toBe(true)
    expect(by.cd_90min).toBe(true)
    expect('cd_fridge' in by).toBe(false)
  })
  it('points answered elsewhere are not set (answers win over AI)', () => {
    const fields = buildPackDraft({ answers: { processes: ['cool_cooked'], cool_90: false, cooling_words: cooling }, scotland: false }, null)
    expect(fields.filter((f) => f.fieldId === 'cd_90min')).toEqual([])
    const both = buildPackDraft({ answers: { processes: ['cool_cooked'], cool_90: true, cooling_words: cooling }, scotland: false }, null)
    expect(both.filter((f) => f.fieldId === 'cd_90min')).toHaveLength(1)
  })
  it('skip and malformed answers set nothing', () => {
    expect(ownWordsValues(q('cooling_words'), { cooling_words: SKIP })).toEqual([])
    expect(ownWordsValues(q('cooling_words'), { cooling_words: { cd_method: 'x' } })).toEqual([])
  })
  it('a hand-edited pack field stays manual', () => {
    const pack = { ...EMPTY_PACK, texts: { cd_method: 'My own words' }, overrides: { cd_method: true } }
    const f = buildPackDraft({ answers: { cooling_words: cooling }, scotland: false }, pack).find((x) => x.fieldId === 'cd_method')!
    expect(f.status).toBe('manual')
  })
  it('preview and quote show the draft', () => {
    const answers: Answers = { processes: ['cool_cooked'], cooling_words: cooling }
    const p = fillsPreview(q('cooling_words'), answers, { scotland: false })
    expect(p.find((x) => x.fieldId === 'cd_method')!.value).toBe(cooling.draft)
    expect(p.find((x) => x.fieldId === 'cd_fridge')!.value).toBeNull()
    expect(planQuote(q('cooling_words'), answers, { scotland: false })).toBe(cooling.draft)
  })
  it('asOwnWords restores a saved answer and rejects others', () => {
    expect(asOwnWords(cooling)).toEqual(cooling)
    expect(asOwnWords(SKIP)).toBeNull()
    expect(asOwnWords({ documents: 'x' } as never)).toBeNull()
  })
})
