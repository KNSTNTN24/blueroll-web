# Onboarding Questionnaire (From-Scratch Branch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guided "build from scratch" questionnaire branch to the in-app onboarding assistant that generates FSA-shaped checklists from a few count/checkbox answers, previews them, and writes them live.

**Architecture:** A pure client function turns questionnaire answers into per-checklist engine briefs. A thin `onboard-generate` edge function runs the existing Claude checklist engine over those briefs in one call and returns `{ checklists }` in the exact shape the existing `onboard-build` already consumes. The widget gains an entry fork (upload vs questionnaire) and the questionnaire UI (areas → mini-questionnaires → preview → build). Reuses the existing `onboard-build` write/notify pipeline unchanged.

**Tech Stack:** Next.js (App Router) + React + TypeScript + Supabase JS + Tailwind (web); Deno + Anthropic API (edge functions); vitest (web tests); deno test (edge/shared logic).

## Global Constraints

- **Anthropic model id is `claude-sonnet-4-6`** — NOT `claude-sonnet-4-20250514` (that id is retired for this account and returns Anthropic 404). The repo copies of `ai-generate-checklist`/`import-recipe` still hardcode the retired id; do not copy it.
- Generated checklist objects must be shape-compatible with `onboard-build`'s input `ExtractedChecklist`: `{ name: string; frequency?: string; assigned_roles?: string[]; items: { name: string; item_type: string; required?: boolean; min_value?: number|null; max_value?: number|null; unit?: string|null }[] }`. Extra fields (`description`, `supervisor_role`) are allowed and ignored by the build.
- `item_type` ∈ `tick|temperature|text|yes_no|photo|initials`. `frequency` ∈ `daily|weekly|monthly|four_weekly|custom`.
- One `temperature` item PER named unit (never a generic "check all fridges"); preserve exact unit names.
- v1 areas are exactly **Kitchen** and **Front of House**. No Bar/Delivery/standalone-Cleaning area, no voice, no menu/allergen dish data.
- The questionnaire generates checklists only; it never writes dish/allergen data. An "Allergen control" selection produces a plain four-weekly checklist, no dish records.
- Questionnaire answers are ephemeral session state — never persisted to the DB.
- Edge functions are NOT deployed by the implementer (the user deploys). `onboard-generate` deploys WITH `--no-verify-jwt` (stateless AI, no DB, like `onboard-extract-checks`); `onboard-build` stays WITHOUT it.
- Web tests: `npx vitest run <file>`. Edge tests: `deno test --no-config <path>` (this repo REQUIRES `--no-config` — the root Next `tsconfig.json` is otherwise auto-picked up).
- Reuse existing patterns: `supabase/functions/onboard-extract-checks/index.ts` (edge fn shape: CORS, `Deno.serve`, OPTIONS, JSON-regex parse), `src/components/onboarding-assistant.tsx` (widget shell + `useOnboarding`), `src/lib/onboarding/use-onboarding.ts` (invoke pattern).

---

### Task 1: Questionnaire model + `buildBriefs` (pure, client)

Answers → an array of per-checklist engine briefs. Pure and deterministic; the crux of the from-scratch mapping.

**Files:**
- Create: `src/lib/onboarding/questionnaire.ts`
- Test: `src/lib/onboarding/questionnaire.test.ts`

**Interfaces:**
- Produces:
```ts
export type Area = 'kitchen' | 'foh'
export type FridgeKind = 'fridge' | 'freezer' | 'walk_in' | 'display'
export interface FridgeUnit { name: string; kind: FridgeKind }
export interface KitchenAnswers {
  fridges: FridgeUnit[]
  probeCount: number
  sinkCount: number
  cooking: Array<'raw' | 'cook_chill' | 'reheat'>
  routines: { opening: boolean; closing: boolean; cleaning: boolean; allergen: boolean }
}
export interface FohAnswers {
  coldDisplayCount: number
  routines: { opening: boolean; closing: boolean; cleaning: boolean }
}
export interface Answers { areas: Area[]; kitchen?: KitchenAnswers; foh?: FohAnswers }
export interface EngineBrief { key: string; title: string; frequency: 'daily' | 'weekly' | 'four_weekly'; prompt: string }
export function buildBriefs(answers: Answers): EngineBrief[]
```

