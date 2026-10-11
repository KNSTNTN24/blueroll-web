# HACCP Plan Document Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the HACCP Pack into a designed, SFBB-shaped HACCP Plan document. It is viewable in-app, shareable with an inspector through an expiring read-only link, and downloadable as a server-rendered A4 PDF, with real 28-day "Prove it" records for each method.

**Architecture:**
- **Data:** one Deno edge function, `haccp-plan`, loads a `PlanBundle` with the service role. It authorises the caller one of two ways: a member JWT plus `site_id`, or a hashed share token.
- **Build:** a pure TS `buildPlan(bundle)` turns the bundle into a `PlanDoc`.
- **Render:** a single React renderer draws the `PlanDoc` for three surfaces: `/haccp-pack/document` (in-app), `/plan/[token]` (public, bare layout) and print mode.
- **PDF:** a Node route handler drives headless Chromium (puppeteer-core + @sparticuz/chromium) to `/plan/<token>?print=1` and returns `page.pdf()`.

**Tech Stack:** Next.js 16.2 App Router (client components, one Node route handler), React 19, TanStack Query, Supabase (Postgres + RLS, Deno edge functions), vitest 4, `deno test`, lucide-react, puppeteer-core 25, @sparticuz/chromium.

**Spec:** `docs/superpowers/specs/2026-10-11-haccp-plan-document-design.md`
**Design reference (source of truth for markup and styling):** `docs/design/haccp-plan/*.dc.html`

## Global Constraints

- Read `node_modules/next/dist/docs/` before writing Next code. In Next 16, middleware is called `proxy`; route handler config uses `export const runtime = 'nodejs'`, `maxDuration` and `dynamic`.
- Font: Geist only (already loaded via `next/font` as `--font-geist`).
- Colors: `#1f9d63` brand, `#1f7a52` brand-deep, `#e9f4ee` brand-tint, `#16181d` ink, `#3b3f47` body-2, `#5f6670` muted (minimum grey on paper), `#d9dce1` rule, `#e9eaed` hairline, `#f6f7f8` canvas, amber text `#8a5a0c`, amber fill `#e0a43a`, amber tint `#fbf1e1`, frozen slate `#2f4a63`.
- Icons: `lucide-react`, `strokeWidth={1.6}`. Section icons: cross `ShieldAlert`, cleaning `SprayCan`, chilling `Snowflake`, cooking `Flame`, management `ClipboardCheck`. Extras: `Refrigerator`, `Wheat`, `Thermometer`, `HandPlatter`.
- Copy is UK English. Temperatures are written `75 °C` (thin space before °C is not required; a normal space is fine).
- Every page footer, and the sign-off page, carries this attribution: "Safety points adapted from Safer Food, Better Business for Caterers (Food Standards Agency). Contains public sector information licensed under the Open Government Licence v3.0."
- Token: 32 random bytes, base64url without padding (43 chars, matches `/^[A-Za-z0-9_-]{43}$/`). The DB stores only `sha256(token)` as lowercase hex.
- Expiry limits: inspector links are 1, 7 (default) or 30 days; PDF render tokens are 10 minutes.
- Proof window: the 28 site-local days ending **yesterday** (today is excluded because it is incomplete). Timezone comes from `sites.timezone`, falling back to `'Europe/London'`.
- Out of range: `checklist_responses.flagged = true`. Corrected means `corrective_status = 'done'`. Deliveries count as out of range when chilled > 5 °C or frozen > −15 °C (`src/lib/haccp-setup/content/thresholds.ts`).
- No new dependency except `puppeteer-core` and `@sparticuz/chromium`.
- `npm test`, `npx tsc --noEmit` (the repo baseline may already have errors: compare the count before and after, and add no new ones), `npm run lint` on touched files, and `deno test supabase/functions/_shared/haccp-plan/` must pass before each commit.
- Production actions (migration apply, edge function deploy, Vercel deploy, PR) need the user's explicit go-ahead at that moment.

## Review Focus

