import { resolveAllergens, type Dish } from '@/lib/dishes'
import type { HaccpField, HaccpMethod } from './methods'

// Which pack fields are actually asked for. The pack doesn't ask for what
// Blueroll already holds: allergens come from the menu (the matrix replaces the
// free-text list), and a document is only needed when Blueroll can't build it —
// cleaning schedule from cleaning checklists, opening/closing from those checks,
// supplier list from Suppliers, and the daily diary is Blueroll itself.

export interface PackScope {
  menuHasAllergens: boolean
  hasCleaningChecklist: boolean
  hasOpeningClosing: boolean
  hasSuppliers: boolean
}

export interface ScopeTemplate {
  name: string
  sfbb_section: string | null
  library_key?: string | null
  active?: boolean | null
  site_id?: string | null
}

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

export function scopeFrom(input: {
  dishes: Dish[]
  siteId: string | null
  templates: ScopeTemplate[]
  suppliers: unknown[]
}): PackScope {
  const live = input.templates.filter((t) =>
    t.active !== false && (!t.site_id || !input.siteId || t.site_id === input.siteId),
  )
  const isCleaning = (t: ScopeTemplate) =>
    t.sfbb_section === 'cleaning' || t.library_key === 'dishwasher' || t.library_key === 'weekly_deep_clean' || /clean/i.test(t.name)
  const opening = live.some((t) => t.library_key === 'opening_checks' || /opening/i.test(t.name))
  const closing = live.some((t) => t.library_key === 'closing_checks' || /closing/i.test(t.name))
  return {
    menuHasAllergens: menuHasAllergens(input.dishes, input.siteId),
    hasCleaningChecklist: live.some(isCleaning),
    hasOpeningClosing: opening && closing,
    hasSuppliers: input.suppliers.length > 0,
  }
}

/** Why a document field is not needed in this scope; null when it is needed. */
export const COVERED_FILE_REASON: Record<string, (s: PackScope) => string | null> = {
  fa_matrix_file: (s) => (s.menuHasAllergens ? 'Your allergen matrix is built from the menu.' : null),
  cs_file: (s) => (s.hasCleaningChecklist ? 'Built from your cleaning checklists.' : null),
  oc_file: (s) => (s.hasOpeningClosing ? 'Your daily opening and closing checks in Blueroll are the record.' : null),
  sup_file: (s) => (s.hasSuppliers ? 'Your suppliers are listed in Blueroll.' : null),
  dd_file: () => 'Blueroll is your daily diary — every check is timed and signed.',
}

export function packFields(method: HaccpMethod, scope: PackScope): HaccpField[] {
  return method.fields.filter((f) => !RETIRED_FIELDS.has(f.id) && !COVERED_FILE_REASON[f.id]?.(scope))
}