- [ ] **Step 1: Write the failing test**
```ts
import { test, expect } from 'vitest'
import { buildBriefs } from './questionnaire'

test('kitchen fridges → one temperature-record brief naming each unit', () => {
  const briefs = buildBriefs({ areas: ['kitchen'], kitchen: {
    fridges: [{ name: 'Fridge 1', kind: 'fridge' }, { name: 'Chest Freezer', kind: 'freezer' }],
    probeCount: 0, sinkCount: 1, cooking: [],
    routines: { opening: false, closing: false, cleaning: false, allergen: false } } })
  expect(briefs).toHaveLength(1)
  expect(briefs[0].title).toBe('Fridge & Freezer Temperature Record')
  expect(briefs[0].frequency).toBe('daily')
  expect(briefs[0].prompt).toContain('Fridge 1')
  expect(briefs[0].prompt).toContain('Chest Freezer')
  expect(briefs[0].prompt).toContain('−18°C')
})

test('probes + routines add briefs; allergen is four_weekly', () => {
  const briefs = buildBriefs({ areas: ['kitchen'], kitchen: {
    fridges: [], probeCount: 2, sinkCount: 2, cooking: ['raw', 'cook_chill'],
    routines: { opening: true, closing: false, cleaning: false, allergen: true } } })
  const keys = briefs.map((b) => b.key)
  expect(keys).toContain('kitchen-probe-calibration')
  expect(keys).toContain('kitchen-opening')
  expect(keys).toContain('kitchen-cook-cool')
  expect(briefs.find((b) => b.key === 'kitchen-allergen')?.frequency).toBe('four_weekly')
})

test('foh cold displays + opening → those two briefs in order', () => {
  const briefs = buildBriefs({ areas: ['foh'], foh: {
    coldDisplayCount: 3, routines: { opening: true, closing: false, cleaning: false } } })
  expect(briefs.map((b) => b.key)).toEqual(['foh-cold-display', 'foh-opening'])
})

test('area not selected contributes nothing even if answers present', () => {
  const briefs = buildBriefs({ areas: ['foh'], kitchen: {
    fridges: [{ name: 'Fridge 1', kind: 'fridge' }], probeCount: 1, sinkCount: 1, cooking: [],
    routines: { opening: true, closing: true, cleaning: true, allergen: true } },
    foh: { coldDisplayCount: 0, routines: { opening: false, closing: false, cleaning: false } } })
  expect(briefs).toHaveLength(0)
})
```
- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/lib/onboarding/questionnaire.test.ts` → FAIL (module not found).
- [ ] **Step 3: Write the implementation**
```ts
export type Area = 'kitchen' | 'foh'
export type FridgeKind = 'fridge' | 'freezer' | 'walk_in' | 'display'
export interface FridgeUnit { name: string; kind: FridgeKind }
export interface KitchenAnswers {
  fridges: FridgeUnit[]
  probeCount: number
  sinkCount: number
  cooking: Array<'raw' | 'cook_chill' | 'reheat'>
  routines: { opening: boolean; closing: boolean; cleaning: boolean; allergen: boolean }
}
export interface FohAnswers {
  coldDisplayCount: number
  routines: { opening: boolean; closing: boolean; cleaning: boolean }
}
export interface Answers { areas: Area[]; kitchen?: KitchenAnswers; foh?: FohAnswers }
export interface EngineBrief { key: string; title: string; frequency: 'daily' | 'weekly' | 'four_weekly'; prompt: string }

function targetFor(kind: FridgeKind): string {
  if (kind === 'freezer') return 'target −18°C or below'
  if (kind === 'display') return 'target 0–8°C'
  return 'target 0–5°C' // fridge, walk_in
}

