import { describe, it, expect } from 'vitest'
import { isAssigned, availableChecklists, dueChecklists } from '../../../../supabase/functions/_shared/checklists-core/due'
import type { Template, Person } from '../../../../supabase/functions/_shared/checklists-core/types'

const tpl = (o: Partial<Template>): Template => ({
  id: 't1', business_id: 'b', site_id: null, name: 'Fridge temps', frequency: 'daily', deadline_time: '11:00',
  multi_per_day: false, min_per_day: null, assigned_roles: ['kitchen_staff'], assigned_role_ids: ['r-ks'], active: true, ...o,
})
const anna: Person = { profile_id: 'p1', business_id: 'b', full_name: 'Anna', role: 'kitchen_staff', role_id: 'r-ks' }
const legacy: Person = { ...anna, profile_id: 'p2', role_id: null }
const now = new Date('2026-10-14T09:45:00Z') // 10:45 BST
const L = 'Europe/London'

describe('assignment and availability', () => {
  it('uses role_id when present, legacy role otherwise', () => {
    expect(isAssigned(tpl({}), anna)).toBe(true)
    expect(isAssigned(tpl({ assigned_role_ids: ['r-chef'] }), anna)).toBe(false)
    expect(isAssigned(tpl({ assigned_role_ids: [] }), legacy)).toBe(true)
    expect(isAssigned(tpl({ assigned_roles: ['chef'] }), legacy)).toBe(false)
  })
  it('filters by site and active', () => {
    const ts = [tpl({ id: 'a' }), tpl({ id: 'b', site_id: 's2' }), tpl({ id: 'c', site_id: 's1' }), tpl({ id: 'd', active: false })]
    expect(availableChecklists(ts, anna, 's1').map((t) => t.id)).toEqual(['a', 'c'])
  })
})

describe('dueChecklists', () => {
  it('due with deadline and not overdue before it', () => {
    const [d] = dueChecklists({ templates: [tpl({})], person: anna, siteId: 's1', tz: L, now, completions: [] })
    expect(d).toMatchObject({ site_id: 's1', deadline_utc: '2026-10-14T10:00:00.000Z', period_key: '2026-10-14', overdue: false })
  })
  it('done today → not due; done yesterday → due', () => {
    const today = [{ template_id: 't1', site_id: 's1', completed_at: '2026-10-14T06:00:00Z' }]
    const yesterday = [{ template_id: 't1', site_id: 's1', completed_at: '2026-10-13T20:00:00Z' }]
    expect(dueChecklists({ templates: [tpl({})], person: anna, siteId: 's1', tz: L, now, completions: today })).toEqual([])
    expect(dueChecklists({ templates: [tpl({})], person: anna, siteId: 's1', tz: L, now, completions: yesterday })).toHaveLength(1)
  })
  it('a completion at another site does not count', () => {
    const other = [{ template_id: 't1', site_id: 's2', completed_at: '2026-10-14T06:00:00Z' }]
    expect(dueChecklists({ templates: [tpl({})], person: anna, siteId: 's1', tz: L, now, completions: other })).toHaveLength(1)
  })
  it('multi-per-day needs min_per_day completions; 0 means optional', () => {
    const one = [{ template_id: 't1', site_id: 's1', completed_at: '2026-10-14T06:00:00Z' }]
    expect(dueChecklists({ templates: [tpl({ multi_per_day: true, min_per_day: 2 })], person: anna, siteId: 's1', tz: L, now, completions: one })).toHaveLength(1)
    expect(dueChecklists({ templates: [tpl({ multi_per_day: true, min_per_day: 0 })], person: anna, siteId: 's1', tz: L, now, completions: [] })).toEqual([])
  })
  it('multi-per-day counts today only, even if weekly', () => {
    const yest = [{ template_id: 't1', site_id: 's1', completed_at: '2026-10-13T10:00:00Z' }]
    expect(dueChecklists({ templates: [tpl({ frequency: 'weekly', multi_per_day: true, min_per_day: 1 })], person: anna, siteId: 's1', tz: L, now, completions: yest })).toHaveLength(1)
  })
  it('overdue after the deadline; no deadline → deadline_utc null', () => {
    const late = new Date('2026-10-14T10:30:00Z')
    expect(dueChecklists({ templates: [tpl({})], person: anna, siteId: 's1', tz: L, now: late, completions: [] })[0].overdue).toBe(true)
    expect(dueChecklists({ templates: [tpl({ deadline_time: null })], person: anna, siteId: 's1', tz: L, now, completions: [] })[0].deadline_utc).toBeNull()
  })
})
