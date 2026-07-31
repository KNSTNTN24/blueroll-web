import { EU_ALLERGENS, ALLERGEN_LABELS, type EUAllergen } from './constants'

/**
 * A dish is the menu item. It is either recipe-backed — allergens derived live
 * from the recipe's ingredients and fully traceable — or declared by hand and
 * attested by a named user.
 *
 * Effective allergens are resolved at read time and never denormalised onto the
 * dish for the recipe case, so editing a recipe updates every dish built from it.
 */
export type AllergenSource = 'recipe' | 'manual'

export interface DishRecipe {
  id: string
  name: string
  recipe_ingredients?: { ingredient: { name: string; allergens: string[] | null } | null }[] | null
}

export interface Dish {
  id: string
  name: string
  category: string | null
  active: boolean
  allergen_source: AllergenSource
  recipe_id: string | null
  declared_allergens: string[]
  may_contain: string[]
  dietary: string[]
  attested_by_name: string | null
  attested_at: string | null
  /** The sites this dish is on the menu of. Empty = on no site's menu. */
  site_ids: string[]
  /** Per-site menu category assignment: site_id -> menu_categories.id. */
  site_categories: Record<string, string>
  recipe?: DishRecipe | null
}

export const DISH_CATS = ['Starters', 'Mains', 'Sides', 'Desserts', 'Other'] as const

const CAT_MAP: Record<string, string> = {
  starter: 'Starters', starters: 'Starters',
  main: 'Mains', mains: 'Mains',
  side: 'Sides', sides: 'Sides',
  dessert: 'Desserts', desserts: 'Desserts',
}
/** Recipes and dishes have both singular and plural categories in the wild. */
export const catLabel = (c: string | null | undefined) => CAT_MAP[(c || '').toLowerCase()] ?? 'Other'
export const catSlug = (label: string) => (label === 'Other' ? 'other' : label.toLowerCase())

/** Union of the allergens carried by a recipe's ingredients. */
export function recipeAllergens(recipe: DishRecipe | null | undefined): string[] {
  const set = new Set<string>()
  recipe?.recipe_ingredients?.forEach((ri) => ri.ingredient?.allergens?.forEach((a) => set.add(a)))
  return EU_ALLERGENS.filter((a) => set.has(a))
}

/**
 * The dish's effective allergens. Recipe-backed dishes read through to the
 * live recipe; declared dishes return exactly what a human attested.
 */
export function resolveAllergens(dish: Dish): string[] {
  if (dish.allergen_source === 'recipe') return recipeAllergens(dish.recipe)
  return EU_ALLERGENS.filter((a) => dish.declared_allergens.includes(a))
}

export const allergenLabel = (a: string) => ALLERGEN_LABELS[a as EUAllergen] ?? a

const DISH_FOR_RECIPE_SELECT = 'id, name, category, active, allergen_source, recipe_id, declared_allergens, may_contain, dietary, attested_by_name, attested_at, site_ids, recipe:recipes(id, name, recipe_ingredients(ingredient:ingredients(name, allergens)))'

type Db = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Dishes that would lose their allergen evidence if this recipe went away. */
export async function dishesForRecipe(db: Db, recipeId: string): Promise<Dish[]> {
  const { data } = await db.from('menu_items').select(DISH_FOR_RECIPE_SELECT).eq('recipe_id', recipeId).eq('allergen_source', 'recipe')
  return (data ?? []) as Dish[]
}

/**
 * Detach dishes from a recipe about to be deleted, keeping them on the menu.
 *
 * The recipe's current allergens are snapshotted into declared_allergens and
 * the person doing this attests to them — the dish stops being traceable, so
 * someone has to own the declaration. Without this the FK (RESTRICT) blocks
 * the delete, which is the correct default.
 */
export async function convertDishesToManual(db: Db, dishes: Dish[], attesterId: string | null, attesterName: string): Promise<void> {
  for (const d of dishes) {
    const { error } = await db.from('menu_items').update({
      allergen_source: 'manual',
      declared_allergens: resolveAllergens(d),
      recipe_id: null,
      attested_by: attesterId,
      attested_by_name: attesterName,
      attested_at: new Date().toISOString(),
    }).eq('id', d.id)
    if (error) throw error
  }
}

/** Sub-text under the dish name: where its allergen evidence comes from. */
export function sourceMeta(dish: Dish): string {
  if (dish.allergen_source === 'recipe') return `Linked to recipe · ${dish.recipe?.name ?? 'unknown'}`
  const when = dish.attested_at
    ? new Date(dish.attested_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : '—'
  return `Declared by ${dish.attested_by_name ?? 'unknown'} · ${when}`
}
