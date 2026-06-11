# Recipe Tags (replace category) — Design Spec

**Date:** 2026-06-11
**Status:** Draft — pending Konstantin's review
**Repo scope:** `blueroll-web` (DB migration + web), `haccp-mobile` (follow-up release), `import-recipe` edge function (deployed separately)

## Problem

Users asked to "extend menu categorisation". Current model: `recipes.category` — one
TEXT column, CHECK constraint on a fixed list, hardcoded enum in both clients
(`RECIPE_CATEGORIES` in web `src/lib/constants.ts:64`, `RecipeCategory` enum in mobile
`lib/models/recipe.dart:1-41`). Users cannot add their own sections; every new category
is a 3-repo code change (constant + enum + DB CHECK), and the lists already drifted
once (cocktail/beverage).

## Decision summary (user-approved in brainstorm, 2026-06-09 + 2026-06-11)

- **Variant B:** drop the category concept and hard menu sections. Menu = flat list
  + tag filter. Printed menu loses fixed sections — accepted consequence.
- Tags are **per-business**, user-created, **M:N** with recipes. Normalisation
  (lowercase+trim) + uniqueness per business + autocomplete prevent duplicates.
- **Approach A:** tags are created/picked inline in the recipe editor. NO separate
  tag-management screen.
- **Grouping (answered 2026-06-11):** optional "group by tags" view — one section per
  tag, a recipe with several tags is **duplicated under each of its tags**; untagged
  recipes go to a final "Untagged" section.
- **dietary flags (Vegan/Veg/GF/DF) and allergens stay structural fields** — NOT tags.
- Migration: existing categories become tags (per business), recipes get linked,
  nothing is lost.
- AI import returns an array of tag names instead of one category (find-or-create).

## New facts found while drafting (changes vs. brainstorm)

1. **`category` column cannot be dropped in this cycle.** Shipped mobile builds
   (≤1.4.0+21) parse `json['category'] as String` with no null fallback
   (`lib/models/recipe.dart:103`) — dropping the column (or letting it go NULL on
   new rows) crashes the Recipes/Menu screens of every existing install. The column
   stays as `TEXT NOT NULL DEFAULT 'other'`; new code stops reading/writing it; drop
   happens in a **later migration** after the tags mobile release has adoption.
2. **Mobile has no offline cache for recipes** (fresh Supabase fetch via
   FutureProvider every load) — the "offline tag cache" work item from the estimate
   disappears; tags ride along in the same select.
3. The `import-recipe` edge function source is **not in either repo** — it is
   deployed directly to Supabase. Its update is a separate deploy step.

## Section 1 — Schema, RLS, RPC

### Tables

```sql
CREATE TABLE public.tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 40),
  name_norm   TEXT GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, name_norm)
);

CREATE TABLE public.recipe_tags (
  recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  tag_id    UUID NOT NULL REFERENCES public.tags(id)    ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, tag_id)
);
CREATE INDEX idx_recipe_tags_tag ON public.recipe_tags(tag_id);
```

`name` keeps the user's original casing for display; `name_norm` (generated column)
enforces uniqueness. The UNIQUE constraint doubles as the autocomplete lookup index.

### RLS

RLS enabled on both tables. Same access model as recipes, via existing helpers
`get_my_business_id()` / `get_my_role()`:

- `tags`: SELECT for all business members (`business_id = get_my_business_id()`);
  INSERT/UPDATE/DELETE for `owner|manager|chef` (same roles that may write recipes,
  per `create_recipe_with_ingredients`). WITH CHECK pins `business_id` to
  `get_my_business_id()` so nobody can create tags in another business.
- `recipe_tags`: SELECT for members; INSERT/DELETE for `owner|manager|chef`; both
  sides checked — `recipe_id` must belong to a recipe of my business AND `tag_id`
  to a tag of my business (blocks cross-business linking).

### RPC `attach_tag(p_recipe_id UUID, p_name TEXT) RETURNS tags`

**SECURITY INVOKER** (not DEFINER — RLS does the authorisation; avoids a privileged
function in the exposed schema), `SET search_path = public`:

1. Normalise input; reject empty/overlong (same rule as the CHECK).
2. Find-or-create race-safe: `INSERT INTO tags (business_id, name)
   VALUES (get_my_business_id(), btrim(p_name))
   ON CONFLICT (business_id, name_norm) DO UPDATE SET name = tags.name RETURNING *`
   (no-op update so RETURNING always yields the row).
3. `INSERT INTO recipe_tags ... ON CONFLICT DO NOTHING`.
4. Return the tag row (client gets canonical id+name for its chip).

Detach is a plain client-side `DELETE FROM recipe_tags WHERE recipe_id=? AND tag_id=?`
under RLS — no RPC needed.

