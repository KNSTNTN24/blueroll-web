// src/lib/whatsapp/__tests__/live-list.test.ts
import { describe, it, expect } from 'vitest'
import { renderLiveList, listIcon, refreshDecision, localDate, sitesForGroup, clip, type LiveListInput } from '../../../../supabase/functions/_shared/channels/live-list'
import { miniAppLink } from '../../../../supabase/functions/_shared/channels/telegram'
import { dueAtSite, dueChecklists } from '../../../../supabase/functions/_shared/checklists-core/due'
import type { Template } from '../../../../supabase/functions/_shared/checklists-core/types'

const NOW = new Date('2026-10-14T09:40:00Z')   // 10:40 Europe/London (BST)
const L = 'Europe/London'
const link = (t: string) => miniAppLink(t)

const INPUT: LiveListInput = {
  siteName: 'Wharf Side', tz: L, now: NOW,
  open: [
    { templateId: 'c', name: 'Cleaning Schedule', deadlineUtc: '2026-10-14T22:00:00.000Z', url: link('tc') },
    { templateId: 'w', name: 'Weekly Deep Clean', deadlineUtc: null, url: link('tw') },
    { templateId: 'h', name: 'Hot Holding Checks', deadlineUtc: '2026-10-14T10:00:00.000Z', url: link('th') },
    { templateId: 'p', name: 'Probe Calibration', deadlineUtc: null, url: null },
    { templateId: 'f', name: 'Fridge & Freezer Temperatures', deadlineUtc: '2026-10-14T09:00:00.000Z', url: link('tf') },
  ],
  done: [
    { templateId: 'd', name: 'Delivery Check', completedAt: '2026-10-14T08:05:00+00:00', by: 'Alex' },
    { templateId: 'o', name: 'Daily Opening Checks', completedAt: '2026-10-14T07:47:00+00:00', by: 'Anna' },
  ],
}

describe('renderLiveList', () => {
  it('renders the spec example: order, icons, clock times, app-only, done lines, counts, escaping', async () => {
    const r = await renderLiveList(INPUT)
    expect(r.text).toBe([
      '📋 <b>Wharf Side</b> — 2 of 7 done',
      '🔴 Fridge &amp; Freezer Temperatures · due 10:00',
      '🟠 Hot Holding Checks · due 11:00',
      '⚪ Cleaning Schedule · due 23:00',
      '⚪ Probe Calibration · app only',
      '⚪ Weekly Deep Clean',
      '✅ Daily Opening Checks · 08:47 Anna',
      '✅ Delivery Check · 09:05 Alex',
    ].join('\n'))
    expect(r.keyboard).toEqual([
      [{ text: '🔴 Fridge & Freezer Temperatures', url: link('tf') }],
      [{ text: '🟠 Hot Holding Checks', url: link('th') }],
      [{ text: '⚪ Cleaning Schedule', url: link('tc') }],
      [{ text: '⚪ Weekly Deep Clean', url: link('tw') }],
    ])
    expect(r.openCount).toBe(5)
    expect(r.doneCount).toBe(2)
  })
  it('escapes the site name and person names', async () => {
    const r = await renderLiveList({ ...INPUT, siteName: 'Fish & Chips <Bar>', open: [], done: [{ templateId: 'x', name: 'A<b>', completedAt: '2026-10-14T08:00:00Z', by: 'Jo & Co' }] })
    expect(r.text).toBe('📋 <b>Fish &amp; Chips &lt;Bar&gt;</b> — 1 of 1 done\n✅ A&lt;b&gt; · 09:00 Jo &amp; Co')
  })
  it('a done line without a known person has no name', async () => {
    const r = await renderLiveList({ ...INPUT, open: [], done: [{ templateId: 'x', name: 'Probe', completedAt: '2026-10-14T08:00:00Z', by: null }] })
    expect(r.text.split('\n')[1]).toBe('✅ Probe · 09:00')
  })
  it('button labels are clipped to 64 characters', async () => {
    const r = await renderLiveList({ ...INPUT, open: [{ templateId: 'l', name: 'X'.repeat(80), deadlineUtc: null, url: link('tl') }], done: [] })
    const label = r.keyboard[0][0].text
    expect([...label]).toHaveLength(64)
    expect(label.startsWith('⚪ X')).toBe(true)
    expect(label.endsWith('…')).toBe(true)
  })
  it('very long lists collapse the done lines to a count', async () => {
    const done = Array.from({ length: 120 }, (_, i) => ({ templateId: `d${i}`, name: `Done checklist number ${i} with a long name`, completedAt: '2026-10-14T08:00:00Z', by: 'Anna' }))
    const r = await renderLiveList({ ...INPUT, done })
    expect(r.text.length).toBeLessThanOrEqual(4000)
    expect(r.text.endsWith('✅ 120 done')).toBe(true)
  })
  it('hash is stable while nothing visible changes and changes with the state', async () => {
    const a = await renderLiveList(INPUT)
    const b = await renderLiveList({ ...INPUT, now: new Date('2026-10-14T09:41:00Z') })
    expect(b.hash).toBe(a.hash)
    expect(b.hash).toMatch(/^[0-9a-f]{64}$/)
    const c = await renderLiveList({ ...INPUT, now: new Date('2026-10-14T10:01:00Z') })   // Hot Holding turns 🔴
    expect(c.hash).not.toBe(a.hash)
    const d = await renderLiveList({ ...INPUT, open: INPUT.open.slice(1) })
    expect(d.hash).not.toBe(a.hash)
  })
})

