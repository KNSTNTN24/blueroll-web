// src/lib/whatsapp/__tests__/team-day.test.ts
import { describe, it, expect } from 'vitest'
import { planTeamDay, teamDayState, teamDayTimes, takePeriodKey, doneInPeriod, summaryParams, todayOnly } from '../../../../supabase/functions/_shared/channels/team-day'
import { tpl, NOW } from './fakes/team-deps'

const LON = 'Europe/London'
const FRIDGE = tpl({ id: 'tA', name: 'Fridge temps', deadline_time: '11:00' })      // 10:00Z (BST)
const HOT = tpl({ id: 'tB', name: 'Hot holding', deadline_time: '15:00' })          // 14:00Z
const CLEAN = tpl({ id: 'tC', name: 'Cleaning' })                                    // daily, no deadline
const DEEP = tpl({ id: 'tW', name: 'Deep clean', frequency: 'weekly' })             // weekly, no deadline
const at = (iso: string) => new Date(iso)
const plan = (now: Date, templates = [FRIDGE, HOT, CLEAN], completions: any[] = []) => planTeamDay({ templates, siteId: 's1', tz: LON, now, completions })

describe('teamDayTimes', () => {
  it('morning = earliest deadline − 1 h; summary = latest deadline + 1 h', () => {
    const t = teamDayTimes([FRIDGE, HOT, CLEAN], LON, NOW)
    expect(t.morningAt.toISOString()).toBe('2026-10-14T09:00:00.000Z')
    expect(t.summaryAt.toISOString()).toBe('2026-10-14T15:00:00.000Z')
    expect(t.date).toBe('2026-10-14')
  })
  it('no deadlines → 08:00 and 22:00 site time', () => {
    const t = teamDayTimes([CLEAN], LON, NOW)
    expect(t.morningAt.toISOString()).toBe('2026-10-14T07:00:00.000Z')
    expect(t.summaryAt.toISOString()).toBe('2026-10-14T21:00:00.000Z')
  })
  it('site timezone, not London', () => {
    const t = teamDayTimes([FRIDGE], 'America/New_York', at('2026-10-14T14:00:00Z'))
    expect(t.morningAt.toISOString()).toBe('2026-10-14T14:00:00.000Z')   // 11:00 EDT − 1 h = 10:00 EDT
  })
  it('a 23:30 deadline does not push the summary past 23:50 local', () => {
    const t = teamDayTimes([tpl({ id: 'late', name: 'Close down', deadline_time: '23:30' })], LON, NOW)
    expect(t.summaryAt.toISOString()).toBe('2026-10-14T22:50:00.000Z')
  })
  // Review Focus 1: the clocks go back in London at 02:00 on Sunday 25 Oct 2026.
  it('DST day: 1 h before a 09:00 deadline is 08:00 GMT on the 25th, 07:00Z the day before; fallback 08:00 likewise', () => {
    const nine = tpl({ id: 'n', name: 'Opening', deadline_time: '09:00' })
    expect(teamDayTimes([nine], LON, at('2026-10-24T12:00:00Z')).morningAt.toISOString()).toBe('2026-10-24T07:00:00.000Z')
    expect(teamDayTimes([nine], LON, at('2026-10-25T12:00:00Z')).morningAt.toISOString()).toBe('2026-10-25T08:00:00.000Z')
    expect(teamDayTimes([CLEAN], LON, at('2026-10-25T00:30:00Z')).morningAt.toISOString()).toBe('2026-10-25T08:00:00.000Z')
    expect(plan(at('2026-10-25T07:59:00Z'), [nine]).morning).toBe(false)
    expect(plan(at('2026-10-25T08:00:00Z'), [nine]).morning).toBe(true)
  })
})

