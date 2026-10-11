// src/lib/whatsapp/__tests__/record.test.ts
// Shared checklists-core/record.ts: corrective notes (Telegram Mini App) vs the WhatsApp default.
import { describe, it, expect } from 'vitest'
import { recordCompletion } from '../../../../supabase/functions/_shared/checklists-core/record'
import type { Template, TemplateItem } from '../../../../supabase/functions/_shared/checklists-core/types'

const NOW = new Date('2026-10-14T09:40:00Z')
const T: Template = { id: 't1', business_id: 'b', site_id: null, name: 'Fridge temps', frequency: 'daily', deadline_time: '11:00',
  multi_per_day: false, min_per_day: null, assigned_roles: [], assigned_role_ids: ['r'], active: true }
const ITEMS: TemplateItem[] = [
  { id: 'i1', name: 'Walk-in fridge', item_type: 'temperature', required: true, min_value: 0, max_value: 5, unit: '°C', sort_order: 0 },
  { id: 'i2', name: 'Door seals OK', item_type: 'yes_no', required: true, min_value: null, max_value: null, unit: null, sort_order: 1 },
]

describe('recordCompletion corrective notes', () => {
  const person = { profile_id: 'p1', business_id: 'b', full_name: 'Anna', role: 'kitchen_staff', role_id: 'r' }
  const db = () => {
    const s: any = { responses: [], notifs: [] }
    return { s, db: {
      insertCompletion: async () => ({ id: 'c1' }),
      insertResponses: async (rows: any[]) => { s.responses.push(...rows); return rows.map((r, i) => ({ id: 'r' + i, item_id: r.item_id })) },
      managerIds: async () => ['m1'],
      insertNotifications: async (rows: any[]) => { s.notifs.push(...rows) },
    } }
  }
  const answers = [{ item_id: 'i1', value: '9', flagged: true }, { item_id: 'i2', value: 'yes', flagged: false }]
  it('default: flagged → needed, notes null (WhatsApp unchanged)', async () => {
    const { s, db: x } = db()
    const r = await recordCompletion(x, { person, siteId: 's1', template: T, items: ITEMS, answers, source: 'whatsapp', now: NOW })
    expect(s.responses.map((r: any) => [r.notes, r.corrective_status])).toEqual([[null, 'needed'], [null, null]])
    expect(r.flagged[0].notes).toBeNull()
  })
  it('with notes: flagged → done + notes; unflagged untouched; managers still notified in-app', async () => {
    const { s, db: x } = db()
    const r = await recordCompletion(x, { person, siteId: 's1', template: T, items: ITEMS, answers, source: 'telegram', now: NOW,
      correctiveNotes: { i1: 'Discarded food', i2: 'ignored' } })
    expect(s.responses.map((r: any) => [r.notes, r.corrective_status])).toEqual([['Discarded food', 'done'], [null, null]])
    expect(r.flagged[0].notes).toBe('Discarded food')
    expect(s.notifs).toHaveLength(1)
  })
  it('an empty or blank note does not mark the corrective done', async () => {
    const { s, db: x } = db()
    await recordCompletion(x, { person, siteId: 's1', template: T, items: ITEMS, answers, source: 'telegram', now: NOW, correctiveNotes: { i1: '  ' } })
    expect(s.responses[0]).toMatchObject({ notes: null, corrective_status: 'needed' })
  })
})
