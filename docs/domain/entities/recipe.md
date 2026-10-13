# Recipe (`recipes`)

> A dish the kitchen makes — "Mushroom risotto", "Beef stew" — with its ingredients, how it is cooked, and the
> food-safety controls (chill, reheat, hot-hold…) that apply. Allergens come from the ingredients, not from the recipe.

**Tables:** `recipes`, `recipe_ingredients` (lines), `ingredients` (shared per business), `tags` + `recipe_tags`,
`recipe_sites` (unused) · **Scope:** business (one catalogue for all sites) ·
**Last verified:** 2026-10-13 (review pass) against `main@b50e9d1` and the live DB (211 recipes in 9 businesses, 1,437 lines, 935 ingredients, 64 tags)

## What it is for

The recipe library is the evidence base for allergens and HACCP: a menu dish linked to a recipe reads its allergens
live from the recipe's ingredients ([Menu](menu.md)), and the HACCP Pack, *Set up my HACCP* and the HACCP Plan
fill their cooking/chilling answers from each recipe's `haccp_methods`. Recipes are typed in, or imported by AI from
text, a PDF or photos.

## Parameters

| Field (UI label) | DB column | Meaning | Allowed values | Enforced by |
|---|---|---|---|---|
| Name, Description | `name`, `description` | What the dish is. Name is what the Pack and Plan print. | text; name required | DB `NOT NULL` |
| Course (mobile only) | `category` | **Legacy**, replaced by tags (spec 2026-06-11) but kept because old mobile builds crash without it. | `starter`, `main`, `dessert`, `side`, `sauce`, `drink`, `other` (default) | DB `recipes_category_check` |
| Tags | `tags` + `recipe_tags` | Per-business labels ("Pasta", "Brunch"), many per recipe. Filter on the list. | 1–40 chars, unique per business after `lower(btrim())` (`name_norm`, generated) | DB `tags_name_check`, `tags_business_id_name_norm_key`; RPC `attach_tag` |
| Method steps | `instructions` | Free-text method. | text, **`NOT NULL DEFAULT ''`** | DB — clients send `null` for empty (Gotcha 2) |
| Cooking method | `cooking_method` | How it is cooked. "No cook" means no `cooking_safely`. | free text. Web picker: Oven, Grill, Pan fry, Deep fry, Boil / simmer, Steam, No cook (`new/page.tsx:15`) | nowhere |
| Temp, Time, unit | `cooking_temp`, `cooking_time`, `cooking_time_unit` | Cooking temperature °C (oven, not core) and duration. Temp goes into Pack `ck_dishes`/`mc_items`. | numbers; unit `minutes`/`hours` | DB `recipes_cooking_time_unit_check`; web new always writes `minutes` |
| HACCP controls | `haccp_methods text[]` | Which SFBB safe methods apply. Drives all auto-fill. | 9 ids: `chilled_storage`, `chilling_down`, `defrosting`, `freezing`, `cooking_safely`, `extra_care`, `reheating`, `hot_holding`, `ready_to_eat` | code only: `HACCP_RECIPE_METHODS` `src/lib/haccp-methods.ts:15-77`. No DB `CHECK` |
| Per-control notes | `chilling_method`, `freezing_instructions`, `defrosting_instructions`, `reheating_instructions` | How this dish is chilled / frozen / defrosted / reheated. Printed after the recipe name in the Pack. | text | — |
| Hot holding | `hot_holding_required` | Mirror of the `hot_holding` method. | bool | not kept in sync (Known drift) |
| Extra care | `extra_care_flags text[]` | Which "extra care" foods it contains. | `eggs`, `rice`, `pulses`, `shellfish` | code only (`edit/[id]/page.tsx:27-32`, mobile `recipe_form.dart:30`); **web New writes free text here** (Gotcha 8) |
| Dietary overrides | `vegan_override`, `vegetarian_override`, `gluten_free_override`, `dairy_free_override` | `null` = derive from allergens; `true`/`false` = forced. | bool or null | — |
| Active | `active` | Inactive = greyed out on lists. Nothing else filters on it (Gotcha 6). | bool, default true | — |
| Site | `site_id` | Multisite leftover. Always null live. | uuid | not used by RLS since `20260713102000_kitchen_back_to_business_level.sql` |
| Photo, video, SFBB check | `photo_url`, `source_video_url`, `sfbb_check_method` | **Legacy**: no UI writes them; only copied by duplicate and `copy_kitchen`. | — | — |
| Created by | `created_by` | Author. FK to `profiles` with no `ON DELETE` (blocks hard-deleting the author). | profile id | DB FK |