describe('teamDayState', () => {
  it('open by assignment-free due logic; done = latest completion in the period with who did it', () => {
    const s = teamDayState({ templates: [FRIDGE, CLEAN], siteId: 's1', tz: LON, now: NOW, completions: [
      { template_id: 'tC', site_id: 's1', completed_at: '2026-10-14T07:00:00Z', completed_by: 'p2' },
      { template_id: 'tC', site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' },
      { template_id: 'tA', site_id: 's2', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' },   // other site
      { template_id: 'tA', site_id: 's1', completed_at: '2026-10-13T08:00:00Z', completed_by: 'p1' },   // yesterday
    ] })
    expect(s.open.map((x) => x.template.id)).toEqual(['tA'])
    expect(s.done).toEqual([{ template: CLEAN, completedAt: '2026-10-14T08:00:00Z', by: 'p1' }])
  })
})

describe('planTeamDay', () => {
  it('morning from earliest deadline − 1 h until the summary time, only with something open', () => {
    expect(plan(at('2026-10-14T08:59:00Z')).morning).toBe(false)
    expect(plan(at('2026-10-14T09:00:00Z')).morning).toBe(true)
    expect(plan(at('2026-10-14T14:59:00Z')).morning).toBe(true)
    expect(plan(at('2026-10-14T15:00:00Z')).morning).toBe(false)
    const allDone = ['tA', 'tB', 'tC'].map((id) => ({ template_id: id, site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' }))
    expect(plan(at('2026-10-14T09:30:00Z'), [FRIDGE, HOT, CLEAN], allDone).morning).toBe(false)
  })
  it('overdue: an open checklist from its deadline for an hour', () => {
    expect(plan(at('2026-10-14T09:59:00Z')).overdue).toEqual([])
    expect(plan(at('2026-10-14T10:00:00Z')).overdue.map((x) => x.template.id)).toEqual(['tA'])
    expect(plan(at('2026-10-14T10:59:00Z')).overdue.map((x) => x.template.id)).toEqual(['tA'])
    expect(plan(at('2026-10-14T11:00:00Z')).overdue).toEqual([])
    expect(plan(at('2026-10-14T10:10:00Z'), [FRIDGE], [{ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T10:05:00Z', completed_by: 'p1' }]).overdue).toEqual([])
  })
  it('summary from latest deadline + 1 h when something that counts today is open', () => {
    expect(plan(at('2026-10-14T14:59:00Z')).summary).toBe(false)
    expect(plan(at('2026-10-14T15:00:00Z')).summary).toBe(true)
    const doneToday = ['tA', 'tB', 'tC'].map((id) => ({ template_id: id, site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' }))
    expect(plan(at('2026-10-14T15:00:00Z'), [FRIDGE, HOT, CLEAN, DEEP], doneToday).summary).toBe(false)   // only the weekly is open
  })
})

describe('take keys, counts, summary params', () => {
  it('one take per period; multi-per-day: one per slot', () => {
    expect(takePeriodKey({ multi_per_day: false }, '2026-10-14', 0)).toBe('2026-10-14')
    expect(takePeriodKey({ multi_per_day: true }, '2026-10-14', 0)).toBe('2026-10-14#1')
    expect(takePeriodKey({ multi_per_day: true }, '2026-10-14', 2)).toBe('2026-10-14#3')
  })
  it('doneInPeriod counts this site and period only', () => {
    const t = tpl({ id: 'm', name: 'Probe', multi_per_day: true, min_per_day: 3 })
    expect(doneInPeriod(t, 's1', LON, NOW, [
      { template_id: 'm', site_id: 's1', completed_at: '2026-10-14T07:00:00Z', completed_by: 'p1' },
      { template_id: 'm', site_id: 's1', completed_at: '2026-10-13T21:00:00Z', completed_by: 'p1' },
      { template_id: 'm', site_id: 's2', completed_at: '2026-10-14T07:00:00Z', completed_by: 'p1' },
    ])).toBe(1)
  })
  it('summary params count today’s checklists; missed names in deadline order', () => {
    const s = teamDayState({ templates: [HOT, FRIDGE, CLEAN, DEEP], siteId: 's1', tz: LON, now: at('2026-10-14T15:00:00Z'),
      completions: [{ template_id: 'tC', site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' }] })
    expect(summaryParams('Kitchen', 'Ashfield Row', s)).toEqual(['Kitchen', 'Ashfield Row', '1', '3', 'Fridge temps, Hot holding'])
    expect(todayOnly(s).open.map((x) => x.template.id)).toEqual(['tB', 'tA'])   // template order; the weekly is left out
  })
})
