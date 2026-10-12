import { resolveAllergens, type Dish } from '@/lib/dishes'
import type { HaccpField, HaccpMethod } from './methods'

// Which pack fields are actually asked for. Allergens live in the menu: the
// matrix built from it replaces the free-text list, and an uploaded matrix is
// only needed when the menu has no allergen information to build one from.

export interface PackScope { menuHasAllergens: boolean }

/** Retired from the pack UI and the plan; the key may still exist in stored data. */
const RETIRED_FIELDS = new Set(['fa_allergens_list'])

/** At least one active dish on this site (or on every site) declares or resolves an allergen. */
export function menuHasAllergens(dishes: Dish[], siteId: string | null): boolean {
  return dishes.some((d) =>
    d.active &&
    (!siteId || !Array.isArray(d.site_ids) || d.site_ids.length === 0 || d.site_ids.includes(siteId)) &&
    resolveAllergens(d).length > 0,
  )
}

export function packFields(method: HaccpMethod, scope: PackScope): HaccpField[] {
  return method.fields.filter((f) =>
    !RETIRED_FIELDS.has(f.id) && !(f.id === 'fa_matrix_file' && scope.menuHasAllergens),
  )
}
