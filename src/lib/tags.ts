// Recipe tags: per-business, M:N (replaces recipes.category — spec 2026-06-11).
// Grouping semantics (user-approved): a recipe with several tags is duplicated
// under each of its tag sections; untagged recipes form a final section.
export type TagRef = { id: string; name: string }

export const UNTAGGED = 'Untagged'

export function normalizeTag(name: string): string {
  return name.trim().toLowerCase()
}

export function getRecipeTags(recipe: any): TagRef[] {
  const tags: TagRef[] = (recipe.recipe_tags ?? [])
    .map((rt: any) => rt.tag)
    .filter(Boolean)
  return tags.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export function groupByTags<T extends { name: string }>(
  recipes: T[]
): { title: string; recipes: T[] }[] {
  const byTag = new Map<string, T[]>()
  const untagged: T[] = []
  for (const r of recipes) {
    const tags = getRecipeTags(r)
    if (tags.length === 0) {
      untagged.push(r)
      continue
    }
    for (const t of tags) {
      if (!byTag.has(t.name)) byTag.set(t.name, [])
      byTag.get(t.name)!.push(r)
    }
  }
  const groups = Array.from(byTag.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([title, list]) => ({
      title,
      recipes: list.sort((a, b) => a.name.localeCompare(b.name)),
    }))
  if (untagged.length > 0) {
    groups.push({ title: UNTAGGED, recipes: untagged.sort((a, b) => a.name.localeCompare(b.name)) })
  }
  return groups
}
