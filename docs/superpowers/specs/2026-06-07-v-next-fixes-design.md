# v-next: Recipes & Checklists fixes — Design Spec

**Date:** 2026-06-07
**Status:** Systematized from Konstantin's backlog (7 items) + 2 carried-over mobile items; key decisions confirmed in session.
**Repos:** `blueroll-web` (DB migrations + web UI), `haccp-mobile` (Flutter release)

## Backlog → design mapping

| # | Item | Kind | Platforms |
|---|---|---|---|
| 1 | Editable dietary flags (vegan/vegetarian/GF/DF) | Feature, schema | DB + web + mobile |
| 2 | Checklist "Save" (fill in several sittings) | Feature, schema | DB + web + mobile |
| 3 | "Who filled" initials | Feature, **new item type** | DB-enum-free + web + mobile |
| 4 | Deadline time on checklist header + dashboard ordering | UI (schema exists) | web + mobile |
| 5 | Multi-per-day checklists with min count | Feature, schema | DB + web + mobile |
| 6 | AI recipe import ends in error instead of returning to recipe | Bug (investigate first) | mobile (verify web too) |
| 7 | Editing from Library kicks you to active list | Bug, navigation | web + mobile |
| A | Mobile paywall: Buy visible to owner only | Carried over (arbitration spec) | mobile |
| B | Mobile team-flag: permanent override → cache | Carried over (arbitration spec) | mobile |

## Confirmed decisions

- **#3**: initials is a **6th checklist item type** (`initials`) alongside tick/temperature/text/yes_no/photo — pluggable per template, can be `required`. No changes to `checklist_completions` (old clients unaffected). Validation 2–5 chars; device remembers last value. Display "who filled" in lists = the initials response when present, else profile name (current behaviour).
- **#4+#5**: **counter model.** Template gains `multi_per_day boolean DEFAULT false` and `min_per_day int DEFAULT 1` (0 allowed when multi). Single-per-day: `deadline_time` shown on card header; dashboard sorts by it. Multi-per-day: no per-slot schedule; card shows "N/M today" progress badge; status = done when N ≥ min_per_day; sorts above completed items until the minimum is reached. No false "overdue" states. (Slot schedules — possible later iteration, out of scope.)

## Design per item

### 1. Dietary flags — tri-state override
Flags are currently **computed** from ingredient allergens (web `recipes/page.tsx:26-37`, mobile `models/recipe.dart:150-177`) — nothing stored, nothing editable, and meat is invisible to the rules (a beef stew computes "vegetarian").

- Schema: 4 nullable booleans on `recipes`: `vegan_override`, `vegetarian_override`, `gluten_free_override`, `dairy_free_override`. `NULL` = auto (computed as today), `true/false` = explicit.
- Shared resolution rule (both clients): `effective = override ?? computed`.
- UI (recipe new/edit, both platforms): 4 chips prefilled with the effective value; tapping cycles explicit on/off; a "reset to auto" affordance. Recipe detail/list show effective flags.
- AI import: continues to fill allergens (auto computation keeps working); MAY set overrides only when the source text explicitly states a claim (e.g. "vegan recipe"); otherwise leaves NULL.
- Old mobile builds: ignore the new columns, keep computing — acceptable until the release lands.

### 2. Checklist drafts — separate table
Completion today is one-shot (web `checklists/[id]/page.tsx:115-202`, mobile `checklist_detail_screen.dart:128-205`); local state dies on refresh.

- Schema: new table `checklist_drafts (id uuid pk, template_id, business_id, created_by, responses jsonb, updated_at)`, unique `(template_id, created_by)`. **Deliberately NOT a status on `checklist_completions`** — old clients count completion rows for status; a draft row there would mark the checklist done for them.
- Flow: "Save" button persists responses jsonb; opening the checklist restores a draft if present; successful submit deletes the draft. Drafts are per-user.
- RLS: same business-scoped policy pattern as responses.

