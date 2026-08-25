# In-App Onboarding Assistant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paying Blueroll client stands up their live site by sending photos/text/voice to an in-app assistant, which uses Claude to build their checklists and menu-with-allergens automatically.

**Architecture:** Deno Supabase Edge Functions do the AI extraction and the DB build (mirroring the existing `ai-generate-checklist`); pure, cross-cutting logic (allergen mapping, JSON→rows build plan) lives in `supabase/functions/_shared/` and is unit-tested with `deno test`. A React widget (modelled on `src/components/feedback-beacon.tsx`) collects media and drives the flow, unit-tested with vitest.

**Tech Stack:** Next.js (App Router) + React + TypeScript + Supabase JS + react-query + zod + Tailwind (web); Deno + Anthropic SDK (edge functions); vitest (web tests); deno test (shared logic).

## Global Constraints

- Allergen vocabulary is EXACTLY these 14 keys: `gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery, mustard, sesame, sulphites, lupin, molluscs`. Guide-label mapping: Soya→soybeans, Tree nuts/Nuts→nuts, Sulphite→sulphites, Cereals containing gluten→gluten.
- `checklist_template_items.item_type` ∈ `tick|temperature|text|yes_no|photo|initials` (CHECK-enforced).
- `checklist_templates.frequency` ∈ `daily|weekly|monthly|four_weekly|custom`.
- `menu_items.allergen_source` ∈ `manual|recipe` (CHECK). Manual rows REQUIRE `attested_by_name` AND `attested_at` (CHECK `menu_items_attestation_check`).
- **Never write empty `assigned_roles` (`[]` = invisible to everyone).** Fall back to `['manager','kitchen_staff','front_of_house']`.
- **Always backfill `assigned_role_ids`** from `roles.base_tier` for every inserted template (rows with `'{}'` are invisible under the app's role_id filter).
- Allergens are auto-written but flagged pending owner attestation: `allergen_source='manual'`, `attested_by=NULL`, `attested_by_name='Imported — pending owner verification'`, `attested_at=now()`.
- All build writes idempotent: upsert templates by `(business_id, name)`, menu_categories by `(site_id, lower(name))`, menu_items by `(business_id, name)`.
- Supabase project ref: `rszrggreuarvodcqeqrj`. Service-role key only server-side (edge function env), never in client.

## Phasing

**Ship checklists first, then menu/allergens.**
- **Phase 1 (v1 — checklists):** Tasks 1, 2, 4, 5, 6, 7, 8. Ships an end-to-end working "photos of your
  checks → live checklists" flow. In this phase the client sends only checks; the build receives
  `dishes: []` (the dish path in `buildPlan`/`onboard-build` is present and tested but simply unexercised).
  Task 1 (allergens) stays in Phase 1 only because Task 2 imports it — it's tiny and inert without dishes.
- **Phase 2 (v1.1 — menu/allergens fast-follow):** Task 3 (`onboard-extract-menu`) + extend the hook
  (Task 7) and widget (Task 8) with the menu step. No rework of Phase 1 — the build already handles dishes.

---

### Task 1: Allergen mapping (shared, pure)  — *(Phase 1: foundation)*

**Files:**
- Create: `supabase/functions/_shared/allergens.ts`
- Test: `supabase/functions/_shared/allergens.test.ts`

**Interfaces:**
- Produces: `EU_ALLERGENS: readonly string[]`, `normalizeAllergens(labels: string[]): string[]` — maps free-text guide labels to the 14 canonical keys, drops unknowns, dedupes, preserves canonical order.

- [ ] **Step 1: Write the failing test**
```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeAllergens, EU_ALLERGENS } from "./allergens.ts";
Deno.test("maps guide labels to canonical keys", () => {
  assertEquals(normalizeAllergens(["Soya","Cereals containing gluten","Sulphite"]), ["gluten","soybeans","sulphites"]);
});
Deno.test("drops unknowns, dedupes, orders canonically", () => {
  assertEquals(normalizeAllergens(["Nuts","banana","nuts","Milk"]), ["milk","nuts"]);
});
Deno.test("has exactly 14 allergens", () => { assertEquals(EU_ALLERGENS.length, 14); });
```
- [ ] **Step 2: Run test to verify it fails** — `deno test supabase/functions/_shared/allergens.test.ts` → FAIL (module not found).
- [ ] **Step 3: Write minimal implementation**
```ts
export const EU_ALLERGENS = ["gluten","crustaceans","eggs","fish","peanuts","soybeans",
  "milk","nuts","celery","mustard","sesame","sulphites","lupin","molluscs"] as const;
const ALIASES: Record<string,string> = {
  "soya":"soybeans","soy":"soybeans","soybean":"soybeans","tree nuts":"nuts","tree nut":"nuts","nut":"nuts",
  "sulphite":"sulphites","sulphur dioxide":"sulphites","sulphur dioxide/sulphites":"sulphites",
  "cereals containing gluten":"gluten","cereals/gluten":"gluten","gluten (cereals)":"gluten","crustacean":"crustaceans",
  "mollusc":"molluscs","egg":"eggs","peanut":"peanuts",
};
export function normalizeAllergens(labels: string[]): string[] {
  const set = new Set<string>();
  for (const raw of labels ?? []) {
    const k = String(raw).trim().toLowerCase();
    const mapped = (EU_ALLERGENS as readonly string[]).includes(k) ? k : ALIASES[k];
    if (mapped) set.add(mapped);
  }
  return EU_ALLERGENS.filter((a) => set.has(a));
}
```
- [ ] **Step 4: Run test to verify it passes** — `deno test supabase/functions/_shared/allergens.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add supabase/functions/_shared/allergens.* && git commit -m "feat(onboarding): allergen label normalization"`

---

### Task 2: Build plan (shared, pure) — JSON → Supabase rows

The crux. Given extracted checklists + dishes + the business's roles, produce the exact row sets to upsert, with every Global Constraint applied (role fallback, role_id backfill, allergen-pending, item_type coercion).

**Files:**
- Create: `supabase/functions/_shared/build-plan.ts`
- Test: `supabase/functions/_shared/build-plan.test.ts`

**Interfaces:**
- Consumes: `normalizeAllergens` (Task 1).
- Produces:
```ts
type Role = { id: string; base_tier: string };
type ExtractedChecklist = { name: string; frequency?: string; assigned_roles?: string[];
  items: { name: string; item_type: string; required?: boolean; min_value?: number|null; max_value?: number|null; unit?: string|null }[] };
type ExtractedDish = { name: string; category: string; allergens: string[] };
type BuildInput = { businessId: string; siteId: string; roles: Role[];
  checklists: ExtractedChecklist[]; dishes: ExtractedDish[] };
type TemplateRow = { business_id, site_id, name, frequency, assigned_roles: string[], assigned_role_ids: string[],
  items: {name,item_type,required,sort_order,min_value,max_value,unit}[] };
type MenuItemRow = { business_id, site_id?, name, category, declared_allergens: string[],
  allergen_source:'manual', attested_by_name:string, active:true };
buildPlan(input: BuildInput, nowIso: string): { templates: TemplateRow[]; categories: string[]; menuItems: MenuItemRow[] };
```

- [ ] **Step 1: Write the failing test** (covers role fallback, role_id backfill, item_type coercion, allergen normalize+pending)
```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildPlan } from "./build-plan.ts";
const roles = [
  { id:"r-mgr", base_tier:"manager" }, { id:"r-kit", base_tier:"kitchen_staff" },
  { id:"r-foh", base_tier:"front_of_house" }, { id:"r-chef", base_tier:"chef" }, { id:"r-own", base_tier:"owner" },
];
Deno.test("template: empty roles → fallback + role_id backfill from base_tier", () => {
  const out = buildPlan({ businessId:"b1", siteId:"s1", roles, dishes:[],
    checklists:[{ name:"Opening", assigned_roles:[], items:[{name:"Fridge 1", item_type:"temperature", max_value:5, unit:"°C"}] }] }, "2026-01-01T00:00:00Z");
  const t = out.templates[0];
  assertEquals(t.assigned_roles, ["manager","kitchen_staff","front_of_house"]);
  assertEquals(new Set(t.assigned_role_ids), new Set(["r-mgr","r-kit","r-foh"]));
  assertEquals(t.items[0].sort_order, 0);
});
Deno.test("item_type: unknown coerced to 'text'", () => {
  const out = buildPlan({ businessId:"b1", siteId:"s1", roles, dishes:[],
    checklists:[{ name:"X", assigned_roles:["manager"], items:[{name:"note", item_type:"dropdown"}] }] }, "2026-01-01T00:00:00Z");
  assertEquals(out.templates[0].items[0].item_type, "text");
});
Deno.test("menu item: allergens normalized + pending attestation", () => {
  const out = buildPlan({ businessId:"b1", siteId:"s1", roles, checklists:[],
    dishes:[{ name:"Prawn Crackers", category:"Small Plates", allergens:["Crustaceans","Soya"] }] }, "2026-01-01T00:00:00Z");
  const m = out.menuItems[0];
  assertEquals(m.declared_allergens, ["crustaceans","soybeans"]);
  assertEquals(m.allergen_source, "manual");
  assertEquals(m.attested_by_name, "Imported — pending owner verification");
  assertEquals(out.categories, ["Small Plates"]);
});
```
- [ ] **Step 2: Run test to verify it fails** — `deno test supabase/functions/_shared/build-plan.test.ts` → FAIL.
- [ ] **Step 3: Write minimal implementation**
```ts
import { normalizeAllergens } from "./allergens.ts";
const ITEM_TYPES = new Set(["tick","temperature","text","yes_no","photo","initials"]);
const FREQ = new Set(["daily","weekly","monthly","four_weekly","custom"]);
const ROLE_FALLBACK = ["manager","kitchen_staff","front_of_house"];
export function buildPlan(input, nowIso) {
  const idsByTier = (tiers) => input.roles.filter(r => tiers.includes(r.base_tier)).map(r => r.id);
  const templates = input.checklists.map((c) => {
    const roles = (c.assigned_roles?.length ? c.assigned_roles : ROLE_FALLBACK);
    return {
      business_id: input.businessId, site_id: input.siteId, name: c.name.trim(),
      frequency: FREQ.has(c.frequency ?? "") ? c.frequency : "daily",
      assigned_roles: roles, assigned_role_ids: idsByTier(roles),
      items: c.items.map((it, i) => ({
        name: it.name.trim(),
        item_type: ITEM_TYPES.has(it.item_type) ? it.item_type : "text",
        required: it.required ?? true, sort_order: i,
        min_value: it.min_value ?? null, max_value: it.max_value ?? null, unit: it.unit ?? null,
      })),
    };
  });
  const categories = [...new Set(input.dishes.map(d => d.category.trim()))];
  const menuItems = input.dishes.map((d) => ({
    business_id: input.businessId, site_id: input.siteId, name: d.name.trim(), category: d.category.trim(),
    declared_allergens: normalizeAllergens(d.allergens), allergen_source: "manual",
    attested_by_name: "Imported — pending owner verification", attested_at: nowIso, active: true,
  }));
  return { templates, categories, menuItems };
}
```
- [ ] **Step 4: Run test to verify it passes** — `deno test supabase/functions/_shared/build-plan.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add supabase/functions/_shared/build-plan.* && git commit -m "feat(onboarding): pure JSON→rows build plan with guards"`

---

### Task 3: `onboard-extract-menu` edge function  — *(Phase 2 / v1.1 — do AFTER Phase 1 ships)*

> Deferred to the menu/allergens fast-follow. Build Phase 1 (Tasks 1,2,4,5,6,7,8) end-to-end first. When
> starting Phase 2, also extend Task 7 (add `addMenuMedia` wiring to `onboard-extract-menu` in `runBuild`)
> and Task 8 (add the "Send your menu" step + the "Review allergens" success handoff).

Media (image/PDF base64 or URL) → `{ dishes: ExtractedDish[] }` via Claude structured output. Mirror `supabase/functions/ai-generate-checklist/index.ts` (CORS, Anthropic call, JSON-only response).

**Files:**
- Create: `supabase/functions/onboard-extract-menu/index.ts`
- Reference: `supabase/functions/ai-generate-checklist/index.ts` (copy CORS + Anthropic fetch pattern), `_shared/allergens.ts`

**Interfaces:**
- Produces: HTTP POST `{ images: string[] /* base64 data URLs */, text?: string }` → `200 { dishes: {name,category,allergens[]}[] }`.

- [ ] **Step 1: Write the failing integration test**
```ts
// supabase/functions/onboard-extract-menu/index.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildMenuPrompt } from "./prompt.ts";
Deno.test("menu prompt lists all 14 allergens and demands JSON-only", () => {
  const p = buildMenuPrompt();
  for (const a of ["Celery","Crustaceans","Soya","Sulphite"]) if (!p.includes(a)) throw new Error("missing "+a);
  if (!p.toLowerCase().includes("json")) throw new Error("no json instruction");
});
```
- [ ] **Step 2: Run test to verify it fails** — `deno test supabase/functions/onboard-extract-menu/` → FAIL.
- [ ] **Step 3: Implement `prompt.ts` + `index.ts`**
```ts
// prompt.ts
export function buildMenuPrompt(): string {
  return `You are a UK food-safety allergen expert. From the attached menu image(s)/text, extract EVERY dish.
Return ONLY JSON: {"dishes":[{"name":"…","category":"…","allergens":["Celery","Cereals containing gluten","Crustaceans","Eggs","Fish","Lupin","Milk","Molluscs","Mustard","Nuts","Peanuts","Sesame","Soya","Sulphite"]}]}
Use the dish's menu section as "category". Only include an allergen if the dish contains it. Do not guess — if a dish is unreadable, omit it. No markdown, no commentary.`;
}
```
```ts
// index.ts — mirror ai-generate-checklist: CORS preflight, read {images,text}, call Anthropic with
// image blocks + buildMenuPrompt(), parse JSON, return { dishes }. Use ANTHROPIC_API_KEY from Deno.env.
// (Copy the exact fetch/parse/error-handling shape from ai-generate-checklist/index.ts.)
```
- [ ] **Step 4: Run prompt test** — `deno test supabase/functions/onboard-extract-menu/` → PASS. Manual smoke: deploy and POST one menu photo, assert dishes returned.
- [ ] **Step 5: Commit** — `git add supabase/functions/onboard-extract-menu && git commit -m "feat(onboarding): menu→allergen extractor edge fn"`

---

### Task 4: `onboard-extract-checks` edge function

Photos of paper checks → `{ checklists: ExtractedChecklist[] }`. Reuse `ai-generate-checklist`'s SYSTEM_PROMPT rules (FSA temps, item_type constraints), but input is IMAGES of existing sheets and output is an ARRAY of checklists.

**Files:**
- Create: `supabase/functions/onboard-extract-checks/index.ts`, `supabase/functions/onboard-extract-checks/prompt.ts`
- Reference: `supabase/functions/ai-generate-checklist/index.ts` (SYSTEM_PROMPT to adapt)

**Interfaces:**
- Produces: HTTP POST `{ images: string[], text?: string }` → `200 { checklists: ExtractedChecklist[] }`.

- [ ] **Step 1: Write the failing test**
```ts
// prompt.test.ts
import { buildChecksPrompt } from "./prompt.ts";
Deno.test("checks prompt constrains item_type + frequency + JSON array", () => {
  const p = buildChecksPrompt();
  for (const t of ["tick","temperature","text","yes_no","photo","initials"]) if (!p.includes(t)) throw new Error("missing "+t);
  if (!p.includes("four_weekly")) throw new Error("missing frequency set");
  if (!p.includes('"checklists"')) throw new Error("must return checklists array");
});
```
- [ ] **Step 2: Run test to verify it fails** — `deno test supabase/functions/onboard-extract-checks/` → FAIL.
- [ ] **Step 3: Implement `prompt.ts` (adapt ai-generate-checklist rules) + `index.ts`** — output schema `{"checklists":[{name,frequency,assigned_roles,items:[{name,item_type,required,min_value,max_value,unit}]}]}`; item_type limited to the 6 allowed; frequency to the 5 allowed. `index.ts` mirrors the menu extractor.
- [ ] **Step 4: Run prompt test** → PASS. Manual smoke: POST a temperature-sheet photo, assert a `temperature` item with min/max.
- [ ] **Step 5: Commit** — `git add supabase/functions/onboard-extract-checks && git commit -m "feat(onboarding): checks→checklists extractor edge fn"`

---

### Task 5: `onboard-build` edge function — write to Supabase + notify

Takes `{ checklists, dishes }` + the caller's business/site (from their JWT), loads their `roles`, runs `buildPlan`, and upserts everything idempotently with the service-role client, then emits an oversight notification.

**Files:**
- Create: `supabase/functions/onboard-build/index.ts`
- Reference: `_shared/build-plan.ts`, `_shared/allergens.ts`, `supabase/functions/send-feedback/index.ts` (notification pattern)

**Interfaces:**
- Consumes: `buildPlan` (Task 2).
- Produces: HTTP POST (Authorization: user JWT) `{ checklists, dishes }` → `200 { templates: number, dishes: number }`.

- [ ] **Step 1: Write the failing test for the upsert-shaping helper**
```ts
// upserts.test.ts — pure helper that turns a TemplateRow into the template-insert + items-insert payloads
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { splitTemplateForUpsert } from "./upserts.ts";
Deno.test("splits template row into parent + child item rows keyed by template id", () => {
  const { parent, itemsFor } = splitTemplateForUpsert({ business_id:"b", site_id:"s", name:"Opening",
    frequency:"daily", assigned_roles:["manager"], assigned_role_ids:["r1"],
    items:[{name:"Fridge 1", item_type:"temperature", required:true, sort_order:0, min_value:null, max_value:5, unit:"°C"}] });
  assertEquals(parent.name, "Opening");
  assertEquals(itemsFor("tmpl-123")[0].template_id, "tmpl-123");
});
```
- [ ] **Step 2: Run test to verify it fails** — `deno test supabase/functions/onboard-build/` → FAIL.
- [ ] **Step 3: Implement `upserts.ts` (pure) + `index.ts`** — `index.ts`: verify JWT → resolve `business_id`/`site_id` from `profiles`; `select id, base_tier from roles where business_id=…`; `buildPlan(...)`; for each template upsert parent by `(business_id,name)`, delete+insert its items; upsert `menu_categories` by `(site_id, lower(name))`, then `menu_items` with `site_categories` map; call the `send-feedback`-style notifier with a summary. All under a service-role client.
- [ ] **Step 4: Run test** → PASS. Manual smoke against a throwaway business: POST a small `{checklists,dishes}` and assert rows appear + `assigned_role_ids` non-empty + menu_items `attested_by=NULL`.
- [ ] **Step 5: Commit** — `git add supabase/functions/onboard-build && git commit -m "feat(onboarding): idempotent build + oversight notify edge fn"`

---

### Task 6: `onboard-transcribe` edge function — voice → text

Browser voice note (audio) → text, so voice answers become text the extractors/flow can use.

**Files:**
- Create: `supabase/functions/onboard-transcribe/index.ts`

**Interfaces:**
- Produces: HTTP POST `{ audio: string /* base64 */, mime: string }` → `200 { text: string }`.

- [ ] **Step 1: Write the failing test** — `supabase/functions/onboard-transcribe/provider.test.ts`: assert `buildTranscribeRequest(bytes, mime)` targets the chosen STT endpoint and sets the API key header.
- [ ] **Step 2: Run test to verify it fails** — `deno test supabase/functions/onboard-transcribe/` → FAIL.
- [ ] **Step 3: Implement** — `provider.ts` wraps the STT HTTP call (Whisper API `POST /v1/audio/transcriptions`, key from `Deno.env.get("OPENAI_API_KEY")`); `index.ts` decodes base64, calls provider, returns `{text}`. (Decision in spec Open Questions — default Whisper.)
- [ ] **Step 4: Run test** → PASS. Manual smoke: POST a short m4a, assert non-empty text.
- [ ] **Step 5: Commit** — `git add supabase/functions/onboard-transcribe && git commit -m "feat(onboarding): voice→text edge fn"`

---

### Task 7: `useOnboarding` client hook — session + edge calls  — *(Phase 1; menu call added in Phase 2)*

> **Phase 1:** `runBuild()` invokes only `onboard-extract-checks`, then `onboard-build` with `dishes: []`.
> The test below includes the `onboard-extract-menu` mock (first `mockResolvedValueOnce`) — for Phase 1,
> drop that first mock and the `dishes` assertion; add them back in Phase 2 when `addMenuMedia` is wired.

Client-side orchestration: hold collected artefacts, call the extractor + build edge functions, expose state to the widget. Vitest-testable with mocked `supabase.functions.invoke`.

**Files:**
- Create: `src/lib/onboarding/use-onboarding.ts`, `src/lib/onboarding/use-onboarding.test.ts`
- Reference: `src/components/feedback-beacon.tsx:166` (`supabase.functions.invoke('send-feedback', …)` pattern), `src/lib/supabase.ts`

**Interfaces:**
- Produces: `useOnboarding()` → `{ step, addMenuMedia(files), addChecksMedia(files), addVoice(blob), runBuild(), result, status }`.

- [ ] **Step 1: Write the failing test** (mock invoke; assert runBuild calls extract-menu + extract-checks then onboard-build with merged payload)
```ts
import { renderHook, act } from "@testing-library/react";
import { vi, expect, test } from "vitest";
vi.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
import { supabase } from "@/lib/supabase";
import { useOnboarding } from "./use-onboarding";
test("runBuild aggregates extractor outputs into onboard-build", async () => {
  (supabase.functions.invoke as any)
    .mockResolvedValueOnce({ data: { dishes: [{ name:"A", category:"C", allergens:[] }] } })      // extract-menu
    .mockResolvedValueOnce({ data: { checklists: [{ name:"X", assigned_roles:["manager"], items:[] }] } }) // extract-checks
    .mockResolvedValueOnce({ data: { templates: 1, dishes: 1 } });                                  // onboard-build
  const { result } = renderHook(() => useOnboarding());
  await act(async () => { await result.current.runBuild(); });
  const last = (supabase.functions.invoke as any).mock.calls.at(-1);
  expect(last[0]).toBe("onboard-build");
  expect(last[1].body.dishes).toHaveLength(1);
  expect(last[1].body.checklists).toHaveLength(1);
});
```
- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/lib/onboarding/use-onboarding.test.ts` → FAIL.
- [ ] **Step 3: Implement `use-onboarding.ts`** — state for `menuMedia/checksMedia/voice`; `runBuild()` invokes `onboard-extract-menu` and `onboard-extract-checks` (in parallel), merges to `{checklists,dishes}`, invokes `onboard-build`, sets `result/status`. Convert files to base64 data URLs before invoke.
- [ ] **Step 4: Run test** — `npx vitest run src/lib/onboarding/use-onboarding.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/onboarding && git commit -m "feat(onboarding): useOnboarding client hook"`

