// src/lib/haccp-setup/__tests__/golden.test.ts
import { describe, it, expect } from 'vitest'
import { buildDraft } from '../draft'
import type { Answers, ExistingState } from '../types'

const none: ExistingState = { templates: [], pack: null, packUpdatedAt: null }
const keys = (answers: Answers, scotland = false) => buildDraft({ answers, scotland, existing: none }).checklists.map((c) => c.key)

const base: Answers = {
  hygiene_rules: true, illness_policy: true, uniform: 'staff_launder', changing: 'staff_room', allergen_matrix: true,
  allergen_ask: true, allergen_training: true, cloths: 'single_use', chemicals: 'separate_cupboard', glass_policy: true,
  pest_proofing: true, handwash_basin: true, sanitiser: true, clean_as_go: true, cleaning_schedule: true, labels: true,
  fifo: true, freeze_own: false, opening_closing: true, approved_suppliers: true, induction: true, diary: true,
}

export const PROFILES: Record<string, Answers> = {
  coffee_shop: { ...base, venue_type: 'coffee_shop', processes: ['rte_prep', 'deliveries_in'], separation: 'no_raw',
    delivery_checks: true, pest_control: 'contractor',
    equipment: [{ kind: 'fridge', label: 'Under-counter fridge' }, { kind: 'display_chiller', label: 'Cake display' }] },
  restaurant: { ...base, venue_type: 'restaurant',
    processes: ['cook_hot', 'cool_cooked', 'reheat', 'hot_hold', 'defrost', 'rte_prep', 'deliveries_in'],
    extra_care: ['eggs', 'rice'], separation: 'raw_below', colour_boards: true, delivery_checks: true,
    cooling_method: 'blast_chiller', defrost_method: ['fridge'], reheat_once: true, probe_calibration: true, new_dishes: true,
    pest_control: 'in_house',
    equipment: [{ kind: 'fridge', label: 'Walk-in' }, { kind: 'fridge', label: 'Prep' }, { kind: 'freezer', label: 'Chest' },
      { kind: 'probe', label: 'Probe' }, { kind: 'dishwasher', label: 'Dishwasher' }, { kind: 'blast_chiller', label: 'Blast' }] },
  takeaway: { ...base, venue_type: 'takeaway',
    processes: ['cook_hot', 'reheat', 'hot_hold', 'defrost', 'deliveries_in', 'delivery_out'], extra_care: ['rice'],
    separation: 'raw_below', colour_boards: true, delivery_checks: true, defrost_method: ['fridge', 'microwave'],
    reheat_once: true, probe_calibration: true, new_dishes: true, pest_control: 'contractor',
    equipment: [{ kind: 'fridge', label: 'Fridge' }, { kind: 'freezer', label: 'Freezer' }, { kind: 'probe', label: 'Probe' }] },
  bakery: { ...base, venue_type: 'bakery', processes: ['bake', 'rte_prep', 'deliveries_in', 'defrost'],
    extra_care: ['eggs'], separation: 'raw_below', colour_boards: true, delivery_checks: true, defrost_method: ['fridge'],
    pest_control: 'contractor',
    equipment: [{ kind: 'fridge', label: 'Cream fridge' }, { kind: 'freezer', label: 'Dough freezer' }, { kind: 'display_chiller', label: 'Display counter' }] },
}

describe('golden profiles — checklist sets', () => {
  it('coffee shop', () => expect(keys(PROFILES.coffee_shop)).toEqual(
    ['opening_checks', 'closing_checks', 'fridge_temps', 'delivery_check', 'weekly_deep_clean', 'allergen_check', 'pest_contractor_visit', 'haccp_review']))
  it('restaurant', () => expect(keys(PROFILES.restaurant)).toEqual(
    ['opening_checks', 'closing_checks', 'fridge_temps', 'delivery_check', 'cooking_temps', 'hot_holding', 'cooling', 'reheating',
      'defrosting', 'probe_calibration', 'dishwasher', 'weekly_deep_clean', 'allergen_check', 'pest_check_in_house', 'haccp_review']))
  it('takeaway', () => expect(keys(PROFILES.takeaway)).toEqual(
    ['opening_checks', 'closing_checks', 'fridge_temps', 'delivery_check', 'cooking_temps', 'hot_holding', 'reheating',
      'defrosting', 'probe_calibration', 'weekly_deep_clean', 'allergen_check', 'pest_contractor_visit', 'haccp_review']))
  it('bakery', () => expect(keys(PROFILES.bakery)).toEqual(
    ['opening_checks', 'closing_checks', 'fridge_temps', 'delivery_check', 'defrosting', 'weekly_deep_clean', 'allergen_check',
      'pest_contractor_visit', 'bakery_display', 'haccp_review']))
})

describe('golden profiles — pack fields', () => {
  for (const [name, answers] of Object.entries(PROFILES)) {
    it(`${name} pack draft is stable`, () => {
      const d = buildDraft({ answers, scotland: false, existing: none })
      expect(d.fields.map((f) => `${f.fieldId}=${String(f.value)}`)).toMatchSnapshot()
      expect(d.notes).toEqual([])
    })
  }
})

describe('answer changes and notes', () => {
  it('un-ticking cook_hot removes dependent checklists even if old answers remain', () => {
    const changed = { ...PROFILES.restaurant, processes: ['rte_prep', 'deliveries_in'] }
    const k = keys(changed)
    for (const gone of ['cooking_temps', 'hot_holding', 'cooling', 'reheating', 'defrosting']) expect(k).not.toContain(gone)
    expect(buildDraft({ answers: changed, scotland: false, existing: none }).fields.find((f) => f.fieldId === 'rh_once')).toBeUndefined()
  })
  it('hot food without a probe produces a note', () => {
    const noProbe = { ...PROFILES.takeaway, equipment: [{ kind: 'fridge', label: 'Fridge' }] } as Answers
    expect(buildDraft({ answers: noProbe, scotland: false, existing: none }).notes)
      .toContain('You cook or hold hot food but listed no probe thermometer. You need one to check temperatures.')
  })
})
