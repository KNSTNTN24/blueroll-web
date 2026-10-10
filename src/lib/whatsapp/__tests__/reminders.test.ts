import { describe, it, expect } from 'vitest'
import { planReminders, planCorrective, reminderKey } from '../../../../supabase/functions/_shared/checklists-core/reminders'
import type { Template, Person } from '../../../../supabase/functions/_shared/checklists-core/types'

const tpl = (id: string, deadline: string | null): Template => ({
  id, business_id: 'b', site_id: null, name: id, frequency: 'daily', deadline_time: deadline,
  multi_per_day: false, min_per_day: null, assigned_roles: [], assigned_role_ids: ['r'], active: true,
})
const person: Person = { profile_id: 'p1', business_id: 'b', full_name: 'Anna', role: 'kitchen_staff', role_id: 'r' }
const rec = [{ person, external_id: '447700900123', site_id: 's1', tz: 'Europe/London' }]
const at = (iso: string) => new Date(iso)

describe('planReminders', () => {
  it('only inside [deadline−30, deadline)', () => {
    const t = [tpl('open', '10:00')] // 09:00Z in BST
    expect(planReminders({ now: at('2026-10-14T08:29:00Z'), recipients: rec, templates: t, completions: [], alreadySent: new Set() })).toEqual([])
    expect(planReminders({ now: at('2026-10-14T08:30:00Z'), recipients: rec, templates: t, completions: [], alreadySent: new Set() })).toHaveLength(1)
    expect(planReminders({ now: at('2026-10-14T09:00:00Z'), recipients: rec, templates: t, completions: [], alreadySent: new Set() })).toEqual([])
  })
  it('skips already-sent keys (overlapping cron runs)', () => {
    const sent = new Set([reminderKey('p1', 'open', 's1', '2026-10-14')])
    expect(planReminders({ now: at('2026-10-14T08:40:00Z'), recipients: rec, templates: [tpl('open', '10:00')], completions: [], alreadySent: sent })).toEqual([])
  })
  it('groups up to 3 per message, earliest first; no deadline → never', () => {
    const t = [tpl('d', '10:20'), tpl('a', '10:05'), tpl('b', '10:10'), tpl('c', '10:15'), tpl('x', null)]
    const [job] = planReminders({ now: at('2026-10-14T08:50:00Z'), recipients: rec, templates: t, completions: [], alreadySent: new Set() })
    expect(job.items.map((i) => i.template.id)).toEqual(['a', 'b', 'c'])
  })
  it('4 due items → two jobs (3 + 1), nothing dropped', () => {
    const t = [tpl('a', '10:05'), tpl('b', '10:10'), tpl('c', '10:15'), tpl('d', '10:20')]
    const jobs = planReminders({ now: at('2026-10-14T08:50:00Z'), recipients: rec, templates: t, completions: [], alreadySent: new Set() })
    expect(jobs.map((j) => j.items.map((i) => i.template.id))).toEqual([['a', 'b', 'c'], ['d']])
  })
  it('reminds at deadline−1 min', () => {
    expect(planReminders({ now: at('2026-10-14T08:59:00Z'), recipients: rec, templates: [tpl('open', '10:00')], completions: [], alreadySent: new Set() })).toHaveLength(1)
  })
  it('two sites → separate jobs with site-scoped keys', () => {
    const two = [...rec, { ...rec[0], site_id: 's2' }]
    const sent = new Set([reminderKey('p1', 'open', 's1', '2026-10-14')])
    const all = planReminders({ now: at('2026-10-14T08:40:00Z'), recipients: two, templates: [tpl('open', '10:00')], completions: [], alreadySent: new Set() })
    expect(all.map((j) => j.site_id)).toEqual(['s1', 's2'])
    const part = planReminders({ now: at('2026-10-14T08:40:00Z'), recipients: two, templates: [tpl('open', '10:00')], completions: [], alreadySent: sent })
    expect(part.map((j) => j.site_id)).toEqual(['s2'])
  })
  it('completed checklists are not reminded', () => {
    const done = [{ template_id: 'open', site_id: 's1', completed_at: '2026-10-14T07:00:00Z' }]
    expect(planReminders({ now: at('2026-10-14T08:40:00Z'), recipients: rec, templates: [tpl('open', '10:00')], completions: done, alreadySent: new Set() })).toEqual([])
  })
})

describe('planReminders flow filter', () => {
  it('skips (template, site) pairs without a published flow', () => {
    const two = [...rec, { ...rec[0], site_id: 's2' }]
    const t = [tpl('a', '10:00'), tpl('b', '10:05')]
    const jobs = planReminders({ now: at('2026-10-14T08:40:00Z'), recipients: two, templates: t, completions: [], alreadySent: new Set(),
      hasFlow: (tid, sid) => !(tid === 'b' && sid === 's1') && sid !== 's2' })
    expect(jobs.map((j) => [j.site_id, j.items.map((i) => i.template.id)])).toEqual([['s1', ['a']]])
  })
})

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
