import { describe, it, expect } from 'vitest'
import { fieldName, formItems, parseFormAnswers } from '../../../../supabase/functions/_shared/checklists-core/answers'
import type { TemplateItem } from '../../../../supabase/functions/_shared/checklists-core/types'

const it_ = (id: string, item_type: TemplateItem['item_type'], o: Partial<TemplateItem> = {}): TemplateItem =>
  ({ id, name: id.toUpperCase(), item_type, required: true, min_value: null, max_value: null, unit: null, sort_order: 0, ...o })

describe('formItems', () => {
  it('sorts, drops photo/initials, reports required photos', () => {
    const r = formItems([it_('b', 'yes_no', { sort_order: 2 }), it_('a', 'temperature', { sort_order: 1 }),
      it_('p', 'photo', { required: false }), it_('i', 'initials')])
    expect(r.supported.map((x) => x.id)).toEqual(['a', 'b'])
    expect(r.unsupportedRequired).toEqual([])
    expect(formItems([it_('p', 'photo')]).unsupportedRequired.map((x) => x.id)).toEqual(['p'])
  })
})

describe('parseFormAnswers', () => {
  const items = [it_('a', 'temperature', { min_value: 0, max_value: 5 }), it_('b', 'yes_no'), it_('c', 'tick'), it_('d', 'text', { required: false })]
  const ids = ['a', 'b', 'c', 'd']
  it('maps fields by index and flags', () => {
    const r = parseFormAnswers(ids, items, { [fieldName(0)]: ' 7,5 ', f1: 'no', f2: true, f3: '  ok ' })
    expect(r.answers).toEqual([
      { item_id: 'a', value: '7.5', flagged: true },
      { item_id: 'b', value: 'no', flagged: true },
      { item_id: 'c', value: 'true', flagged: false },
      { item_id: 'd', value: 'ok', flagged: false },
    ])
    expect(r.missingRequired).toEqual([])
  })
  it('reports missing required and skips empties', () => {
    const r = parseFormAnswers(ids, items, { f0: '', f1: 'yes' })
    expect(r.answers.map((a) => a.item_id)).toEqual(['b'])
    expect(r.missingRequired).toEqual(['A', 'C'])
  })
  it('ignores ids of items deleted since the form was sent and never shifts values', () => {
    const r = parseFormAnswers(['gone', 'b'], items, { f0: '3', f1: 'yes' })
    expect(r.answers).toEqual([{ item_id: 'b', value: 'yes', flagged: false }])
  })
  it('rejects unexpected yes_no values', () => {
    expect(parseFormAnswers(['b'], items, { f0: 'maybe' }).answers).toEqual([])
  })
})