export function buildBriefs(answers: Answers): EngineBrief[] {
  const briefs: EngineBrief[] = []
  const k = answers.kitchen
  if (answers.areas.includes('kitchen') && k) {
    if (k.fridges.length > 0) {
      const units = k.fridges.map((f) => `${f.name} (${targetFor(f.kind)})`).join('; ')
      briefs.push({ key: 'kitchen-fridge-temps', title: 'Fridge & Freezer Temperature Record', frequency: 'daily',
        prompt: `A daily Temperature Log. Create exactly one temperature item per unit, for both AM and PM (two items per unit), for these units: ${units}. Use each unit's exact name in the item. End with one text item for corrective action.` })
    }
    if (k.probeCount > 0) {
      briefs.push({ key: 'kitchen-probe-calibration', title: 'Probe Calibration Record', frequency: 'weekly',
        prompt: `A weekly probe thermometer calibration record for ${k.probeCount} probe thermometer(s). For each probe an ice-water test (0°C, tolerance ±3°C) and a boiling-water test (100°C, tolerance ±3°C) as temperature items. End with one text item for corrective action.` })
    }
    if (k.routines.opening) {
      briefs.push({ key: 'kitchen-opening', title: 'Kitchen Opening Checks', frequency: 'daily',
        prompt: `A daily kitchen Opening checklist: ${k.sinkCount} hand-wash basin(s) stocked (hot water, soap, paper towels), fridges/freezers within range, food in date and labelled, raw stored below ready-to-eat, probe sanitised. Use yes_no or tick items.` })
    }
    if (k.routines.closing) {
      briefs.push({ key: 'kitchen-closing', title: 'Kitchen Closing Checks', frequency: 'daily',
        prompt: `A daily kitchen Closing checklist: leftovers cooled and stored, fridges/freezers closed and within range, surfaces cleaned and sanitised, waste removed, equipment switched off. Do NOT include a cleaning schedule.` })
    }
    if (k.routines.cleaning) {
      briefs.push({ key: 'kitchen-cleaning', title: 'Kitchen Cleaning Schedule', frequency: 'daily',
        prompt: `A daily kitchen Cleaning schedule of tick items grouped by area (surfaces, floors, equipment, ${k.sinkCount} sink(s)). Cleaning/sanitising tasks only — no temperature items.` })
    }
    if (k.cooking.length > 0) {
      const stages: string[] = []
      if (k.cooking.includes('raw')) stages.push('cooking from raw (core ≥75°C or equivalent time/temperature)')
      if (k.cooking.includes('cook_chill')) stages.push('two-stage cooling (≤21°C within 2 hours, then ≤8°C within a further 4 hours)')
      if (k.cooking.includes('reheat')) stages.push('reheating (core ≥75°C, once only)')
      briefs.push({ key: 'kitchen-cook-cool', title: 'Cooking & Cooling Temperature', frequency: 'daily',
        prompt: `A daily Cooking & Cooling temperature record covering ${stages.join(', ')}. One temperature item per stage with the stated targets, plus a text item for the food/batch name and corrective action.` })
    }
    if (k.routines.allergen) {
      briefs.push({ key: 'kitchen-allergen', title: 'Allergen Control Record', frequency: 'four_weekly',
        prompt: `A four-weekly allergen control review with yes_no items: supplier allergen information current, storage and preparation separation in place, staff allergen training up to date, menu/allergen matrix accurate. End with a text corrective-action item and a manager sign-off using an initials item.` })
    }
  }
  const f = answers.foh
  if (answers.areas.includes('foh') && f) {
    if (f.coldDisplayCount > 0) {
      briefs.push({ key: 'foh-cold-display', title: 'Cold Display Temperature', frequency: 'daily',
        prompt: `A daily Temperature Log: one temperature item per chilled display unit for ${f.coldDisplayCount} unit(s) (target 0–8°C), for both AM and PM. End with one text corrective-action item.` })
    }
    if (f.routines.opening) {
      briefs.push({ key: 'foh-opening', title: 'Front of House Opening', frequency: 'daily',
        prompt: `A daily front-of-house Opening checklist: dining area clean, tables set, chilled display within range, hand sanitiser stocked, allergen menu available. Use tick/yes_no items.` })
    }
    if (f.routines.closing) {
      briefs.push({ key: 'foh-closing', title: 'Front of House Closing', frequency: 'daily',
        prompt: `A daily front-of-house Closing checklist: surfaces cleaned, condiments stored, display emptied and cleaned, floors cleaned, waste removed. Use tick items.` })
    }
    if (f.routines.cleaning) {
      briefs.push({ key: 'foh-cleaning', title: 'Front of House Cleaning Schedule', frequency: 'daily',
        prompt: `A daily front-of-house Cleaning schedule of tick items grouped by area (tables, floors, toilets, counters). Cleaning tasks only.` })
    }
  }
  return briefs
}
```
- [ ] **Step 4: Run test to verify it passes** — `npx vitest run src/lib/onboarding/questionnaire.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/onboarding/questionnaire.* && git commit -m "feat(onboarding): questionnaire model + buildBriefs"`

---

### Task 2: `onboard-generate` edge function

`{ briefs }` → one Claude call → `{ checklists: [...] }` shape-compatible with `onboard-build`. Mirrors `onboard-extract-checks` but the input is structured briefs (text), not images.

**Files:**
- Create: `supabase/functions/onboard-generate/index.ts`, `supabase/functions/onboard-generate/prompt.ts`, `supabase/functions/onboard-generate/prompt.test.ts`
- Reference: `supabase/functions/onboard-extract-checks/index.ts` (CORS + `Deno.serve` + OPTIONS + JSON-regex parse), `supabase/functions/ai-generate-checklist/index.ts` (FSA `SYSTEM_PROMPT` rules to adapt)

**Interfaces:**
- Consumes: `EngineBrief` (Task 1) — `{ key, title, frequency, prompt }`.
- Produces: HTTP POST `{ briefs: EngineBrief[] }` → `200 { checklists: { name, frequency, assigned_roles, items: {name,item_type,required,min_value,max_value,unit}[] }[] }`.

- [ ] **Step 1: Write the failing prompt test**
```ts
// supabase/functions/onboard-generate/prompt.test.ts
import { buildGeneratePrompt } from "./prompt.ts";
Deno.test("generate prompt constrains item_type, frequency, one-temp-per-unit, JSON array", () => {
  const p = buildGeneratePrompt();
  for (const t of ["tick","temperature","text","yes_no","photo","initials"]) if (!p.includes(t)) throw new Error("missing "+t);
  if (!p.includes("four_weekly")) throw new Error("missing frequency set");
  if (!p.includes('"checklists"')) throw new Error("must return checklists array");
  if (!p.toLowerCase().includes("one temperature")) throw new Error("missing one-temp-per-unit rule");
});
```
- [ ] **Step 2: Run test to verify it fails** — `deno test --no-config supabase/functions/onboard-generate/` → FAIL.
- [ ] **Step 3: Implement `prompt.ts` + `index.ts`**
```ts
// prompt.ts
export function buildGeneratePrompt(): string {
  return `You are a UK food-safety consultant creating HACCP checklists under FSA Safer Food, Better Business (SFBB).
You are given a list of checklist briefs. Produce ONE checklist per brief, in the SAME order.

Return ONLY JSON (no markdown, no commentary):
{"checklists":[{"name":"...","frequency":"daily|weekly|monthly|four_weekly|custom","assigned_roles":["manager","chef","kitchen_staff","front_of_house","owner"],"items":[{"name":"Short action (max 10 words)","item_type":"tick|temperature|text|yes_no|photo|initials","required":true,"min_value":null,"max_value":null,"unit":null}]}]}

Rules:
- Use the brief's stated title as "name" and its stated frequency as "frequency".
- Create exactly one temperature item PER named unit — never a single generic "check all fridges" item. Preserve exact unit names from the brief.
- For temperature items set min_value/max_value/unit (°C) to the stated target range; for non-temperature items set them to null.
- Assign sensible roles: kitchen checklists to manager/chef/kitchen_staff; front-of-house checklists to manager/front_of_house.
- No generic filler items ("any other issues") unless a checklist would otherwise have fewer than 4 items.`;
}
```
```ts
// index.ts — mirror onboard-extract-checks/index.ts:
// - same corsHeaders block, Deno.serve, OPTIONS preflight, try/catch → 500 { error }
// - read { briefs } from the JSON body; 400 if not a non-empty array
// - userMessage = briefs.map((b,i) => `Brief ${i+1}: title="${b.title}", frequency=${b.frequency}. ${b.prompt}`).join("\n\n")
// - POST https://api.anthropic.com/v1/messages with headers x-api-key: Deno.env.get("ANTHROPIC_API_KEY"),
//   anthropic-version 2023-06-01; body { model: "claude-sonnet-4-6", max_tokens: 4096,
//   system: buildGeneratePrompt(), messages:[{role:"user",content: userMessage}] }
// - parse: const m = text.match(/\{[\s\S]*\}/); const result = JSON.parse(m[0]);
//   return 200 { checklists: Array.isArray(result?.checklists) ? result.checklists : [] }
```
- [ ] **Step 4: Run prompt test** — `deno test --no-config supabase/functions/onboard-generate/` → PASS. Then `deno check --no-config supabase/functions/onboard-generate/index.ts` → clean. (No deploy — the user deploys.)
- [ ] **Step 5: Commit** — `git add supabase/functions/onboard-generate && git commit -m "feat(onboarding): brief→checklists generator edge fn"`

---

### Task 3: `useOnboarding` extension — generate → preview → confirm build

Add the from-scratch path to the existing hook: run `onboard-generate`, hold the generated checklists for preview, then write the kept ones via the existing `onboard-build`. The upload path (`runBuild`) is unchanged.

**Files:**
- Modify: `src/lib/onboarding/use-onboarding.ts`
- Test: `src/lib/onboarding/use-onboarding.test.ts` (add cases; keep existing)

**Interfaces:**
- Consumes: `Answers`, `EngineBrief`, `buildBriefs` (Task 1); edge fns `onboard-generate`, `onboard-build`.
- Produces (added to the hook's return):
```ts
generate(answers: Answers): Promise<void>          // buildBriefs → onboard-generate → set generated + status 'preview'
generated: GeneratedChecklist[] | null             // engine output, for the preview UI
confirmBuild(checklists: GeneratedChecklist[]): Promise<void>  // onboard-build → result + status 'done'
// GeneratedChecklist = { name: string; frequency?: string; assigned_roles?: string[]; items: unknown[] }
// status gains 'generating' | 'preview' alongside existing 'idle'|'building'|'done'|'error'
```

- [ ] **Step 1: Write the failing test** (append to the existing test file)
```ts
test('generate → preview holds engine checklists; confirmBuild sends kept ones to onboard-build', async () => {
  (supabase.functions.invoke as any).mockReset()
  ;(supabase.functions.invoke as any)
    .mockResolvedValueOnce({ data: { checklists: [
      { name: 'Fridge & Freezer Temperature Record', frequency: 'daily', assigned_roles: ['manager'], items: [{}] },
      { name: 'Kitchen Opening Checks', frequency: 'daily', assigned_roles: ['manager'], items: [{}, {}] },
    ] } })                                                    // onboard-generate
    .mockResolvedValueOnce({ data: { templates: 1, dishes: 0 } }) // onboard-build
  const { result } = renderHook(() => useOnboarding())
  await act(async () => {
    await result.current.generate({ areas: ['kitchen'], kitchen: {
      fridges: [{ name: 'Fridge 1', kind: 'fridge' }], probeCount: 0, sinkCount: 1, cooking: [],
      routines: { opening: true, closing: false, cleaning: false, allergen: false } } })
  })
  expect(result.current.status).toBe('preview')
  expect(result.current.generated).toHaveLength(2)
  const genCall = (supabase.functions.invoke as any).mock.calls[0]
  expect(genCall[0]).toBe('onboard-generate')
  expect(genCall[1].body.briefs.length).toBeGreaterThan(0)
  await act(async () => { await result.current.confirmBuild([result.current.generated![0]]) })
  const buildCall = (supabase.functions.invoke as any).mock.calls.at(-1)
  expect(buildCall[0]).toBe('onboard-build')
  expect(buildCall[1].body.checklists).toHaveLength(1)
  expect(buildCall[1].body.dishes).toEqual([])
  expect(result.current.status).toBe('done')
})
```
- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/lib/onboarding/use-onboarding.test.ts` → FAIL.
- [ ] **Step 3: Implement the extension** — add to `use-onboarding.ts`:
```ts
import { buildBriefs, type Answers } from './questionnaire'
// ...inside useOnboarding, alongside the existing state:
type GeneratedChecklist = { name: string; frequency?: string; assigned_roles?: string[]; items: unknown[] }
const [generated, setGenerated] = useState<GeneratedChecklist[] | null>(null)
// widen the status type used by setStatus to include 'generating' | 'preview'

const generate = useCallback(async (answers: Answers) => {
  setStatus('generating'); setErrorMessage(null); setGenerated(null)
  try {
    const briefs = buildBriefs(answers)
    if (briefs.length === 0) { setErrorMessage('Pick at least one checklist to create.'); setStatus('error'); return }
    const { data, error } = await supabase.functions.invoke('onboard-generate', { body: { briefs } })
    if (error) { setErrorMessage(`Generating checklists failed: ${await describeInvokeError(error)}`); setStatus('error'); return }
    const checklists = (data?.checklists ?? []) as GeneratedChecklist[]
    if (checklists.length === 0) { setErrorMessage('We could not generate checklists from those answers.'); setStatus('error'); return }
    setGenerated(checklists); setStatus('preview')
  } catch (err) {
    setErrorMessage(err instanceof Error ? err.message : 'Something went wrong.'); setStatus('error')
  }
}, [])

const confirmBuild = useCallback(async (checklists: GeneratedChecklist[]) => {
  setStatus('building'); setResult(null); setErrorMessage(null)
  try {
    const { data, error } = await supabase.functions.invoke('onboard-build', { body: { checklists, dishes: [] } })
    if (error) { setErrorMessage(`Building your site failed: ${await describeInvokeError(error)}`); setStatus('error'); return }
    setResult({ templates: data?.templates ?? 0, dishes: data?.dishes ?? 0 }); setStatus('done')
  } catch (err) {
    setErrorMessage(err instanceof Error ? err.message : 'Something went wrong.'); setStatus('error')
  }
}, [])
// return { ...existing, generate, generated, confirmBuild }
```
(If `describeInvokeError` / `errorMessage` are not present yet in this file, add the same `describeInvokeError` helper and `errorMessage` state used by `runBuild`; the widget already reads `errorMessage`.)
- [ ] **Step 4: Run test** — `npx vitest run src/lib/onboarding/use-onboarding.test.ts` → PASS (existing upload tests still pass).
- [ ] **Step 5: Commit** — `git add src/lib/onboarding/use-onboarding.* && git commit -m "feat(onboarding): hook generate→preview→confirmBuild path"`

