# Blueroll — Onboarding Assistant: Branching Questionnaire (Design Spec)

**Status:** design / approved-to-plan · **Date:** 2026-09-01 · **Author:** KK + Claude

> Reframes the in-app onboarding assistant (`2026-08-25-onboarding-assistant-design.md`).
> That spec's photo-upload flow becomes ONE of two entry branches. This spec adds a guided,
> branching **questionnaire** for clients who do NOT already have a checklist pack to upload —
> "a good questionnaire for complete beginners". The widget, entitlement gate, and the idempotent
> build/notify pipeline are unchanged and shared by both branches.

## 1. Goal & success criteria

The upload-only flow ("send photos of your existing checks") excludes every client who has no
paper pack to photograph — often the least experienced ones who most need help. Add a branch that
**builds a compliant checklist set from a few simple questions**, so a client who has nothing can
still stand up a working site in a couple of minutes.

**Success:** a paying client with no prior paperwork answers a short guided questionnaire (areas +
a handful of count/checkbox questions) and gets **working, FSA-shaped checklists live in their
site**, after a one-screen preview they confirm.

## 2. Scope

**Entry fork (Q0) — "Where do you want to start?"**
1. **"I already have checklists"** → the existing **photo/PDF upload flow** (extract → build).
   Already built (Phase 1 of the prior spec). Unchanged.
2. **"Build from scratch"** → the new **questionnaire** (this spec).