---

### Task 8: `OnboardingAssistant` widget  — *(Phase 1: checks step only; menu step + "Review allergens" handoff added in Phase 2)*

> **Phase 1** ships one step: "Send photos of the checks you use now" → build → "N checklists are live"
> handoff. The "Send your menu" step and the "Review allergens" success CTA below are **Phase 2** — build
> them when Task 3 lands. For Phase 1, omit the menu step and the allergen line from the success view.

The in-app UI: guided steps, photo upload, voice record, progress, result + "Review allergens" handoff. Modelled on `feedback-beacon.tsx`.

**Files:**
- Create: `src/components/onboarding-assistant.tsx`, `src/components/onboarding-assistant.test.tsx`
- Modify: `src/app/(dashboard)/layout.tsx` (mount the widget for entitled accounts with 0 active templates), following where `feedback-beacon` is mounted.
- Reference: `src/components/feedback-beacon.tsx` (beacon shell, open/close, edge invoke), `src/lib/onboarding/use-onboarding.ts` (Task 7)

**Interfaces:**
- Consumes: `useOnboarding` (Task 7).

- [ ] **Step 1: Write the failing test** (renders step 1, file input drives addChecksMedia; Build button calls runBuild; success shows counts + review link)
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { vi, test, expect } from "vitest";
const runBuild = vi.fn();
vi.mock("@/lib/onboarding/use-onboarding", () => ({ useOnboarding: () => ({
  step:"checks", addChecksMedia:vi.fn(), addMenuMedia:vi.fn(), addVoice:vi.fn(), runBuild, status:"idle",
  result: null }) }));