Also `id`, `business_id` (FK `ON DELETE CASCADE`), `created_at`, `updated_at` (trigger `update_recipes_updated_at`).

**Lines** (`recipe_ingredients`): `ingredient_id` (FK cascade), `quantity` (**text**: "1/2", "to taste"), `unit`
(free text; web picker g, kg, ml, l, pcs, tbsp, tsp), `notes` (no UI; 0 rows use it).
**Ingredients** (`ingredients`): `name`, `allergens text[]`, `business_id` — one row per name per business, **shared by
every recipe that uses it**. Allergen keys are lowercase: `EU_ALLERGENS` `src/lib/constants.ts:2-5` (`gluten`,
`crustaceans`, `eggs`, `fish`, `peanuts`, `soybeans`, `milk`, `nuts`, `celery`, `mustard`, `sesame`, `sulphites`,
`lupin`, `molluscs`). No DB `CHECK`. RLS also exposes `business_id IS NULL` rows as a global list (none exist).

**Derived, never stored:**
- **Allergens of a recipe** = union of its ingredients' `allergens` (`recipes/[id]/page.tsx:77`, `src/lib/dishes.ts:51-55`, mobile `models/recipe.dart:147-153`).
- **Dietary** = override if set, else rule on those allergens (`src/lib/dietary.ts:19-24,32-40`): Vegan = no milk, eggs,
  fish, crustaceans, molluscs; Vegetarian = no fish, crustaceans, molluscs; Gluten-Free = no gluten; Dairy-Free = no milk.
  Gluten-Free and Dairy-Free are regulated claims, auto-asserted from the *absence* of an allergen tag. Only the known
  lowercase keys count: a mis-cased allergen (e.g. `Milk`) is dropped by `resolveAllergens` (`dishes.ts:54,63`) **and**
  turns on Dairy-Free/Vegan ([#84](https://github.com/KNSTNTN24/blueroll-web/issues/84)).

**Food-safety numbers in the HACCP method texts (check before reusing).** Some figures in code are not SFBB:
- "75 °C for 2 s" (Cooking Safely, web, mobile, AI prompt) is wrong — SFBB says 75 °C for **30 s** ([#101](https://github.com/KNSTNTN24/blueroll-web/issues/101)).
- "Cool below 8 °C within 90 min" and "hot hold max 2 hours" (mobile `recipe_haccp.dart:11,16`, AI prompt) are not SFBB:
  SFBB says cool as quickly as possible; the 2-hour rule applies to food taken *out of* hot holding.

### Known drift (live data, 2026-10-13)

- `category`: `other` 91, `main` 66, `starter` 24, `dessert` 13, `side` 8, `sauce` 7, `drink` 2 — all valid, but 85 of
  the `other` rows were created after tags shipped (web New/Import never set it). Untagged recipes: 63.
- `cooking_time_unit`: `minutes` 202, `hours` 3, **null 6**.
- `cooking_method`: 47 distinct free-text values, e.g. `Bake`/`baking`, `Oven`/`oven`, `Assemble`/`Assembly`,
  `No cook`/`No cooking required`, plus sentences ("Make sure looks nice."). 80 null.
- `haccp_methods`: empty on 163 of 211. `hot_holding_required` true without the `hot_holding` method: 3; method without the flag: 6.
- Allergens: `ingredients.allergens` all lowercase canonical. Dish side: one `menu_items.declared_allergens` value
  **`Milk`** (Title-case, from mobile spelling) which the web drops (`dishes.ts:63` filters on lowercase keys).
- `recipe_ingredients.quantity`: 38 non-numeric ("1/2", "2-3", "to taste", "al gusto", "100g"), 63 null. `unit`: free
  text (`piece` 114 next to `pcs` 147, `L` and `l`, `Onion(s)`).
- `instructions = ''`: 2. `sfbb_check_method`, `photo_url`: never set; `source_video_url`: 1 row. 130 ingredients are used by no recipe.

## Lifecycle

**Created by:**

| Path | How | Sets |
|---|---|---|
| Web *New recipe* `/recipes/new` | direct inserts (`new/page.tsx:72-108`) | no category, no tags, no overrides; `cooking_safely` added when a cooking method other than "No cook" is picked (`:83-84`) |
| Web *AI import* `/recipes/import` | edge fn `import-recipe` → review → RPC `create_recipe_with_ingredients` (`import/page.tsx:51-116`) | category from AI; **tags always `[]`**; extra care via a second update (`:111`) |
| Mobile new / edit / AI import | `RecipeActions.createRecipe` (`haccp-mobile/lib/features/kitchen/recipes/recipe_actions.dart:257-290`); import (text, PDF, ≤5 photos) pre-fills the form (`recipe_import_v2.dart:22,56-99`) | course (`category`), tags via `attach_tag`, overrides, extra-care flags |
| Duplicate (web detail, mobile) | copies the row, lines and tags (`[id]/page.tsx:118-135`, `recipe_actions.dart:338-370`) | name "(copy)"; keeps the **original** `created_by` |
| `copy_kitchen(from_site, to_site)` | DB function, called by no code | legacy multisite copy |

**AI import** (`supabase/functions/import-recipe/index.ts`): Claude (`claude-sonnet-4-6`) reads text, a PDF or up to 5
images and returns name, category, tags, instructions, cooking method/temp/time and ingredients with allergens
(prompt `:10-45`). It does **not** return `haccp_methods` or the per-control notes, so the user must tick them on review.

**Ingredients on save:** each line's name is looked up case-insensitively in the business's `ingredients`. Web New/Edit
and mobile then **overwrite** that ingredient's `allergens` (`new/page.tsx:78-80`, `edit/[id]/page.tsx:172-197`,
`recipe_actions.dart:201-235`); the import RPC reuses the existing row and **ignores** the AI's allergens for it.

**Edited:** web Edit and mobile update the row, re-link tags (web: diff + `attach_tag`, `edit/[id]/page.tsx:224-244`;
mobile: delete all then re-attach, `recipe_actions.dart:315`) and **delete and re-insert all lines**
(`edit/[id]/page.tsx:247-261`). A tag losing its last recipe is deleted by trigger `trg_cleanup_orphan_tag`.

**Deactivated:** `active = false` from the detail page (`[id]/page.tsx:84`, mobile `toggleActive`).

**Deleted:** `menu_items.recipe_id` is FK `ON DELETE RESTRICT`. Web list/detail and mobile first convert linked dishes to
hand-declared ones (snapshot allergens, attested by the deleter — `src/lib/dishes.ts:86-98`), then delete
(`[id]/page.tsx:93-114`, `recipes/page.tsx:77-97`, `recipe_actions.dart:449-457`). Lines, tags links and
`recipe_sites` cascade; ingredients stay. Business purge cascades everything.

## Who can do what

| Action | Rule | Enforced in |
|---|---|---|
| See | any member of the business (all sites); everyone can read the demo business | RLS `Business members can view recipes`, `demo_read` (same on lines, ingredients, tags) |
| Create / edit / delete | `manage_recipes` (presets: Owner, Manager, Chef) + business entitled | RLS `Chefs can manage recipes` (ALL), `entitlement_write_gate_ins/upd`; same on `recipe_ingredients`, `ingredients`, `tags`, `recipe_tags` |
| AI import save | `profiles.role` text in owner/manager/chef + entitled | RPC `create_recipe_with_ingredients` (SECURITY DEFINER) |
| UI buttons | role text owner/manager/chef (chef parity since PR #24) | web `recipes/page.tsx:23`, `[id]/page.tsx:46`; mobile `models/profile.dart:93-96` |

The UI and the RPC look at the role name, RLS at the capability — a custom role with `manage_recipes` can write
through RLS but sees no buttons; see [#55](https://github.com/KNSTNTN24/blueroll-web/issues/55) and
[Tiers, roles and capabilities](../concepts/roles-and-capabilities.md).

## Related

- **[Menu](menu.md)** — a dish (`menu_items`) can be recipe-backed (`allergen_source = 'recipe'`, `recipe_id`): it reads
  the recipe's name, live ingredient allergens and dietary overrides; per-site menus live on the dish (`site_ids`), not the recipe.
- **[HACCP Pack](haccp-pack.md) / *Set up my HACCP* / HACCP Plan** — `buildAutoData` (`src/lib/haccp-pack/auto-data.ts:66-165`):
  `cooking_safely`→`ck_dishes` (method @ temp), `reheating`→`rh_items`, `hot_holding`→`hh_items`, `chilling_down`→`cd_method`,
  `freezing`→`fz_method`, `defrosting`→`df_method`+`df_products`, `extra_care`→`ec_items` (with flags), `ready_to_eat`→`rte_items`,
  any cooking-side method→`mc_items`; ingredients→`sf_raw_products` (raw keywords/seafood) and the allergen list.
  Same loader in Setup (`src/lib/haccp-setup/api.ts:141-159`) and Plan (`supabase/functions/_shared/haccp-plan/load.ts:69-73`).
- **[Site](site.md)** — recipes are business-level; see Gotcha 4. **[Business](business.md)** — cascade on purge.

## Where in code

| Area | Location |
|---|---|
| Web pages | `src/app/(dashboard)/recipes/` (list, `[id]`, `new`, `edit/[id]`, `import`) |
| Shared | `src/lib/haccp-methods.ts`, `src/lib/dietary.ts`, `src/lib/tags.ts`, `src/lib/dishes.ts`, `src/lib/constants.ts`, `src/components/tag-input.tsx` |
| Mobile | `haccp-mobile/lib/models/recipe.dart`, `features/kitchen/recipes/` (`recipe_actions.dart`, `recipe_form.dart`, `recipe_import_v2.dart`), `features/kitchen/dietary.dart` |
| Edge / DB | `import-recipe`; RPCs `create_recipe_with_ingredients`, `attach_tag`, `copy_kitchen`; trigger `trg_cleanup_orphan_tag`; migrations `20260611120*`, `20260714180000_recipe_sites.sql` |

## Gotchas

1. **Ingredients are shared, so allergen edits are global.** Ticking "milk" on *Butter* in one recipe rewrites the
   `ingredients` row, changing every recipe and every recipe-backed menu dish that uses Butter. Conversely the AI
   import keeps the old allergens of an existing ingredient and drops what the AI detected. [#89](https://github.com/KNSTNTN24/blueroll-web/issues/89)
2. **Empty method steps break saving.** `instructions` is `NOT NULL`, but web New/Edit and mobile send `null` when the
   field is empty (`new/page.tsx:88`, `edit/[id]/page.tsx:206`, `recipe_actions.dart:74-75,106`). Only the RPC coalesces to `''`; there is no coalescing trigger, so the save really fails. [#90](https://github.com/KNSTNTN24/blueroll-web/issues/90)
3. **Allergen spellings differ by client.** DB and web use lowercase keys (`soybeans`, `nuts`); mobile displays
   Title-case `Soya`/`Nuts` and maps back with `storageAllergenKey` (`recipe_actions.dart:47-49`). Anything stored in
   Title-case is silently dropped by the web (`dishes.ts:54,63`). [#60](https://github.com/KNSTNTN24/blueroll-web/issues/60)
4. **`recipe_sites` is dead.** Created and backfilled on 2026-07-14 but no web or mobile code reads or writes it; 104 of
   211 recipes have no row. `recipes.site_id` is always null and RLS ignores sites. Every site sees the whole catalogue; per-site menus use `menu_items.site_ids`.
5. **"Vegetarian" is a guess.** Meat is not an allergen, so a chicken dish with no fish/shellfish is auto-labelled
   Vegetarian (and Vegan if also no milk/eggs) unless someone sets the override. Mobile hides Vegetarian/Dairy-free when
   Vegan applies and shows "GF"/"DF" (`models/recipe.dart:161-190`); web shows all four labels, and web New/Import repeat the rules inline instead of using `dietary.ts`.
   A mis-cased allergen key makes it worse (see *Derived* above). [#84](https://github.com/KNSTNTN24/blueroll-web/issues/84)
6. **Inactive is cosmetic.** Pack, Setup, Plan and the menu's recipe list do not filter `active` (`haccp-pack/page.tsx:190-197`,
   `menu/page.tsx:74`); 10 live dishes are linked to inactive recipes.
7. **Web import loses data:** AI tags are discarded (`tags: []`), the "From a link" mode only sends the text
   `Recipe from <url>` — nothing fetches the page, so the AI invents a recipe (`import/page.tsx:58`); `haccp_methods` start empty. [#90](https://github.com/KNSTNTN24/blueroll-web/issues/90)
8. **Web New writes free text into `extra_care_flags`** (the note typed under "Extra care", or `extra_care`) instead of
   eggs/rice/pulses/shellfish (`new/page.tsx:95`); the Pack prints it as-is. Web New also always stores `minutes`. [#90](https://github.com/KNSTNTN24/blueroll-web/issues/90)
9. **Quantities are lost on web save.** Web New/Edit send `Number(qty)`, so "1/2" or "2-3" becomes `NaN` → null;
   mobile and the RPC keep the text. Editing a recipe on the web also drops line `notes`. [#90](https://github.com/KNSTNTN24/blueroll-web/issues/90)
10. **`hot_holding_required` and the `hot_holding` method are separate fields** and disagree on 9 recipes; the Pack uses only the method.
11. **`category` must not be dropped yet** — shipped mobile builds parse it as required (spec 2026-06-11). Web no longer
    writes it; mobile still does ("course"); the menu maps singular/plural (`dishes.ts:40-47`).
12. Ingredient lookup uses `ilike` with the raw name, so `%`/`_` act as wildcards; web Edit uses `.single()`, which
    returns nothing if two rows match and then inserts another duplicate (0 duplicates live today).

## History

- 2026-10-12 `import-recipe` model → `claude-sonnet-4-6` (#47); HACCP Setup/Plan read recipes (`2026-10-12-haccp-setup-v2-design.md`, `2026-10-11-haccp-plan-document-design.md`).
- 2026-08-02 chefs can manage recipes on web, matching mobile and RBAC (#24).
- 2026-07-16 menu dishes become their own entity; recipe optional (`6d073af`).
- 2026-07-14 `recipe_sites` table + backfill (unused since); 2026-07-13 kitchen back to business-level RLS.
- 2026-07-12 `create_recipe_with_ingredients` gated on entitlement (`20260712180400_gate_recipe_rpc.sql`).
- 2026-06-11 tags replace category (`2026-06-11-recipe-tags-design.md`, PR #8); 2026-06-08 multi-image AI import (#7).
- 2026-04 `haccp_methods` (9 methods) and HACCP Pack auto-fill by method (PR #3).