describe('listIcon', () => {
  const dl = '2026-10-14T10:00:00.000Z'
  it('🔴 after the deadline, 🟠 within 30 min (inclusive), ⚪ otherwise', () => {
    expect(listIcon(dl, new Date('2026-10-14T10:00:00.001Z'))).toBe('🔴')
    expect(listIcon(dl, new Date('2026-10-14T10:00:00.000Z'))).toBe('🟠')
    expect(listIcon(dl, new Date('2026-10-14T09:30:00.000Z'))).toBe('🟠')
    expect(listIcon(dl, new Date('2026-10-14T09:29:00.000Z'))).toBe('⚪')
    expect(listIcon(null, NOW)).toBe('⚪')
  })
})

describe('refreshDecision', () => {
  const base = { listDate: '2026-10-14', today: '2026-10-14', openCount: 2, storedHash: 'h1', newHash: 'h1' }
  it('previous local day → delete, then nothing open → delete, same hash → nothing, else edit', () => {
    expect(refreshDecision({ ...base, listDate: '2026-10-13', openCount: 0 })).toBe('delete_stale')
    expect(refreshDecision({ ...base, openCount: 0 })).toBe('delete_done')
    expect(refreshDecision(base)).toBe('unchanged')
    expect(refreshDecision({ ...base, newHash: 'h2' })).toBe('edit')
    expect(refreshDecision({ ...base, storedHash: null })).toBe('edit')
  })
})

describe('helpers', () => {
  it('localDate is the site-local calendar day', () => {
    expect(localDate(new Date('2026-10-14T23:30:00Z'), L)).toBe('2026-10-15')
    expect(localDate(new Date('2026-10-14T22:30:00Z'), L)).toBe('2026-10-14')
  })
  it('clip keeps short strings', () => expect(clip('abc', 64)).toBe('abc'))
  it('sitesForGroup: sites where at least one active mapped checklist applies', () => {
    const sites = [{ id: 's1' }, { id: 's2' }, { id: 's3' }]
    expect(sitesForGroup([{ site_id: 's2', active: true }], sites)).toEqual([{ id: 's2' }])
    expect(sitesForGroup([{ site_id: null, active: true }], sites)).toEqual(sites)
    expect(sitesForGroup([{ site_id: null, active: false }], sites)).toEqual([])
    expect(sitesForGroup([], sites)).toEqual([])
  })
})

const tpl = (o: Partial<Template>): Template => ({
  id: 't1', business_id: 'b', site_id: null, name: 'Fridge temps', frequency: 'daily', deadline_time: '11:00',
  multi_per_day: false, min_per_day: null, assigned_roles: ['chef'], assigned_role_ids: ['r-chef'], active: true, ...o,
})

describe('dueAtSite', () => {
  it('ignores assignment; respects site, active and completions', () => {
    const due = dueAtSite({ templates: [tpl({}), tpl({ id: 't2', site_id: 's2' }), tpl({ id: 't3', active: false })], siteId: 's1', tz: L, now: NOW, completions: [] })
    expect(due.map((d) => d.template.id)).toEqual(['t1'])
    expect(due[0]).toMatchObject({ site_id: 's1', deadline_utc: '2026-10-14T10:00:00.000Z', period_key: '2026-10-14', overdue: false })
    expect(dueAtSite({ templates: [tpl({})], siteId: 's1', tz: L, now: NOW, completions: [{ template_id: 't1', site_id: 's1', completed_at: '2026-10-14T08:00:00Z' }] })).toEqual([])
  })
  it('multi-per-day stays due until min_per_day completions', () => {
    const t = tpl({ multi_per_day: true, min_per_day: 3 })
    const one = [{ template_id: 't1', site_id: 's1', completed_at: '2026-10-14T08:00:00Z' }]
    expect(dueAtSite({ templates: [t], siteId: 's1', tz: L, now: NOW, completions: one })).toHaveLength(1)
  })
  it('dueChecklists still filters by assignment', () => {
    const anna = { profile_id: 'p1', business_id: 'b', full_name: 'Anna', role: 'kitchen_staff', role_id: 'r-ks' }
    expect(dueChecklists({ templates: [tpl({})], person: anna, siteId: 's1', tz: L, now: NOW, completions: [] })).toEqual([])
  })
})
