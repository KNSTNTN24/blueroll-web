# v-next Phase 2 (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web sides of all 7 v-next items on top of the Phase-1 DB groundwork.

**Architecture:** Pure logic (dietary resolution, checklist status/ordering, initials validation) extracted into `src/lib/` and TDD'd with vitest (node env, no jsdom). UI wiring verified by `npm run build` + targeted live checks. DB already has: `recipes.*_override`, `checklist_templates.multi_per_day/min_per_day`, `checklist_drafts`, RPC `create_recipe_with_ingredients`.

**Tech Stack:** Next.js (App Router) + TanStack Query + Supabase JS; vitest (added in Task 0). Spec: `docs/superpowers/specs/2026-06-07-v-next-fixes-design.md`.

**Conventions:**
- Repo `~/HACCP/web`, branch `KNS/iap-foundation`. Commit ONLY files named in each task (unrelated uncommitted files exist).
- TDD applies to `src/lib/**` logic: write test → `npm test -- <file>` RED → implement → GREEN. UI wiring tasks: `npm run build` must pass (accepted TDD exception for view code — no component test infra; approved in session).
- TS components follow surrounding style (Tailwind classes per file's existing idiom).
- Ship: when all tasks done, the branch builds clean; production deploy happens via the normal PR → squash merge → `vercel --prod` flow (NOT part of this plan).

---

### Task 0: vitest

**Files:**
- Modify: `package.json` (devDependency + script)
- Create: `vitest.config.ts`

- [ ] **Step 1:** `npm install -D vitest` (no jsdom — pure node tests only).
- [ ] **Step 2:** Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
```

- [ ] **Step 3:** Add script `"test": "vitest run"` to package.json scripts.
- [ ] **Step 4:** Sanity: `npx vitest run` → "no test files found" exits 0? If it errors on empty set, add a placeholder `src/lib/__smoke.test.ts` with `import { expect, test } from 'vitest'; test('smoke', () => expect(1).toBe(1))` and keep it.
- [ ] **Step 5:** Commit `package.json package-lock.json vitest.config.ts` (+ smoke test if created): `chore: vitest for lib logic tests`

---

### Task 1: shared dietary lib (item 1, logic)

**Files:**
- Create: `src/lib/dietary.test.ts`
- Create: `src/lib/dietary.ts`
- Modify: `src/app/(dashboard)/recipes/page.tsx:26-37`, `src/app/(dashboard)/recipes/[id]/page.tsx:24-35` (replace local copies with the lib)

- [ ] **Step 1: Write the failing test** (`src/lib/dietary.test.ts`):

```ts
import { describe, expect, test } from 'vitest'
import { computeDietary, effectiveDietary, DIETARY_FLAGS } from './dietary'

describe('computeDietary', () => {
  test('no allergens -> all four', () => {
    expect(computeDietary([])).toEqual(['Vegan', 'Vegetarian', 'Gluten-Free', 'Dairy-Free'])
  })
  test('milk excludes Vegan and Dairy-Free', () => {
    expect(computeDietary(['milk'])).toEqual(['Vegetarian', 'Gluten-Free'])
  })
  test('fish excludes Vegan and Vegetarian', () => {
    expect(computeDietary(['fish'])).toEqual(['Gluten-Free', 'Dairy-Free'])
  })
  test('gluten excludes Gluten-Free only', () => {
    expect(computeDietary(['gluten'])).toEqual(['Vegan', 'Vegetarian', 'Dairy-Free'])
  })
})

describe('effectiveDietary (override ?? computed)', () => {
  const noOverrides = {
    vegan_override: null, vegetarian_override: null,
    gluten_free_override: null, dairy_free_override: null,
  }
  test('all NULL -> same as computed', () => {
    expect(effectiveDietary(noOverrides, ['milk'])).toEqual(['Vegetarian', 'Gluten-Free'])
  })
  test('explicit false beats computed true (beef stew is not vegetarian)', () => {
    expect(effectiveDietary({ ...noOverrides, vegetarian_override: false, vegan_override: false }, []))
      .toEqual(['Gluten-Free', 'Dairy-Free'])
  })
  test('explicit true beats computed false (gluten-free soy sauce)', () => {
    expect(effectiveDietary({ ...noOverrides, gluten_free_override: true }, ['gluten']))
      .toEqual(['Vegan', 'Vegetarian', 'Gluten-Free', 'Dairy-Free'])
  })
  test('flag metadata maps labels to columns', () => {
    expect(DIETARY_FLAGS.map((f) => f.column)).toEqual([
      'vegan_override', 'vegetarian_override', 'gluten_free_override', 'dairy_free_override',
    ])
  })
})
```

- [ ] **Step 2:** `npm test` → RED (`./dietary` not found).
- [ ] **Step 3:** Create `src/lib/dietary.ts`:

```ts
// Dietary flags: computed from ingredient allergens, overridable per recipe
// (recipes.*_override: NULL = auto, true/false = explicit). Single source of
// truth for both the recipes list and detail pages.
export type DietaryOverrides = {
  vegan_override: boolean | null
  vegetarian_override: boolean | null
  gluten_free_override: boolean | null
  dairy_free_override: boolean | null
}

export const DIETARY_FLAGS = [
  { label: 'Vegan', column: 'vegan_override' },
  { label: 'Vegetarian', column: 'vegetarian_override' },
  { label: 'Gluten-Free', column: 'gluten_free_override' },
  { label: 'Dairy-Free', column: 'dairy_free_override' },
] as const

const RULES: Record<string, (a: string[]) => boolean> = {
  Vegan: (a) => !a.some((x) => ['milk', 'eggs', 'fish', 'crustaceans', 'molluscs'].includes(x)),
  Vegetarian: (a) => !a.some((x) => ['fish', 'crustaceans', 'molluscs'].includes(x)),
  'Gluten-Free': (a) => !a.includes('gluten'),
  'Dairy-Free': (a) => !a.includes('milk'),
}

export function computeDietary(allergens: string[]): string[] {
  return DIETARY_FLAGS.filter((f) => RULES[f.label](allergens)).map((f) => f.label)
}

export function effectiveDietary(
  overrides: Partial<DietaryOverrides> | null | undefined,
  allergens: string[],
): string[] {
  return DIETARY_FLAGS.filter((f) => {
    const o = overrides?.[f.column]
    return o ?? RULES[f.label](allergens)
  }).map((f) => f.label)
}
```

- [ ] **Step 4:** GREEN.
- [ ] **Step 5:** In `recipes/page.tsx` and `recipes/[id]/page.tsx`: delete the local `DIETARY_RULES`/`computeDietary` blocks; `import { effectiveDietary } from '@/lib/dietary'`; replace `computeDietary(allergens)` call sites with `effectiveDietary(recipe, allergens)` (the row object spreads `*` so the override columns are already selected). Build must pass.
- [ ] **Step 6:** Commit all four files: `feat(web): shared dietary lib with tri-state overrides`

---

### Task 2: dietary chips editor (item 1, UI)

**Files:**
- Create: `src/components/dietary-chips.tsx`
- Modify: `src/app/(dashboard)/recipes/new/page.tsx` (state + save + UI after allergen Section ~line 370)
- Modify: `src/app/(dashboard)/recipes/edit/[id]/page.tsx` (load + state + save + UI after ~line 432)

- [ ] **Step 1:** Create the component:

```tsx
'use client'

import { DIETARY_FLAGS, computeDietary, type DietaryOverrides } from '@/lib/dietary'
import { cn } from '@/lib/utils'

// Tri-state chips: auto (computed, muted) -> tap to force ON -> tap to force OFF -> tap back to auto.
export function DietaryChips({
  overrides, allergens, onChange,
}: {
  overrides: DietaryOverrides
  allergens: string[]
  onChange: (next: DietaryOverrides) => void
}) {
  const computed = computeDietary(allergens)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {DIETARY_FLAGS.map((f) => {
        const o = overrides[f.column]
        const on = o ?? computed.includes(f.label)
        return (
          <button
            key={f.label}
            type="button"
            onClick={() => {
              const next: boolean | null = o === null ? true : o === true ? false : null
              onChange({ ...overrides, [f.column]: next })
            }}
            title={o === null ? 'Auto (from allergens) — tap to override' : 'Overridden — tap to cycle'}
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium border transition-colors',
              on
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-gray-50 text-muted-foreground border-border line-through',
              o !== null && 'ring-1 ring-emerald-400',
            )}
          >
            {f.label}
            {o === null && <span className="ml-1 text-[10px] opacity-60">auto</span>}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2 (new page):** add state `const [dietary, setDietary] = useState<DietaryOverrides>({ vegan_override: null, vegetarian_override: null, gluten_free_override: null, dairy_free_override: null })`; render after the allergen/ingredients Section (anchor `</Section>` at ~line 370) a new Section "Dietary" with `<DietaryChips overrides={dietary} allergens={allIngredientAllergens} onChange={setDietary} />` where `allIngredientAllergens = [...new Set(ingredients.flatMap((i) => i.allergens))]`; spread `...dietary` into the recipe `.insert({...})` payload.
- [ ] **Step 3 (edit page):** initialize the same state from the loaded recipe row (`vegan_override: data.vegan_override ?? null, …`); same chips Section after ~line 432; spread `...dietary` into the `.update({...})` payload.
- [ ] **Step 4:** `npm run build` green. Live check: edit a recipe, force Vegetarian OFF, save, reload → chip stays off with ring; list page shows effective flags.
- [ ] **Step 5:** Commit: `feat(web): editable dietary chips on recipe new/edit`

---

### Task 3: AI import via atomic RPC (item 6, web side)

**Files:**
- Modify: `src/app/(dashboard)/recipes/import/page.tsx:~185-282`

- [ ] **Step 1:** Replace the multi-step save (ingredient find-or-create map + recipe insert at lines 230-254 + recipe_ingredients insert) with ONE call:

```tsx
const { data: rpcResult, error: rpcError } = await supabase.rpc('create_recipe_with_ingredients', {
  p: {
    recipe: {
      name: parsed.name.trim(),
      description: parsed.description.trim() || null,
      category: parsed.category,
      instructions: parsed.instructions.trim() || null,
      cooking_method: parsed.cooking_method.trim() || null,
      cooking_temp: parsed.cooking_temp || null,
      cooking_time: parsed.cooking_time || null,
      cooking_time_unit: parsed.cooking_time_unit,
      chilling_method: parsed.chilling_method.trim() || null,
      freezing_instructions: parsed.freezing_instructions.trim() || null,
      defrosting_instructions: parsed.defrosting_instructions.trim() || null,
      reheating_instructions: parsed.reheating_instructions.trim() || null,
      hot_holding_required: parsed.hot_holding_required,
      haccp_methods: parsed.haccp_methods,
    },
    ingredients: validIngredients.map((ing) => ({
      name: ing.name.trim(),
      allergens: ing.allergens,
      quantity: ing.quantity?.toString().trim() || null,
      unit: ing.unit.trim() || null,
    })),
  },
})
if (rpcError) throw rpcError
const recipeId = (rpcResult as { recipe_id: string }).recipe_id
```

Keep the existing query invalidation; the redirect stays `router.push('/recipes/' + recipeId)`. Delete the now-dead ingredient find-or-create code (`ingredientIds` map building). NOTE: `extra_care_flags` is not in the RPC — if `parsed.extra_care_flags` is non-empty, follow with a tolerated secondary `supabase.from('recipes').update({ extra_care_flags: parsed.extra_care_flags }).eq('id', recipeId)` (non-critical metadata; a failure here must NOT block the redirect — wrap in try/catch with console.warn).
- [ ] **Step 2:** `npm run build` green. Live check: import a recipe by text on app.blueroll.app preview (or local dev against prod DB) → lands on the recipe detail, ingredients linked, no duplicate ingredients on re-import of same names.
- [ ] **Step 3:** Commit: `feat(web): AI import saves via atomic create_recipe_with_ingredients RPC`

---

### Task 4: checklist status/ordering + multi-per-day (items 4+5, logic + UI)

**Files:**
- Create: `src/lib/checklist-status.test.ts`
- Create: `src/lib/checklist-status.ts`
- Modify: `src/app/(dashboard)/checklists/page.tsx` (use lib for status + sort, "N/M today" badge, allow opening multi templates when already completed)
- Modify: `src/app/(dashboard)/checklists/new/page.tsx` + `edit/[id]/page.tsx` (multi toggle + min input next to the deadline field ~282-288; include both fields in the form defaultValues/save payload)
- Modify: `src/app/(dashboard)/checklists/[id]/page.tsx` (completion gate: multi templates can always submit a new completion)

- [ ] **Step 1: Write the failing test** (`src/lib/checklist-status.test.ts`):

```ts
import { describe, expect, test } from 'vitest'
import { checklistStatus, compareTemplates, type TemplateLike } from './checklist-status'

const base: TemplateLike = {
  name: 'A', frequency: 'daily', deadline_time: null,
  multi_per_day: false, min_per_day: 1, supervisor_role: null,
}
const at = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d }

describe('checklistStatus', () => {
  test('single, none today -> pending', () => {
    expect(checklistStatus(base, []).label).toBe('Pending')
  })
  test('single, one completion -> completed', () => {
    expect(checklistStatus(base, [{ signed_off_by: null }]).label).toBe('Completed')
  })
  test('single with supervisor, unsigned -> awaiting sign-off', () => {
    expect(checklistStatus({ ...base, supervisor_role: 'manager' }, [{ signed_off_by: null }]).label)
      .toBe('Awaiting Sign-off')
  })
  test('multi below min -> progress label, pending-like', () => {
    const s = checklistStatus({ ...base, multi_per_day: true, min_per_day: 8 },
      [{ signed_off_by: null }, { signed_off_by: null }, { signed_off_by: null }])
    expect(s.label).toBe('3/8 today')
    expect(s.status).toBe('neutral')
  })
  test('multi at/over min -> done with count', () => {
    const s = checklistStatus({ ...base, multi_per_day: true, min_per_day: 2 },
      [{ signed_off_by: null }, { signed_off_by: null }, { signed_off_by: null }])
    expect(s.label).toBe('3/2 today')
    expect(s.status).toBe('success')
  })
  test('multi with min 0 -> always counts as done, shows count', () => {
    const s = checklistStatus({ ...base, multi_per_day: true, min_per_day: 0 }, [])
    expect(s.label).toBe('0 today')
    expect(s.status).toBe('success')
  })
  test('single past deadline, not done -> overdue', () => {
    const s = checklistStatus({ ...base, deadline_time: '00:01' }, [], at(23, 59))
    expect(s.label).toBe('Overdue')
    expect(s.status).toBe('warning')
  })
})

describe('compareTemplates (pending first, deadline asc nulls-last, then name)', () => {
  const done = (t: TemplateLike) => ({ t, done: true })
  const pend = (t: TemplateLike) => ({ t, done: false })
  test('pending before done', () => {
    expect(compareTemplates(pend(base), done({ ...base, name: '0' }))).toBeLessThan(0)
  })
  test('earlier deadline first among pending', () => {
    expect(compareTemplates(
      pend({ ...base, deadline_time: '09:00' }),
      pend({ ...base, deadline_time: '17:00' }),
    )).toBeLessThan(0)
  })
  test('deadline before no-deadline', () => {
    expect(compareTemplates(pend({ ...base, deadline_time: '17:00' }), pend(base))).toBeLessThan(0)
  })
  test('name tiebreak', () => {
    expect(compareTemplates(pend({ ...base, name: 'A' }), pend({ ...base, name: 'B' }))).toBeLessThan(0)
  })
})
```

- [ ] **Step 2:** RED (module not found).
- [ ] **Step 3:** Create `src/lib/checklist-status.ts`:

```ts
// Status + ordering for checklist cards. Counter model for multi-per-day
// (spec 2026-06-07 v-next, items 4+5): done when today's completions >= min;
// min 0 = optional (never pending/overdue). Single-per-day keeps the legacy
// pending/completed/awaiting-sign-off states + an Overdue state past deadline.
export type TemplateLike = {
  name: string
  frequency: string
  deadline_time: string | null
  multi_per_day: boolean
  min_per_day: number
  supervisor_role: string | null
}
export type CompletionLike = { signed_off_by: string | null }
export type Status = {
  label: string
  status: 'success' | 'warning' | 'info' | 'neutral'
  done: boolean
}

function pastDeadline(deadline: string | null, now: Date): boolean {
  if (!deadline) return false
  const [h, m] = deadline.split(':').map(Number)
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  return now > d
}

export function checklistStatus(
  t: TemplateLike,
  periodCompletions: CompletionLike[],
  now: Date = new Date(),
): Status {
  if (t.multi_per_day) {
    const n = periodCompletions.length
    const min = Math.max(0, t.min_per_day)
    if (min === 0) return { label: `${n} today`, status: 'success', done: true }
    if (n >= min) return { label: `${n}/${min} today`, status: 'success', done: true }
    return { label: `${n}/${min} today`, status: 'neutral', done: false }
  }
  const completion = periodCompletions[0]
  if (!completion) {
    if (pastDeadline(t.deadline_time, now)) return { label: 'Overdue', status: 'warning', done: false }
    return { label: 'Pending', status: 'neutral', done: false }
  }
  if (completion.signed_off_by) return { label: 'Signed Off', status: 'success', done: true }
  if (t.supervisor_role) return { label: 'Awaiting Sign-off', status: 'warning', done: true }
  return { label: 'Completed', status: 'success', done: true }
}

export function compareTemplates(
  a: { t: TemplateLike; done: boolean },
  b: { t: TemplateLike; done: boolean },
): number {
  if (a.done !== b.done) return a.done ? 1 : -1
  const ad = a.t.deadline_time, bd = b.t.deadline_time
  if (ad !== bd) {
    if (ad === null) return 1
    if (bd === null) return -1
    if (ad !== bd) return ad < bd ? -1 : 1
  }
  return a.t.name.localeCompare(b.t.name)
}
```

- [ ] **Step 4:** GREEN.
- [ ] **Step 5 (list page):** in `checklists/page.tsx` replace `getStatus` (lines 94-103) with the lib: collect `periodCompletions = completions.filter(c => c.template_id === t.id && new Date(c.completed_at) >= getPeriodStart(t.frequency))` (для multi считается за сегодня — `getPeriodStart('daily')`), call `checklistStatus(t, periodCompletions)`; sort the Today array with `compareTemplates` before render (instead of relying on `.order('name')`); show `s.label` (covers the N/M badge); overdue renders via existing StatusBadge warning styling.
- [ ] **Step 6 (editors):** in new+edit template editors, next to the Deadline field (~282-288) add: a `multi_per_day` checkbox "Can be completed multiple times per day" and a numeric `min_per_day` input "Minimum completions per day (0 = optional)" shown when multi is on; register both in the form, include in the insert/update payload (defaults false/1; when multi unchecked force min 1).
- [ ] **Step 7 (completion gate):** in `checklists/[id]/page.tsx`, the page currently treats an existing completion in period as read-only/`isCompleted`; for `template.multi_per_day` keep the form ALWAYS enabled for a new submission (read-only history view still available via existing completions list if present).
- [ ] **Step 8:** Build green; live check: make Fridge Temps multi (min 3) on testpush business → card shows `0/3 today`, submit twice → `2/3 today` pending-sorted on top, third → success.
- [ ] **Step 9:** Commit: `feat(web): multi-per-day checklists, deadline ordering + overdue state`

---

### Task 5: checklist drafts (item 2)

**Files:**
- Modify: `src/app/(dashboard)/checklists/[id]/page.tsx`

- [ ] **Step 1:** On mount (when not read-only), fetch the user's draft and hydrate:

```tsx
const { data: draft } = useQuery({
  queryKey: ['checklist-draft', id, profile?.id],
  queryFn: async () => {
    const { data } = await supabase
      .from('checklist_drafts')
      .select('responses, updated_at')
      .eq('template_id', id)
      .eq('created_by', profile!.id)
      .maybeSingle()
    return data
  },
  enabled: !!profile?.id,
})

useEffect(() => {
  if (draft?.responses && Object.keys(responses).length === 0) {
    setResponses(draft.responses as Record<string, ItemResponse>)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [draft])
```

- [ ] **Step 2:** "Save draft" button in the sticky buttons row (lines 499-538), left of Submit, visible when `!isCompleted`:

```tsx
<Button
  variant="outline"
  onClick={async () => {
    setSavingDraft(true)
    const { error } = await supabase.from('checklist_drafts').upsert(
      {
        template_id: id,
        business_id: business!.id,
        created_by: profile!.id,
        responses,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'template_id,created_by' },
    )
    setSavingDraft(false)
    if (error) toast.error('Failed to save draft: ' + error.message)
    else toast.success('Draft saved — finish anytime')
  }}
  disabled={savingDraft}
  className="gap-1.5"
>
  <Save className="h-3.5 w-3.5" />
  {savingDraft ? 'Saving…' : 'Save draft'}
</Button>
```

(add `const [savingDraft, setSavingDraft] = useState(false)` and the `Save` lucide import; if the page uses a different toast util, follow the file's existing pattern.)
- [ ] **Step 3:** In the submit mutation, after responses insert succeeds: `await supabase.from('checklist_drafts').delete().eq('template_id', id).eq('created_by', profile.id)` (non-fatal on error). Invalidate the draft query.
- [ ] **Step 4:** Build green; live check on testpush: fill half, Save draft, reload → values restored; submit → draft gone.
- [ ] **Step 5:** Commit: `feat(web): checklist save-draft (resume later)`

---

### Task 6: `initials` item type (item 3)

**Files:**
- Modify: `src/lib/constants.ts` (CHECKLIST_ITEM_TYPES + ITEM_TYPE_LABELS)
- Create: `src/lib/initials.test.ts`, `src/lib/initials.ts`
- Modify: `src/app/(dashboard)/checklists/[id]/page.tsx` (renderer case)
- Modify: `supabase/functions/ai-generate-checklist/index.ts` (allowed types) + deploy
- Modify: `src/app/(dashboard)/checklists/page.tsx` (show "by ‹initials›" on completed cards when present — query the initials response alongside completions if cheap, else skip list display this phase and keep it on the completion detail only; decide by what `completions` query already selects)

- [ ] **Step 1: TDD the validator** (`src/lib/initials.test.ts`):

```ts
import { describe, expect, test } from 'vitest'
import { normalizeInitials, isValidInitials } from './initials'

describe('initials', () => {
  test('uppercases and trims', () => expect(normalizeInitials(' jd ')).toBe('JD'))
  test('valid: 2-5 alphanumeric', () => {
    expect(isValidInitials('JD')).toBe(true)
    expect(isValidInitials('JDOE5')).toBe(true)
  })
  test('invalid: too short/long/symbols', () => {
    expect(isValidInitials('J')).toBe(false)
    expect(isValidInitials('JDOEXX')).toBe(false)
    expect(isValidInitials('J.D')).toBe(false)
    expect(isValidInitials('')).toBe(false)
  })
})
```

- [ ] **Step 2:** RED → implement `src/lib/initials.ts`:

```ts
// Initials item type (spec 2026-06-07 v-next, item 3): short uppercase
// alphanumeric tag identifying who filled a checklist on shared accounts.
export const INITIALS_STORAGE_KEY = 'blueroll_last_initials'

export function normalizeInitials(v: string): string {
  return v.trim().toUpperCase()
}

export function isValidInitials(v: string): boolean {
  return /^[A-Z0-9]{2,5}$/.test(normalizeInitials(v))
}
```

→ GREEN.
- [ ] **Step 3:** `src/lib/constants.ts`: add `'initials'` to `CHECKLIST_ITEM_TYPES` and `initials: 'Initials (who filled this)'` to `ITEM_TYPE_LABELS` (both editors pick it up automatically via the shared constants).
- [ ] **Step 4:** Renderer case in `checklists/[id]/page.tsx` (after the `text` case):

```tsx
{item.item_type === 'initials' && (
  <Input
    disabled={readOnly}
    value={readOnly ? (existingResp?.value ?? '') : getResponse(item.id).value}
    onChange={(e) => {
      const v = normalizeInitials(e.target.value)
      setResponse(item.id, { value: v })
      try { localStorage.setItem(INITIALS_STORAGE_KEY, v) } catch {}
    }}
    onFocus={() => {
      if (!getResponse(item.id).value) {
        try {
          const last = localStorage.getItem(INITIALS_STORAGE_KEY)
          if (last) setResponse(item.id, { value: last })
        } catch {}
      }
    }}
    maxLength={5}
    className={cn('w-28 uppercase', !readOnly && getResponse(item.id).value
      && !isValidInitials(getResponse(item.id).value) && 'border-red-300 bg-red-50')}
    placeholder="e.g. JD"
  />
)}
```

Required-validation: extend the existing required-items check in handleSubmit so an `initials` item also fails validation when `!isValidInitials(value)`.
- [ ] **Step 5:** `ai-generate-checklist/index.ts`: line ~18-20 schema `"item_type": "tick|yes_no|temperature|text|photo|initials"`; add one prompt rule line: `- Add ONE "initials" item ("Completed by (initials)", required) as the LAST item of every checklist.` Deploy: `SUPABASE_ACCESS_TOKEN=… supabase functions deploy ai-generate-checklist --project-ref rszrggreuarvodcqeqrj --no-verify-jwt`.
- [ ] **Step 6:** Build green; live check: add an initials item to a testpush template, complete it — value uppercased, remembered on next completion.
- [ ] **Step 7:** Commit: `feat(web): initials checklist item type`

---

### Task 7: Library tab navigation (item 7)

**Files:**
- Modify: `src/app/(dashboard)/checklists/page.tsx` (tab from query param)
- Modify: `src/app/(dashboard)/checklists/edit/[id]/page.tsx:183,215` (return to library)
- Modify: `src/app/(dashboard)/checklists/new/page.tsx` (same returns, if it redirects to /checklists)

- [ ] **Step 1 (list page):** read the tab from the URL:

```tsx
const searchParams = useSearchParams()
const tab = searchParams.get('tab') === 'library' && isManager ? 'library' : 'today'
…
<Tabs value={tab} onValueChange={(v) => router.replace(`/checklists${v === 'library' ? '?tab=library' : ''}`)}>
```

(replace `defaultValue="today"`; import `useSearchParams` from `next/navigation`.)
- [ ] **Step 2 (edit page):** `router.push('/checklists')` at line 183 → `router.push('/checklists?tab=library')`; back button at ~215 likewise. Same in `new/page.tsx` if it pushes `/checklists` (template creation starts from Library).
- [ ] **Step 3:** Build green; live check: Library → edit → save → back in Library tab.
- [ ] **Step 4:** Commit: `fix(web): return to Library tab after template edit`

---

### Task 8: docs + final verification

- [ ] **Step 1:** Append to `docs/superpowers/README.md`:

```markdown

## v-next Phase 2 — Web (2026-06-07)

- `src/lib/dietary.ts` — единый расчёт дието-флагов (override ?? computed); чипы-редактор `src/components/dietary-chips.tsx`.
- `src/lib/checklist-status.ts` — статус/сортировка карточек (overdue, multi N/M today).
- `src/lib/initials.ts` + тип поля `initials` (валидация A-Z0-9 2-5, localStorage `blueroll_last_initials`).
- AI-импорт рецептов и веб — через RPC `create_recipe_with_ingredients`.
- Юнит-тесты: `npm test` (vitest, src/lib/*.test.ts).
- Деплой: PR → squash merge в main → `vercel --prod`.
```

- [ ] **Step 2:** `npm test` (all green) + `npm run build` (green) + run SQL tests 07/08 once more (drafts/RPC used by new UI paths).
- [ ] **Step 3:** Commit README: `docs: v-next phase 2 web notes`

---

## Self-review (done at plan time)

- **Spec coverage (web sides):** item 1 → T1+T2; item 2 → T5; item 3 → T6; item 4 → T4 (badge already rendered in current code — ordering/overdue/editors are the actual gaps); item 5 → T4; item 6 web → T3; item 7 → T7.
- **Placeholders:** code is complete for lib/components/SQL-adjacent steps; page-wiring steps name exact anchors (line refs from live exploration) and exact payload keys. Steps that depend on a file's local idiom (toast util, Section component) explicitly defer to the file's existing pattern rather than invent one.
- **Type consistency:** `DietaryOverrides` column names = Phase-1 DB columns; `checklist_drafts` upsert onConflict matches the UNIQUE(template_id,created_by); RPC param `p` shape matches `create_recipe_with_ingredients`; `initials` value lives in `checklist_responses.value` like every other type.
- **TDD exception (UI wiring):** view-layer steps verified by build + live checks — declared and accepted in session (no component-test infra; pure logic is fully TDD'd).
