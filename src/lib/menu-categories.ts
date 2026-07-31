import type { Dish } from './dishes'

/** A per-site menu section (e.g. "Small plates") that dishes can be assigned into. */
export interface MenuCategory {
  id: string
  site_id: string
  name: string
  sort_order: number
}

/** The menu category id this dish is assigned to on a given site, if any. */
export function dishCategoryId(dish: Dish, siteId: string | null): string | null {
  return siteId ? (dish.site_categories?.[siteId] ?? null) : null
}

/** The section name a dish should render under for a given site. */
export function dishSectionName(dish: Dish, siteId: string | null, cats: MenuCategory[]): string {
  const catId = dishCategoryId(dish, siteId)
  return cats.find((c) => c.id === catId)?.name ?? 'Uncategorised'
}

/**
 * Group rows into per-site menu sections, ordered by category sort_order with
 * any uncategorised/unknown-category rows trailing in an "Uncategorised"
 * section. Empty sections are dropped.
 */
export function groupDishesBySection<T>(
  rows: T[],
  siteId: string | null,
  cats: MenuCategory[],
  getDish: (r: T) => Dish
): { name: string; rows: T[] }[] {
  const sorted = [...cats].sort((a, b) => a.sort_order - b.sort_order)
  const byCat = new Map<string, T[]>()
  const uncategorised: T[] = []

  for (const row of rows) {
    const catId = dishCategoryId(getDish(row), siteId)
    const cat = catId ? sorted.find((c) => c.id === catId) : undefined
    if (cat) {
      const bucket = byCat.get(cat.id) ?? []
      bucket.push(row)
      byCat.set(cat.id, bucket)
    } else {
      uncategorised.push(row)
    }
  }

  const sections = sorted
    .map((c) => ({ name: c.name, rows: byCat.get(c.id) ?? [] }))
    .filter((s) => s.rows.length > 0)

  if (uncategorised.length > 0) sections.push({ name: 'Uncategorised', rows: uncategorised })

  return sections
}
