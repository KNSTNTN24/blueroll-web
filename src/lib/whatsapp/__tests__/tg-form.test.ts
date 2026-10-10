import { describe, it, expect } from 'vitest'
import { normaliseTemp, isFlagged, validateForm, buildPayload, statusMessage, FORM_MSG, type FormItem } from '../tg-form'

const temp: FormItem = { id: 'a', name: 'Fridge 1', type: 'temperature', required: true, min: 0, max: 5, unit: '°C' }
const frz: FormItem = { id: 'f', name: 'Freezer', type: 'temperature', required: false, min: -25, max: -18, unit: null }
const yn: FormItem = { id: 'b', name: 'Clean?', type: 'yes_no', required: true, min: null, max: null, unit: null }
const tick: FormItem = { id: 'c', name: 'Probe wiped', type: 'tick', required: false, min: null, max: null, unit: null }
const txt: FormItem = { id: 'd', name: 'Notes', type: 'text', required: false, min: null, max: null, unit: null }
const items = [temp, frz, yn, tick, txt]

describe('normaliseTemp', () => {
  it.each([['3', '3'], [' -18,5 ', '-18.5'], ['-0.25', '-0.25'], ['', null], ['-', null], ['abc', null], ['1234', null], ['3.123', null], ['\u221218', '-18'], ['\u201320,5', '-20.5']])(
    '%s → %s', (raw, exp) => expect(normaliseTemp(raw)).toBe(exp))
})

describe('isFlagged', () => {
  it('flags out-of-range temps incl. negatives, and yes_no "no"', () => {
    expect(isFlagged(temp, '5.1')).toBe(true)
    expect(isFlagged(temp, '4')).toBe(false)
    expect(isFlagged(frz, '-20')).toBe(false)
    expect(isFlagged(frz, '-12')).toBe(true)
    expect(isFlagged(frz, '-12,0')).toBe(true)
    expect(isFlagged(frz, '\u221212')).toBe(true)
    expect(isFlagged(yn, 'no')).toBe(true)
    expect(isFlagged(yn, 'yes')).toBe(false)
    expect(isFlagged(temp, 'x')).toBe(false)
    expect(isFlagged(tick, true)).toBe(false)
  })
})

describe('validateForm', () => {
  it('requires required answers and a valid temperature', () => {
    const v = validateForm(items, { a: '3' }, {})
    expect(v.valid).toBe(false)
    expect(v.missing).toEqual(['b'])
    const bad = validateForm(items, { a: '3x', b: 'yes' }, {})
    expect(bad.invalid).toEqual(['a'])
    expect(bad.valid).toBe(false)
  })
  it('invalid optional temperature blocks submit; empty optional does not', () => {
    expect(validateForm(items, { a: '3', b: 'yes', f: '--' }, {}).invalid).toEqual(['f'])
    expect(validateForm(items, { a: '3', b: 'yes', f: '' }, {}).valid).toBe(true)
  })
  it('flagged items need a corrective action', () => {
    const v = validateForm(items, { a: '9', b: 'no' }, {})
    expect(v.flagged).toEqual(['a', 'b'])
    expect(v.needsAction).toEqual(['a', 'b'])
    expect(v.valid).toBe(false)
    const ok = validateForm(items, { a: '9', b: 'no' }, { a: { action: 'moved', details: '' }, b: { action: 'other', details: 'x' } })
    expect(ok.valid).toBe(true)
  })
})

describe('buildPayload', () => {
  it('normalises answers, omits empties/unticked, keeps corrective only for flagged', () => {
    const p = buildPayload('tok', items, { a: ' 9,5', f: '', b: 'yes', c: false, d: '  hi  ' }, { a: { action: 'moved', details: ' d ' }, b: { action: 'other', details: '' } })
    expect(p).toEqual({ t: 'tok', answers: { a: '9.5', b: 'yes', d: 'hi' }, corrective: { a: { action: 'moved', details: 'd' } } })
    expect(buildPayload('tok', items, { c: true }, {}).answers).toEqual({ c: true })
    expect(buildPayload('tok', items, { f: '\u221219' }, {}).answers).toEqual({ f: '-19' })
  })
})

describe('statusMessage', () => {
  it('410 used → "Already submitted ✓" (not expired)', () => {
    expect(statusMessage(410, 'used')).toBe('Already submitted ✓')
    expect(statusMessage(410, 'used')).not.toMatch(/expired/i)
  })
  it('other statuses', () => {
    expect(statusMessage(410, 'expired')).toBe(FORM_MSG.expired)
    expect(statusMessage(410, 'changed')).toBe(FORM_MSG.changed)
    expect(statusMessage(401, 'unauthorized')).toBe(FORM_MSG.unauthorized)
    expect(statusMessage(403, 'forbidden')).toBe(FORM_MSG.forbidden)
    expect(statusMessage(500, 'server')).toBe(FORM_MSG.generic)
  })
})
