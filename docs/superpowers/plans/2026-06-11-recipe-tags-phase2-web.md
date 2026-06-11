# Recipe Tags Phase 2 (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web switches from `recipes.category` to tags on top of the Phase-1 DB groundwork: tag editing in recipe forms, tag filter + group-by-tags on Menu, flat allergen matrix, tags in AI import, `RECIPE_CATEGORIES` deleted.

**Architecture:** Pure logic (tag grouping, name normalisation, diffing) in `src/lib/tags.ts`, TDD'd with vitest (same infra as v-next phase 2). A shared `TagInput` chip component used by new/edit/import. UI wiring verified by `npm run build` + live checks (accepted TDD exception for view code — no component test infra). DB already has: `tags`, `recipe_tags`, `attach_tag`, RPC `tags[]` support, backfilled data. Spec: `docs/superpowers/specs/2026-06-11-recipe-tags-design.md`.

**Tech Stack:** Next.js (App Router) + TanStack Query + Supabase JS; vitest.

**Conventions:**
- Repo `~/HACCP/web`, branch `KNS/recipe-tags` (created in Phase 1). Commit ONLY files named in each task.
- TDD for `src/lib/**`: write test → `npm test -- <file>` RED → implement → GREEN. UI tasks: `npm run build` must pass.
- Every recipes query that displays tags adds the same join fragment: `recipe_tags ( tag:tags (id, name) )`.
- Tag chips reuse the existing pill idiom (emerald variant like dietary chips, but neutral): `inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground border border-border`.
- Ship: branch builds clean; production deploy via normal PR → squash merge → `vercel --prod` (NOT part of this plan).

---

### Task 1: tags lib (pure logic)

**Files:**
- Create: `src/lib/tags.test.ts`
- Create: `src/lib/tags.ts`

- [ ] **Step 1: Write the failing test** (`src/lib/tags.test.ts`):

```ts
import { describe, expect, test } from 'vitest'
import { normalizeTag, getRecipeTags, groupByTags, UNTAGGED } from './tags'

describe('normalizeTag', () => {
  test('lowercases and trims', () => {
    expect(normalizeTag('  Pasta Dishes ')).toBe('pasta dishes')
  })
})

describe('getRecipeTags', () => {
  test('extracts sorted tag refs from the supabase join shape', () => {
    const recipe = {
      recipe_tags: [
        { tag: { id: 't2', name: 'Pasta' } },
        { tag: { id: 't1', name: 'hits' } },
        { tag: null }, // defensive: dangling join row
      ],
    }
    expect(getRecipeTags(recipe)).toEqual([
      { id: 't1', name: 'hits' },
      { id: 't2', name: 'Pasta' },
    ])
  })
  test('missing join key -> empty list', () => {
    expect(getRecipeTags({})).toEqual([])
  })
})

describe('groupByTags (duplicate under each tag, Untagged last)', () => {
  const carbonara = { id: 'r1', name: 'Carbonara', recipe_tags: [{ tag: { id: 't1', name: 'Pasta' } }, { tag: { id: 't2', name: 'hits' } }] }
  const tiramisu = { id: 'r2', name: 'Tiramisu', recipe_tags: [{ tag: { id: 't3', name: 'Desserts' } }] }
  const water = { id: 'r3', name: 'Water', recipe_tags: [] }

  test('multi-tag recipe appears in every one of its sections', () => {
    const groups = groupByTags([carbonara, tiramisu, water])
    expect(groups.map((g) => g.title)).toEqual(['Desserts', 'hits', 'Pasta', UNTAGGED])
    expect(groups.find((g) => g.title === 'Pasta')!.recipes.map((r: any) => r.id)).toEqual(['r1'])
    expect(groups.find((g) => g.title === 'hits')!.recipes.map((r: any) => r.id)).toEqual(['r1'])
    expect(groups.find((g) => g.title === UNTAGGED)!.recipes.map((r: any) => r.id)).toEqual(['r3'])
  })
  test('sections sorted case-insensitively, recipes by name', () => {
    const groups = groupByTags([tiramisu, carbonara])
    expect(groups.map((g) => g.title)).toEqual(['Desserts', 'hits', 'Pasta'])
  })
  test('no untagged recipes -> no Untagged section', () => {
    expect(groupByTags([tiramisu]).map((g) => g.title)).toEqual(['Desserts'])
  })
})
```

