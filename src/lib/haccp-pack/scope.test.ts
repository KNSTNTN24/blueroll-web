import { describe, it, expect } from 'vitest'
import { packFields, menuHasAllergens } from './scope'
import { HACCP_METHODS } from './methods'
import type { Dish } from '@/lib/dishes'

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
    for (const scope of [{ menuHasAllergens: true }, { menuHasAllergens: false }]) {
      expect(packFields(fa, scope).map((f) => f.id)).not.toContain('fa_allergens_list')
    }
  })
  it('asks for an allergen matrix file only when the menu has no allergens', () => {
    expect(packFields(fa, { menuHasAllergens: false }).map((f) => f.id)).toContain('fa_matrix_file')
    expect(packFields(fa, { menuHasAllergens: true }).map((f) => f.id)).not.toContain('fa_matrix_file')
  })
  it('leaves other methods untouched', () => {
    const ch = HACCP_METHODS.find((m) => m.id === 'chilled_storage')!
    expect(packFields(ch, { menuHasAllergens: true })).toEqual(ch.fields)
  })
})
