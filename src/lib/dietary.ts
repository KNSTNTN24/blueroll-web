// Dietary flags: computed from ingredient allergens, overridable per recipe
// (recipes.*_override: NULL = auto, true/false = explicit). Single source of
// truth for both the recipes list and detail pages.
export type DietaryOverrides = {
  vegan_override: boolean | null
  vegetarian_override: boolean | null
  gluten_free_override: boolean | null
  dairy_free_override: boolean | null
}

export const DIETARY_FLAGS = [
  { label: 'Vegan', column: 'vegan_override' },
  { label: 'Vegetarian', column: 'vegetarian_override' },
  { label: 'Gluten-Free', column: 'gluten_free_override' },
  { label: 'Dairy-Free', column: 'dairy_free_override' },
] as const

const RULES: Record<string, (a: string[]) => boolean> = {
  Vegan: (a) => !a.some((x) => ['milk', 'eggs', 'fish', 'crustaceans', 'molluscs'].includes(x)),
  Vegetarian: (a) => !a.some((x) => ['fish', 'crustaceans', 'molluscs'].includes(x)),
  'Gluten-Free': (a) => !a.includes('gluten'),
  'Dairy-Free': (a) => !a.includes('milk'),
}

export function computeDietary(allergens: string[]): string[] {
  return DIETARY_FLAGS.filter((f) => RULES[f.label](allergens)).map((f) => f.label)
}

export function effectiveDietary(
  overrides: Partial<DietaryOverrides> | null | undefined,
  allergens: string[],
): string[] {
  return DIETARY_FLAGS.filter((f) => {
    const o = overrides?.[f.column]
    return o ?? RULES[f.label](allergens)
  }).map((f) => f.label)
}
