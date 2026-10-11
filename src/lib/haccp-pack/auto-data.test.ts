import { describe, it, expect } from 'vitest'
import { computeAutoData, AUTO_SOURCE_LABEL, type AutoDataSources } from './auto-data'

const empty: AutoDataSources = { recipes: [], dishes: [], suppliers: [], templates: [], documents: [], team: [] }
const recipe = (over: Partial<AutoDataSources['recipes'][number]>) => ({
  id: 'r', name: 'Dish', cooking_method: null, cooking_temp: null, extra_care_flags: null, reheating_instructions: null,
  hot_holding_required: null, chilling_method: null, freezing_instructions: null, defrosting_instructions: null,
  haccp_methods: [], recipe_ingredients: [], ...over,
})

describe('computeAutoData', () => {
  it('returns nothing for an empty business', () => {
    expect(computeAutoData(empty)).toEqual({})
  })
  it('lists cooking dishes with method and temperature', () => {
    const out = computeAutoData({ ...empty, recipes: [recipe({ name: 'Roast chicken', cooking_method: 'Oven', cooking_temp: 80, haccp_methods: ['cooking_safely'] })] })
    expect(out.ck_dishes).toBe('Roast chicken: Oven @ 80°C')
    expect(out.mc_items).toBe('Roast chicken — Oven @ 80°C')
  })
  it('detects raw products by keyword and seafood allergen', () => {
    const out = computeAutoData({ ...empty, recipes: [recipe({ recipe_ingredients: [
      { ingredient: { name: 'Chicken thigh', allergens: [] } },
      { ingredient: { name: 'Nori', allergens: ['fish'] } },
      { ingredient: { name: 'Rice', allergens: [] } },
    ] })] })
    expect(out.sf_raw_products).toBe('Chicken thigh, Nori')
  })
  it('reads document titles (column is title, not name)', () => {
    const out = computeAutoData({ ...empty, documents: [
      { id: 'd1', title: 'Rentokil contract 2026', category: 'contract' },
      { id: 'd2', title: 'Level 2 — Priya', category: 'certificate' },
    ] })
    expect(out.pc_company).toBe('Rentokil contract 2026')
    expect(out.tr_records).toBe('Level 2 — Priya')
  })
  it('names owners and managers as responsible', () => {
    const out = computeAutoData({ ...empty, team: [{ full_name: 'Emma Marsh', role: 'owner' }, { full_name: 'Sam', role: 'staff' }] })
    expect(out.tr_responsible).toBe('Emma Marsh (owner)')
  })
  it('picks the temperature checklist for st_method', () => {
    const out = computeAutoData({ ...empty, templates: [{ id: 't', name: 'Fridge & Freezer Temperatures', frequency: 'daily', sfbb_section: 'temperature' }] })
    expect(out.st_method).toBe('Using checklist: Fridge & Freezer Temperatures (daily)')
  })
  it('has a source label for every auto field it can produce', () => {
    for (const k of ['ck_dishes', 'sf_raw_products', 'fa_allergens_list', 'sup_list', 'pc_company', 'tr_records', 'tr_responsible', 'st_method', 'tp_method']) {
      expect(AUTO_SOURCE_LABEL[k]).toBeTruthy()
    }
  })
})
