# SFBB structure and how Blueroll maps onto it

> The FSA *Safer food, better business* (SFBB) pack has five sections of **safe methods** plus a **diary** with daily
> opening/closing checks and a **4-weekly review**; Blueroll's HACCP Pack, checklists, Diary and HACCP Plan each stand
> in for one of those parts, keyed by the same five section ids.

**Touches:** [HACCP Pack](../entities/haccp-pack.md), [HACCP Plan](../entities/haccp-plan.md),
[Checklist template](../entities/checklist-template.md), [Checklist completion](../entities/checklist-completion.md),
[Recipe](../entities/recipe.md), [Setup session](../entities/setup-session.md) ·
**Last verified:** 2026-10-13 against `main@3d6f5b6` and the live DB

Food-safety facts below cite the SFBB page as chunked in `supabase/functions/_shared/knowledge-sfbb.ts` (generated from
the FSA *Safer food, better business for caterers* PDF, OGL v3.0). Anything else is marked *house policy*, *Scottish* or
*not in the pack text*. Vocabulary: [glossary.md](../glossary.md) (Food-safety terms).

## The rule in plain words

| SFBB part | What it is (SFBB) | Where it lives in Blueroll |
|---|---|---|
| **Safe methods** (5 sections) | Sheets the business completes *before* trading and reviews when operations change (p.2, `knowledge-sfbb.ts:13`). | **HACCP Pack** — one per site, 26 methods, 115 fields (`src/lib/haccp-pack/methods.ts:19-274`); filled by hand, by *Set up my HACCP*, and shown with auto-fill. |
| Safe-method columns: *Safety point · Why? · How do you do this? · Check it · What to do if things go wrong · How to stop this happening again* | p.4 (`knowledge-sfbb.ts:15`). *Prove it* boxes appear inside several methods (p.41, p.51, p.61). | Pack fields = *How do you do this?*. Plan method page = static *Safety point / Why?* (`METHOD_COPY`), *What we do* (pack answers), *Prove it* (checklist records). *Check it* / *What to do if things go wrong* have no field — corrective actions live on checklist items. |
| **Diary** | Filled daily by the person running the business; tick opening and closing checks, note anything that went wrong, sign that safe methods were followed (p.5, p.81). | **Checklist completions** + incidents, shown on web `/diary` (`src/app/(dashboard)/diary/page.tsx:40-102`) and mobile `DiaryScreen` (`lib/screens/diary/diary_screen.dart:55`). Pack field `dd_file` is always "covered" (`scope.ts`). `diary_entries` is a dead table (4 rows). |
| **Opening / closing checks** | Daily start/end-of-day lists (p.66, p.82). | Library checklists `opening_checks`, `closing_checks` (`src/lib/haccp-setup/content/checklists.ts:22-45`) and seeded *Daily Opening Checks* / *End of Day Closing* (`seed_default_checklists`). |
| **Extra checks** | Less-than-daily checks (deep clean, maintenance) noted in the diary (p.67). | Weekly/monthly templates (e.g. `weekly_deep_clean`, `probe_calibration`). No dedicated concept. |
| **Prove it** | Use a disinfected probe to show a method works; record on the *Prove it: records* sheet (p.68-69, p.93). | Plan *Prove it* panel per method (`src/lib/haccp-plan/proof-map.ts`); `temperature_probes` pack method. |
| **4-weekly review** | Walk the kitchen, look back over 4 weeks of diary, act on anything that went wrong 3+ times; required even with no problems (p.81, p.99). | A `four_weekly` checklist: library `haccp_review` (`checklists.ts:124-129`) or the seeded *4-Weekly HACCP Review* (58 live). Its last completion drives the Plan's next review (`load.ts:117`, `build.ts:123-126`). `four_weekly_reviews` table: 0 rows. |
| **Safe method completion record** | Tick sheet for the methods relevant to you (p.78). | Pack progress % and per-site sign-off ([HACCP Pack](../entities/haccp-pack.md#progress)). |

**Who it is for.** SFBB is for small caterers (restaurants, cafés, takeaways) (p.2). The pack itself says chilled food at
8 °C or below is "a legal requirement in England, Wales and Northern Ireland, and recommended in Scotland" (p.41, p.68).
Scotland's own equivalent (CookSafe, Food Standards Scotland) is **not in Blueroll's knowledge files** *(unverified)*; the
app only knows Scotland via the 82 °C reheat rule and a postcode list (`src/lib/haccp-setup/geo.ts:1`).

## Section ids

| SFBB section (p.) | Pack / Plan `SectionId` (`methods.ts:2`, `copy.ts:4-7`) | `checklist_templates.sfbb_section` live (2026-10-13) |
|---|---|---|
| Cross-contamination (p.12-26) | `cross` | `cross` 8 (all library) · **`cross_contamination` 38** (mobile seed *Cross-contamination & Hygiene*) |
| Cleaning (p.28-37) | `cleaning` | `cleaning` 244 (incl. seeded opening/closing checks) |
| Chilling (p.39-47) | `chilling` | `chilling` 211 (incl. `delivery_check`, `bakery_display`) |
| Cooking (p.49-63) | `cooking` | `cooking` 92 |
| Management (p.65-78) | `management` | `management` 71 |
| — (library only) | — | `temperature` 1 (`fridge_temps`), `probes` 2 (`probe_calibration`) — `ChecklistSection` adds them (`src/lib/haccp-setup/types.ts:58`) |
| — (drift) | — | **`general` 38**, **`training` 7**, `NULL` 726 |

No `CHECK` on `sfbb_section` (live: only `frequency` and `min_per_day` checks). Mobile's `SfbbSection` enum is
`cross_contamination, cleaning, chilling, cooking, management, training, general` and maps anything unknown —
including `cross`, `temperature`, `probes` — to `general` (`haccp-mobile lib/models/checklist.dart:94-127`). [#60](https://github.com/KNSTNTN24/blueroll-web/issues/60)

## The 26 pack safe methods

From `HACCP_METHODS` (`src/lib/haccp-pack/methods.ts:19-274`); field counts in brackets. Plan refs "s.m" follow this
order (`copy.ts:42-48`).

| Section | Methods (fields) | SFBB methods with no pack method |
|---|---|---|
| `cross` (35) | personal_hygiene (8), cloths (5), separating_foods (6), food_allergies (6), contamination_prevention (5) = *Physical and chemical contamination*, pest_control (5) | Maintenance (p.25-26) |
| `cleaning` (15) | handwashing (5), cleaning_effectively (4), clear_clean (4), cleaning_schedule (2) | — |
| `chilling` (19) | chilled_storage (6), chilling_down (4), defrosting (5), freezing (4) | — |
| `cooking` (25) | cooking_safely (4), extra_care (6), reheating (5), menu_checks (2) = *Checking your menu*, hot_holding (4), ready_to_eat (4) | Acrylamide (p.56-57) |
| `management` (21) | opening_closing (4), suppliers (3), stock_control (4), training (4), temperature_probes (4) ≈ *Prove it*, daily_diary (2) — *a diary, not an SFBB safe method* | Extra checks (p.67), Managing food allergen information (p.70-72, partly in `food_allergies`), Customers (p.74), Product withdrawal and recall (p.77) |

Mobile copy: `haccp-mobile lib/features/haccp/haccp_constants.dart` (same section ids `:28-32`, same 115 field ids). [#104](https://github.com/KNSTNTN24/blueroll-web/issues/104)

**Recipe HACCP methods.** `HACCP_RECIPE_METHODS` (`src/lib/haccp-methods.ts:14-72`) is a 9-id subset of the 26, same ids,
so auto-fill can filter recipes per pack method without a mapping (`auto-data.ts:66-138`): Chilling — `chilled_storage`,
`chilling_down`, `defrosting`, `freezing`; Cooking — `cooking_safely`, `extra_care`, `reheating`, `hot_holding`,
`ready_to_eat`. Section is a display string (`'Chilling' | 'Cooking'`), not a `SectionId`. `menu_checks.mc_items` is
filled from *any* cooking-side recipe method. Mobile copy `features/kitchen/recipe_haccp.dart:10-18`. See [Recipe](../entities/recipe.md).

**Plan copy and infographics.** `METHOD_COPY` (`src/lib/haccp-plan/copy.ts:12-39`) holds a static *Safety point* and *Why?*
for all 26 ("adapted from" SFBB, OGL attribution `copy.ts:8-9`) and the infographics per method: `allergenMatrix`
(food_allergies), `twoStageClean` (cleaning_effectively), `cleaningFrequency` (cleaning_schedule), `tempScale`
(chilled_storage), `cookCombos` + `panToPass` (cooking_safely), `panToPass` (hot_holding). Rendered in
`src/components/haccp-plan/MethodPage.tsx:97-129` and in setup (`haccp-setup/method-context.tsx:19-21`).

## Which checklists prove which method (Prove it)

`proofForMethod` (`src/lib/haccp-plan/proof-map.ts:11-32`) matches a template if its `library_key` is listed, **or** its
`sfbb_section` is listed, **or** its name matches the regex:

| Pack method | Library keys | `sfbb_section` | Name regex |
|---|---|---|---|
| chilled_storage | `fridge_temps` | `temperature` | fridge\|freezer\|chiller |
| freezing | `fridge_temps` | `temperature` | freezer |
| chilling_down / defrosting | `cooling` / `defrosting` | — | cool / defrost |
| cooking_safely / reheating / hot_holding | `cooking_temps` / `reheating` / `hot_holding` | — | cook / reheat / hot.?hold |
| cleaning_effectively, cleaning_schedule | `dishwasher`, `weekly_deep_clean` | `cleaning` | clean\|dishwasher |
| clear_clean | `weekly_deep_clean` | `cleaning` | clean |
| food_allergies | `allergen_check` | — | allergen |
| pest_control | `pest_check_in_house`, `pest_contractor_visit` | — | pest |
| opening_closing | `opening_checks`, `closing_checks` | — | opening\|closing |
| temperature_probes | `probe_calibration` | `probes` | probe\|calibrat |
| suppliers, stock_control | deliveries table, not templates | | |
| daily_diary | every template | | |

The other 9 methods (personal_hygiene, cloths, separating_foods, contamination_prevention, handwashing, extra_care,
menu_checks, ready_to_eat, training) have no rule and never show *Prove it*.

## Key temperatures

| Rule | SFBB (page) | Blueroll copies that disagree |
|---|---|---|
| Chilled food | **8 °C or below** — legal in E/W/NI, recommended in Scotland; fridges **set at 5 °C or below** recommended (p.41, p.68) | 0–5 °C ranges are house policy: `thresholds.ts:3`, pack `st_temp` (`methods.ts:128`), recipe text (`haccp-methods.ts:20`); web onboarding fridge 1–5 [#102](https://github.com/KNSTNTN24/blueroll-web/issues/102). `METHOD_COPY` chilled_storage is right. |
| Chilled display | Out of chilling **once, up to 4 h**, then bin (p.41) | not modelled |
| Frozen | **−18 °C or below** (p.68, Freezing p.46-47) | min −30 (`thresholds.ts:4`) / −23 (web onboarding) are house policy [#102](https://github.com/KNSTNTN24/blueroll-web/issues/102) |
| Cooking | Steaming hot; probe combos **75 °C 30 s**, 80 °C 6 s, 70 °C 2 min, 65 °C 10 min, 60 °C 45 min (p.51) | "75 °C for 2 seconds": `haccp-methods.ts:46`, mobile `recipe_haccp.dart:14`, `ai-generate-checklist/index.ts:33` [#101](https://github.com/KNSTNTN24/blueroll-web/issues/101). `CookCombos` (`infographics.tsx:35-40`) is right. |
| Hot holding | **63 °C or above** (legal, p.68; p.61); displayed below 63 °C **once, up to 2 h**, then reheat once / chill / bin (p.60) | Pack toggle `hh_2hr` "Food not held hot for more than 2 hours" (`methods.ts:208`, mobile `haccp_constants.dart:170`) and recipe "≥63 °C, max 2 hours" (`haccp-methods.ts:64`) misstate it [#101](https://github.com/KNSTNTN24/blueroll-web/issues/101). "Check every 2 hours" (`checklists.ts:73`, `infographics.tsx:70`) is house policy. |
| Reheating | Safe centre temperature (the cooking combos), once; probe several spots in microwaved food (p.54-55) | A standalone **75 °C** is not in the pack text (app choice: `thresholds.ts:7`, `rh_75c`). **82 °C in Scotland** is Scottish law, *not SFBB* (`thresholds.ts:8`, `knowledge.ts:43`). |
| Chilling down | "As quickly as possible", then fridge (p.42-43) | **"below 8 °C within 90 minutes" is not SFBB**: `thresholds.ts:9`, `knowledge.ts:46`, `copy.ts:24`, `checklists.ts:77`, setup `cool_90`; pack `cd_90min` says "to room temp within 90 minutes" (`methods.ts:139`) — a third variant. |
| Deliveries | Check stock was "kept cold enough" on arrival (p.75-76) | 5 °C chilled / **−15 °C frozen reject** are house policy, *not SFBB* (`thresholds.ts:10-11`, `knowledge.ts:73`, `proof-map.ts:42`); mobile badge 8 °C [#102](https://github.com/KNSTNTN24/blueroll-web/issues/102) |
| Probe check | −1 to 1 °C iced, 99 to 101 °C boiling, e.g. monthly (p.69) | matches `thresholds.ts:13-14` |
| Dishwasher rinse | not in the pack text | 82 °C (`thresholds.ts:12`, `checklists.ts:95`) house policy |

## Where it is enforced

| Layer | What is checked | Location |
|---|---|---|
| Database | Nothing SFBB-specific: no `CHECK` on `sfbb_section`; pack `data` is free jsonb; `frequency` CHECK allows `four_weekly`. | `checklist_templates_frequency_check`; `haccp_pack_data` |
| Web UI | Section/method/field lists, scope rule, progress, Plan layout. Web template editor never writes `sfbb_section`. | `methods.ts`, `scope.ts`, `copy.ts`, `proof-map.ts` |
| Mobile | Own copy of sections/methods/fields and recipe methods; template editor writes its own section enum. | `haccp_constants.dart`, `recipe_haccp.dart`, `models/checklist.dart:94-127` |
| Edge functions | Plan bundle (finds the review checklist by key or name); assistant knowledge. | `_shared/haccp-plan/load.ts:117`, `_shared/knowledge*.ts` |

## Gotchas

1. **Two section vocabularies.** Web/setup write `cross`; mobile writes `cross_contamination` and turns `cross`,
   `temperature`, `probes` into `general` on edit, so a library template edited on mobile loses its *Prove it* section
   match and `st_method`/`tp_method` auto-fill (`auto-data.ts:220-224`) falls back to name matching. [#60](https://github.com/KNSTNTN24/blueroll-web/issues/60)
2. **Seeded opening/closing checks are filed under `cleaning`**, not Management where SFBB puts them (p.66); they count
   as cleaning proof (`proof-map.ts:19-21`, `build.ts:159`, `scope.ts:47`) as well as opening/closing proof (by name).
3. **Non-SFBB numbers are labelled as SFBB.** The curated assistant notes cite `SFBB(...)` as source for 90-minute
   cooling (`knowledge.ts:44-46`), 82 °C Scotland (`:41-43`) and −15 °C frozen delivery (`:71-73`); `thresholds.ts:1` calls
   itself "FSA SFBB temperatures" but holds house values. [#101](https://github.com/KNSTNTN24/blueroll-web/issues/101), [#102](https://github.com/KNSTNTN24/blueroll-web/issues/102), [#109](https://github.com/KNSTNTN24/blueroll-web/issues/109)
4. **The pack is not the whole of SFBB.** No Maintenance, Acrylamide, Extra checks, Customers or Product recall method;
   `daily_diary` is a pack "method" SFBB does not have. An inspector comparing against p.78 will see gaps.
5. **The 4-weekly review is thinner than SFBB's.** `haccp_review` has 6 items (`checklists.ts:127-129`); SFBB p.99 also asks
   about allergen info, probe calibration, complaints, extra checks and Prove-it records. The pack page's "4-week review"
   badge reads `haccp_last_reviewed_at`, which nothing writes ([#76](https://github.com/KNSTNTN24/blueroll-web/issues/76)); only the Plan uses the checklist.
6. **Section-wide proof is greedy.** Any `cleaning` template (244 live) proves three cleaning methods; a "Daily
   Temperature Log" filed as `general` proves nothing for chilled storage (regex needs fridge/freezer/chiller).
7. **SFBB content is hand-copied** web ↔ mobile (115 fields, 9 recipe methods) and repeated in prompts and setup mapping. [#104](https://github.com/KNSTNTN24/blueroll-web/issues/104)

## History

- 2026-10-11 PR #37 HACCP Plan: `METHOD_COPY`, infographics, *Prove it* map (`2026-10-11-haccp-plan-document-design.md`).
- 2026-10-06 PR #32 *Set up my HACCP*: checklist library (`temperature`/`probes` sections), `knowledge-sfbb.ts` generated from the FSA PDF
  (`2026-10-05-haccp-setup-questionnaire-design.md`; v2 `2026-10-12-haccp-setup-v2-design.md`).
- 2026-04-09 PR #2: `recipes.haccp_methods` and `src/lib/haccp-methods.ts` (9 methods) drive pack auto-fill.