1. **A token for a revoked or expired link opened after creation:** the public page must show the "expired" state, never data, and the PDF route must return 404 without launching Chromium. Pin it in the Task 5 handler tests and the Task 9 route test.
2. **A site with no pack row, or a brand-new business with no checklists:** the document must render with every method as open points and "No records linked yet", without crashing or showing "NaN%". Pin it in the Task 3 `buildPlan` empty-bundle test.
3. **Completions around midnight in Europe/London across the BST→GMT change (25 Oct 2026):** each must land on the correct local day. Pin it in the Task 5 aggregate test.
4. **A user who belongs to another business, or a member restricted to a different site, calling member mode with someone else's `site_id`:** must get 403. Pin it in the Task 5 handler test.
5. **Very long free-text answers (2,000+ chars, newlines) and 60+ dishes in the allergen matrix:** must wrap, never overflow the A4 page, and keep matrix headers on page breaks. Pin it in the Task 3 test (newlines preserved as separate paragraphs) and the Task 10 manual print check with a seeded long answer.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/haccp-pack/auto-data.ts` (new) | `computeAutoData(sources)`: pure, extracted from `page.tsx` |
| `src/lib/haccp-pack/auto-data.test.ts` (new) | parity tests |
| `src/app/(dashboard)/haccp-pack/page.tsx` (modify) | use `computeAutoData`; documents select `title`; "Export PDF" → link to the document |
| `src/lib/haccp-plan/types.ts` (new) | `PlanBundle`, `PlanDoc` and related types |
| `src/lib/haccp-plan/copy.ts` (new) | per-method Safety point / Why, infographic key, attribution |
| `src/lib/haccp-plan/proof-map.ts` (+ test) | which templates prove which method; merging of day strips |
| `src/lib/haccp-plan/build.ts` (+ test) | `buildPlan(bundle, now)` |
| `src/lib/haccp-plan/share.ts` (+ test) | token generation and hashing, create/list/revoke shares, `planUrl` |
| `src/lib/haccp-plan/api.ts` | `fetchPlanBundleForSite`, `fetchPlanBundleByToken` |
| `supabase/migrations/20261012120000_haccp_plan_shares.sql` | table + RLS + guard trigger |
| `supabase/functions/_shared/haccp-plan/aggregate.ts` (+ test) | proof aggregation (pure) |
| `supabase/functions/_shared/haccp-plan/handler.ts` (+ test) | request → auth mode → bundle (deps injected) |
| `supabase/functions/_shared/haccp-plan/load.ts` | Supabase queries building the bundle |
| `supabase/functions/haccp-plan/index.ts` | wiring, CORS |
| `src/components/haccp-plan/*.tsx` + `plan.css` | the renderer |
| `src/app/(dashboard)/haccp-pack/document/page.tsx` | in-app view + toolbar |
| `src/app/plan/layout.tsx`, `src/app/plan/[token]/page.tsx` | public view |
| `src/app/api/haccp-plan/pdf/route.ts`, `src/lib/haccp-plan/pdf.ts` | PDF |

---

### Task 1: Extract `computeAutoData` and fix the documents column

**Files:**
- Create: `src/lib/haccp-pack/auto-data.ts`
- Create: `src/lib/haccp-pack/auto-data.test.ts`
- Modify: `src/app/(dashboard)/haccp-pack/page.tsx:181-461`

**Interfaces:**
- Produces:
  ```ts
  export interface AutoDataSources {
    recipes: RecipeSrc[]; dishes: Dish[]; suppliers: SupplierSrc[]
    templates: { id: string; name: string; frequency: string; sfbb_section: string | null }[]
    documents: { id: string; title: string; category: string | null }[]
    team: { full_name: string | null; role: string | null }[]
  }
  export interface RecipeSrc { id: string; name: string; cooking_method: string | null; cooking_temp: number | null;
    extra_care_flags: string[] | string | null; reheating_instructions: string | null; hot_holding_required: boolean | null;
    chilling_method: string | null; freezing_instructions: string | null; defrosting_instructions: string | null;
    haccp_methods: string[] | null; recipe_ingredients: { ingredient: { name: string; allergens: string[] | null } | null }[] | null }
  export interface SupplierSrc { id: string; name: string; contact_name: string | null; phone: string | null; email: string | null; delivery_days: string[] | string | null }
  export const AUTO_SOURCE_LABEL: Record<string, string>   // field id → "From your recipes" etc.
  export function computeAutoData(src: AutoDataSources): Record<string, string>
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/haccp-pack/auto-data.test.ts
import { describe, it, expect } from 'vitest'
import { computeAutoData, AUTO_SOURCE_LABEL, type AutoDataSources } from './auto-data'

const empty: AutoDataSources = { recipes: [], dishes: [], suppliers: [], templates: [], documents: [], team: [] }
const recipe = (over: Partial<AutoDataSources['recipes'][number]>) => ({
  id: 'r', name: 'Dish', cooking_method: null, cooking_temp: null, extra_care_flags: null, reheating_instructions: null,
  hot_holding_required: null, chilling_method: null, freezing_instructions: null, defrosting_instructions: null,
  haccp_methods: [], recipe_ingredients: [], ...over,
})

describe('computeAutoData', () => {
  it('returns nothing for an empty business', () => {
    expect(computeAutoData(empty)).toEqual({})
  })
  it('lists cooking dishes with method and temperature', () => {
    const out = computeAutoData({ ...empty, recipes: [recipe({ name: 'Roast chicken', cooking_method: 'Oven', cooking_temp: 80, haccp_methods: ['cooking_safely'] })] })
    expect(out.ck_dishes).toBe('Roast chicken: Oven @ 80°C')
    expect(out.mc_items).toBe('Roast chicken — Oven @ 80°C')
  })
  it('detects raw products by keyword and seafood allergen', () => {
    const out = computeAutoData({ ...empty, recipes: [recipe({ recipe_ingredients: [
      { ingredient: { name: 'Chicken thigh', allergens: [] } },
      { ingredient: { name: 'Nori', allergens: ['fish'] } },
      { ingredient: { name: 'Rice', allergens: [] } },
    ] })] })
    expect(out.sf_raw_products).toBe('Chicken thigh, Nori')
  })
  it('reads document titles (column is title, not name)', () => {
    const out = computeAutoData({ ...empty, documents: [
      { id: 'd1', title: 'Rentokil contract 2026', category: 'contract' },
      { id: 'd2', title: 'Level 2 — Priya', category: 'certificate' },
    ] })
    expect(out.pc_company).toBe('Rentokil contract 2026')
    expect(out.tr_records).toBe('Level 2 — Priya')
  })
  it('names owners and managers as responsible', () => {
    const out = computeAutoData({ ...empty, team: [{ full_name: 'Emma Marsh', role: 'owner' }, { full_name: 'Sam', role: 'staff' }] })
    expect(out.tr_responsible).toBe('Emma Marsh (owner)')
  })
  it('picks the temperature checklist for st_method', () => {
    const out = computeAutoData({ ...empty, templates: [{ id: 't', name: 'Fridge & Freezer Temperatures', frequency: 'daily', sfbb_section: 'temperature' }] })
    expect(out.st_method).toBe('Using checklist: Fridge & Freezer Temperatures (daily)')
  })
  it('has a source label for every auto field it can produce', () => {
    for (const k of ['ck_dishes', 'sf_raw_products', 'fa_allergens_list', 'sup_list', 'pc_company', 'tr_records', 'tr_responsible', 'st_method', 'tp_method']) {
      expect(AUTO_SOURCE_LABEL[k]).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/haccp-pack/auto-data.test.ts`
Expected: FAIL, "Cannot find module './auto-data'".

- [ ] **Step 3: Implement**

Move the body of the `useMemo` at `page.tsx:269-461` into `computeAutoData(src)` verbatim, with these changes:
- Replace `recipes` / `dishes` / `suppliersData` / `documents` / `teamProfiles` / `checklistTemplates` with `src.recipes` and so on.
- Replace `(d: any) => d.name` in the documents block with `d.title`.
- Drop the `if (!autoFillEnabled) return {}` guard; the caller handles it.
- Add types instead of `any`.

Add the label map:

```ts
export const AUTO_SOURCE_LABEL: Record<string, string> = {
  ck_dishes: 'From your recipes', rh_items: 'From your recipes', hh_items: 'From your recipes', cd_method: 'From your recipes',
  fz_method: 'From your recipes', df_method: 'From your recipes', df_products: 'From your recipes', ec_items: 'From your recipes',
  rte_items: 'From your recipes', mc_items: 'From your recipes', sf_raw_products: 'From recipe ingredients',
  fa_allergens_list: 'From your menu', sup_list: 'From your suppliers', sf_delivery_schedule: 'From your suppliers',
  pc_company: 'From your documents', tr_records: 'From your documents', tr_responsible: 'From your team',
  st_method: 'From your checklists', tp_method: 'From your checklists',
}
```

In `page.tsx`:
- Change the documents query select to `'id, title, category, file_url'`.
- Replace the `useMemo` body with:
  ```ts
  if (!autoFillEnabled) return {}
  return computeAutoData({ recipes: recipes ?? [], dishes: dishes ?? [], suppliers: suppliersData ?? [], templates: checklistTemplates ?? [], documents: documents ?? [], team: teamProfiles ?? [] } as AutoDataSources)
  ```
- Fix the optimistic cache key at `:524` to `['haccp-pack', businessId, packSiteId]`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/haccp-pack/` then `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/haccp-pack/auto-data.ts src/lib/haccp-pack/auto-data.test.ts "src/app/(dashboard)/haccp-pack/page.tsx"
git commit -m "refactor(haccp-pack): extract computeAutoData; fix documents title column and optimistic cache key"
```

---

### Task 2: Plan types, method copy, proof mapping

**Files:**
- Create: `src/lib/haccp-plan/types.ts`, `src/lib/haccp-plan/copy.ts`, `src/lib/haccp-plan/proof-map.ts`, `src/lib/haccp-plan/proof-map.test.ts`

**Interfaces:**
- Produces (`types.ts`):

```ts
import type { SectionId } from '@/lib/haccp-pack/methods'
import type { AutoDataSources } from '@/lib/haccp-pack/auto-data'

export type DayStatus = 'ok' | 'flagged' | 'corrected' | 'missed' | 'none'
export interface PackData {
  toggles: Record<string, boolean>; texts: Record<string, string>; files: Record<string, string>
  selects: Record<string, string>; overrides: Record<string, boolean>; sources: Record<string, 'questionnaire'>
}
export interface TemplateProof {
  templateId: string; name: string; libraryKey: string | null; sfbbSection: string | null; frequency: string
  days: DayStatus[]            // length 28, oldest first, index 27 = yesterday
  completions: number; flagged: number; corrected: number; readings: number
  initials: string[]; lastCompletedAt: string | null
}
export interface DeliveryProof { count: number; outOfRange: number; days: DayStatus[] }
export interface CorrectiveEntry { at: string; template: string; item: string; value: string | null; notes: string | null; status: 'needed' | 'done' | null; by: string | null }
export interface PlanBundle {
  generatedAt: string; periodStart: string; periodEnd: string   // YYYY-MM-DD site-local, inclusive
  business: { id: string; name: string; address: string | null; postCode: string | null; fsaRating: string | null; autoFill: boolean; lastReviewedAt: string | null }
  site: { id: string; name: string; address: string | null; postcode: string | null; fsaRating: string | null; timezone: string } | null
  pack: { data: PackData; updatedAt: string | null }
  signoff: { signedByName: string | null; signedAt: string } | null
  sources: AutoDataSources
  proof: { templates: TemplateProof[]; deliveries: DeliveryProof; corrective: CorrectiveEntry[]; lastReview: { at: string; by: string | null } | null }
  people: { operator: string | null; siteManager: string | null }
  share: { kind: 'inspector' | 'pdf'; expiresAt: string } | null
  viewer: { canManage: boolean; userId: string } | null
}
export type InfographicKey = 'tempScale' | 'cookCombos' | 'panToPass' | 'twoStageClean' | 'cleaningFrequency' | 'allergenMatrix'
export interface MethodProof { title: string; days: DayStatus[]; stats: { value: string; label: string; tone: 'default' | 'amber' }[]; sourceNames: string[] }
export interface PlanAnswer { label: string; value: string; autoLabel: string | null }
export interface PlanMethod {
  id: string; ref: string; name: string; section: SectionId; sectionName: string
  safetyPoint: string; why: string; infographic: InfographicKey[]
  inPlace: number; toggleTotal: number; status: 'in_place' | 'partial' | 'open'
  doList: string[]; answers: PlanAnswer[]; attachments: { title: string }[]
  open: { ref: string; label: string }[]; proof: MethodProof | null
}
export interface PlanSection { id: SectionId; num: number; name: string; filled: number; total: number; pct: number; methods: PlanMethod[] }
export interface PlanDoc {
  businessName: string; siteName: string | null; address: string | null; fsaRating: string | null
  generatedAt: string; periodStart: string; periodEnd: string
  filled: number; total: number; pct: number; inspectionReady: boolean
  sections: PlanSection[]
  stats: { value: string; label: string; sub: string; tone: 'default' | 'amber' }[]
  people: { role: string; name: string }[]
  openPoints: { ref: string; method: string; label: string }[]
  corrective: CorrectiveEntry[]
  review: { lastAt: string | null; lastBy: string | null; nextDue: string | null; overdue: boolean }
  signoff: { name: string; at: string; editedAfter: boolean } | null
  dishes: { name: string; allergens: string[]; mayContain: string[] }[]
  cleaningFrequency: { label: string; count: number; items: string[] }[]
  footerLabel: string; fileName: string
}
```

- Produces (`copy.ts`): `export const METHOD_COPY: Record<string, { safetyPoint: string; why: string; infographic: InfographicKey[] }>` (all 26 ids from `HACCP_METHODS`), `export const SECTION_ORDER: SectionId[]`, `export const SECTION_NAME: Record<SectionId, string>` and `export const OGL_ATTRIBUTION: string`.
- Produces (`proof-map.ts`): `export function proofForMethod(methodId: string, proof: PlanBundle['proof']): MethodProof | null` and `export function mergeDays(strips: DayStatus[][]): DayStatus[]`.

- [ ] **Step 1: Write `types.ts` exactly as above.**

- [ ] **Step 2: Write `copy.ts`**

```ts
import type { SectionId } from '@/lib/haccp-pack/methods'
import type { InfographicKey } from './types'

export const SECTION_ORDER: SectionId[] = ['cross', 'cleaning', 'chilling', 'cooking', 'management']
export const SECTION_NAME: Record<SectionId, string> = {
  cross: 'Cross-contamination', cleaning: 'Cleaning', chilling: 'Chilling', cooking: 'Cooking', management: 'Management',
}
export const OGL_ATTRIBUTION =
  'Safety points adapted from Safer Food, Better Business for Caterers (Food Standards Agency). Contains public sector information licensed under the Open Government Licence v3.0.'

type Copy = { safetyPoint: string; why: string; infographic: InfographicKey[] }
export const METHOD_COPY: Record<string, Copy> = {
  personal_hygiene: { safetyPoint: 'Everyone handling food keeps themselves and their clothing clean, and reports illness.', why: 'People carry harmful bacteria on hands, hair and clothes. Staff with sickness or diarrhoea can contaminate food even after they feel better.', infographic: [] },
  cloths: { safetyPoint: 'Cloths are used in a way that does not spread bacteria.', why: 'Dirty cloths are one of the main ways bacteria spread around a kitchen.', infographic: [] },
  separating_foods: { safetyPoint: 'Raw and ready-to-eat foods are kept apart at every stage.', why: 'Bacteria from raw meat, poultry, fish, eggs and unwashed vegetables can spread to food that will not be cooked again.', infographic: [] },
  food_allergies: { safetyPoint: 'We know which of the 14 allergens are in every dish.', why: 'A trace can cause a severe reaction. The law requires accurate allergen information for all food we sell.', infographic: ['allergenMatrix'] },
  contamination_prevention: { safetyPoint: 'Food is protected from physical and chemical contamination.', why: 'Glass, metal, packaging and cleaning chemicals in food can injure or poison customers.', infographic: [] },
  pest_control: { safetyPoint: 'The premises are kept free of pests.', why: 'Mice, rats, flies and cockroaches spread bacteria and contaminate food and surfaces.', infographic: [] },
  handwashing: { safetyPoint: 'Staff wash their hands properly and at the right times.', why: 'Clean hands stop bacteria spreading from raw food, bins, toilets and phones to ready-to-eat food.', infographic: [] },
  cleaning_effectively: { safetyPoint: 'Surfaces and equipment are cleaned, then disinfected.', why: 'Dirt and grease stop disinfectant from working. Clean first, then disinfect — two separate stages.', infographic: ['twoStageClean'] },
  clear_clean: { safetyPoint: 'Work areas are cleared and cleaned as we go.', why: 'Clutter and spills hide dirt and let bacteria build up during service.', infographic: [] },
  cleaning_schedule: { safetyPoint: 'Every area and piece of equipment is on a cleaning schedule.', why: 'A schedule makes sure nothing is missed, including jobs done weekly or monthly.', infographic: ['cleaningFrequency'] },
  chilled_storage: { safetyPoint: 'Chilled food is kept at 8 °C or below; we aim for 0–5 °C.', why: 'Harmful bacteria multiply fastest between 8 °C and 63 °C. Cold food stays safe until its use-by date.', infographic: ['tempScale'] },
  chilling_down: { safetyPoint: 'Cooked food that is not served straight away is cooled quickly, then refrigerated.', why: 'Food left warm lets bacteria and their toxins build up. Cooling within 90 minutes keeps it safe.', infographic: [] },
  defrosting: { safetyPoint: 'Frozen food is defrosted safely, or cooked from frozen where the instructions allow.', why: 'Food still frozen in the middle may not cook through, and defrosting at room temperature lets bacteria grow on the outside.', infographic: [] },
  freezing: { safetyPoint: 'Frozen food is kept at −18 °C or below and frozen before its use-by date.', why: 'Freezing stops bacteria growing but does not kill them, so food must be frozen while still safe.', infographic: [] },
  cooking_safely: { safetyPoint: 'Food is cooked until it is steaming hot all the way through.', why: 'Thorough cooking kills harmful bacteria. Hotter for less time works too — each line below is equally safe.', infographic: ['cookCombos', 'panToPass'] },
  extra_care: { safetyPoint: 'Foods with extra risks are prepared with extra care.', why: 'Rice, eggs, pulses, shellfish and some meats carry particular hazards, such as toxins that survive reheating.', infographic: [] },
  reheating: { safetyPoint: 'Food is reheated until steaming hot, and only once.', why: 'Reheating must kill any bacteria that grew while the food was stored.', infographic: [] },
  menu_checks: { safetyPoint: 'Every dish on the menu has a checked way of being cooked safely.', why: 'Knowing how each dish is cooked and checked means new staff and new dishes follow the same safe method.', infographic: [] },
  hot_holding: { safetyPoint: 'Hot food held for service stays at 63 °C or above.', why: 'Below 63 °C bacteria can grow. Food held below 63 °C must be used within 2 hours, once.', infographic: ['panToPass'] },
  ready_to_eat: { safetyPoint: 'Ready-to-eat food is protected from raw food and handled hygienically.', why: 'Ready-to-eat food will not be cooked again, so any bacteria that reach it will reach the customer.', infographic: [] },
  opening_closing: { safetyPoint: 'The kitchen is checked before opening and after closing every day.', why: 'Daily checks catch problems — a warm fridge, an empty soap dispenser — before they affect food.', infographic: [] },
  suppliers: { safetyPoint: 'Food is bought only from reputable suppliers.', why: 'Safe food starts with ingredients that arrive cold, intact and in date.', infographic: [] },
  stock_control: { safetyPoint: 'Stock is checked on delivery and rotated so nothing goes past its date.', why: 'Out-of-date or damaged stock is a hazard, and a sign that control has slipped.', infographic: [] },
  training: { safetyPoint: 'Staff are trained and supervised for the work they do.', why: 'People can only follow safe methods they have been shown and understand.', infographic: [] },
  temperature_probes: { safetyPoint: 'Probe thermometers are clean, working and accurate.', why: 'Every temperature record depends on the probe. A faulty probe makes every record wrong.', infographic: [] },
  daily_diary: { safetyPoint: 'Checks are recorded every day the business is open.', why: 'Daily records show the system is working — this is what the inspector asks to see first.', infographic: [] },
}
```

- [ ] **Step 3: Write the failing proof-map tests**

```ts
// src/lib/haccp-plan/proof-map.test.ts
import { describe, it, expect } from 'vitest'
import { proofForMethod, mergeDays } from './proof-map'
import { METHOD_COPY } from './copy'
import { HACCP_METHODS } from '@/lib/haccp-pack/methods'
import type { PlanBundle, TemplateProof, DayStatus } from './types'

const days = (fill: DayStatus, over: Record<number, DayStatus> = {}) => Array.from({ length: 28 }, (_, i) => over[i] ?? fill)
const tpl = (o: Partial<TemplateProof>): TemplateProof => ({ templateId: 't', name: 'X', libraryKey: null, sfbbSection: null, frequency: 'daily',
  days: days('none'), completions: 0, flagged: 0, corrected: 0, readings: 0, initials: [], lastCompletedAt: null, ...o })
const proof = (templates: TemplateProof[], deliveries = { count: 0, outOfRange: 0, days: days('none') }): PlanBundle['proof'] =>
  ({ templates, deliveries, corrective: [], lastReview: null })

describe('copy', () => {
  it('covers every pack method', () => {
    for (const m of HACCP_METHODS) expect(METHOD_COPY[m.id], m.id).toBeDefined()
  })
})

describe('mergeDays', () => {
  it('uses precedence flagged > corrected > ok > missed > none', () => {
    const a = days('none', { 0: 'ok', 1: 'missed', 2: 'corrected', 3: 'ok' })
    const b = days('none', { 0: 'flagged', 1: 'ok', 2: 'ok', 4: 'missed' })
    const m = mergeDays([a, b])
    expect(m.slice(0, 5)).toEqual(['flagged', 'ok', 'corrected', 'ok', 'missed'])
  })
  it('returns 28 none for no strips', () => {
    expect(mergeDays([])).toEqual(days('none'))
  })
})

describe('proofForMethod', () => {
  it('matches chilled storage by library key, section or name', () => {
    const p = proofForMethod('chilled_storage', proof([
      tpl({ templateId: 'a', name: 'Fridge & Freezer Temperatures', libraryKey: null, sfbbSection: 'chilling', completions: 56, flagged: 2, corrected: 2, initials: ['TA', 'PK'], days: days('ok') }),
      tpl({ templateId: 'b', name: 'Daily Opening Checks', sfbbSection: 'cleaning', completions: 28 }),
    ]))
    expect(p?.sourceNames).toEqual(['Fridge & Freezer Temperatures'])
    expect(p?.stats[0]).toEqual({ value: '56', label: 'Records in 28 days', tone: 'default' })
    expect(p?.stats[1]).toEqual({ value: '2', label: 'Out of range — 2 corrected', tone: 'amber' })
    expect(p?.stats[2].value).toBe('TA · PK')
  })
  it('uses deliveries for suppliers and stock control', () => {
    const p = proofForMethod('suppliers', proof([], { count: 40, outOfRange: 1, days: days('ok') }))
    expect(p?.title).toBe('Delivery checks')
    expect(p?.stats[0].value).toBe('40')
    expect(p?.stats[1].tone).toBe('amber')
  })
  it('returns null when nothing is linked', () => {
    expect(proofForMethod('cooking_safely', proof([]))).toBeNull()
    expect(proofForMethod('training', proof([tpl({ name: 'Training log' })]))).toBeNull()
  })
  it('daily diary merges every template', () => {
    const p = proofForMethod('daily_diary', proof([tpl({ name: 'A', completions: 3, days: days('ok') }), tpl({ name: 'B', completions: 2 })]))
    expect(p?.stats[0].value).toBe('5')
  })
})
```

- [ ] **Step 4: Run to verify failure:** `npx vitest run src/lib/haccp-plan/proof-map.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 5: Implement `proof-map.ts`**

```ts
import type { DayStatus, MethodProof, PlanBundle, TemplateProof } from './types'

const RANK: Record<DayStatus, number> = { none: 0, missed: 1, ok: 2, corrected: 3, flagged: 4 }
export function mergeDays(strips: DayStatus[][]): DayStatus[] {
  const out: DayStatus[] = Array.from({ length: 28 }, () => 'none')
  for (const s of strips) s.forEach((d, i) => { if (i < 28 && RANK[d] > RANK[out[i]]) out[i] = d })
  return out
}

type Rule = { keys?: string[]; sections?: string[]; name?: RegExp; title: string; deliveries?: boolean; all?: boolean }
const RULES: Record<string, Rule> = {
  chilled_storage: { keys: ['fridge_temps'], sections: ['temperature'], name: /fridge|freezer|temperature/i, title: 'Fridge & freezer temperature log' },
  freezing: { keys: ['fridge_temps'], sections: ['temperature'], name: /freezer/i, title: 'Freezer temperature log' },
  chilling_down: { keys: ['cooling'], name: /cool/i, title: 'Cooling records' },
  defrosting: { keys: ['defrosting'], name: /defrost/i, title: 'Defrosting records' },
  cooking_safely: { keys: ['cooking_temps'], name: /cook/i, title: 'Cooking temperature log' },
  hot_holding: { keys: ['hot_holding'], name: /hot.?hold/i, title: 'Hot-holding checks' },
  reheating: { keys: ['reheating'], name: /reheat/i, title: 'Reheating records' },
  cleaning_effectively: { keys: ['dishwasher', 'weekly_deep_clean'], sections: ['cleaning'], name: /clean|dishwasher/i, title: 'Cleaning sign-offs' },
  clear_clean: { keys: ['weekly_deep_clean'], sections: ['cleaning'], name: /clean/i, title: 'Cleaning sign-offs' },
  cleaning_schedule: { keys: ['dishwasher', 'weekly_deep_clean'], sections: ['cleaning'], name: /clean|dishwasher/i, title: 'Cleaning schedule sign-offs' },
  food_allergies: { keys: ['allergen_check'], name: /allergen/i, title: 'Allergen checks' },
  pest_control: { keys: ['pest_check_in_house', 'pest_contractor_visit'], name: /pest/i, title: 'Pest checks' },
  opening_closing: { keys: ['opening_checks', 'closing_checks'], name: /opening|closing/i, title: 'Opening & closing checks' },
  temperature_probes: { keys: ['probe_calibration'], sections: ['probes'], name: /probe|calibrat/i, title: 'Probe calibration' },
  suppliers: { deliveries: true, title: 'Delivery checks' },
  stock_control: { deliveries: true, title: 'Delivery checks' },
  daily_diary: { all: true, title: 'All daily records' },
}

const matches = (t: TemplateProof, r: Rule) =>
  !!r.all || (!!t.libraryKey && !!r.keys?.includes(t.libraryKey)) || (!!t.sfbbSection && !!r.sections?.includes(t.sfbbSection)) || (!!r.name && r.name.test(t.name))

export function proofForMethod(methodId: string, proof: PlanBundle['proof']): MethodProof | null {
  const r = RULES[methodId]
  if (!r) return null
  if (r.deliveries) {
    const d = proof.deliveries
    if (!d.count) return null
    return { title: r.title, days: d.days, sourceNames: ['Deliveries'], stats: [
      { value: String(d.count), label: 'Deliveries checked in 28 days', tone: 'default' },
      { value: String(d.outOfRange), label: 'Above safe temperature', tone: d.outOfRange ? 'amber' : 'default' },
      { value: d.count ? `${Math.round(((d.count - d.outOfRange) / d.count) * 100)}%` : '—', label: 'Accepted in range', tone: 'default' },
    ] }
  }
  const ts = proof.templates.filter((t) => matches(t, r))
  if (!ts.length) return null
  const completions = ts.reduce((n, t) => n + t.completions, 0)
  const flagged = ts.reduce((n, t) => n + t.flagged, 0)
  const corrected = ts.reduce((n, t) => n + t.corrected, 0)
  const initials = Array.from(new Set(ts.flatMap((t) => t.initials))).slice(0, 4)
  return {
    title: r.title, days: mergeDays(ts.map((t) => t.days)), sourceNames: ts.map((t) => t.name),
    stats: [
      { value: String(completions), label: 'Records in 28 days', tone: 'default' },
      { value: String(flagged), label: flagged ? `Out of range — ${corrected} corrected` : 'Out of range', tone: flagged ? 'amber' : 'default' },
      { value: initials.length ? initials.join(' · ') : '—', label: 'Completed by', tone: 'default' },
    ],
  }
}
```

- [ ] **Step 6: Run** `npx vitest run src/lib/haccp-plan/`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/haccp-plan/types.ts src/lib/haccp-plan/copy.ts src/lib/haccp-plan/proof-map.ts src/lib/haccp-plan/proof-map.test.ts
git commit -m "feat(haccp-plan): plan types, SFBB method copy, proof mapping"
```

---

### Task 3: `buildPlan`

**Files:**
- Create: `src/lib/haccp-plan/build.ts`, `src/lib/haccp-plan/build.test.ts`, `src/lib/haccp-plan/fixtures.ts` (test bundle factory, also used for local design previews)

**Interfaces:**
- Consumes: Task 1 `computeAutoData`, `AUTO_SOURCE_LABEL`; Task 2 types, `METHOD_COPY`, `SECTION_ORDER`, `SECTION_NAME`, `proofForMethod`; `HACCP_METHODS`; `resolveAllergens` from `@/lib/dishes`; `ALLERGEN_LABELS`, `EU_ALLERGENS` from `@/lib/constants`.
- Produces: `export function buildPlan(bundle: PlanBundle, now?: Date): PlanDoc` and `export function makeBundle(over?: DeepPartial<PlanBundle>): PlanBundle` (in `fixtures.ts`).

Rules `buildPlan` must implement:
- **Value precedence per text or select field:** a manual value (`texts[id]` / `selects[id]`), unless empty, wins. Otherwise use the auto value when `business.autoFill`, the field has an `autoSource`, and `!overrides[id]`; then `autoLabel = AUTO_SOURCE_LABEL[id] ?? 'Auto-filled'`.
- **Filled** = a toggle that is true, a non-empty answer (manual or auto per the rule above), or a file with a parseable ref. The total is all fields. `pct = round(filled/total*100)`, and 0 when the total is 0.
- **Method status** uses toggles only: `in_place` when every toggle is on and the method has ≥1 toggle; `open` when 0 are on, or when it has no toggles and no answers; `partial` otherwise. For methods without toggles: `in_place` when every text, select and file field is filled.
- **doList:** labels of checked toggles, in order.
- **answers:** text and select fields with a value. Multi-line values are kept as-is (the renderer splits them on `\n`).
- **attachments:** parsed file refs (`JSON.parse` → `{id,title}`); skip unparseable ones.
- **open:** unchecked toggles plus empty text, select and file fields. `ref` = `${sectionNum}.${methodIndex}`.
- `ref` is the 1-based section number in `SECTION_ORDER`, then the 1-based method index within that section, in `HACCP_METHODS` order.
- **inspectionReady:** `pct >= 90` and a signoff exists and `!editedAfter`.
- **editedAfter:** `pack.updatedAt > signoff.signedAt` (ISO compare), allowing 60 s of tolerance for the sign-off click saving the pack.
- **review:** `lastAt` = `proof.lastReview?.at ?? business.lastReviewedAt`; `nextDue` = lastAt + 28 days (YYYY-MM-DD); `overdue` when `now` > nextDue. All null when lastAt is null, and overdue = true.
- **stats (4):**
  - plan complete `${pct}%` / `${filled} of ${total} points`;
  - days recorded `${n}/28` where n = days with ok, flagged or corrected across all templates;
  - out-of-range readings `${flagged}`, with sub `${corrected} corrected`, tone amber when flagged > corrected;
  - training documents count (documents with category training or certificate), sub "Certificates on file".
- **people:** "Food business operator" = `people.operator`; "Site manager" = `people.siteManager`; plus `tr_responsible` from the effective answer when present. Skip nulls.
- **openPoints:** all open items, keeping `{ref, method, label}`. The renderer shows the first 8.
- **dishes:**
  - Filter `sources.dishes` to `active`, and to those whose `site_ids` include `site.id` (when there is a site and `site_ids` is non-empty).
  - Map to labels via `resolveAllergens`; `mayContain` comes from `dish.may_contain` mapped to labels.
  - Sort by name.
- **cleaningFrequency:** from `sources.templates` where `sfbb_section === 'cleaning'` or the name matches `/clean/i`. Group by frequency into four buckets: After use = `custom` (label "After use / as needed"), Daily = `daily`, Weekly = `weekly`, Monthly = `monthly` and `four_weekly`. `items` are template names.
- **footerLabel:** `${businessName}${siteName ? ' · ' + siteName : ''} — HACCP Plan`.
- **fileName:** `HACCP-Plan-${slug(business)}${site ? '-' + slug(site) : ''}-${generatedAt.slice(0,10)}.pdf`, where slug = lowercase, non-alphanumerics → `-`, trimmed.

- [ ] **Step 1: Write `fixtures.ts`**

`makeBundle` returns a minimal valid bundle: business "St James’s Café", site "Borough" (tz Europe/London), empty pack, no signoff, empty sources, proof with zero deliveries and 28 `none` days, `generatedAt '2026-10-11T09:00:00Z'`, period `2026-09-13`..`2026-10-10`. Overrides are merged shallowly per top-level key and one level deep.

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/haccp-plan/build.test.ts
import { describe, it, expect } from 'vitest'
import { buildPlan } from './build'
import { makeBundle } from './fixtures'
import { HACCP_METHODS } from '@/lib/haccp-pack/methods'

const TOTAL = HACCP_METHODS.reduce((n, m) => n + m.fields.length, 0)

describe('buildPlan', () => {
  it('renders an empty pack as all-open without NaN', () => {
    const d = buildPlan(makeBundle())
    expect(d.total).toBe(TOTAL)
    expect(d.filled).toBe(0)
    expect(d.pct).toBe(0)
    expect(d.sections.map((s) => s.num)).toEqual([1, 2, 3, 4, 5])
    expect(d.sections.flatMap((s) => s.methods)).toHaveLength(26)
    expect(d.openPoints.length).toBe(TOTAL)
    expect(d.sections[2].methods[0]).toMatchObject({ id: 'chilled_storage', ref: '3.1', status: 'open', proof: null })
    expect(d.inspectionReady).toBe(false)
    expect(d.review).toEqual({ lastAt: null, lastBy: null, nextDue: null, overdue: true })
    expect(JSON.stringify(d)).not.toContain('NaN')
  })

  it('prefers manual over auto, and auto only when not overridden', () => {
    const b = makeBundle({
      pack: { data: { toggles: {}, texts: { sup_list: 'Manual list' }, files: {}, selects: {}, overrides: { tr_responsible: true }, sources: {} }, updatedAt: null },
      sources: { suppliers: [{ id: 's', name: 'Meadow Dairy', contact_name: null, phone: null, email: null, delivery_days: null }],
                 team: [{ full_name: 'Emma Marsh', role: 'owner' }] },
    })
    const mgmt = buildPlan(b).sections[4].methods
    expect(mgmt.find((m) => m.id === 'suppliers')!.answers[0]).toEqual({ label: 'List your food suppliers and contact details', value: 'Manual list', autoLabel: null })
    expect(mgmt.find((m) => m.id === 'training')!.answers.find((a) => a.label.startsWith('Named person'))).toBeUndefined()
  })

  it('uses auto values with a source label', () => {
    const b = makeBundle({ sources: { team: [{ full_name: 'Emma Marsh', role: 'owner' }] } })
    const tr = buildPlan(b).sections[4].methods.find((m) => m.id === 'training')!
    expect(tr.answers[0]).toEqual({ label: 'Named person responsible for food safety training', value: 'Emma Marsh (owner)', autoLabel: 'From your team' })
  })

  it('ignores auto values when auto-fill is off', () => {
    const b = makeBundle({ business: { autoFill: false }, sources: { team: [{ full_name: 'Emma', role: 'owner' }] } })
    expect(buildPlan(b).sections[4].methods.find((m) => m.id === 'training')!.answers).toEqual([])
  })

  it('computes method status from toggles', () => {
    const toggles = { st_temp: true, st_records: true, st_rotation: true, st_labelled: true, cd_90min: true }
    const d = buildPlan(makeBundle({ pack: { data: { toggles, texts: {}, files: {}, selects: {}, overrides: {}, sources: {} }, updatedAt: null } }))
    const ch = d.sections[2].methods
    expect(ch[0]).toMatchObject({ status: 'in_place', inPlace: 4, toggleTotal: 4 })
    expect(ch[0].doList[0]).toBe('Fridge temperature checked daily (0–5°C)')
    expect(ch[1]).toMatchObject({ status: 'partial', inPlace: 1, toggleTotal: 3 })
  })

  it('parses attachments and skips broken refs', () => {
    const files = { fa_matrix_file: JSON.stringify({ id: 'd1', title: 'Allergen menu.pdf' }), pc_contract_file: 'legacy-path.pdf' }
    const d = buildPlan(makeBundle({ pack: { data: { toggles: {}, texts: {}, files, selects: {}, overrides: {}, sources: {} }, updatedAt: null } }))
    expect(d.sections[0].methods.find((m) => m.id === 'food_allergies')!.attachments).toEqual([{ title: 'Allergen menu.pdf' }])
    expect(d.sections[0].methods.find((m) => m.id === 'pest_control')!.attachments).toEqual([])
  })

  it('keeps multi-line answers intact', () => {
    const long = 'Line one\nLine two\n' + 'x'.repeat(2000)
    const d = buildPlan(makeBundle({ pack: { data: { toggles: {}, texts: { cc_method: long }, files: {}, selects: {}, overrides: {}, sources: {} }, updatedAt: null } }))
    expect(d.sections[1].methods.find((m) => m.id === 'clear_clean')!.answers[0].value).toBe(long)
  })

  it('flags edits after sign-off and computes the review window', () => {
    const d = buildPlan(makeBundle({
      pack: { updatedAt: '2026-10-05T10:00:00Z' },
      signoff: { signedByName: 'Emma Marsh', signedAt: '2026-10-03T16:42:00Z' },
      proof: { lastReview: { at: '2026-10-03T16:40:00Z', by: 'Emma Marsh' } },
    }), new Date('2026-10-11T09:00:00Z'))
    expect(d.signoff).toEqual({ name: 'Emma Marsh', at: '2026-10-03T16:42:00Z', editedAfter: true })
    expect(d.review).toEqual({ lastAt: '2026-10-03T16:40:00Z', lastBy: 'Emma Marsh', nextDue: '2026-10-31', overdue: false })
  })

  it('builds the allergen matrix only from active dishes on this site', () => {
    const dish = (name: string, active: boolean, site_ids: string[]) => ({ id: name, name, category: null, active, allergen_source: 'manual' as const,
      recipe_id: null, declared_allergens: ['milk'], may_contain: ['nuts'], dietary: [], attested_by_name: null, attested_at: null, site_ids, site_categories: {} })
    const b = makeBundle({ sources: { dishes: [dish('Flat white', true, ['site-1']), dish('Old dish', false, ['site-1']), dish('Other site', true, ['site-2'])] } })
    b.site!.id = 'site-1'
    expect(buildPlan(b).dishes.map((x) => x.name)).toEqual(['Flat white'])
  })

  it('names the file and footer', () => {
    const d = buildPlan(makeBundle())
    expect(d.fileName).toBe('HACCP-Plan-st-james-s-cafe-borough-2026-10-11.pdf')
    expect(d.footerLabel).toBe('St James’s Café · Borough — HACCP Plan')
  })
})
```

> Note on the slug: `’` and `é` are non-alphanumeric under `/[^a-z0-9]+/`, so "St James’s Café" becomes `st-james-s-caf`. Normalise first with `.normalize('NFKD').replace(/[̀-ͯ]/g, '')` so that `é` → `e` and the result is `st-james-s-cafe`.

- [ ] **Step 3: Run to verify failure:** `npx vitest run src/lib/haccp-plan/build.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement `build.ts` following the rules above.** Import `findField`-style iteration over `HACCP_METHODS`. Implement `parseFileRef` locally (same logic as `page.tsx:987`).
- [ ] **Step 5: Run** `npx vitest run src/lib/haccp-plan/`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add src/lib/haccp-plan/build.ts src/lib/haccp-plan/build.test.ts src/lib/haccp-plan/fixtures.ts
git commit -m "feat(haccp-plan): buildPlan turns a bundle into the plan document model"
```

---

### Task 4: Migration `haccp_plan_shares`

**Files:**
- Create: `supabase/migrations/20261012120000_haccp_plan_shares.sql`

**Interfaces:**
- Produces: table `public.haccp_plan_shares` (columns per the spec), used by Task 5 (service role) and Task 6 (client, RLS).

- [ ] **Step 1: Write the migration**

```sql
-- HACCP Plan share links: an inspector link (read-only, up to 30 days) or a short-lived PDF render token.
-- Only sha256(token) is stored. Reads by token happen in the haccp-plan edge function with the service role;
-- members manage their own business's links through RLS. No anon access.
create table if not exists public.haccp_plan_shares (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  kind text not null check (kind in ('inspector', 'pdf')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label text check (label is null or length(label) <= 80),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz
);
create index if not exists idx_haccp_plan_shares_business on public.haccp_plan_shares(business_id, site_id, created_at desc);

alter table public.haccp_plan_shares enable row level security;

drop policy if exists haccp_plan_shares_select on public.haccp_plan_shares;
create policy haccp_plan_shares_select on public.haccp_plan_shares for select
  using (business_id = public.get_my_business_id() and (site_id is null or public.can_see_site_row(site_id)));

drop policy if exists haccp_plan_shares_insert on public.haccp_plan_shares;
create policy haccp_plan_shares_insert on public.haccp_plan_shares for insert
  with check (
    business_id = public.get_my_business_id()
    and created_by = auth.uid()
    and (site_id is null or public.can_see_site_row(site_id))
    and revoked_at is null and view_count = 0
    and (
      (kind = 'pdf' and expires_at <= now() + interval '15 minutes')
      or (kind = 'inspector' and public.is_active_business_manager(business_id) and expires_at <= now() + interval '30 days')
    )
  );

drop policy if exists haccp_plan_shares_revoke on public.haccp_plan_shares;
create policy haccp_plan_shares_revoke on public.haccp_plan_shares for update
  using (business_id = public.get_my_business_id() and public.is_active_business_manager(business_id))
  with check (business_id = public.get_my_business_id());

-- Members may only set revoked_at; every other column is fixed after insert (service role skips the check).
create or replace function public.haccp_plan_shares_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then return new; end if;
  if new.business_id is distinct from old.business_id or new.site_id is distinct from old.site_id
     or new.kind is distinct from old.kind or new.token_hash is distinct from old.token_hash
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at or new.label is distinct from old.label
     or new.view_count is distinct from old.view_count or new.last_viewed_at is distinct from old.last_viewed_at then
    raise exception 'only revoked_at can be changed';
  end if;
  return new;
end $$;
drop trigger if exists trg_haccp_plan_shares_guard on public.haccp_plan_shares;
create trigger trg_haccp_plan_shares_guard before update on public.haccp_plan_shares
  for each row execute function public.haccp_plan_shares_guard();
```

- [ ] **Step 2: Lint the SQL locally.** Run `supabase db lint` only if a local stack is running. Otherwise run `psql --set ON_ERROR_STOP=1 -f` against a scratch Postgres (if available), or review by eye. Apply to prod only in Task 11.
- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261012120000_haccp_plan_shares.sql
git commit -m "feat(db): haccp_plan_shares for inspector links and PDF render tokens"
```

---

### Task 5: Edge function `haccp-plan`

**Files:**
- Create: `supabase/functions/_shared/haccp-plan/aggregate.ts`, `aggregate.test.ts`, `handler.ts`, `handler.test.ts`, `load.ts`
- Create: `supabase/functions/haccp-plan/index.ts`

**Interfaces:**
- Produces (`aggregate.ts`):

```ts
export type DayStatus = 'ok' | 'flagged' | 'corrected' | 'missed' | 'none'
export interface CompletionRow { template_id: string; completed_at: string; by_name: string | null
  responses: { flagged: boolean | null; corrective_status: string | null; item_type: string | null }[] }
export interface InstanceRow { template_id: string; due_date: string; status: string }   // due_date YYYY-MM-DD
export interface TemplateRow { id: string; name: string; library_key: string | null; sfbb_section: string | null; frequency: string }
export function periodFor(now: Date, tz: string): { start: string; end: string; dates: string[] }   // 28 dates, end = yesterday local
export function localDate(iso: string, tz: string): string                                          // YYYY-MM-DD in tz
export function initials(name: string | null): string | null                                        // "Tom Achton" → "TA"
export function aggregateTemplates(templates: TemplateRow[], completions: CompletionRow[], instances: InstanceRow[], dates: string[], tz: string): TemplateProof[]
export function aggregateDeliveries(rows: { received_at: string; product_temperature: number | null; frozen: boolean }[], dates: string[], tz: string): DeliveryProof
```

(`TemplateProof` and `DeliveryProof` mirror `src/lib/haccp-plan/types.ts`; they are re-declared here because Deno cannot import from `src`.)

Day status rules per template and day:
- any response flagged with `corrective_status !== 'done'` → `flagged`;
- else any flagged and done → `corrected`;
- else any completion → `ok`;
- else an instance with status `missed` → `missed`;
- else `none`.

`readings` = the count of responses with `item_type === 'temperature'`. `initials` are unique, in order of first appearance.

- Produces (`handler.ts`):

```ts
export interface HandlerDeps {
  now: () => Date
  sha256Hex: (s: string) => Promise<string>
  findShare: (hash: string) => Promise<{ id: string; business_id: string; site_id: string | null; kind: 'inspector' | 'pdf'; expires_at: string; revoked_at: string | null } | null>
  bumpShare: (id: string) => Promise<void>
  getUserId: (jwt: string) => Promise<string | null>
  memberAccess: (userId: string, siteId: string | null) => Promise<{ businessId: string; canManage: boolean } | 'forbidden'>
  loadBundle: (businessId: string, siteId: string | null) => Promise<Record<string, unknown>>
}
export type HandlerResult = { status: number; body: unknown }
export async function handlePlanRequest(req: { method: string; token: string | null; authorization: string | null; siteId: string | null | undefined }, deps: HandlerDeps): Promise<HandlerResult>
```

Rules:
- **Token mode** (token present): the format must match `/^[A-Za-z0-9_-]{43}$/`, else 404 `{error:'not_found'}`. Not found, revoked, or `expires_at <= now` → 404 `{error:'expired'}`. Otherwise `bumpShare` only for `kind==='inspector'`, then 200 with `{...bundle, share:{kind,expiresAt}, viewer:null}`.
- **Member mode** (no token): no bearer → 401; `getUserId` null → 401; `memberAccess` `'forbidden'` → 403; otherwise 200 with `{...bundle, share:null, viewer:{canManage,userId}}`.
- Any thrown error → 500 `{error:'internal'}`. Log `console.error` without the token.

- [ ] **Step 1: Write the failing aggregate tests**

```ts
// supabase/functions/_shared/haccp-plan/aggregate.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { periodFor, localDate, initials, aggregateTemplates, aggregateDeliveries } from "./aggregate.ts";

const TZ = "Europe/London";

Deno.test("period is the 28 local days ending yesterday", () => {
  const p = periodFor(new Date("2026-10-11T09:00:00Z"), TZ);
  assertEquals(p.dates.length, 28);
  assertEquals(p.start, "2026-09-13");
  assertEquals(p.end, "2026-10-10");
});

Deno.test("local dates respect BST and the 25 Oct 2026 change to GMT", () => {
  assertEquals(localDate("2026-10-24T23:30:00Z", TZ), "2026-10-25"); // BST: 00:30 next day
  assertEquals(localDate("2026-10-25T23:30:00Z", TZ), "2026-10-25"); // GMT after the change
  assertEquals(localDate("2026-09-30T23:10:00Z", TZ), "2026-10-01");
});

Deno.test("initials", () => {
  assertEquals(initials("Tom Achton"), "TA");
  assertEquals(initials("priya"), "P");
  assertEquals(initials(null), null);
});

Deno.test("day status precedence and counts", () => {
  const p = periodFor(new Date("2026-10-11T09:00:00Z"), TZ);
  const t = [{ id: "t1", name: "Fridge", library_key: "fridge_temps", sfbb_section: "temperature", frequency: "daily" }];
  const c = [
    { template_id: "t1", completed_at: "2026-10-10T07:30:00Z", by_name: "Tom Achton", responses: [{ flagged: false, corrective_status: null, item_type: "temperature" }] },
    { template_id: "t1", completed_at: "2026-10-09T07:30:00Z", by_name: "Priya Kaur", responses: [{ flagged: true, corrective_status: "done", item_type: "temperature" }] },
    { template_id: "t1", completed_at: "2026-10-08T07:30:00Z", by_name: "Tom Achton", responses: [{ flagged: true, corrective_status: "needed", item_type: "temperature" }, { flagged: false, corrective_status: null, item_type: "yes_no" }] },
  ];
  const inst = [{ template_id: "t1", due_date: "2026-10-07", status: "missed" }];
  const [r] = aggregateTemplates(t, c, inst, p.dates, TZ);
  assertEquals(r.days.slice(-4), ["missed", "flagged", "corrected", "ok"]);
  assertEquals([r.completions, r.flagged, r.corrected, r.readings], [3, 2, 1, 3]);
  assertEquals(r.initials, ["TA", "PK"]);
  assertEquals(r.lastCompletedAt, "2026-10-10T07:30:00Z");
});

Deno.test("deliveries out of range: chilled > 5, frozen > -15", () => {
  const p = periodFor(new Date("2026-10-11T09:00:00Z"), TZ);
  const d = aggregateDeliveries([
    { received_at: "2026-10-10T08:15:00Z", product_temperature: 3.8, frozen: false },
    { received_at: "2026-10-10T10:05:00Z", product_temperature: 9.2, frozen: false },
    { received_at: "2026-10-09T10:05:00Z", product_temperature: -12, frozen: true },
    { received_at: "2026-10-08T10:05:00Z", product_temperature: null, frozen: false },
  ], p.dates, TZ);
  assertEquals([d.count, d.outOfRange], [4, 2]);
  assertEquals(d.days.slice(-3), ["ok", "flagged", "flagged"]);
});
```

> 10-08: no temperature → `ok`; 10-09: frozen at −12 °C (> −15) → `flagged`; 10-10: one at 9.2 °C → `flagged`. Deliveries have no corrective status, so a day is never `corrected`.

- [ ] **Step 2: Run** `deno test supabase/functions/_shared/haccp-plan/aggregate.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `aggregate.ts`.**
  - `localDate` = `new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))`.
  - `periodFor`: take today's local date via `localDate(now)`, then step back 1..28 days using UTC date arithmetic on the `YYYY-MM-DD` string (`Date.UTC` parts, minus N days, then `toISOString().slice(0,10)`), and return the dates oldest first.

- [ ] **Step 4: Run the aggregate tests.** Expected: PASS.

- [ ] **Step 5: Write the failing handler tests**

```ts
// supabase/functions/_shared/haccp-plan/handler.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handlePlanRequest, type HandlerDeps } from "./handler.ts";

const TOKEN = "a".repeat(43);
function deps(over: Partial<HandlerDeps> = {}): HandlerDeps & { bumped: string[] } {
  const bumped: string[] = [];
  return {
    bumped,
    now: () => new Date("2026-10-11T09:00:00Z"),
    sha256Hex: async (s) => `h:${s}`,
    findShare: async () => ({ id: "s1", business_id: "b1", site_id: "site1", kind: "inspector", expires_at: "2026-10-18T09:00:00Z", revoked_at: null }),
    bumpShare: async (id) => { bumped.push(id); },
    getUserId: async (jwt) => (jwt === "good" ? "u1" : null),
    memberAccess: async (_u, site) => (site === "site1" ? { businessId: "b1", canManage: true } : "forbidden"),
    loadBundle: async (b, s) => ({ business: { id: b }, site: { id: s } }),
    ...over,
  };
}

Deno.test("token: valid inspector link returns bundle and counts the view", async () => {
  const d = deps();
  const r = await handlePlanRequest({ method: "GET", token: TOKEN, authorization: null, siteId: null }, d);
  assertEquals(r.status, 200);
  assertEquals((r.body as any).share, { kind: "inspector", expiresAt: "2026-10-18T09:00:00Z" });
  assertEquals((r.body as any).viewer, null);
  assertEquals(d.bumped, ["s1"]);
});

Deno.test("token: pdf tokens are not counted as views", async () => {
  const d = deps({ findShare: async () => ({ id: "s2", business_id: "b1", site_id: null, kind: "pdf", expires_at: "2026-10-11T09:05:00Z", revoked_at: null }) });
  const r = await handlePlanRequest({ method: "GET", token: TOKEN, authorization: null, siteId: null }, d);
  assertEquals(r.status, 200);
  assertEquals(d.bumped, []);
});

Deno.test("token: expired, revoked, unknown and malformed are 404 and load nothing", async () => {
  let loads = 0;
  const base = { loadBundle: async () => { loads++; return {}; } };
  const cases: Partial<HandlerDeps>[] = [
    { ...base, findShare: async () => ({ id: "s", business_id: "b", site_id: null, kind: "inspector", expires_at: "2026-10-11T08:59:59Z", revoked_at: null }) },
    { ...base, findShare: async () => ({ id: "s", business_id: "b", site_id: null, kind: "inspector", expires_at: "2026-10-18T00:00:00Z", revoked_at: "2026-10-10T00:00:00Z" }) },
    { ...base, findShare: async () => null },
  ];
  for (const c of cases) assertEquals((await handlePlanRequest({ method: "GET", token: TOKEN, authorization: null, siteId: null }, deps(c))).status, 404);
  assertEquals((await handlePlanRequest({ method: "GET", token: "short", authorization: null, siteId: null }, deps(base))).status, 404);
  assertEquals(loads, 0);
});

Deno.test("member: 401 without or with a bad JWT, 403 for a site the user cannot see", async () => {
  assertEquals((await handlePlanRequest({ method: "POST", token: null, authorization: null, siteId: "site1" }, deps())).status, 401);
  assertEquals((await handlePlanRequest({ method: "POST", token: null, authorization: "Bearer bad", siteId: "site1" }, deps())).status, 401);
  assertEquals((await handlePlanRequest({ method: "POST", token: null, authorization: "Bearer good", siteId: "other" }, deps())).status, 403);
});

Deno.test("member: ok returns viewer", async () => {
  const r = await handlePlanRequest({ method: "POST", token: null, authorization: "Bearer good", siteId: "site1" }, deps());
  assertEquals(r.status, 200);
  assertEquals((r.body as any).viewer, { canManage: true, userId: "u1" });
  assertEquals((r.body as any).share, null);
});

Deno.test("errors become 500 without leaking", async () => {
  const r = await handlePlanRequest({ method: "POST", token: null, authorization: "Bearer good", siteId: "site1" }, deps({ loadBundle: async () => { throw new Error("db down"); } }));
  assertEquals(r, { status: 500, body: { error: "internal" } });
});
```

- [ ] **Step 6: Run** `deno test supabase/functions/_shared/haccp-plan/`. Expected: the handler tests FAIL.
- [ ] **Step 7: Implement `handler.ts` per the rules.** Run the tests. Expected: PASS.

- [ ] **Step 8: Implement `load.ts`** with `loadBundle(admin, businessId, siteId, now)`. Run the queries below with the service client. Every query filters `business_id = businessId`; the site filter applies where noted.
  - `businesses`: `id, name, address, post_code, fsa_rating, haccp_auto_fill, haccp_last_reviewed_at`, where `deleted_at is null`. Missing → throw.
  - `sites`: `id, name, address, postcode, fsa_rating, timezone, manager_id`, by id when `siteId`. Must belong to the business, else throw.
  - `haccp_pack_data`: `data, updated_at` (`.eq('site_id', siteId)` or `.is('site_id', null)`), via `maybeSingle()`. Unpack like `page.tsx:163-174`.
  - `haccp_signoffs`: `signed_by_name, signed_at` for the site, via `maybeSingle()`.
  - The sources, with the same selects as `page.tsx` (recipes, menu_items + `site_ids` if that column exists, suppliers, checklist_templates `id, name, frequency, sfbb_section, library_key, site_id, active`, documents `id, title, category`, profiles `full_name, role` where `removed_at is null`).
    - Before writing the menu_items select, check how `site_ids` is populated: `grep -rn "site_ids" src/lib src/app/(dashboard)/menu`. If it is derived from a join table, replicate that join.
  - Proof (period from `periodFor(now, site?.timezone ?? 'Europe/London')`, with a query range of `[start 00:00 local − 1 day, end + 2 days]` in UTC, then exact filtering by `localDate`):
    - templates: active, and `site_id is null or = siteId`;
    - `checklist_completions`: `template_id, completed_at, completed_by:profiles!checklist_completions_completed_by_fkey(full_name), checklist_responses(flagged, corrective_status, item:checklist_template_items(item_type, name), value, notes)`, filtered by site when `siteId`;
    - `checklist_instances`: `template_id, due_date, status`, filtered by site when `siteId`;
    - `deliveries`: `received_at, product_temperature` plus frozen detection. Check whether `deliveries` has a `category`/`frozen` column; if not, treat temperatures ≤ −5 °C as frozen.
  - `corrective`: from the same completions, flagged responses, latest 20, mapped to `CorrectiveEntry`.
  - `lastReview`: the latest completion of a template with `library_key='haccp_review'` or a name matching `/4.?weekly|haccp review/i`.
  - `people`:
    - `operator` = the first profile with `role === 'owner'`;
    - `siteManager` = the profile with id `sites.manager_id`;
    - both are `full_name`.
  - Return `{ generatedAt, periodStart, periodEnd, business, site, pack, signoff, sources, proof, people }` with camelCase keys as in `PlanBundle`.

- [ ] **Step 9: Implement `index.ts`.**
  - Create the service client as in `channel-form`.
  - CORS allow-list: `https://app.blueroll.app`, `http://localhost:3001`, plus the comma-separated `PLAN_EXTRA_ORIGINS` env. Methods `GET, POST, OPTIONS`; headers `Authorization, Content-Type, apikey, x-client-info`.
  - `GET ?t=` → token mode. `POST {site_id}` + Authorization → member mode.
  - Real deps:
    - `sha256Hex` via `crypto.subtle.digest`;
    - `findShare`/`bumpShare` on `haccp_plan_shares` (bump = `update view_count = view_count + 1, last_viewed_at = now()` via RPC-free read-then-update);
    - `getUserId` via `admin.auth.getUser(jwt)`;
    - `memberAccess` reads the profile `business_id, role, removed_at, is_group_admin` and the site (it must belong to the business), then visibility: group admin, or no `member_sites` rows for the profile, or a `member_sites` row for the site; `canManage` = role in owner/manager;
    - `loadBundle`.
  - Respond with JSON and `Cache-Control: no-store`.

- [ ] **Step 10: Type-check the function.** Run `deno check supabase/functions/haccp-plan/index.ts`. Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add supabase/functions/_shared/haccp-plan supabase/functions/haccp-plan
git commit -m "feat(edge): haccp-plan function — member and token modes, 28-day proof aggregation"
```

---

### Task 6: Client data layer — fetch, shares, sign-off

**Files:**
- Create: `src/lib/haccp-plan/api.ts`, `src/lib/haccp-plan/share.ts`, `src/lib/haccp-plan/share.test.ts`

**Interfaces:**
- Produces:

```ts
// api.ts
export async function fetchPlanBundleForSite(siteId: string | null): Promise<PlanBundle>   // supabase.functions.invoke('haccp-plan', { body: { site_id: siteId } })
export async function fetchPlanBundleByToken(token: string): Promise<PlanBundle | 'expired'>  // fetch(`${URL}/functions/v1/haccp-plan?t=`, { headers: { apikey: ANON } }); 404 → 'expired'
export async function signOffPlan(p: { businessId: string; siteId: string; userId: string; name: string }): Promise<void> // upsert haccp_signoffs onConflict business_id,site_id
// share.ts
export function newToken(): string                       // 32 random bytes → base64url, 43 chars
export async function sha256Hex(s: string): Promise<string>
export function planUrl(origin: string, token: string): string  // `${origin}/plan/${token}`
export async function createShare(p: { kind: 'inspector' | 'pdf'; businessId: string; siteId: string | null; userId: string; label?: string; ttlMs: number }): Promise<{ token: string; url: string; expiresAt: string }>
export async function listInspectorShares(businessId: string, siteId: string | null): Promise<{ id: string; label: string | null; created_at: string; expires_at: string; revoked_at: string | null; view_count: number; last_viewed_at: string | null }[]>
export async function revokeShare(id: string): Promise<void>
export const TTL = { pdf: 10 * 60_000, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 }
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/haccp-plan/share.test.ts
import { describe, it, expect } from 'vitest'
import { newToken, sha256Hex, planUrl } from './share'

describe('share tokens', () => {
  it('are 43-char base64url and unique', () => {
    const a = newToken(), b = newToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
  })
  it('hash to lowercase sha256 hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('builds the public url', () => {
    expect(planUrl('https://app.blueroll.app', 'tok')).toBe('https://app.blueroll.app/plan/tok')
  })
})
```

- [ ] **Step 2: Run to verify failure:** `npx vitest run src/lib/haccp-plan/share.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `newToken`: `crypto.getRandomValues(new Uint8Array(32))`, then `btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')`.
  - `sha256Hex`: `crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))` → hex.
  - `createShare`: inserts `{business_id, site_id, kind, token_hash, label, created_by, expires_at: new Date(Date.now()+ttlMs).toISOString()}` via `supabase.from('haccp_plan_shares')`; throws on error.
- [ ] **Step 4: Run** `npx vitest run src/lib/haccp-plan/`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/haccp-plan/api.ts src/lib/haccp-plan/share.ts src/lib/haccp-plan/share.test.ts
git commit -m "feat(haccp-plan): client fetchers, share tokens, sign-off"
```

---

### Task 7: The renderer

**Files:**
- Create: `src/components/haccp-plan/plan.css`, `PlanDocument.tsx`, `Cover.tsx`, `AtAGlance.tsx`, `MethodPage.tsx`, `ProofPanel.tsx`, `CorrectivePage.tsx`, `SignoffPage.tsx`, `SectionIcon.tsx`, `infographics/TempScale.tsx`, `infographics/CookCombos.tsx`, `infographics/PanToPass.tsx`, `infographics/TwoStageClean.tsx`, `infographics/CleaningFrequency.tsx`, `infographics/AllergenMatrix.tsx`
- Create: `src/app/dev/haccp-plan-preview/page.tsx` (renders `buildPlan(makeRichBundle())` from fixtures, only when `process.env.NODE_ENV !== 'production'`, otherwise `notFound()`)
- Modify: `src/lib/haccp-plan/fixtures.ts`: add `makeRichBundle()` reproducing the design's St James’s Café sample (toggles, answers, 8 dishes, templates with proof, a signoff)

**Interfaces:**
- Consumes: `PlanDoc` (Task 2), `OGL_ATTRIBUTION`, `SECTION_NAME`.
- Produces:
  - `export function PlanDocument(props: { doc: PlanDoc; mode: 'screen' | 'print'; qrUrl?: string | null }): JSX.Element`. Root `<article className="plan-doc" data-mode={mode}>`, and every sheet is `<section className="plan-sheet">`.
  - `export function SectionIcon(props: { section: SectionId | 'fridge' | 'allergens' | 'thermometer' | 'review'; size?: number; tone?: 'tint' | 'solid' | 'plain' })`.

Mapping from the design files (copy the markup structure and inline values, converting to JSX and classes in `plan.css`; keep the exact colours and sizes):

| Component | Design file | Notes |
|---|---|---|
| Cover | `Main.dc.html` | band colour `#1f7a52`; QR box shows `qrUrl` encoded with an inline SVG QR. **No new dep:** if no QR encoder exists in the repo, render the URL text instead of a QR. Check with `grep -rn "qrcode" package.json src` first; there is a QR generator in the letter tool, but that is not in this repo. |
| AtAGlance | `Contents.dc.html` | contents rows show method refs (e.g. "3.1–3.4"), not page numbers |
| MethodPage | `Method-Chilling.dc.html`, `Method-Allergens.dc.html`, `Method-Cooking.dc.html`, `Method-Cleaning.dc.html` | header with SectionIcon `solid` 56; the 132 px label column grid; answers render `value.split('\n')` as `<p>`s; `autoLabel` as a small brand-deep caption; attachments as a "Attached" list; open points as an amber list "Still to complete" |
| ProofPanel | the "Prove it" block in `Method-Chilling` | 28-cell strip: ok `#1f9d63`, flagged `#d2453f`, corrected `#e0a43a`, missed `#c9cdd3` with a diagonal hatch, none `#eef0f2`; legend; null proof → muted box "No records linked yet — add a checklist in Blueroll" |
| TempScale | `Method-Chilling` Why row | static |
| CookCombos, PanToPass | `Method-Cooking` | static |
| TwoStageClean | `Method-Cleaning` | sanitiser product from the answer to `ce_sanitiser`; if empty, show "[sanitiser]" in muted text |
| CleaningFrequency | `Method-Cleaning` | from `doc.cleaningFrequency`; hidden if all counts are 0 |
| AllergenMatrix | `Method-Allergens` | columns `EU_ALLERGENS` → `ALLERGEN_LABELS`; header cells rotated; `<thead>` with `display: table-header-group` so Chromium repeats it on page breaks; use a real `<table>` |
| SignoffPage | `Review-Signoff.dc.html` | declaration text with the business and site names; signer block; "Edited after sign-off — sign again" amber banner when `editedAfter`; OGL attribution |
| CorrectivePage | new, same style as the review table | columns Date · Check · Item · Reading · Action status · By; empty → "No out-of-range readings in the last 28 days." |

`plan.css` must contain:

```css
.plan-doc { font-family: var(--font-geist), system-ui, sans-serif; color: #16181d; }
.plan-doc[data-mode='screen'] { display: flex; flex-direction: column; gap: 24px; align-items: center; }
.plan-doc[data-mode='screen'] .plan-sheet { width: 100%; max-width: 794px; background: #fff; border: 1px solid #e9eaed; border-radius: 12px; padding: 44px 64px 36px; box-sizing: border-box; }
@media (max-width: 640px) { .plan-doc[data-mode='screen'] .plan-sheet { padding: 20px 16px; border-radius: 0; border-left: 0; border-right: 0; } .plan-grid-2, .plan-grid-3, .plan-grid-4, .plan-grid-5 { grid-template-columns: minmax(0, 1fr) !important; } .plan-label-grid { grid-template-columns: minmax(0, 1fr) !important; } }
.plan-scroll-x { overflow-x: auto; }
@page { size: A4; margin: 14mm 16mm 18mm; }
.plan-doc[data-mode='print'] .plan-sheet { break-before: page; padding: 0; }
.plan-doc[data-mode='print'] .plan-sheet:first-child { break-before: auto; }
.plan-doc[data-mode='print'] .plan-keep { break-inside: avoid; }
.plan-doc[data-mode='print'] { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print { body { background: #fff !important; } .plan-no-print { display: none !important; } .plan-doc .plan-sheet { break-before: page; border: 0 !important; border-radius: 0 !important; padding: 0 !important; max-width: none !important; } .plan-doc .plan-sheet:first-child { break-before: auto; } }
```

- [ ] **Step 1: Build `SectionIcon` and the six infographics** as pure presentational components with no data fetching. Check them on `/dev/haccp-plan-preview` with `npm run dev` (port 3001).
- [ ] **Step 2: Build `ProofPanel`, `MethodPage`, `Cover`, `AtAGlance`, `CorrectivePage`, `SignoffPage` and `PlanDocument`.** Order: Cover → AtAGlance → for each section the methods (a section heading strip appears above the first method of each section, inside that method's sheet) → CorrectivePage → SignoffPage.
- [ ] **Step 3: Visual check.**
  - Open `http://localhost:3001/dev/haccp-plan-preview` with the browser preview tools and compare against the canvas artboards; screenshot Cover, Chilled storage, Food allergies, Cooking safely, Cleaning effectively and Sign-off.
  - Resize to 375 px and confirm there is no horizontal page scroll and the matrix scrolls inside its box.
  - Print-preview with `?mode=print` (the preview page reads `mode` from the search params) via `window.print()`.
- [ ] **Step 4:** `npx tsc --noEmit` (no new errors vs. baseline), `npm run lint -- src/components/haccp-plan src/app/dev`.
- [ ] **Step 5: Commit**

```bash
git add src/components/haccp-plan src/app/dev/haccp-plan-preview src/lib/haccp-plan/fixtures.ts
git commit -m "feat(haccp-plan): document renderer, infographics and print CSS"
```

---

### Task 8: In-app document page

**Files:**
- Create: `src/app/(dashboard)/haccp-pack/document/page.tsx`, `src/components/haccp-plan/ShareDialog.tsx`, `src/components/haccp-plan/PresentOverlay.tsx`
- Modify: `src/app/(dashboard)/haccp-pack/page.tsx`: replace the "Export PDF" button (`:778-785`) and `handleExportPDF` (`:649-703`) with `<Link href="/haccp-pack/document">View document</Link>`, styled like the existing button; remove `handleExportPDF` and its `onExportPDF` prop usage on `AllSitesDashboard` (`:714`; check that component's props and drop the PDF button there or point it to the document of the selected site).

**Interfaces:**
- Consumes: `fetchPlanBundleForSite`, `buildPlan`, `PlanDocument`, `createShare`, `listInspectorShares`, `revokeShare`, `signOffPlan`, `TTL`, `planUrl`.

Behaviour:
- `packSiteId` uses the same rule as the pack page: `currentSiteId ?? (sites.length === 1 ? sites[0].id : null)`. With "All sites" on a multi-site group, show "Pick a site to view its HACCP Plan" using `EmptyState`.
- `useQuery(['haccp-plan', businessId, packSiteId], () => fetchPlanBundleForSite(packSiteId))`. While loading, show a `Skeleton` sheet; on error, an inline error with Retry.
- Toolbar (sticky, `plan-no-print`):
  - "Back to pack";
  - status chip (Inspection-ready / x% complete);
  - **Present** (opens `PresentOverlay`: fixed full-screen, section chips scroll to `#section-<id>`, Esc closes);
  - **Share with inspector** (managers only: `bundle.viewer.canManage`);
  - **Download PDF**;
  - **Sign off** (managers only and when `packSiteId`: confirm dialog → `signOffPlan` → invalidate the query).
- **Download PDF:**
  1. `createShare({kind:'pdf', ttlMs: TTL.pdf, ...})`;
  2. `const res = await fetch('/api/haccp-plan/pdf?t=' + token)`;
  3. `if (!res.ok)`, toast an error;
  4. otherwise blob → `URL.createObjectURL` → an `<a download={doc.fileName}>` click.

  Show a spinner state "Preparing PDF…" because it takes several seconds.
- **ShareDialog:**
  - label input (optional, max 80) and expiry select (1 day / 7 days default / 30 days);
  - "Create link" → `createShare({kind:'inspector'})` → show the URL in a read-only input with Copy and a note "This link is shown once. Anyone with it can view this plan until {date}.";
  - below, a list of active links (`listInspectorShares`, not revoked, not expired) with label, expires, views, and a Revoke button.

- [ ] **Step 1: Implement the page, overlay and dialog.**
- [ ] **Step 2: Manual check against the deployed edge function.** This needs Task 11 steps 1–2 approved first; until then, temporarily point `fetchPlanBundleForSite` at a local `supabase functions serve haccp-plan --env-file` only if service-role env is available locally, otherwise verify with the `/dev` preview.
- [ ] **Step 3: `npx tsc --noEmit`, lint, `npm test`.**
- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/haccp-pack" src/components/haccp-plan/ShareDialog.tsx src/components/haccp-plan/PresentOverlay.tsx
git commit -m "feat(haccp-plan): in-app document view with present, share, sign-off and PDF download"
```

---

### Task 9: Public inspector page

**Files:**
- Create: `src/app/plan/layout.tsx`, `src/app/plan/[token]/page.tsx`

Behaviour:
- **layout:** bare like `src/app/tg/layout.tsx`, with `metadata = { title: 'HACCP Plan', robots: { index: false, follow: false } }` and a `viewport` with `width: 'device-width', initialScale: 1`. Also add a `referrer: 'no-referrer'` meta (via `metadata.referrer`).
- **page** (`'use client'`):
  - `const { token } = useParams<{ token: string }>()` and `const print = useSearchParams().get('print') === '1'`, wrapped in `<Suspense>`.
  - Fetch with `fetchPlanBundleByToken`.
  - **States:**
    - loading → `data-plan-state="loading"`;
    - `'expired'` → a centered card "This link has expired or was withdrawn. Ask the business for a new one." with `data-plan-state="error"`;
    - error → the same card with "Couldn’t load this plan. Try again." and `data-plan-state="error"`;
    - ready → `await document.fonts.ready`, then set `data-plan-state="ready"`.
  - The root element carries `data-plan-state`, `data-plan-filename={doc.fileName}` and `data-plan-footer={doc.footerLabel}`.
  - **Screen mode** (not print):
    - a top bar `#14161b`: "HACCP Plan · read-only" plus "Shared until {date}" and a **Download PDF** link to `/api/haccp-plan/pdf?t=${token}`;
    - sticky section chips;
    - then `<PlanDocument mode="screen" qrUrl={null} />`.
  - **Print mode:** `<PlanDocument mode="print" />` only, with a white background.
- The token never goes into analytics or logs. There are no external scripts on this page; check that the root layout adds none. If it does, note it in the PR.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Manual check** (after the edge function is deployed): a valid link, an expired link (create one with `ttlMs: 1000`, wait), and a revoked link. Phone width 375 px.
- [ ] **Step 3: Commit**

```bash
git add src/app/plan
git commit -m "feat(haccp-plan): public read-only inspector page"
```

---

### Task 10: Server PDF route

**Files:**
- Modify: `package.json` (add `puppeteer-core`, `@sparticuz/chromium`), `next.config.ts`
- Create: `src/lib/haccp-plan/pdf.ts`, `src/app/api/haccp-plan/pdf/route.ts`, `src/lib/haccp-plan/pdf.test.ts`

**Interfaces:**
- Produces:

```ts
// pdf.ts
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
export function footerTemplate(label: string): string        // HTML-escaped label + "Page <span class=pageNumber> of <span class=totalPages>"
export function contentDisposition(fileName: string): string   // attachment; filename="…"; filename*=UTF-8''…
export async function renderPlanPdf(opts: { origin: string; token: string; bypassSecret?: string; timeoutMs?: number }): Promise<{ status: 'ok'; pdf: Uint8Array; fileName: string } | { status: 'not_found' } | { status: 'timeout' } | { status: 'error' }>
```

- [ ] **Step 1: Install.** Read the `@sparticuz/chromium` README for the matching `puppeteer-core` major before installing.

Run: `npm i puppeteer-core@^25 @sparticuz/chromium@^153`
Expected: both added to `dependencies`.

- [ ] **Step 2: Configure `next.config.ts`:** add `serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core']` (check that the exact key name exists in `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/`).

- [ ] **Step 3: Write the failing tests**

```ts
// src/lib/haccp-plan/pdf.test.ts
import { describe, it, expect } from 'vitest'
import { TOKEN_RE, footerTemplate, contentDisposition } from './pdf'

describe('pdf helpers', () => {
  it('validates tokens', () => {
    expect(TOKEN_RE.test('a'.repeat(43))).toBe(true)
    expect(TOKEN_RE.test('a'.repeat(42))).toBe(false)
    expect(TOKEN_RE.test('../../etc/passwd' + 'a'.repeat(27))).toBe(false)
  })
  it('escapes the footer label', () => {
    const f = footerTemplate('Tom & Jerry <Café>')
    expect(f).toContain('Tom &amp; Jerry &lt;Café&gt;')
    expect(f).toContain('class="pageNumber"')
    expect(f).toContain('class="totalPages"')
  })
  it('builds a safe content disposition', () => {
    expect(contentDisposition('HACCP-Plan-st-james-s-cafe.pdf')).toBe(`attachment; filename="HACCP-Plan-st-james-s-cafe.pdf"; filename*=UTF-8''HACCP-Plan-st-james-s-cafe.pdf`)
    expect(contentDisposition('a"b.pdf')).toContain('filename="a_b.pdf"')
  })
})
```

- [ ] **Step 4: Run to verify failure,** then implement `pdf.ts`.

`renderPlanPdf`:
1. `const local = process.env.CHROME_EXECUTABLE_PATH`.
2. Launch puppeteer-core: locally with `{ executablePath: local, headless: true }`; otherwise `{ args: chromium.args, executablePath: await chromium.executablePath(), headless: true }`.
3. `page.setViewport({ width: 1240, height: 1754 })`. If `bypassSecret`, `page.setExtraHTTPHeaders({ 'x-vercel-protection-bypass': bypassSecret })`.
4. `goto(`${origin}/plan/${token}?print=1`, { waitUntil: 'networkidle0', timeout })`, then `waitForSelector('[data-plan-state="ready"],[data-plan-state="error"]', { timeout })`.
5. If the state is error → `not_found`.
6. Read `data-plan-filename` and `data-plan-footer`, then `page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footerTemplate(label), margin: { top: '14mm', bottom: '18mm', left: '16mm', right: '16mm' } })`.
7. A `TimeoutError` → `timeout`. Always `browser.close()` in `finally`.

- [ ] **Step 5: Implement the route**

```ts
// src/app/api/haccp-plan/pdf/route.ts
import { NextResponse } from 'next/server'
import { TOKEN_RE, renderPlanPdf, contentDisposition } from '@/lib/haccp-plan/pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get('t') ?? ''
  if (!TOKEN_RE.test(token)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // Cheap pre-check so bad links never start Chromium.
  const check = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/haccp-plan?t=${token}`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, cache: 'no-store',
  })
  if (check.status === 404) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!check.ok) return NextResponse.json({ error: 'upstream' }, { status: 502 })
  const origin = process.env.PLAN_RENDER_ORIGIN ?? url.origin
  const r = await renderPlanPdf({ origin, token, bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET, timeoutMs: 25_000 })
  if (r.status === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (r.status === 'timeout') return NextResponse.json({ error: 'timeout' }, { status: 504 })
  if (r.status === 'error') return NextResponse.json({ error: 'render_failed' }, { status: 500 })
  return new NextResponse(Buffer.from(r.pdf), { headers: {
    'Content-Type': 'application/pdf', 'Content-Disposition': contentDisposition(r.fileName),
    'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex',
  } })
}
```

> The pre-check counts an inspector view, so the inspector's PDF download counts as one extra view. That is acceptable; note it in the PR description.

- [ ] **Step 6: Run** `npx vitest run src/lib/haccp-plan/pdf.test.ts`. Expected: PASS.
- [ ] **Step 7: Local end-to-end** (after the edge function is deployed).
  - Run `CHROME_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run dev`.
  - Create a PDF token from the in-app page and download the file.
  - Open the PDF. Check for: A4 pages, a footer with page X of Y, the cover band colour printed, each method on a new page, matrix headers repeated, and a long answer that wraps.
- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json next.config.ts src/lib/haccp-plan/pdf.ts src/lib/haccp-plan/pdf.test.ts src/app/api/haccp-plan
git commit -m "feat(haccp-plan): server-rendered A4 PDF via headless Chromium"
```

---

### Task 11: Ship (every step needs the user's explicit go-ahead)

- [ ] **Step 1:** Apply the migration to prod. Run `SUPABASE_ACCESS_TOKEN=… supabase db push --project-ref rszrggreuarvodcqeqrj --include-all --dry-run` first and show the output. Push only after approval. Then verify with `select count(*) from haccp_plan_shares` and the policies list.
- [ ] **Step 2:** Deploy the function: `SUPABASE_ACCESS_TOKEN=… supabase functions deploy haccp-plan --project-ref rszrggreuarvodcqeqrj --no-verify-jwt`. Smoke-test it: a GET with a bogus token → 404; a POST without auth → 401.
- [ ] **Step 3:** Run the full checks: `npm test`, `deno test supabase/functions/_shared/haccp-plan/`, `npx tsc --noEmit` (baseline compare), `npm run build`.
- [ ] **Step 4:** Push the branch and open a PR to `main`. In the body: what, why, the screenshots, the migration plus function already applied, follow-ups (the mobile entry point, versioning, the 16 pack fields without questionnaire questions), and the note about the PDF counting as a view.
- [ ] **Step 5:** After merge, `vercel --prod` as per the repo workflow. On production, smoke-test the in-app document, the inspector link on a phone, and the PDF download.
