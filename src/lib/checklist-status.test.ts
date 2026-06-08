import { describe, expect, test } from 'vitest'
import { checklistStatus, compareTemplates, type TemplateLike } from './checklist-status'

const base: TemplateLike = {
  name: 'A', frequency: 'daily', deadline_time: null,
  multi_per_day: false, min_per_day: 1, supervisor_role: null,
}
const at = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d }

describe('checklistStatus', () => {
  test('single, none today -> pending', () => {
    expect(checklistStatus(base, []).label).toBe('Pending')
  })
  test('single, one completion -> completed', () => {
    expect(checklistStatus(base, [{ signed_off_by: null }]).label).toBe('Completed')
  })
  test('single with supervisor, unsigned -> awaiting sign-off', () => {
    expect(checklistStatus({ ...base, supervisor_role: 'manager' }, [{ signed_off_by: null }]).label)
      .toBe('Awaiting Sign-off')
  })
  test('multi below min -> progress label, pending-like', () => {
    const s = checklistStatus({ ...base, multi_per_day: true, min_per_day: 8 },
      [{ signed_off_by: null }, { signed_off_by: null }, { signed_off_by: null }])
    expect(s.label).toBe('3/8 today')
    expect(s.status).toBe('neutral')
  })
  test('multi at/over min -> done with count', () => {
    const s = checklistStatus({ ...base, multi_per_day: true, min_per_day: 2 },
      [{ signed_off_by: null }, { signed_off_by: null }, { signed_off_by: null }])
    expect(s.label).toBe('3/2 today')
    expect(s.status).toBe('success')
  })
  test('multi with min 0 -> always counts as done, shows count', () => {
    const s = checklistStatus({ ...base, multi_per_day: true, min_per_day: 0 }, [])
    expect(s.label).toBe('0 today')
    expect(s.status).toBe('success')
  })
  test('single past deadline, not done -> overdue', () => {
    const s = checklistStatus({ ...base, deadline_time: '00:01' }, [], at(23, 59))
    expect(s.label).toBe('Overdue')
    expect(s.status).toBe('warning')
  })
})

describe('compareTemplates (pending first, deadline asc nulls-last, then name)', () => {
  const done = (t: TemplateLike) => ({ t, done: true })
  const pend = (t: TemplateLike) => ({ t, done: false })
  test('pending before done', () => {
    expect(compareTemplates(pend(base), done({ ...base, name: '0' }))).toBeLessThan(0)
  })
  test('earlier deadline first among pending', () => {
    expect(compareTemplates(
      pend({ ...base, deadline_time: '09:00' }),
      pend({ ...base, deadline_time: '17:00' }),
    )).toBeLessThan(0)
  })
  test('deadline before no-deadline', () => {
    expect(compareTemplates(pend({ ...base, deadline_time: '17:00' }), pend(base))).toBeLessThan(0)
  })
  test('name tiebreak', () => {
    expect(compareTemplates(pend({ ...base, name: 'A' }), pend({ ...base, name: 'B' }))).toBeLessThan(0)
  })
})
