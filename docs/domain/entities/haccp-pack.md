# HACCP Pack (`haccp_pack_data`)

> The kitchen's written food-safety system: the FSA *Safer Food, Better Business* answers ("we wash cloths at 90 °C",
> "our pest-control company is …"), one pack per site, partly typed by the owner and partly filled from Blueroll data.

**Tables:** `haccp_pack_data` (the answers), `haccp_signoffs` (per-site confirmation), `haccp_setup_sessions`
(*Set up my HACCP*), `haccp_plan_shares` (Plan links) · **Scope:** site · **Last verified:** 2026-10-13 against
`main@b50e9d1` and the live DB (9 pack rows, 6 businesses)

## What it is for

An inspector asks "show me your food safety management system". The pack is that system, in SFBB shape: 5 sections,
26 *safe methods*, each a short list of yes/no points, descriptions and supporting documents. Blueroll fills what it
already knows (recipes, menu, suppliers, documents, team, checklists), so the owner answers only the rest; the
**HACCP Plan** is the printable/shareable document built from it.

## Structure

`data` is one jsonb object: `{toggles, texts, files, selects, overrides, sources}`, each keyed by **field id**
(`HaccpPackRow`, `src/app/(dashboard)/haccp-pack/page.tsx:25-35`). Field ids are defined only in code —
`HACCP_METHODS` in `src/lib/haccp-pack/methods.ts:19-195` (mobile copy: `haccp-mobile/lib/features/haccp/haccp_constants.dart`,
same 115 ids). Section ids: `cross`, `cleaning`, `chilling`, `cooking`, `management` (`methods.ts:2`).

| Section (UI) | Methods | Fields | toggle / text / file / select |
|---|---|---|---|
| Cross-contamination (`cross`) | 6 — personal hygiene, cloths, separating foods, food allergies, contamination prevention, pest control | 35 | 21 / 12 / 2 / 0 |
| Cleaning (`cleaning`) | 4 — handwashing, cleaning effectively, clear & clean as you go, cleaning schedule | 15 | 13 / 1 / 1 / 0 |
| Chilling (`chilling`) | 4 — chilled storage, chilling down, defrosting, freezing | 19 | 13 / 5 / 0 / 1 |
| Cooking (`cooking`) | 6 — cooking safely, extra care, reheating, menu checks, hot holding, ready-to-eat | 25 | 16 / 9 / 0 / 0 |
| Management (`management`) | 6 — opening & closing, suppliers, stock control, training, temperature probes, daily diary | 21 | 12 / 5 / 4 / 0 |
| **Total** | **26** | **115** | 75 / 32 / 7 / 1 |

## Parameters

| Field (UI label) | DB column / key | Meaning | Allowed values | Enforced by |
|---|---|---|---|---|
| Site | `site_id` | Whose pack this is. One row per (business, site). | site uuid; null only for a business with no sites | DB `UNIQUE (business_id, site_id)` (`uq_haccp_pack_business_site`), FK `ON DELETE CASCADE`; trigger `trg_site_id_default` fills the caller's home site if null |
| Business | `business_id` | Owner business. | uuid | FK `ON DELETE CASCADE` |
| Yes/no points | `data.toggles` | `{fieldId: true/false}` | boolean | code only |
| Descriptions | `data.texts` | Free text typed by the owner, or written by setup. | string | code only |
| Documents | `data.files` | **Web:** JSON string `{"id","title"}` of a `documents` row (`page.tsx:765-780`). **Mobile:** raw storage path `{business}/{millis}_{name}` (`haccp_file_upload.dart:8-9`). | string | nowhere — Gotcha 1 |
| Choice | `data.selects` | Only `st_check_method` (Digital thermometer / Fridge display / Dial thermometer / Data logger, `methods.ts:133`). | string | code only |
| Manual override | `data.overrides` | `{fieldId: true}` = "the owner edited this; do not show auto-fill and do not let setup overwrite it". Set on any text/file/select edit (`page.tsx:324-350`). | boolean | code only |
| From setup | `data.sources` | `{fieldId: 'questionnaire'}` = value written by *Set up my HACCP*; shows the "From setup" chip (`page.tsx:864,872`) and is removed when the owner edits the field. | `'questionnaire'` only | code only |
| Last saved | `updated_at` | Also the optimistic-lock version for setup (`pack_changed`). | timestamp | `apply_haccp_setup` |
| Auto-fill switch | `businesses.haccp_auto_fill` | Business-wide (not per site) on/off for auto-fill. Toggled on the pack page by anyone (`page.tsx:353-366`). | boolean, default true | — |
| Last reviewed | `businesses.haccp_last_reviewed_at` | Drives the "4-week review" badge (`page.tsx:421-434`). | timestamp | **written by nothing** — Gotcha 6 |

`id` (uuid PK) exists too.

### Known drift (live data, 2026-10-13)