- [ ] **Step 2:** `npm test -- src/lib/tags.test.ts` → RED (`./tags` not found).
- [ ] **Step 3:** Create `src/lib/tags.ts`:

```ts
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
```

- [ ] **Step 4:** `npm test -- src/lib/tags.test.ts` → GREEN.
- [ ] **Step 5:** Commit:

```bash
git add src/lib/tags.test.ts src/lib/tags.ts
git commit -m "feat(web): tags lib — join parsing, normalisation, group-by-tags"
```
(Append `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` to every commit in this plan.)

---

### Task 2: TagInput component

**Files:**
- Create: `src/components/tag-input.tsx`

Chip editor with autocomplete against the business's existing tags. Value is plain `string[]` (names) — attachment to a recipe happens in the page save handlers.

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { Input } from '@/components/ui/input'
import { normalizeTag } from '@/lib/tags'

// Inline tag creation/selection (spec approach A — no tag management screen).
// Autocomplete + normalisation are the duplicate guard: "pasta" matches "Pasta".
export function TagInput({
  value,
  onChange,
}: {
  value: string[]
  onChange: (tags: string[]) => void
}) {
  const business = useAuthStore((s) => s.business)
  const [draft, setDraft] = useState('')

  const { data: existing = [] } = useQuery({
    queryKey: ['tags', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('tags')
        .select('id, name')
        .eq('business_id', business.id)
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const suggestions = useMemo(() => {
    const norm = normalizeTag(draft)
    const chosen = new Set(value.map(normalizeTag))
    return existing.filter(
      (t: any) =>
        !chosen.has(normalizeTag(t.name)) &&
        (!norm || normalizeTag(t.name).startsWith(norm))
    )
  }, [existing, value, draft])

  function add(name: string) {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 40) return
    const norm = normalizeTag(trimmed)
    if (value.some((v) => normalizeTag(v) === norm)) {
      setDraft('')
      return
    }
    // prefer the existing tag's canonical casing
    const match = existing.find((t: any) => normalizeTag(t.name) === norm)
    onChange([...value, match ? match.name : trimmed])
    setDraft('')
  }

  function remove(name: string) {
    onChange(value.filter((v) => v !== name))
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground border border-border"
          >
            {t}
            <button type="button" onClick={() => remove(t)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(draft)
            }
          }}
          placeholder={value.length === 0 ? 'Add tags (e.g. Pasta, Specials)...' : 'Add tag...'}
          className="h-8 w-44 text-[13px]"
        />
      </div>
      {suggestions.length > 0 && draft.trim() !== '' && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.slice(0, 8).map((t: any) => (
            <button
              key={t.id}
              type="button"
              onClick={() => add(t.name)}
              className="inline-flex items-center rounded-full bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground border border-border hover:border-emerald-300 hover:text-foreground transition-colors"
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2:** `npm run build` → passes (component compiles; not yet imported anywhere).
- [ ] **Step 3:** Commit:

```bash
git add src/components/tag-input.tsx
git commit -m "feat(web): TagInput chip editor with autocomplete"
```

---

### Task 3: recipes/new — TagInput instead of category select

**Files:**
- Modify: `src/app/(dashboard)/recipes/new/page.tsx`

- [ ] **Step 1: Replace imports** — drop `RECIPE_CATEGORIES, RECIPE_CATEGORY_LABELS` from the `@/lib/constants` import (keep `EU_ALLERGENS, ALLERGEN_LABELS`), add:

```ts
import { TagInput } from '@/components/tag-input'
```

- [ ] **Step 2: Replace state** — `const [category, setCategory] = useState('main')` (line 48) becomes:

```ts
const [tags, setTags] = useState<string[]>([])
```

- [ ] **Step 3: Replace the Category field** (lines 227–239) with:

```tsx
<Field label="Tags">
  <TagInput value={tags} onChange={setTags} />
</Field>
```

- [ ] **Step 4: Save handler** — in the recipe `.insert({...})` payload remove the `category,` line (the DB default applies). After the insert succeeds (after `if (recipeError) throw recipeError`, before the recipe_ingredients block), attach tags:

```ts
// Tags: attach_tag is normalised find-or-create on the DB side
for (const t of tags) {
  const { error: tagError } = await supabase.rpc('attach_tag', {
    p_recipe_id: recipe.id,
    p_name: t,
  })
  if (tagError) throw tagError
}
```

Also invalidate the tags cache next to the existing invalidations:

```ts
queryClient.invalidateQueries({ queryKey: ['tags'] })
queryClient.invalidateQueries({ queryKey: ['menu-recipes'] })
queryClient.invalidateQueries({ queryKey: ['allergen-recipes'] })
```

- [ ] **Step 5:** `npm run build` → passes. Live check: create a recipe with a new tag + an existing (backfilled) tag; verify both chips render on /recipes after Task 5.
- [ ] **Step 6:** Commit:

```bash
git add "src/app/(dashboard)/recipes/new/page.tsx"
git commit -m "feat(web): recipe create uses tags instead of category"
```

---

### Task 4: recipes/edit — load, diff, attach/detach

**Files:**
- Modify: `src/app/(dashboard)/recipes/edit/[id]/page.tsx`

- [ ] **Step 1: Imports** — drop `RECIPE_CATEGORIES, RECIPE_CATEGORY_LABELS`; add:

```ts
import { TagInput } from '@/components/tag-input'
import { getRecipeTags, normalizeTag, type TagRef } from '@/lib/tags'
```

- [ ] **Step 2: Query join** — in the recipe query select (lines 75–82) add the tags join:

```ts
.select(`
  *,
  recipe_ingredients (
    quantity,
    unit,
    ingredient:ingredients (id, name, allergens)
  ),
  recipe_tags ( tag:tags (id, name) )
`)
```

- [ ] **Step 3: State** — replace `const [category, setCategory] = useState('main')` (line 49) with:

```ts
const [tags, setTags] = useState<string[]>([])
const [originalTags, setOriginalTags] = useState<TagRef[]>([])
```

In the pre-fill effect replace `setCategory(recipe.category ?? 'main')` (line 95) with:

```ts
const loadedTags = getRecipeTags(recipe)
setTags(loadedTags.map((t) => t.name))
setOriginalTags(loadedTags)
```

- [ ] **Step 4: Form field** — replace the Category `<Field>` (lines 295–307) with:

```tsx
<Field label="Tags">
  <TagInput value={tags} onChange={setTags} />
</Field>
```

- [ ] **Step 5: Save handler** — remove `category,` from the `.update({...})` payload. After `if (recipeError) throw recipeError`, add the diff sync:

```ts
// Tags diff: detach removed (orphan tags self-delete in the DB),
// attach current (idempotent find-or-create on the DB side)
const currentNorms = new Set(tags.map(normalizeTag))
const removedIds = originalTags
  .filter((t) => !currentNorms.has(normalizeTag(t.name)))
  .map((t) => t.id)
if (removedIds.length > 0) {
  const { error: detachError } = await supabase
    .from('recipe_tags')
    .delete()
    .eq('recipe_id', id)
    .in('tag_id', removedIds)
  if (detachError) throw detachError
}
for (const t of tags) {
  const { error: tagError } = await supabase.rpc('attach_tag', {
    p_recipe_id: id,
    p_name: t,
  })
  if (tagError) throw tagError
}
```

Add to the invalidations: `queryClient.invalidateQueries({ queryKey: ['tags'] })`, `['menu-recipes']`, `['allergen-recipes']`.

- [ ] **Step 6:** `npm run build` → passes. Live check: open a backfilled recipe → its category-derived tag shows as a chip; remove it, add another, save, reopen — state persists; the removed tag disappears from autocomplete if it was its last recipe (orphan cleanup).
- [ ] **Step 7:** Commit:

```bash
git add "src/app/(dashboard)/recipes/edit/[id]/page.tsx"
git commit -m "feat(web): recipe edit manages tags (diff attach/detach)"
```

---

### Task 5: recipes list — tag filter + tag chips column

**Files:**
- Modify: `src/app/(dashboard)/recipes/page.tsx`

- [ ] **Step 1: Imports** — drop `RECIPE_CATEGORIES, RECIPE_CATEGORY_LABELS`; add:

```ts
import { useQuery } from '@tanstack/react-query' // already imported
import { getRecipeTags, normalizeTag } from '@/lib/tags'
```

- [ ] **Step 2: Query join** — add `recipe_tags ( tag:tags (id, name) )` to the select (lines 41–46), same shape as Task 4 Step 2.

- [ ] **Step 3: Filter state** — replace `const [category, setCategory] = useState('')` with:

```ts
const [tagFilter, setTagFilter] = useState<string[]>([])
```

Add a business-tags query for the filter row (same queryKey as TagInput so the cache is shared):

```ts
const { data: allTags = [] } = useQuery({
  queryKey: ['tags', business?.id],
  queryFn: async () => {
    if (!business?.id) return []
    const { data, error } = await supabase
      .from('tags').select('id, name').eq('business_id', business.id).order('name')
    if (error) throw error
    return data ?? []
  },
  enabled: !!business?.id,
})
```

- [ ] **Step 4: Filter logic** — replace the `matchCategory` line (line 58) with AND-semantics tag matching (spec derived decision 3):

```ts
const recipeNorms = getRecipeTags(r).map((t) => normalizeTag(t.name))
const matchTags = tagFilter.every((f) => recipeNorms.includes(normalizeTag(f)))
return matchSearch && matchTags
```

- [ ] **Step 5: Filter UI** — replace the category `<select>` (lines 117–128) with a toggle-chip row (hidden when the business has no tags):

```tsx
{allTags.length > 0 && (
  <div className="flex flex-wrap gap-1.5">
    {allTags.map((t: any) => {
      const selected = tagFilter.includes(t.name)
      return (
        <button
          key={t.id}
          type="button"
          onClick={() =>
            setTagFilter((prev) =>
              selected ? prev.filter((x) => x !== t.name) : [...prev, t.name]
            )
          }
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors ${
            selected
              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
              : 'bg-muted/50 text-muted-foreground border-border hover:border-emerald-200'
          }`}
        >
          {t.name}
        </button>
      )
    })}
  </div>
)}
```

Update the EmptyState condition: `search || category` → `search || tagFilter.length > 0` (both occurrences, lines 140 and 142).

- [ ] **Step 6: Table column** — header `Category` → `Tags`; replace the category cell (lines 170–173) with:

```tsx
<td className="px-4 py-3">
  <div className="flex flex-wrap gap-1">
    {getRecipeTags(recipe).length === 0 ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      getRecipeTags(recipe).map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground border border-border"
        >
          {t.name}
        </span>
      ))
    )}
  </div>