---

### Task 4: `OnboardingQuestionnaire` component — areas → mini-questionnaires → preview → build

The from-scratch wizard UI. Collects `Answers`, calls `generate`, renders the preview of engine output with per-checklist toggles, then `confirmBuild`. Modelled on the existing widget's panel styling.

**Files:**
- Create: `src/components/onboarding-questionnaire.tsx`, `src/components/onboarding-questionnaire.test.tsx`
- Reference: `src/components/onboarding-assistant.tsx` (panel/step styling, `Button`, `useOnboarding` usage), `src/lib/onboarding/questionnaire.ts` (Task 1 types)

**Interfaces:**
- Consumes: `useOnboarding()` (`generate`, `generated`, `confirmBuild`, `status`, `result`, `errorMessage`), `Answers`/`Area` types (Task 1).
- Produces: `export function OnboardingQuestionnaire({ onBack }: { onBack: () => void })` — a self-contained panel body (rendered inside the widget shell by Task 5).

- [ ] **Step 1: Write the failing test**
```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, act } from '@testing-library/react'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { vi, test, expect } from 'vitest'
afterEach(cleanup)
const generate = vi.fn().mockResolvedValue(undefined)
const confirmBuild = vi.fn().mockResolvedValue(undefined)
let hook: any = { generate, confirmBuild, generated: null, status: 'idle', result: null, errorMessage: null }
vi.mock('@/lib/onboarding/use-onboarding', () => ({ useOnboarding: () => hook }))
import { OnboardingQuestionnaire } from './onboarding-questionnaire'

test('pick kitchen, set a fridge count, continue → generate called with answers', async () => {
  render(<OnboardingQuestionnaire onBack={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /kitchen/i }))
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
  // kitchen mini-questionnaire: bump fridges to 1 then continue through to generate
  fireEvent.click(screen.getByRole('button', { name: /create my checklists/i }))
  await act(async () => {})
  expect(generate).toHaveBeenCalled()
  const answers = generate.mock.calls[0][0]
  expect(answers.areas).toContain('kitchen')
})

test('preview lists generated checklists and Build calls confirmBuild with kept ones', async () => {
  hook = { generate, confirmBuild, status: 'preview', result: null, errorMessage: null,
    generated: [ { name: 'Fridge & Freezer Temperature Record', items: [{},{}] },
                 { name: 'Kitchen Opening Checks', items: [{}] } ] }
  render(<OnboardingQuestionnaire onBack={() => {}} />)
  expect(screen.getByText(/Fridge & Freezer Temperature Record/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /build/i }))
  await act(async () => {})
  expect(confirmBuild).toHaveBeenCalled()
  expect(confirmBuild.mock.calls[0][0]).toHaveLength(2)
})
```
- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/components/onboarding-questionnaire.test.tsx` → FAIL.
- [ ] **Step 3: Implement the component.** Structure (a small internal step state machine — `'areas' | 'kitchen' | 'foh' | 'generating' | 'preview' | 'done'`), following the existing widget's Tailwind idiom. Concrete requirements:
  - `'areas'`: toggle buttons for Kitchen 🍳 / Front of House 🍽️ (multi-select into `areas`), a **Continue** button (disabled until ≥1 area) that advances to the first selected area's mini-questionnaire.
  - Kitchen mini-questionnaire: a fridge-count stepper (+/−) that maintains `fridges` as auto-named units (`Fridge 1`, `Fridge 2`, …, defaulting `kind:'fridge'`; a small kind `<select>` per row is optional in v1), a probe-count stepper, a sink-count stepper, cooking checkboxes (raw / cook-chill / reheat), and routine checkboxes (Opening, Closing, Cleaning pre-ticked; Allergen unticked). **Continue** advances to FOH if selected, else triggers generate.
  - FOH mini-questionnaire: cold-display count stepper + routine checkboxes (Opening, Closing, Cleaning). **Create my checklists** triggers `generate(answers)`.
  - When `status === 'generating'`: a spinner + "Building your checklists…".
  - When `status === 'preview'`: render each `generated` checklist as a row (name + `items.length` items) with a checkbox (default checked) to keep/drop; a **Build** button calls `confirmBuild(keptChecklists)`.
  - When `status === 'done'` and `result`: "N checklists are live" + a `<Link href="/checklists">`.
  - When `status === 'error'`: show `errorMessage` and allow going back.
  - A **Back** control on the first step calls the `onBack` prop (returns to the entry fork).
  - Keep local state for `areas`, `kitchen`, `foh`, the current step, and the preview keep-set. Build the final `Answers` object from local state when calling `generate`.
- [ ] **Step 4: Run test** — `npx vitest run src/components/onboarding-questionnaire.test.tsx` → PASS.
- [ ] **Step 5: Commit** — `git add src/components/onboarding-questionnaire.* && git commit -m "feat(onboarding): from-scratch questionnaire wizard UI"`

---

### Task 5: Entry fork in `OnboardingAssistant`

Add Q0 ("Where do you want to start?") that routes to the existing upload panel or the new questionnaire. Extract the current checks/upload UI into an `UploadPanel` sub-view so the panel body can switch on the chosen branch.

**Files:**
- Modify: `src/components/onboarding-assistant.tsx`
- Test: `src/components/onboarding-assistant.test.tsx` (add fork cases; keep existing upload test)
- Reference: `src/components/onboarding-questionnaire.tsx` (Task 4)

**Interfaces:**
- Consumes: `OnboardingQuestionnaire` (Task 4).

- [ ] **Step 1: Write the failing test** (append)
```tsx
test('entry fork: choosing "build from scratch" shows the questionnaire', () => {
  render(<OnboardingPanel />)
  // open the panel if it starts closed (reuse the existing open trigger)
  const openBtn = screen.queryByRole('button', { name: /set up my checklists/i })
  if (openBtn) fireEvent.click(openBtn)
  fireEvent.click(screen.getByRole('button', { name: /build from scratch/i }))
  expect(screen.getByRole('button', { name: /kitchen/i })).toBeTruthy()
})