**v1 areas — Kitchen + Front of House.** Bar, Delivery/Goods-in, and a standalone Cleaning area are
deliberately deferred to a fast-follow. Voice input and menu/allergen extraction remain deferred
(prior spec's Phase 2).

**Out of scope (later / YAGNI):** persisting questionnaire answers beyond the session, team-account
creation, multi-department role split, Bar/Delivery areas, editing generated checklists inside the
wizard (the client edits in `/checklists` after building).

## 3. Generation engine — reuse `ai-generate-checklist`

The from-scratch branch does **not** hand-author a template library. It reuses the existing
`supabase/functions/ai-generate-checklist` engine, which already turns a structured brief into an
FSA/SFBB-correct checklist: one `temperature` item per named unit, exact equipment names preserved,
type-specific rules (a Temperature Log is temps-only; Cleaning is tick-only; Closing has no cleaning
schedule). The questionnaire's job is to **collect the answers and synthesize one brief per checklist**;
the engine produces the checklist JSON.

- Rejected — deterministic parametrized template library: 100% predictable but requires authoring and
  maintaining the whole FSA library by hand, duplicating what the engine already encodes.
- Rejected — hybrid skeletons + AI polish: more complexity for little gain.
- The AI-variance risk is covered by the **preview-and-confirm** step (§5) before anything is written.

Existing primitives reused: `CHECKLIST_TYPES` (opening / closing / temperature_log / cleaning /
haccp_review / custom) and `DEFAULT_EQUIPMENT` from `src/lib/constants.ts`.

## 4. The questionnaire (Kitchen + FOH)

Short, lazy-friendly: counts and checkboxes with sensible pre-ticked defaults and auto-named units
(the client can rename but never has to). Each answer maps to a concrete checklist to generate.

**Step 1 — Areas** (multi-select): 🍳 Kitchen · 🍽️ Front of House.

**Step 2 — per-area mini-questionnaire.** Each answer drives one generated checklist:

**Kitchen**
| Question | Generates |
|---|---|
| How many fridges/freezers? (auto-named Fridge 1/2, Freezer 1; optional rename + type: fridge 0–5°C / freezer −18°C / walk-in / display) | **Fridge & Freezer Temperature Record** — one `temperature` item per named unit, AM/PM |
| How many probe thermometers? | **Probe Calibration Record** — ice 0°C ±3 / boiling 100°C ±3 per probe (weekly) |
| How many sinks / wash-hand basins? | hand-wash + sanitising items folded into Opening/Cleaning |
| What do you cook: from raw / cook-chill / reheat? (multi) | **Cooking & Cooling Temperature** — core ≥75°C; 2-stage cooling ≤21°C@2h → ≤8°C@+4h |
| Which routines? Opening ✓ / Closing ✓ / Cleaning ✓ / Allergen control (four-weekly) (checkboxes, defaults pre-ticked) | the corresponding checklists |

**Front of House**
| Question | Generates |
|---|---|
| How many cold displays / chilled units? | **Cold Display Temperature** (0–8°C) |
| Which routines? FOH Opening / FOH Closing / Front cleaning (checkboxes) | the corresponding checklists |

Defaults: if the client skips a count it defaults to a sensible minimum (e.g. 1 fridge, 1 probe) so
the wizard can always produce something. Allergen control is OFF by default (it carries the
attestation obligation, §6).

## 5. Preview → confirm → build

**Step 3 — Preview.** After the questions, show the planned set: "We'll build N checklists, M items",
each row = checklist name + item count, with a toggle to drop any. A **Build** button confirms.

**Step 4 — Build.** For each selected checklist spec, synthesize the engine brief from the answers
(equipment names, counts, type) → run `ai-generate-checklist` → collect the checklist JSON → hand the
aggregated `{ checklists }` to the existing **`onboard-build`** edge function (idempotent write, role_id
backfill, `active:true`, oversight notification). Success view: "N checklists are live → Go to checklists".

## 6. Architecture (what's new vs reused)

```
 Onboarding widget (existing shell)
   ├─ Q0 entry fork
   │    ├─ "I have checklists"  → upload flow  → onboard-extract-checks ─┐   (existing)
   │    └─ "Build from scratch" → questionnaire (Steps 1–3, NEW UI) ─────┤
   │                                    │ synthesize briefs             │
   │                                    ▼                               │
   │                             onboard-generate (NEW, thin):          │
   │                             loops ai-generate-checklist over the   │
   │                             selected checklist specs → {checklists}│
   ▼                                                                    ▼
 onboard-build (EXISTING) — idempotent write + role backfill + active + notify
```

- **New:** the questionnaire UI (Steps 1–3 in the widget) + a thin `onboard-generate` edge function
  that runs the existing engine once per selected checklist spec and returns the aggregated
  `{ checklists }` in the same shape `onboard-build` already consumes. (Alternatively the loop can run
  client-side calling `ai-generate-checklist` N times; the edge function keeps the API key server-side
  and the payload small — preferred.)
- **Reused unchanged:** the widget shell + entitlement gate, the photo-upload branch
  (`onboard-extract-checks`), the whole `onboard-build` write/notify pipeline, and the
  `ai-generate-checklist` engine.
- **Data flow:** questionnaire answers are ephemeral session state (not persisted). Output =
  `checklist_templates` + items, identical to the upload branch.

## 7. Components (isolation & boundaries)

- `OnboardingAssistant` (gate) — unchanged; still shows only for entitled accounts with 0 active
  templates.
- `OnboardingWizard` (widget UI) — NEW: holds the entry fork and, for the from-scratch path, the
  area picker → mini-questionnaires → preview. Talks only to edge functions. No DB writes.
- `buildBriefs(answers)` — NEW pure function: questionnaire answers → an array of engine briefs (one
  per checklist) + the preview summary. Independently unit-testable (answers in → briefs/preview out).
- `onboard-generate` — NEW edge function: `{ briefs }` → `{ checklists }` by running the engine per
  brief. No DB.
- `onboard-build` — unchanged: the only DB writer; idempotent; role backfill; oversight notify.

## 8. Error handling & edge cases

- A brief that the engine fails to generate is skipped with a note in the preview/summary rather than
  failing the whole build (partial success is fine; the client can re-run).
- Empty selection (client unticks everything) disables Build.
- Same guards as the upload branch: never write empty `assigned_roles` (fallback trio), always backfill
  `assigned_role_ids`, idempotent upserts, never touch existing accounts.
- Allergen control, if selected, is generated as a four-weekly checklist; any allergen **data** stays
  the client's responsibility (there is no dish/allergen writing in this branch — that's the deferred
  menu flow).

## 9. Open questions

- `onboard-generate` runs N engine calls — sequential vs parallel, and a cap on N (Kitchen+FOH tops out
  around 7–8 checklists, so a small fixed cap is fine).
- Whether to let the client rename auto-named units inline in v1, or defer renaming to `/checklists`.
- Whether "Allergen control" should be visible in v1 at all, given the attestation obligation lives in
  the deferred menu flow (leaning: show it as a plain four-weekly checklist, no dish data).