</td>
```

- [ ] **Step 7:** `npm run build` → passes. Live check: filter by two tags → only recipes carrying BOTH remain.
- [ ] **Step 8:** Commit:

```bash
git add "src/app/(dashboard)/recipes/page.tsx"
git commit -m "feat(web): recipes list — tag chips column + AND tag filter"
```

---

### Task 6: recipe detail — tag chips

**Files:**
- Modify: `src/app/(dashboard)/recipes/[id]/page.tsx`

- [ ] **Step 1: Imports** — drop `RECIPE_CATEGORY_LABELS`; add `import { getRecipeTags } from '@/lib/tags'`.
- [ ] **Step 2: Query join** — add `recipe_tags ( tag:tags (id, name) )` to the select (lines 40–47).
- [ ] **Step 3: Replace the Category InfoCard** (line 172) with a tags card matching the Allergens/Dietary card idiom — insert as a third card in the Allergens+Dietary grid (line 197: change `sm:grid-cols-2` to `sm:grid-cols-3`) and DELETE line 172:

```tsx
<div className="rounded-lg border border-border p-4">
  <h3 className="text-[13px] font-medium text-foreground mb-2">Tags</h3>
  <div className="flex flex-wrap gap-1.5">
    {getRecipeTags(recipe).length === 0 ? (
      <span className="text-[13px] text-muted-foreground">No tags</span>
    ) : (
      getRecipeTags(recipe).map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-foreground border border-border"
        >
          {t.name}
        </span>
      ))
    )}
  </div>
