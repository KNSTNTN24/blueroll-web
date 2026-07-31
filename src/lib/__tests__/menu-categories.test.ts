import { describe, it, expect } from 'vitest'
import { dishCategoryId, dishSectionName, groupDishesBySection, type MenuCategory } from '../menu-categories'
import type { Dish } from '../dishes'

const cats: MenuCategory[] = [
  { id: 'c1', site_id: 's1', name: 'Small plates', sort_order: 0 },
  { id: 'c2', site_id: 's1', name: 'Big plates', sort_order: 1 },
]
const dish = (id: string, catId?: string): Dish => ({
  id, name: id, category: null, active: true, allergen_source: 'manual', recipe_id: null,
  declared_allergens: [], may_contain: [], dietary: [], attested_by_name: null, attested_at: null,
  site_ids: ['s1'], site_categories: catId ? { s1: catId } : {},
} as Dish)

describe('menu-categories', () => {
  it('dishCategoryId reads the per-site map', () => {
    expect(dishCategoryId(dish('d', 'c2'), 's1')).toBe('c2')
    expect(dishCategoryId(dish('d'), 's1')).toBeNull()
    expect(dishCategoryId(dish('d', 'c2'), null)).toBeNull()
  })
  it('dishSectionName resolves to the category name or Uncategorised', () => {
    expect(dishSectionName(dish('d', 'c1'), 's1', cats)).toBe('Small plates')
    expect(dishSectionName(dish('d'), 's1', cats)).toBe('Uncategorised')
  })
  it('groupDishesBySection orders by sort_order + trailing Uncategorised', () => {
    const rows = [dish('a', 'c2'), dish('b', 'c1'), dish('c')].map((d) => ({ dish: d }))
    const secs = groupDishesBySection(rows, 's1', cats, (r) => r.dish)
    expect(secs.map((s) => s.name)).toEqual(['Small plates', 'Big plates', 'Uncategorised'])
  })
})