### Orphan tags (derived decision — flag for review)

With no management screen, a typo'd tag would otherwise live in autocomplete forever.
Decision: **self-cleaning** — `AFTER DELETE ON recipe_tags` trigger deletes the tag
if it has no remaining links. Tags exist only while ≥1 recipe carries them. (Rare
race with a concurrent attach resolves via FK error → client retries attach_tag.)

### `create_recipe_with_ingredients` RPC change

Accepts optional `p->'tags'` (array of names); after inserting the recipe, loops
find-or-create+link (same logic as attach_tag) inside the same transaction. The
`category` key in the payload is ignored from now on (column default applies).
Old mobile builds that still pass `category` keep working — value lands in the
legacy column, harmless.

## Section 2 — Backfill migration & deploy order

### Backfill (single migration, idempotent)

For every business, for every distinct `recipes.category` **except `'other'`**
(derived decision: "Other" as a tag is noise; those recipes simply stay untagged):

1. Insert tag with the human label (`'main'` → `'Main Course'` etc., the
   `RECIPE_CATEGORY_LABELS` mapping inlined into the migration), ON CONFLICT skip.
2. Link all the business's recipes of that category via `recipe_tags`.

Column `recipes.category` and its CHECK constraint are **left untouched** (see
"New facts" #1). New code stops writing it; the `DEFAULT 'other'` (add it if the
column has no default today — verify at implementation) keeps old mobile builds
crash-free on rows created by new clients.

Sanity check after backfill: every recipe with `category NOT IN ('other')` has
exactly one tag whose name matches its category label; count mismatches → stop.

### Deploy order

1. **Migration** (tables + RLS + RPCs + backfill). Old clients unaffected — they
   neither select nor join the new tables.
2. **Web** (Vercel) — editor, menu, allergens, import switch to tags.
3. **Edge function `import-recipe`** — prompt/schema returns `tags: string[]`
   (1–3 suggested). Deployed separately
   (`supabase functions deploy import-recipe --project-ref rszrggreuarvodcqeqrj --no-verify-jwt`).
   Until then web maps a legacy `category` response to one tag client-side, so
   ordering between 2 and 3 is not critical.
4. **Mobile release** (next AAB/TestFlight) — full tags UI.
5. **Later cycle:** migration dropping `recipes.category` + `recipes_category_check`
   + removing the legacy mapping code. Trigger: tags mobile release ≥2 weeks in
   production / forced-update decision. This also closes the old
   "code knows cocktail/beverage, CHECK maybe doesn't" drift bug by removing both.

**Rollback:** new tables/RPCs are additive; web rollback = previous Vercel deploy
(category column still has all pre-migration data). Only data written tags-only
after cutover would lack categories — accepted, window is small.

## Section 3 — Web changes (inventory-based)

- `src/lib/constants.ts` — `RECIPE_CATEGORIES` / `RECIPE_CATEGORY_LABELS` deleted
  (after the last consumer goes); shared tag helpers live in new `src/lib/tags.ts`
  (fetch business tags, attach/detach wrappers).
- **New shared component** `TagInput`: chip list + text input with autocomplete
  against the business's tags (prefix match on `name_norm`), free-text creates.
  Used by recipes/new, recipes/edit, recipes/import.
- `recipes/new/page.tsx` + `recipes/edit/[id]/page.tsx` (`:228-238` / `:296-306`):
  category `<select>` → `TagInput`. New: tags attached after insert via RPC payload;
  edit: diff chips → attach_tag / delete recipe_tags.
- `recipes/page.tsx` (`:117-128`, `:172`): category filter dropdown → tag filter
  (multi-select chips, recipe matches if it has ALL selected tags); table cell shows
  tag chips.
- `recipes/[id]/page.tsx` (`:172`): category InfoCard → tag chips.
- `menu/page.tsx` (`:111-168`, `:259`): flat list + tag filter + **"Group by tags"
  toggle**. Grouped view & PDF: one section per tag (alphabetical), duplicates per
  the approved answer, "Untagged" last. Ungrouped PDF = flat alphabetical. CSV: tags
  joined `; ` in one column.
- `allergens/page.tsx` (`:76-148`, `:271-307`): matrix goes **flat, alphabetical**
  (per brainstorm); category section rows in HTML/PDF/CSV removed; tags shown as a
  column is NOT added (matrix is about allergens).
- `recipes/import/page.tsx` (`:35`, `:133`, `:204`, `:350-361`): `ParsedRecipe.category`
  → `tags: string[]`; legacy `category` in the function response mapped to
  `[label]` until the edge function is redeployed; per-recipe `TagInput` for review;
  save passes tags to the RPC.
- Recipes select queries gain `recipe_tags(tags(id, name))`.

