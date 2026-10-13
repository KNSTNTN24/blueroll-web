# Allergens and dietary labels

> Every dish on a menu resolves to a set of the 14 regulated allergens: either traced live from a recipe's
> ingredients, or declared by hand and signed by a named person. Dietary labels (Vegan, Vegetarian,
> Gluten-Free, Dairy-Free) are declared for hand-made dishes and **guessed from allergens** for recipe dishes.

**Touches:** [Recipe](../entities/recipe.md) (ingredients, overrides) · [Menu](../entities/menu.md) (dishes, matrix) ·
[HACCP Pack](../entities/haccp-pack.md) · [HACCP Plan](../entities/haccp-plan.md) · [Document](../entities/document.md) (`fa_matrix_file`) ·
**Last verified:** 2026-10-13 against `main@3d6f5b6` (web), `haccp-mobile origin/main@2d9a747` and the live DB

## The rule in plain words

```
allergens(dish) = dish.allergen_source = 'recipe'
                    ? ∪ ingredients.allergens over the recipe's lines      -- live, at read time
                    : dish.declared_allergens                              -- what the attester ticked
                  then keep only the 14 canonical keys                     -- web: exact match; mobile: case/synonym-normalised

dietary(dish)   = dish.allergen_source = 'manual'
                    ? dish.dietary                                          -- as ticked
                    : per flag: recipe.<flag>_override ?? rule(allergens(dish))
rule:  Vegan = none of milk, eggs, fish, crustaceans, molluscs · Vegetarian = none of fish, crustaceans, molluscs
       Gluten-Free = no gluten · Dairy-Free = no milk
```

Web: `resolveAllergens` `src/lib/dishes.ts:61-64`, `effectiveDietary` `src/lib/dietary.ts:18-40`, `dishDietary`
`src/app/(dashboard)/menu/page.tsx:24-28`. Mobile: `dishAllergens`/`dishDietary` `lib/features/kitchen/dishes.dart:15-49`.
`may_contain` exists on dishes but nothing writes it. No database rule checks any allergen or dietary value.

## The 14 allergens

Keys are lowercase and stored as `text[]`. Labels and codes from `src/lib/constants.ts:2-13` and
`src/app/(dashboard)/allergens/page.tsx:19-24` (mobile `allergen_grid.dart:6-25` copies both).

| Key | Web label | Code | Mobile `EU_ALLERGENS` | SFBB name (p.20) |
|---|---|---|---|---|
| `gluten` | Gluten | GLU | Gluten | Cereals containing gluten |
| `crustaceans` | Crustaceans | CRU | Crustaceans | Crustaceans |
| `eggs` | Eggs | EGG | Eggs | Eggs |
| `fish` | Fish | FSH | Fish | Fish |
| `peanuts` | Peanuts | PNT | Peanuts | Peanuts |
| `soybeans` | Soybeans | SOY | **Soya** | Soya |
| `milk` | Milk | MLK | Milk | Milk |
| `nuts` | Tree Nuts | NUT | **Nuts** | Nuts (almonds, hazelnuts…) |
| `celery` | Celery | CEL | Celery | Celery |
| `mustard` | Mustard | MUS | Mustard | Mustard |
| `sesame` | Sesame | SES | Sesame | Sesame seeds |
| `sulphites` | Sulphites | SUL | Sulphites | Sulphur dioxide (added, >10 mg/kg) |
| `lupin` | Lupin | LUP | Lupin | Lupin |
| `molluscs` | Molluscs | MOL | Molluscs | Molluscs |

Web order is the column order of every matrix. Mobile's display list (`lib/features/kitchen/dietary.dart:5-20`) is
alphabetical-ish and Title-case; its matrix uses the web order (`allergen_grid.dart:6-9`).

## Where allergens and dietary are stored

