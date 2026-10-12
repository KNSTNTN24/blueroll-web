# Set up my HACCP v2 — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Set up my HACCP" the single, complete way to fill the HACCP pack:
- one entry point on the pack page;
- every pack field covered by a question, a confirm-from-Blueroll step or the documents step;
- every question shown with SFBB context, an example and what it fills in;
- the assistant beside each question.

**Architecture:** extend the existing questionnaire engine (pure TS in `src/lib/haccp-setup`):
- question metadata: `method`, `fills`, option `hint`;
- two new answer kinds: `confirm_data` and `documents`;
- a data-availability condition, plus a documents tab.

Rebuild the `/haccp-setup` UI to match the Claude Design canvas, reusing `METHOD_COPY` and the plan infographics. Extend the shared pack scope rule so covered files stop counting everywhere. The AI "own words" drafting is Phase B, in a separate plan.

**Tech Stack:** Next.js 16 client pages, TanStack Query, Supabase, vitest, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-12-haccp-setup-v2-design.md`
**Design reference:** `docs/design/haccp-setup/*.dc.html`

## Global Constraints

- Colours and type are the same as the HACCP Plan:
  - Geist; brand `#1f9d63`, deep `#1f7a52`, tint `#e9f4ee`; ink `#16181d`, body `#3b3f47`, muted `#5f6670`;
  - hairline `#e9eaed`, input border `#e2e4e8`, canvas `#f6f7f8`;
  - amber text `#8a5a0c` on `#fbf1e1`.
- Option cards: min-height 64 px (60 on phone); radio or checkbox with `accent-color: #1f9d63`; selected border `#1f9d63` on `#f3faf6`.
- Touch targets ≥ 44 px.
- `QUESTIONNAIRE_VERSION = 2`. Sessions from version 1 keep their answers.
- Copy is UK English; temperatures are written `75 °C`.
- Read `node_modules/next/dist/docs/` before Next-specific code.
- Gates for every task: `npm test`, `npx tsc --noEmit` (baseline 3 errors, add none) and eslint on touched files.
- Prod actions (migration, deploy, push, PR, merge) need the user's go-ahead. The user has approved the "push → PR → merge → verify" flow for this project; the migration still needs an explicit yes.

## Review Focus

1. A v1 session reopened after deploy must keep its answers and land on the first new question. Pin it in Task 3's engine test with v1-style answers.
2. A business with no suppliers, recipes or team data must not see empty confirm steps; the related fields stay open. Pin it in Task 3's test (data flags false hide the confirm questions).
3. A pack edited by hand after setup must not be overwritten when setup re-applies (`classifyField` "manual" and "kept"), including selects and files. Pin it in Task 2's draft-pack test for `st_check_method` and a file ref.
4. Toggling covered-file scope (for example, the last cleaning checklist is deleted) must make `cs_file` reappear as open in the pack, the plan and setup. Pin it in Task 1's scope test.
5. On a phone (375 px) the step rail collapses to section chips, and option cards, the context card and the side panels stack with no horizontal scroll. Check manually in Task 7.

---

### Task 1: Extend the pack scope rule for covered documents

**Files:**
- Modify: `src/lib/haccp-pack/scope.ts`, `src/lib/haccp-pack/scope.test.ts`
- Modify: `src/lib/haccp-plan/build.ts` (compute scope from the bundle) and `src/lib/haccp-plan/build.test.ts`
- Modify: `src/app/(dashboard)/haccp-pack/page.tsx` (scope inputs: active site templates and suppliers, always loaded)

**Interfaces:**
- Produces:
  ```ts
  export interface PackScope {
    menuHasAllergens: boolean
    hasCleaningChecklist: boolean
    hasOpeningClosing: boolean
    hasSuppliers: boolean
  }
  export function scopeFrom(input: {
    dishes: Dish[]
    siteId: string | null
    templates: { name: string; sfbb_section: string | null; library_key?: string | null; active?: boolean; site_id?: string | null }[]
    suppliers: unknown[]
  }): PackScope
  export function packFields(method: HaccpMethod, scope: PackScope): HaccpField[]   // also drops covered files
  export const COVERED_FILE_REASON: Record<string, (s: PackScope) => string | null>   // human reason when covered
  ```

Rules:
- `cs_file` is covered when `hasCleaningChecklist`: an active template on this site or a shared one with `sfbb_section === 'cleaning'`, a library_key of `dishwasher`/`weekly_deep_clean`, or a name matching `/clean/i`.
- `oc_file` is covered when `hasOpeningClosing`: active templates matching both `/opening/i` and `/closing/i`, or library keys `opening_checks` and `closing_checks`.
- `sup_file` is covered when `hasSuppliers`.
- `dd_file` is always covered.
- `fa_matrix_file` is covered when `menuHasAllergens` (existing rule).

- [ ] **Step 1: Failing tests.** Add to `scope.test.ts`:
  - `scopeFrom` cases: an inactive cleaning template does not count; another site's template does not count; a shared template counts; opening without closing gives false.
  - `packFields` drops `cs_file`/`oc_file`/`sup_file` only when covered and `dd_file` always.
  - Focus 4: the same method with `hasCleaningChecklist: false` includes `cs_file`.
  - `COVERED_FILE_REASON.cs_file({…hasCleaningChecklist:true})` is `'Built from your cleaning checklists.'`.

  In `build.test.ts`, the empty bundle's total drops by 1 (`dd_file`), and a bundle with suppliers drops `sup_file`.
- [ ] **Step 2:** `npx vitest run src/lib/haccp-pack src/lib/haccp-plan`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - `buildPlan` uses `scopeFrom({ dishes: sources.dishes, siteId: site?.id, templates: sources.templates, suppliers: sources.suppliers })`. The bundle templates are already active and site-filtered (load.ts); give `AutoDataSources['templates']` optional `library_key`.
  - The pack page loads `checklist_templates` with `id, name, frequency, sfbb_section, library_key, active, site_id` (always enabled) and suppliers (always enabled), then `scope = scopeFrom(...)`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run `npm test`.
- [ ] **Step 5: Commit:** `feat(haccp-pack): documents Blueroll already has are not asked for (cleaning, opening/closing, suppliers, diary)`.

---

### Task 2: Question metadata, new questions, select and file values in the draft

**Files:**
- Modify: `src/lib/haccp-setup/types.ts`, `content/questions.ts`, `content/haccp-mapping.ts`, `draft-pack.ts`
- Test: `src/lib/haccp-setup/__tests__/content.test.ts`, `draft-pack.test.ts`, `golden.test.ts` (and its snapshot)

**Interfaces:**
- Produces:
  ```ts
  export interface Option { value: string; label: string; hint?: string }
  export type AnswerSpec =
    | { kind: 'yes_no' } | { kind: 'single'; options: Option[] } | { kind: 'multi'; options: Option[] }
    | { kind: 'equipment_list' }
    | { kind: 'confirm_data'; source: DataSource }
    | { kind: 'documents' }
  export type DataSource = 'raw_products' | 'menu_methods' | 'suppliers' | 'team' | 'checklists'
  export interface Question { id; text; why; section; method: string; fills: string[]; answer; showIf?; defaultsByType? }
  export const QUESTIONNAIRE_VERSION = 2
  ```
  - `FIELD_RULES` gains the rules in the spec table (selects: `st_check_method` maps `probe→'Digital thermometer'`, `display→'Fridge display'`, `dial→'Dial thermometer'`, `logger→'Data logger'`).
  - `buildPackDraft` handles file rules: `documents` answers produce `DraftField` entries of type `'file'`, merged into `files`. `classifyField` treats a file like text.

- [ ] **Step 1: Failing content tests:**
  - every question has a `method` in `HACCP_METHODS`;
  - every `fills` id exists (`findField`);
  - every `FIELD_RULES.fieldId` appears in some question's `fills`;
  - every new question id from the spec exists with the right kind and showIf;
  - for `fridge_check_method`, every option value maps to an option of the `st_check_method` select.
- [ ] **Step 2: Failing draft-pack tests:**
  - `st_check_method` from `{fridge_check_method:'logger'}` gives a select `'Data logger'`, status new;
  - a manual override of `st_check_method` gives status `manual` (Focus 3);
  - `answers.documents = { pc_contract_file: '{"id":"d1","title":"Contract.pdf"}' }` gives a file field, and `mergePack` writes `files.pc_contract_file` with source `questionnaire`;
  - an existing different file ref not from the questionnaire is `kept` (Focus 3).
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Add `method`/`fills` to all existing questions. Use the mapping file to derive `fills` (each FIELD_RULE's driving question), and write them by hand for readability.
  - Add the 12 new questions after the related existing ones in their sections, with option hints from the design (Main.dc.html shows the fridge-check hints).
  - Add the FIELD_RULES.
  - Add the file branch in the draft.
- [ ] **Step 5:** Run the tests. Update the golden snapshot (`npx vitest run -u src/lib/haccp-setup/__tests__/golden.test.ts`) only after reading the diff: it must add the new fields and change nothing else. Then run `npm test`.
- [ ] **Step 6: Commit:** `feat(haccp-setup): every question knows its SFBB method and pack fields; 12 new questions close the toggle/select gaps`.

---

### Task 3: Data conditions, confirm steps, documents tab in the engine

**Files:**
- Modify: `src/lib/haccp-setup/types.ts` (`Cond` gains `{ data: DataSource | 'documents_needed' }`), `conditions.ts`, `engine.ts`, `content/questions.ts`
- Test: `__tests__/conditions.test.ts`, `engine.test.ts`, `tabs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DataFlags = Partial<Record<DataSource | 'documents_needed', boolean>>
  export function evalCond(cond: Cond, answers: Answers, data?: DataFlags): boolean
  export function visibleQuestions(qs, answers, data?: DataFlags): Question[]
  export function nextQuestion(qs, answers, data?): Question | null
  export function progressByTab(qs, answers, data?): Record<TabId, { answered; total }>
  export function effectiveAnswers(qs, answers, data?): Answers
  export type TabId = 'profile' | SectionId | 'documents'
  export const TAB_ORDER: TabId[] = ['profile','cross','cleaning','chilling','cooking','management','documents']
  ```
  - New questions:
    - `confirm_raw_products` (cross / separating_foods, showIf `{data:'raw_products'}`);
    - `confirm_menu_methods` (cooking / menu_checks, `{data:'menu_methods'}`);
    - `confirm_suppliers` (management / suppliers);
    - `confirm_team` (management / training);
    - `confirm_checklists` (chilling / chilled_storage);
    - `documents` (tab documents / method daily_diary, showIf `{data:'documents_needed'}`).
  - `tabOf` returns `'documents'` for kind `documents`.

- [ ] **Step 1: Failing tests:**
  - `evalCond({data:'suppliers'}, {}, {suppliers:true})` is true and with no data is false;
  - a v1-style answer set (all old ids answered) gives `nextQuestion` as the first new v2 question in question order (Focus 1);
  - with all data flags false, no `confirm_*` question is visible (Focus 2);
  - `TAB_ORDER` ends with documents;
  - progress counts documents.
- [ ] **Step 2–4:** Implement, run and confirm green, then run `npm test`.
- [ ] **Step 5: Commit:** `feat(haccp-setup): confirm-from-Blueroll steps and a documents tab, shown only when they have something to show`.

---

### Task 4: Setup context loader and previews

**Files:**
- Create: `src/lib/haccp-setup/context.ts`, `src/lib/haccp-setup/__tests__/context.test.ts`
- Modify: `src/lib/haccp-setup/api.ts` (add `loadSetupContext`)

**Interfaces:**
- Produces:
  ```ts
  export interface SetupContext {
    sources: AutoDataSources; auto: Record<string, string>; scope: PackScope; flags: DataFlags
    neededFiles: { fieldId: string; methodId: string; label: string }[]
    coveredFiles: { fieldId: string; label: string; reason: string }[]
    documents: { id: string; title: string; category: string | null }[]
  }
  export function buildSetupContext(sources: AutoDataSources, siteId: string, docs: SetupContext['documents']): SetupContext
  export function fillsPreview(q: Question, answers: Answers, ctx: { scotland: boolean }): { fieldId: string; label: string; ref: string; value: string | boolean }[]
  export function planQuote(q: Question, answers: Answers, ctx: { scotland: boolean }): string | null   // first text value, else "label; label" of set toggles
  export async function loadSetupContext(businessId: string, siteId: string): Promise<SetupContext>     // api.ts, same queries as the pack page (RLS)
  ```
  - `flags`:
    - `raw_products` when `auto.sf_raw_products`;
    - `menu_methods` when any of `ck_dishes`/`rh_items`/`hh_items`/`mc_items` exists;
    - `suppliers` when `sources.suppliers.length`;
    - `team` when `auto.tr_responsible`;
    - `checklists` when `auto.st_method || auto.tp_method`;
    - `documents_needed` when `neededFiles.length`.
  - `ref` is the pack method ref (`3.1`), from the same numbering as `buildPlan`. Export a `methodRef(methodId)` helper from `src/lib/haccp-plan/build.ts`.
- [ ] **Step 1: Failing tests:**
  - flags for an empty business are all false;
  - suppliers make `suppliers` true and drop `sup_file`;
  - `neededFiles` for an empty business = `pc_contract_file`, `tr_file`, `cs_file`, `oc_file`, `sup_file`, `fa_matrix_file` (not `dd_file`);
  - `fillsPreview` for `fridge_check_method:'probe'` lists `st_check_method` with ref `3.1`;
  - `planQuote` for `cloths:'both'` returns the CLOTHS text.
- [ ] **Step 2–4:** Implement, run, then run `npm test`.
- [ ] **Step 5: Commit:** `feat(haccp-setup): setup context — data flags, documents needed/covered, fills preview and plan quote`.

---

### Task 5: Setup UI components (preview page first)

**Files:**
- Create in `src/app/(dashboard)/haccp-setup/`: `step-rail.tsx`, `method-context.tsx`, `question-card.tsx` (replaces the card in chat.tsx), `fills-panel.tsx`, `context-assistant.tsx`, `confirm-data.tsx`, `documents-step.tsx`, `review.tsx` (replaces draft-review.tsx's Review UI; keep its logic)
- Create: `src/lib/haccp-setup/content/assistant-chips.ts` (2–3 suggested questions per method id; all 26)
- Create: `src/app/dev/haccp-setup-preview/page.tsx` (dev-only, `notFound()` in production) rendering each component with fixtures
- Remove: `assistant-panel.tsx` usage (the component moves into `context-assistant.tsx`)

Each component mirrors its canvas artboard:

| Component | Artboard | Notes |
|---|---|---|
| StepRail | Main (left) | steps = TAB_ORDER + Review; SectionIcon (from `src/components/haccp-plan/parts.tsx`); sub-line "x of y", "now"; on < 900 px becomes horizontal chips (Phone) |
| MethodContext | Main (top card) | kicker `Safe method {ref} · {section}`, Safety point / Why from `METHOD_COPY`, "Show example" toggles the infographics in `METHOD_COPY[method].infographic` (only the no-prop ones: TempScale, CookCombos, PanToPass, TwoStageClean) plus the "In your HACCP Plan" quote (`planQuote`) and a link to `/haccp-pack/document` |
| QuestionCard | Main (question) | "Question n of m in {Tab}"; option cards with hint; yes_no as two cards; equipment uses the existing `EquipmentInput`; Back / Continue; "Not sure — ask the assistant" focuses the assistant input |
| FillsPanel | Main (right, top) | `fillsPreview` labels with refs; checklists from `buildDraft(...).checklists` whose `reason` mentions this question are out of scope; show "And switches on: …" only for questions whose answers gate library checklists (`fridge_check_method` → fridge temps, and so on); keep it simple: a static map in `assistant-chips.ts` |
| ContextAssistant | Main (right, bottom) | input + chips for the method; uses `assistantAnswer`; shows the answer + sources; error states as today |
| ConfirmData | From-Blueroll | renders source data (suppliers table, raw products chips, recipes by method, team, checklists); "Yes, that's right" → answer `true`; "Something's missing" → answer `'missing'` and a link to the source page (Suppliers, Recipes, Team, Checklists) |
| DocumentsStep | Documents | `neededFiles` rows: attached state or "Choose from library" (existing `DocumentPickerModal`) / Upload (the same modal's upload); `coveredFiles` with the reason and "Attach anyway"; answer = map of fieldId → file ref JSON |
| Review | Review | composition bars per section (answers / Blueroll / open) from `buildPlan`-style counting over `packFields(scope)`; checklist toggle list (existing selection logic); open points (≤ 6); Apply panel; after Apply, links to `/haccp-pack/document` and `/checklists?tab=library` |

- [ ] **Step 1:** Write `assistant-chips.ts` with a content test (all 26 methods, 2–3 chips each, each ≤ 60 chars).
- [ ] **Step 2:** Build the components and the dev preview page. Check visually against the canvas on desktop and at 375 px with the browser preview (dev server via `.claude/launch.json` of the session's project; worktree needs real `node_modules`).
- [ ] **Step 3:** `npx tsc --noEmit`, eslint, `npm test`.
- [ ] **Step 4: Commit:** `feat(haccp-setup): new setup UI components matching the design (rail, context, example, fills, assistant, confirm, documents, review)`.

---

### Task 6: Wire the setup page

**Files:**
- Modify: `src/app/(dashboard)/haccp-setup/page.tsx` (layout from Main.dc.html: header with progress and "Save & exit", rail | question column | side panels); `chat.tsx` (answered list collapsed above the current question, "Edit" in place)
- Modify: `draft-review.tsx` → the Review component wiring

Behaviour:
- The context loads with the session (`loadSetupContext`), and `flags` are passed to every engine call.
- Overall progress in the header is "{filled} of {total} points", computed like Review.
- The current question card scrolls into view on change.
- "Save & exit" returns to `/haccp-pack`; answers save per answer as today.

- [ ] **Step 1:** Implement. **Step 2:** tsc, lint, test. **Step 3: Commit:** `feat(haccp-setup): new setup page flow`.

---

### Task 7: One entry point

**Files:**
- Modify: `src/app/(dashboard)/haccp-pack/page.tsx`: replace the "Set up with questions" link with the "Set up my HACCP" hero (Pack-Entry.dc.html) for managers. It shows progress from the latest session ("Start", "Continue — N% done" with "Next: {tab}, n questions left", or after apply "Review with questions"). Rename the form heading to "Edit the pack by hand".
- Modify: `src/components/layout/sidebar.tsx` (remove the "Set up my HACCP" item) and `src/components/layout/command-palette.tsx` (managers only).
- Modify: `src/lib/haccp-setup/api.ts` (add `loadSessionSummary(businessId, siteId)`: latest session status + answers for the hero).

- [ ] **Step 1:** Implement. **Step 2:** Check visually on the dev preview (hero states: new / in progress / applied) and on phone width. **Step 3:** tsc, lint, test. **Step 4: Commit:** `feat(haccp-pack): Set up my HACCP is the pack's single entry point`.

---

### Task 8: Migration — apply without pack must not fail on pack edits

**Files:**
- Create: `supabase/migrations/20261012130000_haccp_setup_apply_pack_check.sql`. Re-create `apply_haccp_setup` with the `pack_changed` check wrapped in `if jsonb_typeof(p_payload->'pack') = 'object' then … end if`, everything else unchanged (copy the current function body from `20261006120000_haccp_setup.sql`, change only that).

- [ ] **Step 1:** Write it and parse it with libpg-query (as for #37).
- [ ] **Step 2: Commit:** `fix(db): apply_haccp_setup checks the pack version only when it writes the pack`.
- Prod apply: with `supabase db push` now that the history is aligned, after the user says yes.

---

### Task 9: Verify, review, ship

- [ ] Full gates: `npm test`, `deno test` (unchanged), `tsc`, `next build`.
- [ ] Final whole-branch review (fresh reviewer, most capable model) with this plan's Review Focus.
- [ ] Fix pass (TDD), then push → PR → merge → verify on prod (routes, dev preview 404) and ask the user to run through setup with a manager account.

---

## Amendment (2026-10-12): switch on checklists at apply

The user asked for a review option to switch the new checklists on straight away.
- **Task 5, Review:** add a checkbox "Switch on the selected checklists now" (default off). When it is on, the apply payload carries `activate: true`. After apply, show the "Switch on checklists" link only when not activated.
- **Task 8, migration:** besides the `pack_changed` fix, new checklists are inserted with `active = coalesce((p_payload->>'activate')::boolean, false)`.
- **`src/lib/haccp-setup/apply.ts`:** `toApplyPayload(…, opts?: { activate?: boolean })` adds `activate`. Test in `__tests__/apply.test.ts`: default false, true when asked.
