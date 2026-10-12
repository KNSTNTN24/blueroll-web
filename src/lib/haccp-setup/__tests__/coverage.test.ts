// Every question knows its SFBB method and the pack fields it sets; together they cover the pack.
import { describe, it, expect } from 'vitest'
import { QUESTIONS } from '../content/questions'
import { FIELD_RULES } from '../content/haccp-mapping'
import { HACCP_METHODS, findField } from '@/lib/haccp-pack/methods'
import { buildPackDraft } from '../draft-pack'
import type { Ctx } from '../types'

const methodIds = new Set(HACCP_METHODS.map((m) => m.id))
const ctx = (answers: Ctx['answers']): Ctx => ({ answers, scotland: false })
const fieldsOf = (answers: Ctx['answers']) => Object.fromEntries(buildPackDraft(ctx(answers), null).map((f) => [f.fieldId, f.value]))
const q = (id: string) => QUESTIONS.find((x) => x.id === id)!

describe('question metadata', () => {
  it('every question names an existing pack method', () => {
    for (const x of QUESTIONS) expect(methodIds.has(x.method), `${x.id} → ${x.method}`).toBe(true)
  })
  it('every fills id is a real pack field', () => {
    for (const x of QUESTIONS) for (const f of x.fills) expect(findField(f), `${x.id} → ${f}`).toBeTruthy()
  })
  it('every field a rule can set is listed in some question’s fills', () => {
    const filled = new Set(QUESTIONS.flatMap((x) => x.fills))
    for (const r of FIELD_RULES) expect(filled.has(r.fieldId), r.fieldId).toBe(true)
  })
})

describe('new v2 questions', () => {
  const spec: [string, string, string, string[]][] = [
    ['cloth_habits', 'multi', 'cloths', ['cl_colour_coded', 'cl_stored']],
    ['handwash_signs', 'yes_no', 'handwashing', ['hw_signs']],
    ['two_stage_clean', 'yes_no', 'cleaning_effectively', ['ce_2stage']],
    ['fridge_check_method', 'single', 'chilled_storage', ['st_check_method']],
    ['fridge_checks_recorded', 'yes_no', 'chilled_storage', ['st_temp', 'st_records']],
    ['cool_90', 'yes_no', 'chilling_down', ['cd_90min']],
    ['no_refreeze', 'yes_no', 'defrosting', ['df_not_refreeze']],
    ['freezer_minus18', 'yes_no', 'freezing', ['fz_temp', 'fz_suitable']],
    ['cook_checks', 'multi', 'cooking_safely', ['ck_75c', 'ck_visual']],
    ['hot_hold_rules', 'multi', 'hot_holding', ['hh_63c', 'hh_2hr']],
    ['reheat_75', 'yes_no', 'reheating', ['rh_75c']],
    ['probe_clean', 'yes_no', 'temperature_probes', ['tp_sanitised']],
  ]
  it.each(spec)('%s is a %s question for %s filling %j', (id, kind, method, fills) => {
    expect(q(id)).toBeTruthy()
    expect(q(id).answer.kind).toBe(kind)
    expect(q(id).method).toBe(method)
    expect([...q(id).fills].sort()).toEqual([...fills].sort())
  })
  it('only asks about processes and kit the site has', () => {
    expect(q('cool_90').showIf).toEqual({ q: 'processes', has: 'cool_cooked' })
    expect(q('no_refreeze').showIf).toEqual({ q: 'processes', has: 'defrost' })
    expect(q('freezer_minus18').showIf).toEqual({ equipment: ['freezer'] })
    expect(q('cook_checks').showIf).toEqual({ q: 'processes', has: 'cook_hot' })
    expect(q('hot_hold_rules').showIf).toEqual({ q: 'processes', has: 'hot_hold' })
    expect(q('reheat_75').showIf).toEqual({ q: 'processes', has: 'reheat' })
    expect(q('probe_clean').showIf).toEqual({ equipment: ['probe'] })
  })
  it('fridge check options map onto the pack select options', () => {
    const opts = findField('st_check_method')!.options!
    const a = q('fridge_check_method').answer
    expect('options' in a).toBe(true)
    for (const o of (a as { options: { value: string }[] }).options) {
      expect(opts).toContain(fieldsOf({ fridge_check_method: o.value }).st_check_method)
    }
  })
  it('answers produce the right pack values', () => {
    expect(fieldsOf({ cloth_habits: ['colour_coded', 'sanitiser_between'] })).toMatchObject({ cl_colour_coded: true, cl_stored: true })
    expect(fieldsOf({ cloth_habits: [] })).not.toHaveProperty('cl_colour_coded')
    expect(fieldsOf({ fridge_checks_recorded: true })).toMatchObject({ st_temp: true, st_records: true })
    expect(fieldsOf({ cook_checks: ['visual'] })).toEqual({ ck_visual: true })
    expect(fieldsOf({ hot_hold_rules: ['above_63', 'max_2h'] })).toMatchObject({ hh_63c: true, hh_2hr: true })
    expect(fieldsOf({ freezer_minus18: true })).toMatchObject({ fz_temp: true, fz_suitable: true })
    expect(fieldsOf({ handwash_signs: false })).toEqual({})
  })
})
