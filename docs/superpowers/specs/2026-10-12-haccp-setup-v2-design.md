# Set up my HACCP v2: one entry point, full coverage, SFBB context, AI drafting

**Date:** 2026-10-12 · **Branch:** `KNS/haccp-setup-v2`
**Design:** `docs/design/haccp-setup/*.dc.html` (Claude Design canvas https://claude.ai/artifact/NdAKXhguZfrEdvT5bQv9XW)
**Builds on:** `2026-10-05-haccp-setup-questionnaire-design.md` and `2026-10-11-haccp-plan-document-design.md`

## Problem

- **Two entry points look like two tools:** the pack page's "Set up with questions" and the sidebar's "Set up my HACCP". Both open `/haccp-setup`.
- **The questionnaire covers only 73 of the pack's 119 fields.** The rest have to be found and filled by hand in the pack form.
- **The questions have no context.** Each one is a bare line with "Why we ask". None of the SFBB copy and infographics we built for the HACCP Plan are used, and nothing shows what an answer turns into.
- **The assistant is a separate free-text box** at the bottom of the page, cut off from the current question.

## Goals

1. **One entry point.**
   - The HACCP Pack page gets a prominent "Set up my HACCP" panel (managers) with progress and "Continue — N% done".
   - The sidebar item goes away. The ⌘K entry stays but is shown to managers only.
   - The pack form is reframed as "Edit the pack by hand".
2. **Every pack field is covered** in one of four ways:
   - **Ask:** new yes/no and choice questions for toggle and select gaps.
   - **From Blueroll:** confirm what menu, recipes, suppliers, team and checklists already provide (auto-fill). This is a confirm step, not a retype.
   - **Own words → AI:** free-text methods such as cooling, defrosting, freezing, probe calibration, training records and pest control. The assistant drafts the plan text and the matching ticks. This is **Phase B**.
   - **Documents:** ask only for files Blueroll cannot build. Covered files become "not needed", using the same scope rule as allergens (#41).
3. **SFBB context on every question.**
   - A method card: kicker "Safe method 3.1 · Chilling", Safety point and Why from `METHOD_COPY`.
   - "Show example", which reveals the method's infographic (TempScale, CookCombos, PanToPass, TwoStageClean) and an "In your HACCP Plan" preview of the plan text this answer produces.
   - A "This fills in" side panel listing the pack points the question sets and the checklists it switches on.
4. **The assistant sits beside each question.** "Ask about this question" has 2–3 suggested questions per method and keeps the same edge function, limits and sources.
5. **Look and feel matches the design:**
   - a step rail with section icons and per-step progress;
   - large radio and checkbox option cards with a sub-line;
   - one question at a time, with an editable answered list collapsed above it;
   - a review screen showing composition bars (from answers / from Blueroll / open) and a checklist toggle list;
   - a working phone layout.

## Non-goals

- **Voice input.**
- **Changing `apply_haccp_setup` semantics.** Exception: the `pack_changed` false positive is fixed when the pack is null (a small migration).
- **Mobile app changes.** Its "Set up with questions (web)" link keeps working because the route is unchanged.

## Phases

- **Phase A (this plan):** one entry point, the step rail, the context card with example, the "This fills in" panel, the contextual assistant, new simple questions, the "From Blueroll" confirm steps, the Documents step and file-scope rules, the new review.
- **Phase B (separate plan):** the AI "own words → plan text" edge function action `draft_method`, its UI, and an eval set.

## Data model changes (Phase A)

- **`Question` gains:**
  - `method: string` (a pack method id; drives the context card and examples);
  - `fills: string[]` (pack field ids the question can set; drives "This fills in");
  - `hint?: string` per option (the option sub-line).
- **New answer kinds:**
  - `confirm_data` with `source: 'suppliers' | 'raw_products' | 'menu_dishes' | 'team' | 'recipes_cooking' | 'checklists'`. Its answer is `true` (confirmed) or the string `'missing'`, and links to the source page.
  - `documents`, whose answer is `Record<fileFieldId, fileRefJSON>`. It is written to `pack.files` by the draft.
- **Tabs:** `TAB_ORDER` becomes `profile, cross, cleaning, chilling, cooking, management, documents`, then Review.
- **Scope rule** (`src/lib/haccp-pack/scope.ts`, extended): a file field is "covered" (not asked, not counted) when:
  - `fa_matrix_file`: the menu has allergens (existing rule);
  - `cs_file`: the site has an active cleaning checklist;
  - `oc_file`: the site has active opening and closing checklists;
  - `sup_file`: the business has at least 1 supplier;
  - `dd_file`: always (Blueroll is the diary).

  `PackScope` grows `{ hasCleaningChecklist, hasOpeningClosing, hasSuppliers }`. The pack page, the HACCP Plan (`buildPlan`, bundle) and setup all use it.

## New questions (Phase A)

| id | method | kind | fills | showIf |
|---|---|---|---|---|
| `cloth_habits` | cloths | multi: colour_coded, sanitiser_between | cl_colour_coded, cl_stored | – |
| `handwash_signs` | handwashing | yes_no | hw_signs | – |
| `two_stage_clean` | cleaning_effectively | yes_no | ce_2stage | – |
| `fridge_check_method` | chilled_storage | single: probe / display / dial / logger → select | st_check_method | – |
| `fridge_checks_recorded` | chilled_storage | yes_no | st_temp, st_records | – |
| `cool_90` | chilling_down | yes_no | cd_90min | processes has cool_cooked |
| `no_refreeze` | defrosting | yes_no | df_not_refreeze | processes has defrost |
| `freezer_minus18` | freezing | yes_no | fz_temp, fz_suitable | equipment has freezer |
| `cook_checks` | cooking_safely | multi: core_75, visual | ck_75c, ck_visual | processes has cook_hot |
| `hot_hold_rules` | hot_holding | multi: above_63, max_2h | hh_63c, hh_2hr | processes has hot_hold |
| `reheat_75` | reheating | yes_no | rh_75c | processes has reheat |
| `probe_clean` | temperature_probes | yes_no | tp_sanitised | equipment has probe |

Confirm-data steps (one per source, placed in the matching section):

| step | source | covers (auto-fill fields) |
|---|---|---|
| `confirm_raw_products` | raw products from recipe ingredients | sf_raw_products |
| `confirm_menu_methods` | recipes by HACCP method | ck_dishes, rh_items, hh_items, mc_items, ec_items, rte_items, df_products, cd_method, fz_method, df_method |
| `confirm_suppliers` | suppliers | sup_list, sf_delivery_schedule |
| `confirm_team` | owners/managers | tr_responsible |
| `confirm_checklists` | temperature/probe checklists | st_method, tp_method |

`tr_records` and `pc_company` come from documents (auto) and are confirmed in the Documents step. The confirm steps are shown only when the source has data. When it has none, the related text fields stay open and Phase B covers them.

## Review

- Composition per section: filled from answers, from Blueroll (auto), still open. Computed with `buildPlan`-compatible counting over `packFields(scope)` with the draft merged.
- The checklist list keeps the existing select/deselect (`defaultSelection`).
- Open points: up to 6, "+N more".
- Apply: the same RPC. After Apply: "Open your HACCP Plan" (`/haccp-pack/document`) and "Switch on checklists".

## Errors and edges

- **Assistant down or limit reached:** the side panel shows the existing messages and the question flow is unaffected.
- **Session from questionnaire v1:** it keeps its answers. New questions appear as unanswered, `QUESTIONNAIRE_VERSION` becomes 2, and old sessions continue.
- **No site selected:** the existing site picker.
- **Non-managers:** they never see the CTA. The route shows the existing notice.

## Testing

- **vitest:**
  - content: every new `method` exists; every `fills` id exists; every FIELD_RULES field is in some question's `fills`; the new questions map correctly;
  - engine: tab order with documents;
  - scope: the new file rules;
  - the draft writes documents into `files` and select values into `selects`;
  - review composition maths;
  - golden snapshot updated deliberately.
- **Visual:** dev preview pages for the setup step components against the canvas, desktop and 375 px.
- **Manual:** the run-through needs a logged-in manager. The user does it on prod after deploy, or on a preview with their account.
