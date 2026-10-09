import { describe, it, expect } from 'vitest'
import { localParts, zonedToUtc, periodStartUtc, periodKey, deadlineUtc } from '../../../../supabase/functions/_shared/checklists-core/time'

const L = 'Europe/London'
describe('time helpers', () => {
  it('localParts in BST and GMT', () => {
    expect(localParts(new Date('2026-07-01T08:30:00Z'), L)).toMatchObject({ y: 2026, m: 7, d: 1, hh: 9, mm: 30, weekday: 3 })
    expect(localParts(new Date('2026-12-01T08:30:00Z'), L)).toMatchObject({ hh: 8, mm: 30, weekday: 2 })
  })
  it('zonedToUtc handles both offsets', () => {
    expect(zonedToUtc(2026, 7, 1, 9, 0, L).toISOString()).toBe('2026-07-01T08:00:00.000Z')
    expect(zonedToUtc(2026, 12, 1, 9, 0, L).toISOString()).toBe('2026-12-01T09:00:00.000Z')
  })
  it('deadline on the day clocks go back (25 Oct 2026) is 09:00 local = 09:00Z', () => {
    expect(deadlineUtc('09:00', new Date('2026-10-25T07:00:00Z'), L)!.toISOString()).toBe('2026-10-25T09:00:00.000Z')
    expect(deadlineUtc('09:00', new Date('2026-10-24T07:00:00Z'), L)!.toISOString()).toBe('2026-10-24T08:00:00.000Z')
  })
  it('deadlineUtc null without a deadline and tolerant of HH:mm:ss', () => {
    expect(deadlineUtc(null, new Date(), L)).toBeNull()
    expect(deadlineUtc('23:00:00', new Date('2026-12-01T10:00:00Z'), L)!.toISOString()).toBe('2026-12-01T23:00:00.000Z')
  })
  it('period starts match web getPeriodStart in site time', () => {
    const now = new Date('2026-10-14T10:00:00Z') // Wed 14 Oct 2026, BST
    expect(periodStartUtc('daily', now, L).toISOString()).toBe('2026-10-13T23:00:00.000Z')
    expect(periodStartUtc('weekly', now, L).toISOString()).toBe('2026-10-11T23:00:00.000Z')      // Mon 12 Oct local
    expect(periodStartUtc('monthly', now, L).toISOString()).toBe('2026-09-30T23:00:00.000Z')     // 1 Oct local
    expect(periodStartUtc('four_weekly', now, L).toISOString()).toBe('2026-09-20T23:00:00.000Z') // Mon 12 Oct − 21 d
    expect(periodKey('weekly', now, L)).toBe('2026-10-12')
    expect(periodKey('custom', now, L)).toBe('2026-10-14')
  })
  it('just after local midnight belongs to the new day', () => {
    expect(periodKey('daily', new Date('2026-07-01T23:30:00Z'), L)).toBe('2026-07-02')
  })
})