</div>
```

- [ ] **Step 4:** `npm run build` → passes.
- [ ] **Step 5:** Commit:

```bash
git add "src/app/(dashboard)/recipes/[id]/page.tsx"
git commit -m "feat(web): recipe detail shows tag chips"
```

---

### Task 7: menu — tag filter, group-by-tags toggle, PDF/CSV

**Files:**
- Modify: `src/app/(dashboard)/menu/page.tsx`

- [ ] **Step 1: Imports** — drop `RECIPE_CATEGORY_LABELS`; add:

```ts
import { getRecipeTags, groupByTags, normalizeTag, UNTAGGED } from '@/lib/tags'
```

- [ ] **Step 2: Query join** — add `recipe_tags ( tag:tags (id, name) )` to the select (lines 60–65).

- [ ] **Step 3: State + filter** — after `const [tab, setTab] = useState<TabId>('recipes')` add:

```ts
const [tagFilter, setTagFilter] = useState<string[]>([])
const [groupByTag, setGroupByTag] = useState(false)
```

After `const activeRecipes = recipes.filter((r: any) => r.active)` add:

```ts
function matchesFilter(r: any): boolean {
  const norms = getRecipeTags(r).map((t) => normalizeTag(t.name))
  return tagFilter.every((f) => norms.includes(normalizeTag(f)))
}
const visibleRecipes = recipes.filter(matchesFilter)
const visibleActive = activeRecipes.filter(matchesFilter)
const allTagNames = Array.from(
  new Set(recipes.flatMap((r: any) => getRecipeTags(r).map((t) => t.name)))
).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
```

- [ ] **Step 4: Controls UI** — below the Tabs row add the filter chips + group toggle (same chip pattern as Task 5 Step 5, iterating `allTagNames`; hidden when empty):

```tsx
{allTagNames.length > 0 && (
  <div className="flex flex-wrap items-center gap-1.5">
    {allTagNames.map((name) => {
      const selected = tagFilter.includes(name)
      return (
        <button
          key={name}
          type="button"
          onClick={() =>
            setTagFilter((prev) =>
              selected ? prev.filter((x) => x !== name) : [...prev, name]
            )
          }
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors ${
            selected
              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
              : 'bg-muted/50 text-muted-foreground border-border hover:border-emerald-200'
          }`}
        >
          {name}
        </button>
      )
    })}
    <label className="ml-2 flex items-center gap-1.5 text-[12px] text-muted-foreground cursor-pointer">
      <input
        type="checkbox"
        checked={groupByTag}
        onChange={(e) => setGroupByTag(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-border accent-emerald-600"
      />
      Group by tags
    </label>
  </div>
)}
```

- [ ] **Step 5: Recipes tab rendering** — switch the table body source from `recipes` to `visibleRecipes`. Table column `Category` → `Tags` with the same chips cell as Task 5 Step 6. When `groupByTag` is true, render one table per group instead of a single table (each preceded by a heading; duplicates per approved grouping):

```tsx
{groupByTag ? (
  <div className="space-y-6">
    {groupByTags(visibleRecipes).map((group) => (
      <div key={group.title}>
        <h2 className="mb-2 text-[14px] font-semibold text-foreground">
          {group.title} <span className="text-muted-foreground font-normal">({group.recipes.length})</span>
        </h2>
        {/* same <div className="overflow-hidden rounded-lg border border-border"><table>…</table></div> as the flat view, mapping group.recipes */}
      </div>
    ))}
  </div>
) : (
  /* existing single table over visibleRecipes */
)}
```

To keep this DRY, extract the existing `<table>…</table>` block into a local component inside the file:

```tsx
function RecipesTable({ list }: { list: any[] }) { /* the current thead+tbody, mapping `list` */ }
```

and call it from both branches. The Allergens matrix tab switches from `activeRecipes` to `visibleActive` (no grouping there — it mirrors /allergens and goes flat in Task 8).

- [ ] **Step 6: CSV** — header `Category` → `Tags`; the row cell `RECIPE_CATEGORY_LABELS[r.category] ?? r.category` becomes:

```ts
getRecipeTags(r).map((t) => t.name).join('; ')
```

and the export iterates `visibleActive` instead of `activeRecipes`.

- [ ] **Step 7: PDF** — `handlePrint` reworked: respects the filter and the grouping toggle.

```ts
function handlePrint() {
  const list = visibleActive
  const sections = groupByTag
    ? groupByTags(list)
    : [{ title: '', recipes: [...list].sort((a: any, b: any) => a.name.localeCompare(b.name)) }]
  // dietaryCounts over `list` (unchanged logic)
  // html header (unchanged) …
  for (const section of sections) {
    if (section.title) html += `<h2>${section.title} (${section.recipes.length})</h2>`
    html += `<table><tr><th>Dish</th><th>Tags</th><th>Allergens</th><th>Dietary</th></tr>`
    for (const r of section.recipes) {
      const tagNames = getRecipeTags(r).map((t) => t.name).join(', ')
      // allergen/dietary badges unchanged; row gains <td>${tagNames}</td> after the dish cell
    }
    html += `</table>`
  }
  // dietary summary + footer unchanged
}
```

Delete the `categoryOrder` array and the old `grouped` logic entirely.

- [ ] **Step 8:** `npm run build` → passes. Live check: toggle Group by tags → Carbonara-style multi-tag dish appears under each of its tags; Untagged section last; PDF mirrors the on-screen mode.
- [ ] **Step 9:** Commit:

```bash
git add "src/app/(dashboard)/menu/page.tsx"
git commit -m "feat(web): menu — tag filter, group-by-tags view and PDF/CSV"
```

---

### Task 8: allergens — flat matrix, category artefacts removed

**Files:**
- Modify: `src/app/(dashboard)/allergens/page.tsx`

Per spec: the matrix goes flat alphabetical; category sections/columns/sort vanish; tags are NOT added here.

- [ ] **Step 1: Imports** — drop `RECIPE_CATEGORY_LABELS` from the constants import.
- [ ] **Step 2: Sort** — narrow `type SortKey = 'name' | 'category' | 'allergen_count'` to `'name' | 'allergen_count'`; delete the `if (sortKey === 'category') …` line (76) and the `<option value="category">Sort by Category</option>` (line 186).
- [ ] **Step 3: Card view** — delete the `grouped` useMemo (lines 83–91); the card view (lines 270–309) loses the per-category wrapper: render the existing card grid once over `filtered` directly (delete the `Object.entries(grouped).map` wrapper and the `<h2>` heading, keep the inner grid div).
- [ ] **Step 4: Matrix view** — delete the Category `<th>` (lines 228–230) and the category `<td>` (lines 249–251).
- [ ] **Step 5: CSV** — header drops `'Category'`; rows drop the `RECIPE_CATEGORY_LABELS[r.category] ?? r.category` element.
- [ ] **Step 6: PDF** — delete the `categoryOrder`/`sortedCats` block (lines 135–136) and the `cat-row` section loop; emit one flat run of rows over `filtered` (already name-sorted by default sort). Delete the now-unused `.cat-row` CSS rule.
- [ ] **Step 7:** `npm run build` → passes. Live check: matrix and card views render flat; CSV/PDF have no category traces.
- [ ] **Step 8:** Commit:

```bash
git add "src/app/(dashboard)/allergens/page.tsx"
git commit -m "feat(web): allergen matrix flat — category sections removed"
```

---

### Task 9: AI import — tags end-to-end

**Files:**
- Modify: `src/app/(dashboard)/recipes/import/page.tsx`

- [ ] **Step 1: Imports** — drop `RECIPE_CATEGORIES, RECIPE_CATEGORY_LABELS`; add `import { TagInput } from '@/components/tag-input'`.
- [ ] **Step 2: Types** — in `ParsedRecipe` replace `category: string` with `tags: string[]`; in `emptyParsed` replace `category: 'main',` with `tags: [],`.
- [ ] **Step 3: Response mapping** (line 133) — replace `category: r.category ?? 'main',` with:

```ts
// tags from the updated edge function; legacy responses map category -> one tag.
// Capitalise+s reproduces the backfill labels for all 8 legacy values
// (starter->Starters … beverage->Beverages), so legacy AI responses land on
// the existing backfilled tags instead of creating near-duplicates.
tags: Array.isArray(r.tags) && r.tags.length > 0
  ? r.tags
  : r.category && r.category !== 'other'
    ? [r.category.charAt(0).toUpperCase() + r.category.slice(1) + 's']
    : [],
```

- [ ] **Step 4: Form field** — replace the Category `<Field>` + select (lines 350–362) with:

```tsx
<Field label="Tags">
  <TagInput value={parsed.tags} onChange={(t) => updateParsed('tags', t)} />
</Field>
```

- [ ] **Step 5: Save** — in the RPC payload remove `category: parsed.category,` and add a sibling key next to `ingredients`:

```ts
tags: parsed.tags,
```

Add `queryClient.invalidateQueries({ queryKey: ['tags'] })` to the post-save invalidations.

- [ ] **Step 6:** `npm run build` → passes. Live check: import a text recipe → legacy `category` maps to a tag chip; edit chips; save → recipe carries the tags.
- [ ] **Step 7:** Commit:

```bash
git add "src/app/(dashboard)/recipes/import/page.tsx"
git commit -m "feat(web): AI import produces tags (legacy category mapped)"
```

---

### Task 10: import-recipe edge function returns tags

**Files:**
- Create: `supabase/functions/import-recipe/` (downloaded — source is NOT in the repo today)

- [ ] **Step 1: Download the deployed source** (gets it under version control at last):

```bash
cd ~/HACCP/web
SUPABASE_ACCESS_TOKEN=<token> supabase functions download import-recipe --project-ref rszrggreuarvodcqeqrj
```

- [ ] **Step 2: Patch the prompt/schema.** Locate the recipe JSON schema in the function's prompt (the response contract documented in `docs/04-DATABASE.md:399-403` — it contains `category`). Keep `category` in the schema for one deploy cycle (spec Section 5) and ADD:

```
"tags": ["string"]  // 1-3 short menu tags a restaurant would use, e.g. ["Pasta", "Starters", "Vegan specials"]
```

with a prompt instruction: `Suggest 1-3 short menu tags (capitalised, max 40 chars each) a restaurant would file this dish under. Keep returning "category" with one of the legacy values as before.`

- [ ] **Step 3: Deploy + verify:**

```bash
SUPABASE_ACCESS_TOKEN=<token> supabase functions deploy import-recipe --project-ref rszrggreuarvodcqeqrj --no-verify-jwt
```

Live check via the web import page: response now yields `tags` chips (not the legacy mapping path — verify in devtools that `r.tags` came from the function).

- [ ] **Step 4: Commit:**

```bash
git add supabase/functions/import-recipe
git commit -m "feat(edge): import-recipe suggests tags[] (category kept for legacy clients)"
```

---

### Task 11: constants cleanup + final sweep

**Files:**
- Modify: `src/lib/constants.ts:63-71`
- Modify: `docs/02-FEATURES.md` (menu/recipes feature blurbs mention categories)

- [ ] **Step 1: Delete** `RECIPE_CATEGORIES` and `RECIPE_CATEGORY_LABELS` (constants.ts lines 63–71, the whole `── Recipe ──` block).
- [ ] **Step 2: Verify zero references:**

```bash
grep -rn "RECIPE_CATEGORIES\|RECIPE_CATEGORY_LABELS\|recipe.category\|r\.category\|recipe\.category" src/ | grep -v "extra_care\|DOCUMENT_CATEGORIES"
```

Expected: only the import page's legacy-response mapping (`r.category` in Task 9 Step 3 — intentional, reads the edge-function response, not the DB column). Anything else → fix it.
- [ ] **Step 3:** Update `docs/02-FEATURES.md`: recipes/menu feature descriptions — categories → per-business tags, mention group-by-tags view.
- [ ] **Step 4: Full verification:** `npm test` (all green) + `npm run build` (clean). Live regression per spec DoD: open /recipes, /menu (both modes + PDF), /allergens, full AI import round-trip, recipe create/edit with tags.
- [ ] **Step 5: Commit:**

```bash
git add src/lib/constants.ts docs/02-FEATURES.md
git commit -m "chore(web): remove RECIPE_CATEGORIES — tags everywhere"
```

---

## Self-review (done at plan time)

- **Spec coverage (web scope):** editor (Tasks 3–4), list filter+chips (5), detail (6), menu flat+filter+group+PDF/CSV (7), allergens flat (8), AI import incl. legacy mapping (9), edge function (10), constants removal (11), shared lib+component (1–2). HACCP-pack page reads `select('*')` but never touches category — no task needed (verified in inventory).
- **Placeholders:** Task 7 Step 5 references "same table as flat view" with an explicit extraction instruction (`RecipesTable`) — acceptable DRY pointer within the same file/step; everything else carries full code. Task 10 can't pre-quote unseen source; steps give exact commands, the exact schema line to add, and the prompt sentence.
- **Type consistency:** `getRecipeTags`/`groupByTags`/`normalizeTag`/`UNTAGGED`/`TagRef` defined in Task 1 and used with identical signatures in Tasks 4–9; `attach_tag` called with `{p_recipe_id, p_name}` matching the Phase-1 SQL parameter names; join fragment `recipe_tags ( tag:tags (id, name) )` identical in Tasks 4–7 and matches the `rt.tag` shape parsed in Task 1.
- **Sequencing:** Tasks 1–2 before 3–9; Task 10 independent after 9 (legacy mapping covers the gap); Task 11 last (constants must outlive their final consumer, deleted only after Tasks 3–9 land).
