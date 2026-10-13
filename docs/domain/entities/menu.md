# Menu — dishes and menu sections (`menu_items`, `menu_categories`)

> The dishes a kitchen actually serves, grouped into sections ("Starters", "Small Plates"), each with the
> allergens a guest or an inspector must be told — traced from a recipe, or declared and signed by a named person.

**Tables:** `menu_items` (a dish), `menu_categories` (a site's menu sections) · **Scope:** business-wide row, placed on
sites by `site_ids`; sections are per site · **Last verified:** 2026-10-13 (review pass) against `main@b50e9d1` and the live DB
(166 dishes in 5 businesses; 91 sections on 17 sites)

## What it is for

The Menu page answers "what do we serve and what is in it"; the Allergens page turns the same dishes into the
dishes × 14 allergens matrix that inspectors ask for first (`src/app/(dashboard)/allergens/page.tsx:39-40,239`).
A dish exists because drinks, bought-in items and specials have no recipe yet still need declared allergens
(`supabase/migrations/20260716180000_dishes_model.sql:1-15`). The HACCP Pack and the HACCP Plan read their allergen
section from the menu. Recipes, ingredients and their allergen tags: see [Recipe](recipe.md).

## Parameters

**`menu_items`**

| Field (UI label) | DB column | Meaning | Allowed values | Enforced by |
|---|---|---|---|---|
| Dish name | `name` | Shown everywhere. For recipe dishes it is a **copy** of the recipe name at add time. | text | DB `NOT NULL` |
| Allergen source | `allergen_source` | `recipe` = allergens read live from the recipe's ingredients ("Linked to recipe"); `manual` = declared by hand ("Declared by …"). | `recipe`, `manual` | DB `CHECK menu_items_allergen_source_check`; default `recipe` |
| Recipe | `recipe_id` | The recipe a `recipe` dish traces to. | uuid or null | `CHECK menu_items_recipe_source_check` (recipe ⇒ not null); FK `ON DELETE RESTRICT` |
| Allergens (declared) | `declared_allergens` | What the attester ticked. **Ignored** for `recipe` dishes. | lowercase keys of the 14 (below) | code only (`EU_ALLERGENS`); no DB `CHECK` |
| May contain | `may_contain` | Cross-contact ("trace") warnings. Shown on the Menu page and the Plan matrix. | same keys | **written by no code** — Gotcha 6 |
| Dietary | `dietary` | Labels for `manual` dishes. Ignored for `recipe` dishes (computed live). | `Vegan`, `Vegetarian`, `Gluten-Free`, `Dairy-Free` | code only (`DIETARY_FLAGS` `src/lib/dietary.ts:11-16`, mobile `add_dish_screen.dart:32-38`) |
| Attested by / at | `attested_by`, `attested_by_name`, `attested_at` | The due-diligence record for a `manual` dish: who vouched and when ("Declared by Ana · 3 Oct"). Name is a text copy. | — | `CHECK menu_items_attestation_check` (manual ⇒ name and time not null); `attested_by` FK `ON DELETE SET NULL` |
| Sites | `site_ids` | Which sites' menus the dish is on. One row is shared by all those sites. | uuid[] | `NOT NULL DEFAULT '{}'`; no FK, no check that ids belong to the business |
| Section per site | `site_categories` | `{ "<site_id>": "<menu_categories.id>" }` — which section the dish sits in on each site. Missing key = "Uncategorised". | jsonb object | nowhere (no FK into the json) |
| Category (legacy) | `category` | Old business-wide grouping, still written on insert (`starters`/`mains`/`sides`/`desserts`/`other`, or on mobile the section name). Used only when no site is active. | text | `NOT NULL`; no `CHECK` |
| Active | `active` | Meant to hide a dish. | bool | default true; **no UI toggles it** |
| Order | `display_order` | Sort order of the Menu list. | int | apps always write 0 |
| Price | `price` | Unused. | numeric | **no code reads or writes it** (19 rows set by SQL) |

Also `id`, `business_id` (FK `ON DELETE CASCADE`). No `created_at`.

**`menu_categories`** (Menu sections): `site_id` (NOT NULL, FK `ON DELETE CASCADE`), `business_id` (FK cascade), `name`
(unique per site case-insensitively, index `ux_menu_categories_site_lower_name`), `sort_order` (int, default 0),
`created_at`. Backfilled on 2026-07-31 from the legacy `category` into `Starters/Mains/Sides/Desserts/Other`
(`20260731120000_per_site_menu_categories.sql:47-94`); since then owners rename and add their own.

### Known drift (live data, 2026-10-13)

- `category`: 25 distinct values — slugs singular **and** plural (`main` 17, `starter` 8, `starters` 5, `mains` 3 …) plus
  section names written by mobile (`Small Plates` 19, `Noodles` 15 …). Harmless while sections drive grouping.
- `declared_allergens`: all canonical lowercase except **`Milk` 1** (on a `recipe` dish, so never read).
- `dietary`: `Vegetarian` 8, `vegetarian` 5, `Vegan` 4, `vegan` 2, `gluten_free` 1. The 8 lowercase rows (vegetarian 5, vegan 2,
  gluten_free 1) are all on
  `recipe` dishes (ignored); no code in either repo writes lowercase, so they came from an import/SQL. Canonical: Title-case with hyphen.
- `recipe` dishes carrying leftovers: 24 with `declared_allergens`, 16 with `dietary`, 19 with an attestation — all ignored.
- `manual` 116 / `recipe` 50; 114 manual dishes have no `attested_by` id (name only) and `display_order` runs 0–114 in one
  business — signs of a bulk SQL load, not app writes.
- `site_categories`: 17 dishes keep a key for a site no longer in `site_ids`; 21 are on a site with no section; none point
  at a missing section. 1 recipe has two dishes in one business. `may_contain` empty everywhere; `price` set on 19; `active` true on all.

## Allergens and dietary — the rules

**The 14** (UK FIR / Natasha's Law), storage key → label (`src/lib/constants.ts:2-13`): `gluten` Gluten (cereals),
`crustaceans`, `eggs`, `fish`, `peanuts`, `soybeans` Soybeans, `milk`, `nuts` Tree Nuts, `celery`, `mustard`, `sesame`,
`sulphites`, `lupin`, `molluscs`. Mobile displays them Title-case with its own order and `Soya`/`Nuts`
(`haccp-mobile/lib/features/kitchen/dietary.dart:5-20`) but writes the same lowercase keys (`add_dish_screen.dart:25-30`).

| Where | Column | Notes |
|---|---|---|
| Ingredient | `ingredients.allergens text[]` | the only per-ingredient source; see [Recipe](recipe.md). Live: all lowercase. |
| Recipe | none for allergens; `vegan_override`, `vegetarian_override`, `gluten_free_override`, `dairy_free_override` (null = auto) | allergens = union of its ingredients |
| Dish | `declared_allergens`, `may_contain`, `dietary` | read only for `manual` dishes (except `may_contain`) |

**Resolving a dish** (`resolveAllergens`, `src/lib/dishes.ts:61-64`): `recipe` → union of `recipe_ingredients →
ingredients.allergens`, live at read time, so a recipe edit moves every dish; `manual` → `declared_allergens`.
Both are filtered through `EU_ALLERGENS`, so **any unknown or mis-cased key silently disappears** (web is
case-sensitive; mobile `canonicalAllergen` lower-cases and maps synonyms, `dietary.dart:22-46`).
**Dietary**: `manual` → stored `dietary`; `recipe` → per flag, recipe override if set, else a rule on allergens
(`src/lib/dietary.ts:18-36`, mobile `dishes.dart:32-49`): Vegan = no milk/eggs/fish/crustaceans/molluscs,
Vegetarian = no fish/crustaceans/molluscs, Gluten-Free = no gluten, Dairy-Free = no milk (Gotcha 2).
**May contain** is never derived; nothing writes it.

## Lifecycle

**Created** (both apps write the same row shape):

| Path | Where |
|---|---|
| Web Menu → New dish → "From a recipe": if a `recipe` dish for that recipe exists, add the site to its `site_ids`; else insert with `site_ids=[site]` | `src/app/(dashboard)/menu/page.tsx:430-453` |
| Web → "Declare by hand": name, section, allergens, dietary, attestation checkbox (required) → `attested_by_name = full_name ?? email` | `menu/page.tsx:455-468,619` |
| Mobile Kitchen → Menu → Add dish (same two modes; recipe de-dup uses `.maybeSingle()`) | `haccp-mobile/lib/providers/kitchen_provider.dart:112-185` |

**Edited:** only `site_ids` and `site_categories` (section picker, `menu/page.tsx:131-147`; mobile `menu_tab.dart:514`) — Gotcha 5.
**Removed from a site:** drops the site from `site_ids`; if it was the last site the row is deleted (`menu/page.tsx:119-129`,
`kitchen_provider.dart:189-200`). `site_categories` keeps the old key.
**Recipe deleted:** FK `RESTRICT` blocks it, so both apps first convert linked dishes to `manual`, snapshotting the
resolved allergens and attesting as the deleting user (`src/lib/dishes.ts:86-98`, called from `recipes/page.tsx:79-90`,
`recipes/[id]/page.tsx:96-106`; mobile `recipe_actions.dart:425-461`).
**Sections:** add / rename / reorder / delete (delete first strips the id from dishes' `site_categories`) — `menu/page.tsx:649-700`, mobile `menu_sections_sheet.dart:191-304`.
**Gone with:** business (cascade); a hard-deleted site cascades its sections but leaves its id inside `site_ids`.
(`copy_kitchen()` exists live, copies no dishes and is called by neither app.)

## Who can do what

| Action | Rule | Enforced in |
|---|---|---|
| See dishes, sections | any member of the business; anyone signed in for the demo business | RLS `Business members can view menu`, `Members read menu categories`, `demo_read` |
| Create / edit / delete | `manage_recipes` (Owner, Manager, Chef presets) | RLS `Managers can manage menu`, `Managers manage menu categories` (ALL) |
| Write when not entitled | dish insert/update blocked; **sections not gated** | RESTRICTIVE `entitlement_write_gate_ins/_upd` on `menu_items` only |
| Site | **not checked** — any member sees every site's dishes and sections | no `can_see_site_row` on either table |
| UI | web shows "New dish" / sections to everyone, no capability check (RLS error toast for others); mobile hides edits without `canManageRecipes` (`menu_tab.dart:89`); "All sites" is read-only on both | `menu/page.tsx:199-209` |

See [Tiers, roles and capabilities](../concepts/roles-and-capabilities.md).

## Site scoping

A dish row is business-wide; `site_ids` places it on menus. Sections are per site (`menu_categories.site_id`) and
`site_categories` maps each site to one of *that site's* sections. Views: multi-site business on a site → dishes whose
`site_ids` contain it, editable; "All sites" → every dish, read-only, with a Sites column (web) or the estate grid
(mobile `estate_menu.dart`). **Single-site business: web shows every dish regardless of `site_ids`; mobile shows only
dishes whose `site_ids` contain the site** (`menu/page.tsx:89-92` vs `menu_tab.dart:96-101`). The web topbar still labels
/menu and /allergens "Shared across all sites" (`src/components/layout/topbar.tsx:24`), which is no longer true.
Backfill `20260717120000` put pre-July dishes on every site of their business.

## HACCP Pack and Plan

- `menuHasAllergens(dishes, site)` = some **active** dish on that site (or with empty `site_ids`, or no site chosen)
  resolves ≥1 allergen (`src/lib/haccp-pack/scope.ts:29-35`). When true, `fa_matrix_file` ("Upload allergen matrix
  document") is not asked — "Your allergen matrix is built from the menu." (`scope.ts:60`); `fa_allergens_list` is retired
  from the pack UI (`scope.ts:26`). Used by the pack page (`haccp-pack/page.tsx:371,413`) and *Set up my HACCP*
  (`src/lib/haccp-setup/context.ts:33`).
- HACCP Plan (`build.ts:150-155`) prints the same site's active dishes as a matrix with contains / "T" for may-contain
  (`src/components/haccp-plan/infographics.tsx:161-186`), loaded by the edge function `haccp-plan` (incl. inspector
  token links, `supabase/functions/_shared/haccp-plan/load.ts:75`).
- Web auto-fill still writes `fa_allergens_list` from **all** dishes of the business, unfiltered by site or `active`
  (`src/lib/haccp-pack/auto-data.ts:170-180`).
- Mobile pack still shows `fa_allergens_list` and always asks `fa_matrix_file` (`haccp_constants.dart:71-73`), and its
  auto-fill reads only `declared_allergens` (Gotcha 4).

## Related

[Recipe](recipe.md) (source of `recipe` dishes), [Site](site.md), [Document](document.md) (`fa_matrix_file`),
[Subscription and entitlement](../concepts/subscription-and-entitlement.md).

## Where in code

| Area | Location |
|---|---|
| Web pages | `src/app/(dashboard)/menu/page.tsx` (list, add drawer, sections panel, CSV + print PDF), `allergens/page.tsx` (matrix, CSV, print) |
| Shared logic | `src/lib/dishes.ts` (`DISH_CATS`, `catLabel`, `resolveAllergens`, `convertDishesToManual`), `src/lib/menu-categories.ts`, `src/lib/dietary.ts`, `src/lib/constants.ts`, `src/lib/haccp-pack/scope.ts` |
| Mobile | `models/dish.dart`, `providers/kitchen_provider.dart`, `providers/menu_categories_provider.dart`, `features/kitchen/` (`menu_tab`, `add_dish_screen`, `menu_sections_sheet`, `allergen_matrix_tab`, `estate_menu`, `dishes.dart`, `dietary.dart`), `utils/menu_export.dart` |

## Gotchas

1. **`site_ids` is shared, the dish is not per site.** Adding a recipe to site B reuses site A's row, so allergens,
   name and source are one record for all sites; only the section differs. RLS ignores sites entirely. [#91](https://github.com/KNSTNTN24/blueroll-web/issues/91)
2. **Auto dietary only looks at allergens.** A beef or chicken recipe with no fish/milk/egg allergens is labelled
   Vegan and Vegetarian unless someone sets the recipe overrides (`src/lib/dietary.ts:19-20`). Gluten-Free and
   Dairy-Free are regulated claims, yet they are asserted automatically from the *absence* of an allergen tag. It
   compounds with Gotcha 7: a mis-cased allergen (e.g. `Milk`) is dropped by `resolveAllergens` (`dishes.ts:54,63`)
   **and** turns on Dairy-Free/Vegan. [#84](https://github.com/KNSTNTN24/blueroll-web/issues/84)
3. **Recipe→manual conversion loses dietary.** `convertDishesToManual` snapshots allergens but not `dietary`, so the
   dish falls back to whatever stale `dietary` the row held (usually none) (`src/lib/dishes.ts:88-95`; mobile same). [#91](https://github.com/KNSTNTN24/blueroll-web/issues/91)
4. **Mobile HACCP Pack auto-fill ignores recipe dishes:** it lists `declaredAllergens` only, so every recipe-backed dish
   reads "none" (or stale leftovers), for all sites (`haccp-mobile/lib/providers/haccp_autofill_provider.dart:76-85`).
5. **No dish editing anywhere.** A wrong declaration can only be fixed by delete + re-add (losing sections on other sites). [#91](https://github.com/KNSTNTN24/blueroll-web/issues/91)
6. **`may_contain`, `price`, `active`, `display_order` are dead fields** for writers; `menuHasAllergens` and the Plan honour
   `active`, the web Menu/Allergens pages do not, mobile matrix does.
7. **Unknown allergen keys vanish on web** (`Milk` ≠ `milk`) — a mis-cased declaration prints as "None declared"
   (and switches on dietary labels — Gotcha 2).
8. **Mobile add-from-recipe throws** when a recipe already has two dishes (`.maybeSingle()`, `kitchen_provider.dart:131`; 1 live case). [#91](https://github.com/KNSTNTN24/blueroll-web/issues/91)
9. **Sections are writable while unentitled** — `menu_categories` has no restrictive entitlement gate (dishes do). [#91](https://github.com/KNSTNTN24/blueroll-web/issues/91)
10. **Exports differ:** web PDF = allergens + source; web matrix = allergens only; mobile PDF adds dietary; none print may-contain.

## History

- 2026-10-12 `ad90c34` (#41) pack takes allergens from the menu; `fa_matrix_file` only when the menu has none.
- 2026-07-31 per-site sections (`35e48a9`, #20); 2026-07-17 per-site `site_ids` + backfill (`e9db13e`).
- 2026-07-16 dishes promoted to first-class, `recipe`/`manual` with attestation, FK RESTRICT (`6d073af`, `20260716180000`).
- 2026-04 original `menu_items` = recipe projection (`001_initial_schema.sql:189-196`, FK cascade).