- 9 rows, all with `site_id`; businesses with 3 and 10 sites have only 2 and 3 pack rows (the rest show an empty pack).
- `files`: 8 web `{"id","title"}` values, **3 raw storage paths** (mobile) — [#62](https://github.com/KNSTNTN24/blueroll-web/issues/62).
- `sources`: 260 keys, all `questionnaire`, in 4 rows; 5 rows have no `sources` key at all.
- `businesses.haccp_auto_fill` is `true` for all 84 businesses; `haccp_last_reviewed_at` is null for all 84.

## Auto-fill

`computeAutoData` (`src/lib/haccp-pack/auto-data.ts:62-230`) is pure and **never stored**: the pack page and the Plan
recompute it each time. It yields text for 19 fields (labels `AUTO_SOURCE_LABEL`, `auto-data.ts:41-48`):

| Source | Fields |
|---|---|
| Recipes, by `recipes.haccp_methods` | `ck_dishes` (cooking_safely + method/temp), `rh_items`, `hh_items`, `cd_method`, `fz_method`, `df_method`+`df_products`, `ec_items`, `rte_items`, `mc_items` (any cooking-side method) — `:66-138` |
| Recipe ingredients | `sf_raw_products` (keyword list or fish/crustacean/mollusc allergen) — `:140-165` |
| Menu dishes (fallback: recipe allergens) | `fa_allergens_list` — computed but **retired** from UI and Plan (`scope.ts:26`) |
| Suppliers | `sup_list`, `sf_delivery_schedule` — `:191-201` |
| Documents | `pc_company` (`contract`/`inspection`), `tr_records` (`training`/`certificate`) — `:203-210` |
| Team | `tr_responsible` (owners + managers) — `:212-216` |
| Checklist templates | `st_method` (temperature), `tp_method` (probe/calibration) — `:218-227` |

A text field counts as answered if it has typed text, or if auto-fill is on, the field has `autoSource`, an auto
value exists and it is not overridden (`page.tsx:51-75`). Auto-fill only *displays*; it never writes `texts`.

## Scope rule — what the pack asks for

`scopeFrom` (`src/lib/haccp-pack/scope.ts:37-56`) looks at the site's active dishes, active templates and suppliers;
`packFields` (`:67-69`) drops retired fields and file fields Blueroll already covers (`COVERED_FILE_REASON`, `:59-65`):
`fa_matrix_file` when a menu dish on the site has allergens; `cs_file` when a cleaning checklist exists; `oc_file`
when both opening and closing checks exist; `sup_file` when any supplier exists; `dd_file` **always** ("Blueroll is
your daily diary"). Same rule in the Plan (`src/lib/haccp-plan/build.ts:50`).

## Progress

Web: filled ÷ asked fields of `packFields` per section and total (`computeSectionProgress`/`computeTotalProgress`,
`page.tsx:77-116`); toggles count only when `true`; files when any value is stored. "All sites" on a multi-site
group shows `all-sites-dashboard.tsx` with each site's % (`page.tsx:389-418`). XP (10/20/50/20 per type) is cosmetic.
Mobile computes its own % (`haccp-mobile/lib/models/haccp.dart:88-125`) **without** the scope rule — Gotcha 4.

## Set up my HACCP

A guided questionnaire (`/haccp-setup`, `src/lib/haccp-setup/`) for owners/managers (`isManager`, `page.tsx:557`).
Session state lives in `haccp_setup_sessions` (`answers`, `status` ∈ `in_progress`/`applied`/`abandoned` — DB `CHECK`;
live: 6 applied, 3 in progress, 8 abandoned). The draft (`draft-pack.ts:29-81`) proposes values; fields with
`overrides` are "manual" and never overwritten; `mergePack` writes accepted values and marks them
`sources = 'questionnaire'`. "In your own words" questions send the owner's text to `haccp-assistant`
`action: draft_method` (6 methods: `pc_company`, `cd_method`, `df_method`, `fz_method`, `tp_method`, `tr_records` —
`supabase/functions/_shared/draft-method.ts`) and the draft lands in that text field (`own-words.ts`). RPC
`apply_haccp_setup` (security invoker, manager only) creates checklists and upserts the pack in one transaction,
failing with `pack_changed` if `updated_at` moved since the draft. Specs: `2026-10-05-haccp-setup-questionnaire-design.md`,
`2026-10-12-haccp-setup-v2-design.md`.

## HACCP Plan

`/haccp-pack/document` renders the Plan: `buildPlan` (`src/lib/haccp-plan/build.ts`) over a bundle loaded by edge
function `haccp-plan` (`supabase/functions/_shared/haccp-plan/load.ts`, service role). Manual text wins, then
auto-fill (`build.ts:37-45`). The Plan only lists documents with access `all` and current members (`scope.ts`).
PDF via `/api/haccp-plan/pdf` with a 15-minute `pdf` token; inspector links up to 30 days, owner/manager only, revocable;
only `sha256(token)` is stored in `haccp_plan_shares` (`20261012120000_haccp_plan_shares.sql`). Sign-off: one row
per site in `haccp_signoffs` (live RLS: member of the business who can see the site, plus restrictive
`is_active_business_manager` for writes). Spec: `2026-10-11-haccp-plan-document-design.md`.

## Who can do what

| Action | Rule | Enforced in |
|---|---|---|
| See / edit / delete a pack | any member of the business (`profiles.business_id`), any site; writes need an entitled business | RLS `Users can … own business haccp data`, restrictive `entitlement_write_gate_ins/upd`; `demo_read` for the demo business |
| Run setup / apply | owner or manager | RLS on `haccp_setup_sessions` (`is_business_manager`), `apply_haccp_setup` |
| Sign off a site | owner/manager (UI by tier text, `site-signoff.tsx:38`; DB `is_active_business_manager`) | RLS `haccp_signoffs_*` |
| Inspector link | owner/manager; PDF token any member | RLS `haccp_plan_shares_insert` |

## Related

- [Document](document.md) — file fields point at documents; documents feed `pc_company`/`tr_records`.
- [Checklist template](checklist-template.md) — drives the scope rule and `st_method`/`tp_method`; setup creates templates.
- [Site](site.md), [Business](business.md), [Roles and capabilities](../concepts/roles-and-capabilities.md),
  [Subscription and entitlement](../concepts/subscription-and-entitlement.md). Planned: Recipe (`haccp_methods`), Menu.

## Where in code

| Area | Location |
|---|---|
| Web pages | `src/app/(dashboard)/haccp-pack/` (`page.tsx`, `all-sites-dashboard.tsx`, `setup-hero.tsx`, `site-signoff.tsx`, `document/`), `src/app/(dashboard)/haccp-setup/`, `src/app/plan/[token]/` |
| Shared logic | `src/lib/haccp-pack/{methods,auto-data,scope}.ts`, `src/lib/haccp-setup/`, `src/lib/haccp-plan/` |
| Mobile | `haccp-mobile/lib/providers/haccp_provider.dart`, `providers/haccp_autofill_provider.dart`, `models/haccp.dart`, `features/haccp/` |
| Edge functions | `haccp-plan`, `haccp-assistant` |
| DB objects | `haccp_pack_data`, `haccp_signoffs`, `haccp_setup_sessions`, `haccp_plan_shares`, `apply_haccp_setup`, `set_site_id_default` |

## Gotchas

1. **Web and mobile file values are incompatible.** Web stores `{"id","title"}`, mobile a raw storage path; web's
   `parseFileRef` treats a path as empty, mobile shows the JSON as a file name. Mobile uploads never become documents. [#62](https://github.com/KNSTNTN24/blueroll-web/issues/62)
2. **Mobile wipes "From setup".** Mobile's `HaccpPackRow` has no `sources` and `toData()` writes only five keys
   (`models/haccp.dart:47-53`); any mobile save upserts the whole `data` and drops every `sources` mark for that site.
3. **Setup answers hidden by auto-fill on the pack page.** Setup writes `texts` without `overrides`; the page shows the
   auto value whenever one exists (`showAuto`, `page.tsx:819`), while the Plan prefers the text (`build.ts:39-40`).
   Hits own-words targets that also auto-fill (`pc_company`, `cd_method`, `df_method`, `fz_method`, `tp_method`, `tr_records`).
4. **Mobile ignores `haccp_auto_fill` and the scope rule**; its auto-fill uses only recipes, dishes and suppliers
   (`haccp_autofill_provider.dart:104-109`), and it still asks `fa_allergens_list` and covered files — mobile % ≠ web %.
5. **"Revert to auto-fill" does not revert.** It calls `updateField(id,'text','')`, which sets `overrides[id] = true`
   again (`page.tsx:913-923`, `:331-333`); the field stays empty and auto-fill stays hidden.
6. **"Never reviewed" for everyone.** Nothing writes `businesses.haccp_last_reviewed_at`, so the 4-week review badge
   is always overdue. [#76](https://github.com/KNSTNTN24/blueroll-web/issues/76)
7. **Any member, any site, can edit or delete any pack** — RLS checks only business membership; no capability, no
   `can_see_site_row`, and the pack page has no edit gate. Same for the business-wide `haccp_auto_fill` switch.
8. **Auto-fill ignores the site** for recipes, suppliers, documents and team (business-wide queries, `page.tsx:186-270`);
   the pack page's team query includes removed members, the Plan's does not (`load.ts:81`).
9. **Per-site migration did not seed sibling sites.** `20260712100000` had already moved each business-level row to
   the oldest site, so `20260731180000`'s copy step (`where site_id is null`) found nothing; other sites started empty
   *(effect on live inferred from row counts)*. The `20260713101000` "group-wide" note is obsolete.
10. Sign-off is never invalidated when the pack changes; web `site-signoff.tsx` inserts (one-shot), Plan/mobile upsert.

## History

- 2026-10-12 setup v2 (own words, documents step), Plan shares, `apply_haccp_setup` pack-check fix (`20261012130000`).
- 2026-10-11 HACCP Plan document; 2026-10-06 *Set up my HACCP* (`20261006120000_haccp_setup.sql`).
- 2026-07-31 packs per site (`20260731180000_haccp_pack_per_site.sql`); 2026-07-13 RLS back to business-wide.
- 2026-07-12 entitlement write gate; site backfill. 2026-07-07 `site_id` column, `haccp_signoffs`.
- 2026-04 PR #3/#4: auto-fill by `recipes.haccp_methods`, document picker for file fields.
