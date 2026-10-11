# HACCP Plan document: in-app view, inspector link, server PDF

**Date:** 2026-10-11 · **Branch:** `KNS/haccp-plan-document` · **Design reference:** `docs/design/haccp-plan/*.dc.html` (Claude Design canvas https://claude.ai/artifact/LZ1Wf65U3np2JBgCfhdXxN)

## Problem

The HACCP Pack is a form. Its only export (`handleExportPDF` in `src/app/(dashboard)/haccp-pack/page.tsx`) prints a plain HTML dump that:
- ignores auto-filled values (`autoData`), so filled fields print "Not filled";
- prints attached files as raw JSON (`📎 {"id":…,"title":…}`);
- has no site, sign-off or review information;
- looks worse than the free 16-page lead-magnet pack on blueroll.app.

Paying customers should get the best-looking document. They should also be able to show it to an EHO on screen and download it as a PDF.

## Goals

1. A **HACCP Plan document** generated from the pack. It is read-only and shaped like FSA SFBB. Each of the 26 methods is laid out as *Safety point → Why? → What we do → Prove it*.
2. **Three surfaces, one renderer:**
   - in-app view `/haccp-pack/document`;
   - a public inspector link `/plan/<token>` (read-only, expires);
   - a server-rendered PDF `/api/haccp-plan/pdf?t=<token>` (A4, headless Chromium on Vercel).
3. **"Prove it"** = real records from the last 28 days per method, taken from checklists, deliveries and documents.
4. Visual language from the design canvas: Geist, the calm green tokens (`--brand #1f9d63`, `--brand-deep #1f7a52`, `--brand-tint #e9f4ee`, amber `#c8861a` for alerts), Lucide icons at stroke 1.6, and infographics (temperature scale, cook time/temperature combinations, pan-to-pass timeline, two-stage clean, cleaning frequency, allergen matrix).

## Non-goals (v1)

- Plan versioning or history tables. We show `haccp_pack_data.updated_at` plus the latest sign-off, and an "edited after sign-off" warning.
- Mobile (Flutter) entry point. That is a later PR in `haccp-mobile`.
- Editing from the document. The pack page stays the editor.
- AI-written prose. "What we do" is built deterministically from the pack fields.

## Architecture

```
            ┌─────────────────────────── Supabase ───────────────────────────┐
browser ──► │ edge fn `haccp-plan` (service role)                            │
 (JWT or    │   member mode: Authorization: Bearer <user JWT> + site_id      │
  token)    │   token mode:  ?t=<token> → sha256 → haccp_plan_shares         │
            │   → loadBundle(business, site) → PlanBundle JSON               │
            │      (pack, business, site, signoff, recipes, dishes,          │
            │       suppliers, templates, documents, team, proof aggregates) │
            └────────────────────────────────────────────────────────────────┘
                     │ PlanBundle (JSON)
                     ▼
src/lib/haccp-plan/build.ts  buildPlan(bundle) → PlanDoc        (pure, vitest)
src/lib/haccp-pack/auto-data.ts computeAutoData(...)            (extracted from page.tsx)
                     │ PlanDoc
                     ▼
src/components/haccp-plan/<PlanDocument doc mode="screen|print">  ← one renderer
   ├─ /haccp-pack/document        (dashboard, member mode, toolbar: Present · Share · PDF · Sign off)
   ├─ /plan/[token]               (bare layout, noindex; ?print=1 → print mode, sets data-plan-ready)
   └─ /api/haccp-plan/pdf?t=…     (Node route, puppeteer-core + @sparticuz/chromium → /plan/<t>?print=1 → page.pdf A4)
```

**Why an edge function for data, not Next route handlers:** the repo has no server Supabase client and no service-role key in `src`. All privileged work lives in Deno edge functions (`channel-form` is the token-auth precedent). One loader serves both the member view and the public link, so the two can never drift apart.

**Why the PDF route renders the public page:** Chromium needs no session. A short-lived `kind='pdf'` share token (10 minutes) gives it access to exactly one plan, and the PDF matches the screen pixel for pixel.

## Data

### New table `haccp_plan_shares`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| business_id | uuid fk businesses | |
| site_id | uuid fk sites, null | null = business-level pack (single site without a site row) |
| kind | text | `'inspector'` \| `'pdf'` |
| token_hash | text unique | sha256 hex of the 32-byte base64url token; the plaintext is never stored |
| label | text null | e.g. "EHO visit 14 Oct" |
| created_by | uuid fk profiles | |
| created_at | timestamptz | |
| expires_at | timestamptz | inspector: up to 30 days (default 7); pdf: 10 minutes |
| revoked_at | timestamptz null | |
| view_count | int default 0 | |
| last_viewed_at | timestamptz null | |

RLS:
- **select:** the same business and `can_see_site_row(site_id)` (or `site_id` is null).
- **insert:**
  - `created_by = auth.uid()`, the same business and site visibility;
  - kind `pdf` → any active member, `expires_at <= now() + 15 min`;
  - kind `inspector` → `is_active_business_manager(business_id)`, `expires_at <= now() + 30 days`.
- **update (revoke):** managers only. A trigger allows only `revoked_at`, `view_count` and `last_viewed_at` to change.
- No delete. No anon policies; the edge function uses the service role.

### PlanBundle (edge function → client)

See `src/lib/haccp-plan/types.ts` in the plan.
- **Proof** is aggregated server-side per checklist template over the 28 days ending yesterday, in site-local dates (`sites.timezone`, default Europe/London). Each day is one of `ok | flagged | corrected | missed | none`, plus counts, the initials of whoever completed, the last completion, and the number of temperature readings.
- **Deliveries:** count, out-of-range (chilled > 5 °C, frozen > −15 °C), and per-day status.
- **Corrective log:** the latest 20 flagged responses with item name, value, notes and `corrective_status`.

## Document structure (PlanDoc)

1. **Cover:** business, site, address, FHRS rating, food business operator, site manager, plan status (overall % plus per-section bars with icons), signed off by and when, next review date (last review + 28 days), QR for the inspector link (only when one exists), generated timestamp.
2. **At a glance:** four stats (plan complete %, days recorded / 28, flagged readings and how many were corrected, training documents), contents with page numbers, the people responsible, open points (unchecked toggles and empty text or file fields, max 8 shown, "+N more").
3. **Five section dividers** inline as headers, not separate pages: icon, name and methods.
4. **26 method pages:**
   - header: kicker "Safe method {s}.{m} · {Section}", title, status pill "In place · x of y" or "x of y in place";
   - Safety point and Why? (static copy per method, adapted from FSA SFBB under OGL v3);
   - optional infographic per method;
   - What we do: checked toggles as tick bullets, then text answers as captioned paragraphs. A value comes from the auto-fill when not overridden, and is marked "From your menu/recipes/suppliers…";
   - attached documents by title;
   - Prove it panel: when sources exist, a 28-day strip and three stats; otherwise "No records linked yet".
5. **Corrective actions:** flagged readings from the last 28 days.
6. **Review & sign-off:** last 4-weekly review (from the latest `haccp_review` checklist completion, else `businesses.haccp_last_reviewed_at`), declaration, signer, date, "edited after sign-off" warning, attribution line (OGL v3).

Infographics by method:

| method | infographic |
|---|---|
| chilled_storage | TempScale |
| cooking_safely | CookCombos + PanToPass |
| hot_holding | PanToPass |
| cleaning_effectively | TwoStageClean |
| cleaning_schedule | CleaningFrequency (from cleaning templates' `frequency`) |
| food_allergies | AllergenMatrix (dishes × 14 allergens from `resolveAllergens`) |

## Screen and print

- **Screen:** sheets render as white "paper" cards, 794 px max width, on `--background`.
  - Below 640 px the paper padding drops to 16 px and grids stack; wide tables scroll inside their box.
  - Sticky section chips appear on the inspector link and in Present mode.
- **Print** (`.plan-print`):
  - `@page { size: A4; margin: 14mm 16mm 16mm }`;
  - each method starts a new page (`break-before: page`), with `break-inside: avoid` on panels, tables and infographics;
  - `print-color-adjust: exact`;
  - Chromium's `footerTemplate` adds "St James’s Café · Borough — HACCP Plan · page X of Y".
- **Present mode (in-app):** a full-screen overlay (`fixed inset-0 z-50`) with the same document and chips, closed with Esc.

## Permissions

| Action | Who |
|---|---|
| View document in-app | any active member who can see the site (`can_see_site_row`) |
| Download PDF | same (creates a `pdf` share) |
| Create or revoke an inspector link | owner or manager (`is_active_business_manager`) |
| Sign off from the document | owner or manager (upsert `haccp_signoffs` for this site) |
| Public link | anyone holding a valid, unexpired, unrevoked token; noindex; `Cache-Control: no-store` |

## Errors

- **Bad, expired or revoked token:** `/plan/[token]` shows "This link has expired or was withdrawn. Ask the business for a new one." The PDF route returns 404 JSON.
- **No pack row yet:** the document still renders, every method is shown as open points, and the cover says "Draft — not signed off".
- **Edge function failure:** an inline error with a retry button. The PDF route returns 502.
- **Chromium timeout:** 25 s for navigation and ready; 55 s total under `maxDuration 60`, then 504.

## Testing

- **vitest:** `computeAutoData` (parity with the old inline logic plus the documents `title` fix), `buildPlan` (status counts, open points, value precedence, infographic selection, review date, signed-after-edit), `proofForMethod` mapping, token helpers.
- **deno test:** proof aggregation (day bucketing in the site timezone, flagged/corrected/missed precedence, initials), token-mode handler (expired, revoked, ok), `isOriginAllowed`.
- **Manual:** dev server plus a deployed edge function on a demo business; print preview; PDF route locally with `CHROME_EXECUTABLE_PATH`.

## Deployment (each step needs explicit approval at the time)

1. Apply the migration `20261012120000_haccp_plan_shares.sql` to prod.
2. Deploy the edge function `haccp-plan` with `--no-verify-jwt` (it verifies JWTs itself in member mode).
3. Vercel: the env needs `NEXT_PUBLIC_SUPABASE_URL` (already present); for preview deployments, `VERCEL_AUTOMATION_BYPASS_SECRET` (optional); then deploy.
