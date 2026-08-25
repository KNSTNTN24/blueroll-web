# Blueroll — In-App Onboarding Assistant (Design Spec)

**Status:** design / approved-to-plan · **Date:** 2026-08-25 · **Author:** KK + Claude

> Supersedes the earlier Telegram-bot sketch (`blueroll-crm/docs/telegram-onboarding-bot-spec.md`).
> After a clean-slate discussion the direction changed: **pay first, then use an in-app widget** — not a
> pre-signup Telegram/WhatsApp lead bot. Channel is in-app; the client is already authenticated and paying.

## 1. Goal & success criteria

New clients are lazy and don't want to learn the product — that is the real onboarding blocker (learned
from the manual Bobo & Wild and Tootoomoo onboardings). Replace the manual "email us your menu / photos of
your checks and we'll build it by hand" flow with an **in-app conversational assistant** that a paying
client uses to stand up their site by just answering a few questions with **photos, text, or voice**.

**Success:** a paying client, teaching themselves nothing, gets **working checklists + a menu with an
allergen matrix in ~10 minutes**, built into their live site.

## 2. Scope

**v1 — checklists first** (ship the biggest, safest win alone; menu/allergens follows):
1. **Paper checks → checklists.** Client sends photos of their current SFBB pack / temperature sheets /
   cleaning schedules → AI builds `checklist_templates` + items, live in the site.

**v1.1 (fast-follow) — menu → allergen matrix.** Client sends menu (photos / PDF / link) → AI builds
`menu_items` with `declared_allergens[]` + `menu_categories`, pending owner attestation (the Tootoomoo
115-dish job, automated). Deliberately split out of v1: it is the safety-critical, attestation-heavy
piece, so it ships once the checklists path is proven end-to-end.

**Out of scope (later / YAGNI):** Telegram/WhatsApp channels (in-app only), auto-creating team accounts,
multi-department role split (Wanstead-style), fridge/sink list extraction, payment/Stripe (separate
track — the widget assumes an entitled account).

## 3. UX / conversation flow

An in-app assistant (same surface pattern as the existing `feedback-beacon.tsx`) that appears for a
paying client on an otherwise-empty account. A short guided wizard; each step accepts **photo upload,
text, or a browser-recorded voice note**; every step has "skip / send later".

1. "Send **photos of the checks you use now** — temperature sheets, cleaning schedules, opening/closing.
   A batch is fine, phone photos are fine."
2. "Send your **menu** — photos, a PDF, or a link."
3. *(fast-follow: fridges, then team.)*

After processing, the assistant reports and hands off:
> "Done — I've set up **N checklists** and **M dishes with allergens**. Your checklists are already live.
> Please review and confirm your allergens here 👉 [Review allergens]."

Resumable: artefacts accumulate on a session; the client can drop off and continue.

## 4. Architecture (reuse existing muscle)

```
 In-app widget (React, like feedback-beacon.tsx)
   │  photo / text / voice
   ▼
 Supabase Edge Functions (pattern of ai-generate-checklist / import-recipe — already call Claude)
   ├─ onboard-extract-checks   (photos → checklist JSON)
   ├─ onboard-extract-menu     (menu → dishes + declared_allergens[])
   ├─ (STT for voice notes → text)          ← only new external dependency
   └─ onboard-build            (idempotent writes to Supabase + notify)
        ├─ checklist_templates + checklist_template_items  (+ backfill assigned_role_ids)
        ├─ menu_items + menu_categories + site_categories
        └─ notify team (send-feedback pattern → email; optional Telegram)
```

- **Widget:** a new component modelled on `feedback-beacon.tsx` (same in-app beacon UX + auth context —
  `business_id` / `site` / `profile` already known), plus photo upload and in-browser voice recording.
- **Backend:** Supabase Edge Functions, mirroring the existing `ai-generate-checklist` and `import-recipe`
  functions that already use Claude with the `ANTHROPIC`-configured secret. Raw uploads go to a Supabase
  Storage bucket `onboarding/<business>/…`.
- **Voice → text:** a speech-to-text call (Whisper API / Deepgram) — the one genuinely new dependency.
- **Build pipeline:** idempotent (upsert by `(business_id, name)` / `(site_id, lower(name))`).

## 5. The two extractors (core value)

Each is a single Claude call with a strict JSON schema (structured output / tool-use), returning a
per-field **confidence**.

| Input | Extractor | Output → Supabase |
|---|---|---|
| Photos of paper checks | → checklists | `checklist_templates` + items, mapping each line to an item type: `tick / temperature / text / yes_no / photo / initials` (min/max/unit for temps) |
| Menu (photos / PDF / link) | → dishes + 14 UK allergens | `menu_items(name, category, declared_allergens[])` + `menu_categories` + `site_categories` map |

- **Allergen vocabulary (fixed):** `gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts,
  celery, mustard, sesame, sulphites, lupin, molluscs`. (Soya→soybeans, Tree nuts→nuts, Sulphite→sulphites,
  Cereals-containing-gluten→gluten.)
- Reuse `ai-generate-checklist`'s FSA/SFBB prompt rules for the checks extractor.

## 6. Auto-build + oversight

- **Full auto into the live site.** Checklists and menu sections go live immediately — no blocking review
  gate. That's the "magic" moment for a lazy client.
- **Allergens are the one exception — legally the business's responsibility.** They are written but flagged
  **pending owner attestation**: `allergen_source='manual'`, `attested_by=NULL`,
  `attested_by_name='Imported — pending owner verification'`, `attested_at=now()`. The app prompts the
  owner to confirm each dish in the Allergens section. This is the owner's own tick, not a step that
  returns us to the loop.
- **Copy to us for post-hoc oversight:** each build emits a notification (what was built, for which
  business, a link) — email in v1 (reuse the `send-feedback` edge-function path), optional Telegram notify.

## 7. Error handling & edge cases

- **Unreadable / low-confidence:** the assistant asks the client to re-send a clearer photo, or writes the
  item flagged "please check" rather than guessing.
- **Confirmation surface:** after building, the client sees a summary ("found 115 dishes, 24 checklists —
  open?") and can correct or send more.
- **Guards (learned the hard way):** always backfill `assigned_role_ids` from `base_tier` on inserts (rows
  created without it are invisible under the role_id filter); never write an empty `assigned_roles` (`[]` =
  invisible to everyone) — fall back to a sensible role set; never touch an existing live account; keep all
  writes idempotent.
- Size/count caps on uploads; retries on transient AI/STT failures.

## 8. Components (isolation & boundaries)

- `OnboardingAssistant` (widget) — UI + session state; talks only to the edge functions. No DB writes.
- `onboard-extract-checks` / `onboard-extract-menu` — pure functions: media in → validated JSON out. No DB.
- `onboard-build` — the only component that writes Supabase; idempotent; owns the allergen-pending rule and
  the role_id backfill; emits the oversight notification.
- Each is independently testable: extractors against fixture photos → expected JSON; build against a JSON
  fixture → expected rows.

## 9. Open questions

- STT provider (Whisper API vs Deepgram vs on-device) and its cost/latency.
- Do we auto-run the build, or show a one-tap "Build my site" confirm after extraction? (Leaning auto.)
- Team-account creation: v1.1 or v2? (Currently out of v1.)
- Notification channel default: email only in v1, Telegram opt-in later.
