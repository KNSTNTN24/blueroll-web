import { describe, it, expect } from 'vitest'
import { packFields, menuHasAllergens, scopeFrom, COVERED_FILE_REASON, type PackScope } from './scope'
import { HACCP_METHODS } from './methods'
import type { Dish } from '@/lib/dishes'

const NONE = { menuHasAllergens: false, hasCleaningChecklist: false, hasOpeningClosing: false, hasSuppliers: false }
const fa = HACCP_METHODS.find((m) => m.id === 'food_allergies')!
const dish = (o: Partial<Dish>): Dish => ({
  id: 'd', name: 'Dish', category: null, active: true, allergen_source: 'manual', recipe_id: null,
  declared_allergens: [], may_contain: [], dietary: [], attested_by_name: null, attested_at: null,
  site_ids: [], site_categories: {}, ...o,
})

describe('menuHasAllergens', () => {
  it('needs at least one active dish with an allergen on this site', () => {
    expect(menuHasAllergens([], 's1')).toBe(false)
    expect(menuHasAllergens([dish({ declared_allergens: [] })], 's1')).toBe(false)
    expect(menuHasAllergens([dish({ declared_allergens: ['milk'], active: false })], 's1')).toBe(false)
    expect(menuHasAllergens([dish({ declared_allergens: ['milk'], site_ids: ['s2'] })], 's1')).toBe(false)
    expect(menuHasAllergens([dish({ declared_allergens: ['milk'], site_ids: ['s1'] })], 's1')).toBe(true)
    expect(menuHasAllergens([dish({ declared_allergens: ['milk'], site_ids: [] })], 's1')).toBe(true)
    expect(menuHasAllergens([dish({ declared_allergens: ['milk'] })], null)).toBe(true)
  })
})

describe('packFields', () => {
  it('never asks for the allergen text list (the matrix replaces it)', () => {
    for (const scope of [{ ...NONE, menuHasAllergens: true }, NONE]) {
      expect(packFields(fa, scope).map((f) => f.id)).not.toContain('fa_allergens_list')
    }
  })
  it('asks for an allergen matrix file only when the menu has no allergens', () => {
    expect(packFields(fa, NONE).map((f) => f.id)).toContain('fa_matrix_file')
    expect(packFields(fa, { ...NONE, menuHasAllergens: true }).map((f) => f.id)).not.toContain('fa_matrix_file')
  })
  it('leaves other methods untouched', () => {
    const ch = HACCP_METHODS.find((m) => m.id === 'chilled_storage')!
    expect(packFields(ch, { ...NONE, menuHasAllergens: true })).toEqual(ch.fields)
  })
})

describe('scopeFrom', () => {
  const tpl = (o: Partial<{ name: string; sfbb_section: string | null; library_key: string | null; active: boolean; site_id: string | null }>) =>
    ({ name: 'X', sfbb_section: null, library_key: null, active: true, site_id: null, ...o })
  const base = { dishes: [], siteId: 's1', templates: [], suppliers: [] }

  it('counts only active cleaning checklists on this site or shared', () => {
    expect(scopeFrom({ ...base, templates: [tpl({ name: 'Weekly Deep Clean', active: false })] }).hasCleaningChecklist).toBe(false)
    expect(scopeFrom({ ...base, templates: [tpl({ name: 'Weekly Deep Clean', site_id: 's2' })] }).hasCleaningChecklist).toBe(false)
    expect(scopeFrom({ ...base, templates: [tpl({ name: 'Weekly Deep Clean', site_id: null })] }).hasCleaningChecklist).toBe(true)
    expect(scopeFrom({ ...base, templates: [tpl({ name: 'Dishwasher', library_key: 'dishwasher', site_id: 's1' })] }).hasCleaningChecklist).toBe(true)
    expect(scopeFrom({ ...base, templates: [tpl({ name: 'Bar', sfbb_section: 'cleaning' })] }).hasCleaningChecklist).toBe(true)
  })
  it('needs both opening and closing checks', () => {
    expect(scopeFrom({ ...base, templates: [tpl({ name: 'Daily Opening Checks' })] }).hasOpeningClosing).toBe(false)
    expect(scopeFrom({ ...base, templates: [tpl({ name: 'Daily Opening Checks' }), tpl({ name: 'End of Day Closing' })] }).hasOpeningClosing).toBe(true)
    expect(scopeFrom({ ...base, templates: [tpl({ library_key: 'opening_checks' }), tpl({ library_key: 'closing_checks' })] }).hasOpeningClosing).toBe(true)
  })
  it('knows about suppliers', () => {
    expect(scopeFrom({ ...base, suppliers: [{}] }).hasSuppliers).toBe(true)
    expect(scopeFrom(base).hasSuppliers).toBe(false)
  })
})

describe('covered documents', () => {
  const none: PackScope = { menuHasAllergens: false, hasCleaningChecklist: false, hasOpeningClosing: false, hasSuppliers: false }
  const ids = (methodId: string, scope: PackScope) => packFields(HACCP_METHODS.find((m) => m.id === methodId)!, scope).map((f) => f.id)

  it('asks for files Blueroll cannot build', () => {
    expect(ids('cleaning_schedule', none)).toContain('cs_file')
    expect(ids('opening_closing', none)).toContain('oc_file')
    expect(ids('suppliers', none)).toContain('sup_file')
  })
  it('drops files Blueroll already has, and the diary file always', () => {
    expect(ids('cleaning_schedule', { ...none, hasCleaningChecklist: true })).not.toContain('cs_file')
    expect(ids('opening_closing', { ...none, hasOpeningClosing: true })).not.toContain('oc_file')
    expect(ids('suppliers', { ...none, hasSuppliers: true })).not.toContain('sup_file')
    expect(ids('daily_diary', none)).not.toContain('dd_file')
  })
  it('explains why a file is not needed', () => {
    expect(COVERED_FILE_REASON.cs_file({ ...none, hasCleaningChecklist: true })).toBe('Built from your cleaning checklists.')
    expect(COVERED_FILE_REASON.cs_file(none)).toBeNull()
    expect(COVERED_FILE_REASON.dd_file(none)).toBe('Blueroll is your daily diary — every check is timed and signed.')
  })
})