## Section 4 — Mobile changes (next release)

- `lib/models/recipe.dart`: delete `RecipeCategory` enum + extension; model gets
  `final List<String> tags` (parsed from joined `recipe_tags(tags(name))`,
  **tolerant of the key being absent** — empty list). `category` field removed from
  the model; toJson no longer emits it (RPC/inserts rely on the DB default).
- Delete the three duplicated `_catIcon` maps (`recipes_screen.dart:36-44`,
  `recipe_detail_screen.dart:45-53`, `allergen_matrix_screen.dart:45-53`).
- `recipes_screen.dart` (`:97-167`): category sections → flat list + tag filter
  chips row + "group by tags" toggle (duplicate-per-tag + Untagged, same semantics
  as web).
- `recipe_new_screen.dart` / `recipe_edit_screen.dart`: dropdown → tag chips editor
  with autocomplete (queries `tags` by business); save via attach_tag/detach.
- `recipe_detail_screen.dart:145`: category pill → tag chips.
- `allergen_matrix_screen.dart` (`:80-84`, `:173-193`): flat alphabetical, sections
  removed.
- `lib/utils/menu_export.dart`: hardcoded category order arrays removed; PDF/CSV
  group by tags with duplicates when grouping is on, flat otherwise.
- `ai_import_screen.dart` (`:251`, `:755`, `:784-790`): category pill → tag chips;
  passes `tags` to the RPC; legacy `category` response mapped like web.
- Release as the next version bump (current 1.4.0+21); separate AAB + TestFlight.

## Section 5 — AI import (edge function)

`import-recipe` prompt/schema: replace `category` with `tags: string[]` — "1–3 short
menu tags a restaurant would use (e.g. Pasta, Starters, Vegan specials)". Clients
find-or-create via the RPC payload, so hallucinated novel tags are safe — they just
become new tags the user can delete by unticking the chip (orphan cleanup removes
them). Keep returning `category` alongside `tags` for one deploy cycle so not-yet-
updated clients keep working.

## TDD plan

pgTAP via `supabase test db` (same infra decision as the subscription spec; fallback
plain SQL ASSERT script). Written red→green before the migration is finalised:

1. attach_tag normalisation: "  Pasta " and "pasta" → same tag, display name keeps
   first-writer casing.
2. attach_tag race shape: two attaches of the same name → one tag, two links OK,
   second link no-op.
3. RLS isolation: business A member cannot SELECT/INSERT B's tags, cannot link
   A-recipe→B-tag or B-recipe→A-tag (the WITH CHECK pair).
4. Role gate: front_of_house can read tags, cannot attach.
5. Orphan cleanup: deleting the last recipe_tags link deletes the tag; deleting one
   of two links does not. Recipe DELETE cascades links → cleanup fires too.
6. Backfill: per-business distinct categories → labelled tags, counts match,
   `'other'` recipes untagged, re-running the backfill is a no-op.
7. CHECK guards: empty/41-char tag name rejected.
8. `create_recipe_with_ingredients` with `tags` payload creates and links atomically;
   payload with legacy `category` and no `tags` still succeeds (column default).

Web/mobile: component-level — TagInput dedup against autocomplete; grouping function
(pure: recipes+tags → sections with duplicates + Untagged) unit-tested on both
platforms.

## Definition of done

- All pgTAP tests green; backfill sanity check 0 mismatches on production data.
- Web: create/edit/filter/group/print with tags, AI import end-to-end.
- A pre-tags mobile build (1.4.0+21) still renders Recipes/Menu after the migration
  AND after web has created tag-only recipes (manual check on a test business).
- `docs/04-DATABASE.md` updated (tags, recipe_tags, RPC changes, category marked
  deprecated-pending-drop).

## Out of scope

- Dropping `recipes.category` + CHECK (deferred migration, step 5 of deploy order).
- Tag management screen, tag colours/icons, tag ordering/pinning.
- Migrating dietary flags or allergens to tags.
- Offline caching (mobile has none today; not adding any).
- Forced-update mechanism for old mobile builds.

## Open items for review (derived decisions made while drafting)

1. `'other'` categories are NOT backfilled as a tag (those recipes start untagged).
2. Orphan tags self-delete when their last recipe link is removed.
3. Tag filter semantics = AND (recipe must have all selected tags).
4. Backfilled tag names use the human labels ("Main Course"), not raw enum values.

## Related context

- Brainstorm session 2026-06-09 (memory: recipe-tags-feature); duplicate-per-tag
  grouping answer 2026-06-11.
- Pattern references: `supabase/migrations/20260607150300_create_recipe_rpc.sql`
  (role-checked recipe RPC), `20260607150400_phase1_hardening.sql` (RLS style).
