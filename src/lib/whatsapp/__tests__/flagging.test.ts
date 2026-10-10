import { describe, it, expect } from 'vitest'
import { flagResponse } from '../../../../supabase/functions/_shared/checklists-core/flagging'

const t = (min: number | null, max: number | null) => ({ item_type: 'temperature' as const, min_value: min, max_value: max })
describe('flagResponse (parity with web autoFlag)', () => {
  it.each([
    [t(0, 5), '3', false], [t(0, 5), '5', false], [t(0, 5), '5.1', true], [t(0, 5), '-0.5', true],
    [t(null, 5), '-40', false], [t(75, null), '74.9', true], [t(0, 5), '', false], [t(0, 5), 'abc', false], [t(0, 5), '9°C', true],
  ])('temperature %o value %s → %s', (item, v, exp) => expect(flagResponse(item, v as string)).toBe(exp))
  it('yes_no "no" flags, others do not', () => {
    const yn = { item_type: 'yes_no' as const, min_value: null, max_value: null }
    expect(flagResponse(yn, 'no')).toBe(true)
    expect(flagResponse(yn, 'yes')).toBe(false)
    expect(flagResponse({ item_type: 'tick', min_value: null, max_value: null }, 'false')).toBe(false)
  })
})