import { OnboardingAssistant } from "./onboarding-assistant";
test("shows checks step and triggers build", () => {
  render(<OnboardingAssistant />);
  expect(screen.getByText(/photos of the checks/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /set up my site/i }));
  expect(runBuild).toHaveBeenCalled();
});
```
- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/components/onboarding-assistant.test.tsx` → FAIL.
- [ ] **Step 3: Implement the widget** — beacon shell (reuse feedback-beacon styles); steps checks→menu→done; `<input type="file" multiple accept="image/*,application/pdf">`; a MediaRecorder-based voice button (posts to `onboard-transcribe`); "Set up my site" → `runBuild()`; success view: "N checklists, M dishes — checklists live; Review allergens →" linking to `/allergens`.
- [ ] **Step 4: Run test** — `npx vitest run src/components/onboarding-assistant.test.tsx` → PASS. Then `npm run build` to confirm the app compiles.
- [ ] **Step 5: Commit** — `git add src/components/onboarding-assistant.* "src/app/(dashboard)/layout.tsx" && git commit -m "feat(onboarding): in-app onboarding assistant widget"`

---

## Self-review notes

- **Spec coverage:** §2 checklists→Task 4+5; §2 menu/allergens→Task 3+5; §3 UX→Task 8; §4 architecture→all; §5 extractors→Task 3/4; §6 auto-build+allergen-pending+notify→Task 5; §7 error handling→ built into extractor prompts (omit unreadable) + Task 8 summary; §8 component boundaries→Tasks 1–8 isolation.
- **Guards from experience (Global Constraints):** role_id backfill (Task 2), empty-roles fallback (Task 2), allergen attestation constraint (Task 2), idempotent upserts (Task 5). Do NOT auto-create/modify existing accounts — team accounts are out of v1.
- **Deploy:** edge functions `supabase functions deploy <name> --project-ref rszrggreuarvodcqeqrj --no-verify-jwt` (except onboard-build which needs the JWT → deploy WITHOUT `--no-verify-jwt`). Web auto-deploys on push to main.
- **Secrets to set in Supabase:** `ANTHROPIC_API_KEY` (exists), `OPENAI_API_KEY` (new, for STT).
