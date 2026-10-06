// src/lib/haccp-setup/__tests__/draft-checklists.test.ts
import { describe, it, expect } from 'vitest'
import { buildChecklistDraft } from '../draft-checklists'
import { CHECKLIST_LIBRARY, SIMILAR_DEFAULTS } from '../content/checklists'
import type { Ctx } from '../types'

const restaurant: Ctx = {
  scotland: false,
  answers: {
    venue_type: 'restaurant',
    processes: ['cook_hot', 'cool_cooked', 'reheat', 'hot_hold', 'defrost', 'rte_prep', 'deliveries_in'],
    equipment: [
      { kind: 'fridge', label: 'Walk-in' }, { kind: 'fridge', label: 'Prep' }, { kind: 'freezer', label: 'Chest' },
      { kind: 'probe', label: 'Probe' }, { kind: 'dishwasher', label: 'Dishwasher' }, { kind: 'blast_chiller', label: 'Blast' },
    ],
    pest_control: 'in_house',
  },
}

describe('buildChecklistDraft', () => {
  it('fridge log has one temperature line per fridge/freezer, FSA ranges, then a storage check', () => {
    const fridge = buildChecklistDraft(restaurant, []).checklists.find((c) => c.key === 'fridge_temps')!
    expect(fridge.sfbb_section).toBe('temperature')
    expect(fridge.items.slice(0, 3)).toEqual([
      { name: 'Walk-in temperature', item_type: 'temperature', required: true, min_value: 0, max_value: 5, unit: '°C' },
      { name: 'Prep temperature', item_type: 'temperature', required: true, min_value: 0, max_value: 5, unit: '°C' },
      { name: 'Chest temperature', item_type: 'temperature', required: true, min_value: -30, max_value: -18, unit: '°C' },
    ])
    expect(fridge.items).toHaveLength(4)
  })
  it('reheating uses 82 °C in Scotland', () => {
    const eng = buildChecklistDraft(restaurant, []).checklists.find((c) => c.key === 'reheating')!
    const sco = buildChecklistDraft({ ...restaurant, scotland: true }, []).checklists.find((c) => c.key === 'reheating')!
    expect(eng.items[0].min_value).toBe(75)
    expect(sco.items[0].min_value).toBe(82)
  })
  it('existing library templates are not recreated; only missing items are offered', () => {
    const existing = [{ id: 't1', library_key: 'fridge_temps', name: 'Fridge & Freezer Temperatures',
      itemNames: ['Walk-in temperature', 'Chest temperature', 'Food stored correctly and covered'] }]
    const d = buildChecklistDraft(restaurant, existing)
    expect(d.checklists.map((c) => c.key)).not.toContain('fridge_temps')
    expect(d.existing).toEqual([{ key: 'fridge_temps', name: 'Fridge & Freezer Temperatures' }])
    expect(d.itemAdds).toEqual([{ templateId: 't1', key: 'fridge_temps', templateName: 'Fridge & Freezer Temperatures',
      item: { name: 'Prep temperature', item_type: 'temperature', required: true, min_value: 0, max_value: 5, unit: '°C' } }])
  })
  it('opening checks gain a delivery-bag line for delivery businesses', () => {
    const withOut = buildChecklistDraft({ ...restaurant, answers: { ...restaurant.answers, processes: ['delivery_out'] } }, [])
    expect(withOut.checklists.find((c) => c.key === 'opening_checks')!.items.map((i) => i.name))
      .toContain('Delivery bags clean and insulated')
  })
  it('a default (non-library) template with a similar name marks the library checklist, still listed', () => {
    const others = [{ id: 's1', name: 'Fridge & Freezer Temperatures' }, { id: 's2', name: 'daily opening checks ' }, { id: 's3', name: 'My own list' }]
    const d = buildChecklistDraft(restaurant, [], others)
    expect(d.checklists.find((c) => c.key === 'fridge_temps')!.similarTo).toBe('Fridge & Freezer Temperatures')
    expect(d.checklists.find((c) => c.key === 'opening_checks')!.similarTo).toBe('daily opening checks ')
    expect(d.checklists.find((c) => c.key === 'cooking_temps')!.similarTo).toBeUndefined()
    expect('similarTo' in d.checklists.find((c) => c.key === 'closing_checks')!).toBe(false)
  })
  it('SIMILAR_DEFAULTS only references real library keys', () => {
    const keys = new Set(CHECKLIST_LIBRARY.map((c) => c.key))
    for (const k of Object.keys(SIMILAR_DEFAULTS)) expect(keys.has(k)).toBe(true)
  })
  it('every library entry has non-empty roles and unique keys', () => {
    expect(new Set(CHECKLIST_LIBRARY.map((c) => c.key)).size).toBe(CHECKLIST_LIBRARY.length)
    for (const c of CHECKLIST_LIBRARY) expect(c.assigned_roles.length).toBeGreaterThan(0)
  })
})