### 3. `initials` item type
- No DB enum migration needed (`item_type` is text).
- Both clients: render a short text input, uppercase, 2–5 chars, persist last-used value locally (localStorage / SharedPreferences), validate when `required`.
- Template editor (both platforms) + AI checklist generator (`ai-generate-checklist` edge fn prompt) + `DefaultChecklists` (mobile) learn the new type.
- Lists/detail: when a completion has an initials response, show it as "by ‹initials›".

### 4. Deadline on header + ordering
`deadline_time` (HH:mm) already exists on templates and is editable on mobile (`checklist_manage_screen.dart:352-445`); web dashboard currently orders by `name` (`checklists/page.tsx:41-56`), mobile by status only.

- Card/header: show "due by HH:mm" when set; after the time passes and the checklist isn't done — visually flag (amber).
- Ordering (both platforms): pending-first, then `deadline_time` asc (nulls last), then name. Multi-per-day below-minimum items rank as pending.
- Web template editor: add the deadline_time field (mobile already has it).

### 5. Multi-per-day — counter
- Schema: `checklist_templates.multi_per_day boolean NOT NULL DEFAULT false`, `min_per_day int NOT NULL DEFAULT 1` (CHECK `min_per_day >= 0`).
- Status logic (new clients): count today's completions; done when `count >= max(min_per_day, multi_per_day ? min_per_day : 1)`; multi with min 0 never shows as overdue, just a counter.
- Multi templates allow a new completion at any time (today's UI blocks re-completion within the period — relax for multi).
- Old mobile builds: see the checklist as done after the first completion — accepted degradation until release.

### 6. AI import return bug — investigate, then fix
Findings so far (mobile `ai_import_screen.dart`): after save it navigates to the recipes **list** (`context.go('/recipes')`, line 285), save is a multi-step non-atomic sequence (recipe insert → per-ingredient find-or-create → join rows) — a mid-sequence failure shows an error SnackBar while the recipe is already half-created; analysis errors land in a banner with no recovery.
- Step 1: reproduce with logs; identify the actual failing step (suspect: ingredient find-or-create conflict or RLS).
- Fix direction: make save atomic via a single RPC `create_recipe_with_ingredients(payload jsonb)` (SECURITY DEFINER, business-scoped); navigate to `/recipes/{id}` of the created recipe; analysis-error path keeps user's input intact with a retry button. Web import page (`recipes/import/page.tsx`) gets the same RPC for consistency.

### 7. Library navigation bug
- Web: after template edit, `router.push('/checklists')` (`checklists/edit/[id]/page.tsx:183`) loses the Library tab. Fix: tab state in query param (`/checklists?tab=library`), edit page returns to it; same for the back button (line 215).
- Mobile: `context.go('/checklists')` after manage-screen save (`checklist_manage_screen.dart:225`) → return to the Library tab (pass/restore tab index).

### A/B. Carried-over mobile items
Per `2026-06-07-subscription-arbitration-design.md` "Team members" amendments: (A) Buy button owner-only, staff see "ask the owner" + Restore; (B) `blueroll_team_member` SharedPreferences flag becomes a cache — when online, re-check the business row instead of overriding.

## Phasing & deploy order

- **Phase 1 — DB (one sitting):** migrations for #1 (override columns), #2 (drafts table + RLS), #5 (template columns), RPC for #6. All additive; old clients unaffected. SQL tests via existing `scripts/sql-api.sh` runner.
- **Phase 2 — Web (fast deploy via Vercel):** all 7 items' web sides (#6 web = switch to RPC). Ships independently.
- **Phase 3 — Flutter release (one version):** items 1–7 mobile sides + A + B. One store submission.

Each phase gets its own writing-plans-style detailed plan (full code per task) before implementation, as with the arbitration project.

## Out of scope
- Slot schedules for multi-per-day (hybrid later if restaurants ask).
- Dietary rules accounting for meat as an ingredient class (the override mechanism is the practical answer).
- Farkhod's orphaned Stripe sub `sub_1TbPl5…` — needs whoever owns the Stripe account, before 2026-06-09.
