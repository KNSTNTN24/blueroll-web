import { describe, it, expect } from 'vitest'
import { renderDueMenu, MENU_ROWS_MAX } from '../../../../supabase/functions/_shared/channels/due-menu'

const NOW = new Date('2026-10-14T09:40:00Z')   // 10:40 London (BST)
const base = { siteId: 's1', siteName: 'Ashfield Row', tz: 'Europe/London', now: NOW }

describe('renderDueMenu', () => {
  it('header with progress, open lines by deadline with icons, done lines, one row per open checklist', () => {
    const m = renderDueMenu({ ...base,
      open: [
        { templateId: 'c', name: 'Chilling Down Hot Food', deadlineUtc: '2026-10-14T14:00:00Z' },
        { templateId: 'w', name: 'Weekly Deep Clean & Calibration', deadlineUtc: null },
        { templateId: 'f', name: 'Fridge & Freezer Temperatures', deadlineUtc: '2026-10-14T09:00:00Z' },
        { templateId: 'h', name: 'Hot Holding Checks', deadlineUtc: '2026-10-14T10:00:00Z' },
      ],
      done: [{ name: 'Daily Opening Checks', completedAt: '2026-10-14T07:47:00Z' }] })
    expect(m.header).toBe('📋 Ashfield Row — 1 of 5 done')
    expect(m.body).toBe([
      '🔴 Fridge & Freezer Temperatures — due 10:00',
      '🟠 Hot Holding Checks — due 11:00',
      '⚪ Chilling Down Hot Food — due 15:00',
      '⚪ Weekly Deep Clean & Calibration',
      '✅ Daily Opening Checks — 08:47',
    ].join('\n'))
    expect(m.button).toBe('Choose a check')
    expect(m.footer).toBe('Forms open on your phone')
    expect(m.rows).toEqual([
      { id: 'fill:f:s1', title: 'Fridge & Freezer Temper…', description: '🔴 Due 10:00 · overdue · Fridge & Freezer Temperatures' },
      { id: 'fill:h:s1', title: 'Hot Holding Checks', description: '🟠 Due 11:00 · due soon' },
      { id: 'fill:c:s1', title: 'Chilling Down Hot Food', description: '⚪ Due 15:00' },
      { id: 'fill:w:s1', title: 'Weekly Deep Clean & Cal…', description: '⚪ No deadline · Weekly Deep Clean & Calibration' },
    ])
  })
  it('respects WhatsApp limits: ≤10 rows (+N more in the body), title ≤24, description ≤72, header ≤60', () => {
    const open = Array.from({ length: 13 }, (_, i) => ({ templateId: `t${i}`, name: `Checklist ${String(i).padStart(2, '0')} ${'x'.repeat(80)}`, deadlineUtc: null }))
    const m = renderDueMenu({ ...base, siteName: 'S'.repeat(80), open, done: [] })
    expect(m.rows).toHaveLength(MENU_ROWS_MAX)
    expect(m.body.endsWith('+3 more — send CHECKS again after these')).toBe(true)
    for (const r of m.rows) { expect([...r.title].length).toBeLessThanOrEqual(24); expect([...r.description].length).toBeLessThanOrEqual(72) }
    expect([...m.header].length).toBeLessThanOrEqual(60)
  })
})

describe('renderDueMenu — team menu', () => {
  it('done lines carry the first name; rows use the given id builder', () => {
    const m = renderDueMenu({ ...base, siteName: 'Kitchen · Ashfield Row',
      open: [{ templateId: 'h', name: 'Hot Holding Checks', deadlineUtc: '2026-10-14T10:00:00Z' }],
      done: [{ name: 'Daily Opening Checks', completedAt: '2026-10-14T07:47:00Z', by: 'Anna' }, { name: 'Probe check', completedAt: '2026-10-14T08:00:00Z', by: null }],
      rowId: (id) => `tfill:g1:${id}` })
    expect(m.header).toBe('📋 Kitchen · Ashfield Row — 2 of 3 done')
    expect(m.body).toBe(['🟠 Hot Holding Checks — due 11:00', '✅ Daily Opening Checks — 08:47 Anna', '✅ Probe check — 09:00'].join('\n'))
    expect(m.rows).toEqual([{ id: 'tfill:g1:h', title: 'Hot Holding Checks', description: '🟠 Due 11:00 · due soon' }])
  })
})
