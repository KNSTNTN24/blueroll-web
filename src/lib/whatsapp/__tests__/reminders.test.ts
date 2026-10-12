import { describe, it, expect } from 'vitest'
import { planCorrective, planGroupReminders } from '../../../../supabase/functions/_shared/checklists-core/reminders'
import type { Template } from '../../../../supabase/functions/_shared/checklists-core/types'

const tpl = (id: string, deadline: string | null): Template => ({
  id, business_id: 'b', site_id: null, name: id, frequency: 'daily', deadline_time: deadline,
  multi_per_day: false, min_per_day: null, assigned_roles: [], assigned_role_ids: ['r'], active: true,
})
const at = (iso: string) => new Date(iso)

describe('planCorrective', () => {
  const n = [{ response_id: 'r1', completed_by: 'p1', business_id: 'b', site_id: 's1', created_at: '2026-10-14T09:00:00Z' }]
  it('nudge at 30 min, alert at 60 min, each once', () => {
    expect(planCorrective({ now: at('2026-10-14T09:29:00Z'), needed: n, nudged: new Set(), alerted: new Set() })).toEqual([])
    expect(planCorrective({ now: at('2026-10-14T09:30:00Z'), needed: n, nudged: new Set(), alerted: new Set() })).toEqual([{ response_id: 'r1', action: 'nudge' }])
    expect(planCorrective({ now: at('2026-10-14T10:00:00Z'), needed: n, nudged: new Set(['r1']), alerted: new Set() })).toEqual([{ response_id: 'r1', action: 'alert_no_action' }])
    expect(planCorrective({ now: at('2026-10-14T10:00:00Z'), needed: n, nudged: new Set(), alerted: new Set() })).toEqual([{ response_id: 'r1', action: 'alert_no_action' }])
    expect(planCorrective({ now: at('2026-10-14T10:30:00Z'), needed: n, nudged: new Set(['r1']), alerted: new Set(['r1']) })).toEqual([])
  })
})

describe('planGroupReminders', () => {
  const sites = [{ id: 's1', timezone: 'Europe/London' }, { id: 's2', timezone: 'Europe/London' }]
  it('inside [deadline−30, deadline) only, per site, ignoring assignment', () => {
    const t = [{ ...tpl('open', '10:00'), assigned_role_ids: ['nobody'] }]
    expect(planGroupReminders({ now: at('2026-10-14T08:29:00Z'), sites, templates: t, completions: [] })).toEqual([])
    const jobs = planGroupReminders({ now: at('2026-10-14T08:30:00Z'), sites, templates: t, completions: [] })
    expect(jobs.map((j) => [j.site_id, j.items.map((i) => [i.template.id, i.period_key])])).toEqual([
      ['s1', [['open', '2026-10-14']]], ['s2', [['open', '2026-10-14']]],
    ])
    expect(planGroupReminders({ now: at('2026-10-14T09:00:00Z'), sites, templates: t, completions: [] })).toEqual([])
  })
  it('skips completed checklists, no-deadline checklists and other sites', () => {
    const t = [tpl('done', '10:00'), tpl('nodl', null), { ...tpl('other', '10:00'), site_id: 's2' }]
    const jobs = planGroupReminders({ now: at('2026-10-14T08:40:00Z'), sites: [sites[0]], templates: t,
      completions: [{ template_id: 'done', site_id: 's1', completed_at: '2026-10-14T08:00:00Z' }] })
    expect(jobs).toEqual([])
  })
})