test('entry fork: choosing "I already have checklists" shows the upload step', () => {
  render(<OnboardingPanel />)
  const openBtn = screen.queryByRole('button', { name: /set up my checklists/i })
  if (openBtn) fireEvent.click(openBtn)
  fireEvent.click(screen.getByRole('button', { name: /already have/i }))
  expect(screen.getByText(/photos of the checks/i)).toBeTruthy()
})
```
- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/components/onboarding-assistant.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** In `OnboardingPanel`:
  - Add local state `branch: 'fork' | 'upload' | 'scratch'` (default `'fork'`).
  - `'fork'`: a short "Where do you want to start?" with two buttons — **"I already have checklists"** (→ `'upload'`) and **"Build from scratch"** (→ `'scratch'`).
  - `'upload'`: the EXISTING checks step (heading, file input, notes, "Set up my site", success/error) — extract it unchanged into this branch; add a Back button that sets `branch='fork'`.
  - `'scratch'`: render `<OnboardingQuestionnaire onBack={() => setBranch('fork')} />`.
  - The gate/wrapper `OnboardingAssistant` and the beacon open/close button are unchanged.
- [ ] **Step 4: Run test + build** — `npx vitest run src/components/onboarding-assistant.test.tsx` → PASS. Then `npm run build` → compiles.
- [ ] **Step 5: Commit** — `git add src/components/onboarding-assistant.* && git commit -m "feat(onboarding): entry fork (upload vs questionnaire)"`

---

## Self-review notes

- **Spec coverage:** §2 entry fork → Task 5; §2 areas Kitchen+FOH → Tasks 1+4; §3 engine reuse → Task 2; §4 questionnaire questions → Tasks 1 (mapping) + 4 (UI); §5 preview→confirm→build → Tasks 3+4; §6 architecture (onboard-generate + reuse onboard-build) → Tasks 2+3; §7 components/boundaries → Tasks 1–5 (pure buildBriefs, thin edge fn, hook, two UI components); §8 error handling → hook error surfacing (Task 3) + empty-selection guards (Tasks 1/4).
- **Shape compatibility:** the engine output (`name/frequency/assigned_roles/items`) already matches `onboard-build`'s `ExtractedChecklist` input (Global Constraints), so no transform between Task 2 and the existing build.
- **Model landmine:** Task 2 uses `claude-sonnet-4-6`, not the retired `claude-sonnet-4-20250514` the repo still hardcodes.
- **Deploy (user):** `onboard-generate` WITH `--no-verify-jwt`; `onboard-build` already deployed WITHOUT it. No new secrets (`ANTHROPIC_API_KEY` exists).
- **Not covered by unit tests (acceptable, note for reviewer):** the actual Claude generation quality (Task 2) is only smoke-tested by the user post-deploy; the multi-step questionnaire is tested at the key transitions, not every field.