| Thing | Column | Read when | Written by |
|---|---|---|---|
| Ingredient | `ingredients.allergens text[] NOT NULL DEFAULT '{}'` | every recipe and recipe-backed dish using it | recipe New/Edit (web, mobile) **overwrite** it; AI import only for new ingredients ([Recipe](../entities/recipe.md#lifecycle)) |
| Recipe | `vegan_override`, `vegetarian_override`, `gluten_free_override`, `dairy_free_override` (bool, null = auto) | dietary of the recipe and its dishes | web Edit only (`DietaryChips`, `src/components/dietary-chips.tsx`); mobile form (`recipe_form.dart:1198`) |
| Dish | `allergen_source` `recipe`\|`manual` (DB `CHECK`, default `recipe`), `recipe_id` (required for `recipe`) | always | Menu → New dish |
| Dish (manual) | `declared_allergens`, `dietary` (`Vegan`/`Vegetarian`/`Gluten-Free`/`Dairy-Free`) | only when `manual` | "Declare by hand" |
| Dish (manual) | `attested_by`, `attested_by_name`, `attested_at` | shown as "Declared by … · date" | DB `CHECK menu_items_attestation_check` requires name + time for `manual` |
| Dish | `may_contain` | Plan matrix ("T"), Menu page | **nothing** — 0 values live |

A recipe has no allergen column: its allergens are always the union of its ingredients (details in [Recipe](../entities/recipe.md)).
Converting a recipe dish to manual (on recipe delete) snapshots allergens, not dietary (`dishes.ts:86-98`; [Menu](../entities/menu.md) Gotcha 3).

## Case and synonyms: web vs mobile

| | Web | Mobile |
|---|---|---|
| Reading | exact match against `EU_ALLERGENS` — anything else is **dropped** (`dishes.ts:54,63`) | `canonicalAllergen` lower-cases, maps `soybeans/soy/soya beans→Soya`, `tree nuts→Nuts`, `peanut→Peanuts` (`dietary.dart:25-43`); matrix uses `webAllergenKey` (`allergen_grid.dart:27-40`) |
| Writing | checkboxes over the 14 keys | lowercase keys (`add_dish_screen.dart:27-30`, `recipe_form.dart:23-26`); Title-case → key via `storageAllergenKey` (`recipe_actions.dart:49-50`) |
| AI import | prompt lists the 14 keys (`import-recipe/index.ts:39-40`); the output is **not validated** — the RPC `create_recipe_with_ingredients` inserts whatever array comes back for new ingredients | same edge function |

So one stored `Milk` is invisible on web (matrix, Pack, Plan) but shown on mobile.

## How dietary labels are derived, and why it is unsafe

- Meat, gelatine and honey are not allergens, so the rule cannot see them: a chicken dish with no fish/milk/egg is
  "Vegan". Live heuristic (ingredient names like chicken/beef/pork/bacon…): of 47 such recipes, 5 still show
  Vegetarian and 2 Vegan; the rest are saved only because someone set overrides (49 `vegetarian_override = false`).
  [#84](https://github.com/KNSTNTN24/blueroll-web/issues/84)
- Gluten-Free and Dairy-Free are **"free from" claims**. SFBB p.71 (`knowledge-sfbb.ts` `sfbb-p71-1`) says a business
  advertising "free from" must ensure no contamination and an environment free from that allergen. Blueroll asserts
  them from the *absence* of a tag, with no cross-contact check. Vegan/Vegetarian are not in SFBB at all — they are
  house labels with no SFBB basis.
- A missing or mis-cased allergen tag (see above) both hides the allergen **and** switches the label on.
- Labels differ by screen: web uses "Gluten-Free"/"Dairy-Free" and shows all four; web New/Import preview repeat the
  rule inline as "Gluten-free"/"Dairy-free" (`recipes/new/page.tsx:52-60`, `recipes/import/page.tsx:82-85`); mobile
  recipe cards print "GF"/"DF" and hide Vegetarian when Vegan (`models/recipe.dart:180-190`); mobile recipe detail uses
  `dietaryFor` (`dietary.dart:60-75`), which hides Dairy-free when Vegan. Five implementations in all ([#105](https://github.com/KNSTNTN24/blueroll-web/issues/105)).

## Allergen matrix and exports

| Output | Rows | Columns | Dietary | May contain | `active` filter |
|---|---|---|---|---|---|
| Web Allergens page (`allergens/page.tsx`) | dishes on the current site; single-site businesses see every dish (`:59`) | 14 codes + per-column count | no | no | **no** |
| Web matrix CSV `allergen-matrix.csv` (`:81-94`) | filtered rows | Dish, Allergen source, 14 labels (`Y`) | no | no | no |
| Web matrix PDF (browser print, `:96`) | same | codes + legend | no | no | no |
| Web Menu CSV / PDF (`menu/page.tsx:149-182`) | dishes | allergens, source; CSV adds dietary | CSV only | no | no |
| Mobile Kitchen → Allergens (`allergen_matrix_tab.dart:75`) | dishes on the active site | 14 codes | — | no | yes |
| Mobile menu CSV/PDF (`utils/menu_export.dart`) | dishes | allergens, dietary | yes | no | — *(unverified)* |
| HACCP Plan matrix (`src/lib/haccp-plan/build.ts:151-156`, `infographics.tsx:161-186`) | active dishes on the plan's site | 14 labels; "T" = may contain | no | yes (always empty) | yes |

## HACCP Pack and Plan

- `menuHasAllergens` (`src/lib/haccp-pack/scope.ts:29-35`): some active dish on the site resolves ≥1 allergen. Then the
  pack's `fa_matrix_file` is a **covered file** — "Your allergen matrix is built from the menu." (`scope.ts:60`).
- `fa_allergens_list` is retired from the pack UI (`scope.ts:26`) but web auto-fill still writes it from **all** dishes,
  unfiltered by site or `active` (`src/lib/haccp-pack/auto-data.ts:167-180`); mobile writes it from
  `declaredAllergens` only, so recipe dishes read "none" (`haccp_autofill_provider.dart:76-85`) and mobile always asks for `fa_matrix_file`.
- The Plan loads dishes in the `haccp-plan` edge function (`supabase/functions/_shared/haccp-plan/load.ts:76`) and prints the matrix above.

## Regulatory frame (only what the knowledge base supports)

| Claim | Source |
|---|---|
| By law you must tell customers if certain allergens are in the food; the list of 14 with examples | SFBB p.19–20 (`sfbb-p19-1`, `sfbb-p20-1`) |
| Food businesses must give **accurate** information on allergenic ingredients in food and drink | SFBB p.70 (`sfbb-p70-1`) |
| Loose food (restaurant meals): if not in writing, clear signposting to where the information is | SFBB p.70 (`sfbb-p70-2`) |
| Since Oct 2021, PPDS food must carry name + full ingredients list with allergens emphasised | SFBB p.70 (`sfbb-p70-1`) — Blueroll does **no** PPDS labelling |
| Update allergen info when the menu or recipes change; "may contain" only after a risk assessment; "free from" needs a free-from environment | SFBB p.71 (`sfbb-p71-1`) |
| Phone/online orders: allergens known before ordering and at delivery | SFBB p.71 (`sfbb-p71-1`, `sfbb-p71-2`) |
| AI assistant summary: tell customers which of the 14 are in every dish, keep it current | `supabase/functions/_shared/knowledge.ts:53-55` |

The regulation names "UK FIC/FIR" and "Natasha's Law" do not appear in either knowledge file *(name unverified there)*;
[Menu](../entities/menu.md) calls the 14 "UK FIR / Natasha's Law", but Natasha's Law is the PPDS rule only.

## Worked example (illustrative, not live data)

**Recipe-backed dish "Carbonara".** Ingredients: *Spaghetti* `['gluten']`, *Egg yolk* `['eggs']`, *Pecorino* `['milk']`,
*Guanciale* `[]`. Dish row: `allergen_source='recipe'`, `recipe_id=<Carbonara>`, `declared_allergens` ignored.
- Matrix: GLU, EGG, MLK ticked (order from `EU_ALLERGENS`). Pack/Plan list "Gluten, Eggs, Milk (Linked to recipe · Carbonara)".
- Dietary: Vegan ✗ (milk, eggs), **Vegetarian ✓** (no fish/shellfish — the pork is invisible), GF ✗, DF ✗. Correct only
  if a chef sets `vegetarian_override = false`.
- Someone ticks `sesame` on *Pecorino* in another recipe → Carbonara gains SES everywhere, at the next read (#89).

**Manual dish "House lemonade".** Name, section, `declared_allergens = ['sulphites']`, `dietary = ['Vegan','Gluten-Free','Dairy-Free']`,
attestation checkbox → `attested_by_name`, `attested_at`. Matrix: SUL; labels exactly as ticked; "Declared by Ana · 3 Oct".
Nothing recomputes it — if the syrup changes, the declaration is stale until the dish is deleted and re-added (no edit, [#91](https://github.com/KNSTNTN24/blueroll-web/issues/91)).
Had mobile-era data stored `'Sulphites'`, web would show no allergen and the Pack scope could flip `fa_matrix_file` back to "needed".

## All copies of the allergen list ([#105](https://github.com/KNSTNTN24/blueroll-web/issues/105))

Web: `src/lib/constants.ts:2-13` (keys, labels), `allergens/page.tsx:19-24` (codes), `import-recipe/index.ts:39-40` (prompt).
Mobile: `features/kitchen/dietary.dart:5-31` (Title-case + synonyms), `allergen_grid.dart:6-30` (keys, codes, labels, synonyms),
`add_dish_screen.dart:27-30`, `recipes/recipe_form.dart:23-26`, `recipes/recipe_import_v2.dart:26-29`,
`widgets/allergen_badge.dart:3-35` (colours, emoji). Dietary rules: web `dietary.ts`, `recipes/new/page.tsx:52-60`,
`recipes/import/page.tsx:82-85`; mobile `models/recipe.dart:164-190`, `kitchen/dietary.dart:60-75`, `kitchen/dishes.dart:32-49`.
Change one, change all — or fix #105 first.

## Where it is enforced

| Layer | What is checked | Location |
|---|---|---|
| Database | `allergen_source` values; recipe dish has `recipe_id`; manual dish has attester name + time; `recipe_id` FK `RESTRICT`. **No check on allergen keys or dietary values.** | `menu_items_*_check` constraints |
| Web UI | known keys only on read; attestation checkbox required | `dishes.ts:54,63`; `menu/page.tsx:455-468` |
| Mobile | case/synonym normalisation on read | `dietary.dart:35-49`, `allergen_grid.dart:34-40` |
| Edge functions | none (AI prompt only asks for the 14) | `import-recipe` |

## Known drift (live data, 2026-10-13)

- `ingredients.allergens`: all 14 keys, all lowercase (0 rows with upper case). `milk` 142, `gluten` 98 … `lupin` 1.
- `menu_items.declared_allergens`: canonical except **`Milk` 1** (on a `recipe` dish, so never read).
- `menu_items.dietary`: `Vegetarian` 8, `vegetarian` 5, `Vegan` 3, `vegan` 2, `gluten_free` 1 on `recipe` dishes (ignored);
  `Vegan` 1 on a manual dish. 115 of 116 manual dishes have no dietary at all.
- `may_contain`: empty on all 166 dishes. Overrides set: vegan 31, vegetarian 51, gluten-free 3, dairy-free 6.

## Gotchas

1. **Meat dishes can be labelled Vegan/Vegetarian** and Gluten-Free/Dairy-Free are claimed from missing tags (#84).
2. **Shared ingredients**: an allergen tick in one recipe changes every recipe and recipe dish using that ingredient, live (#89).
3. **Web silently drops unknown keys** (`Milk`, `soy`); nothing validates keys on write, including AI import (#60, #105).
4. **Mobile recipe detail ignores the Gluten-Free and Dairy-Free overrides.** `dietaryFor` gets only veg/vegan flags and
   recomputes GF/DF from allergens (`dietary.dart:71-73`, called at `recipe_detail_v2.dart:404-408,1323-1327`, also the
   recipe PDF). Live: 1 recipe forced *not* gluten-free and 2 forced *not* dairy-free still show "Gluten-free"/"Dairy-free" there; 1 forced dairy-free shows nothing.
5. **The web matrix and exports ignore `active`**; the Plan and mobile matrix honour it — counts can differ between them.
6. **`may_contain` is unused** although SFBB p.71 expects precautionary labelling to be a deliberate decision; the Plan legend shows "T" that can never appear.
7. **Manual dishes cannot be edited** — a wrong declaration is delete + re-add (#91); recipe→manual conversion drops dietary.
8. **Mobile Pack auto-fill lists declared allergens only** (recipe dishes = "none").

## History

- 2026-10-12 pack takes allergens from the menu; `fa_matrix_file` covered (`ad90c34`, #41).
- 2026-07-16 dishes become first-class with `recipe`/`manual` + attestation (`20260716180000_dishes_model.sql`).
- 2026-06-08 recipe dietary overrides and `src/lib/dietary.ts` (`e9845de`, #5).
