# v-next Phase 1 (DB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All additive DB groundwork for the v-next fixes: dietary override columns, multi-per-day template fields, checklist drafts table, atomic recipe-creation RPC.

**Architecture:** Four independent migrations, each TDD'd with SQL ASSERT test files run via `scripts/sql-api.sh` against the live project (no Docker on this machine). Old clients are unaffected: new columns are ignored, drafts live in a NEW table, the RPC is additive. Spec: `docs/superpowers/specs/2026-06-07-v-next-fixes-design.md`.

**Tech Stack:** Supabase Postgres, plpgsql, existing RLS helpers `get_my_business_id()` / `get_my_role()`.

**Conventions for every task:**
- Repo `~/HACCP/web`, branch `KNS/iap-foundation`. Commit ONLY files named in the task (branch has unrelated uncommitted files: CLAUDE.md, team/page.tsx, .agents/ etc.).
- Runner: `SUPABASE_ACCESS_TOKEN=sbp_… scripts/sql-api.sh <file.sql>`. On HTTP errors the script hides the body — re-run the curl from the script without `-f` to see the JSON error.
- TDD: run the test file BEFORE its migration, paste the RED output; apply migration; paste GREEN. If RED doesn't fail — STOP, report BLOCKED.
- Test identities: profile `testpush@g.com` (dedicated test account; resolve its `id`/`business_id` inside the test). Simulate an authenticated user with `PERFORM set_config('request.jwt.claims', json_build_object('sub', <uuid>, 'role', 'authenticated')::text, true);` — and for RLS tests additionally `SET LOCAL ROLE authenticated;`. Both are transaction-local; the API call is one transaction, so state never leaks.
- Throwaway rows use fixed uuids `00000000-0000-4000-8000-0000000000XX` and `__…_TEST__` names; every test deletes what it created.

---

### Task 1: recipe dietary override columns

**Files:**
- Create: `supabase/tests/sql/05_dietary_overrides.test.sql`
- Create: `supabase/migrations/20260607150000_recipe_dietary_overrides.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- Dietary tri-state overrides on recipes (NULL = auto-computed from allergens).
DO $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_recipe_id uuid;
  b record;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE email = 'testpush@g.com';
  ASSERT v_profile.id IS NOT NULL, 'test profile testpush@g.com missing';

  INSERT INTO public.recipes (business_id, created_by, name, category)
  VALUES (v_profile.business_id, v_profile.id, '__DIETARY_TEST__', 'Main')
  RETURNING id INTO v_recipe_id;

  -- defaults: all overrides NULL (= auto)
  SELECT * INTO b FROM public.recipes WHERE id = v_recipe_id;
  ASSERT b.vegan_override IS NULL AND b.vegetarian_override IS NULL
     AND b.gluten_free_override IS NULL AND b.dairy_free_override IS NULL,
     'expected all overrides NULL by default';

  -- tri-state roundtrip
  UPDATE public.recipes
     SET vegan_override = false, vegetarian_override = true,
         gluten_free_override = false, dairy_free_override = true
   WHERE id = v_recipe_id;
  SELECT * INTO b FROM public.recipes WHERE id = v_recipe_id;
  ASSERT b.vegan_override = false AND b.vegetarian_override = true
     AND b.gluten_free_override = false AND b.dairy_free_override = true,
     format('roundtrip failed: %s/%s/%s/%s', b.vegan_override, b.vegetarian_override,
            b.gluten_free_override, b.dairy_free_override);

  -- reset to auto
  UPDATE public.recipes SET vegan_override = NULL WHERE id = v_recipe_id;
  SELECT * INTO b FROM public.recipes WHERE id = v_recipe_id;
  ASSERT b.vegan_override IS NULL, 'reset to NULL failed';

  DELETE FROM public.recipes WHERE id = v_recipe_id;
END $$;
SELECT 'DIETARY OVERRIDE TESTS PASSED' AS result;
```

- [ ] **Step 2: Run to verify RED**

Run the runner on the test file.
Expected: error mentioning `vegan_override` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- Dietary tri-state overrides (spec 2026-06-07 v-next, item 1).
-- NULL = auto-compute from ingredient allergens (current behaviour);
-- true/false = explicit user override. Resolution: effective = override ?? computed.
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS vegan_override        boolean,
  ADD COLUMN IF NOT EXISTS vegetarian_override   boolean,
  ADD COLUMN IF NOT EXISTS gluten_free_override  boolean,
  ADD COLUMN IF NOT EXISTS dairy_free_override   boolean;
```

- [ ] **Step 4: Apply + verify GREEN**

Apply migration, re-run test. Expected: `[{"result":"DIETARY OVERRIDE TESTS PASSED"}]`

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/sql/05_dietary_overrides.test.sql supabase/migrations/20260607150000_recipe_dietary_overrides.sql
git commit -m "feat(db): dietary tri-state override columns on recipes"
```
(Append the standard `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` footer to every commit in this plan.)

---

### Task 2: multi-per-day template fields

**Files:**
- Create: `supabase/tests/sql/06_multi_per_day.test.sql`
- Create: `supabase/migrations/20260607150100_checklist_multi_per_day.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- multi_per_day / min_per_day on checklist_templates (spec item 5).
DO $$
DECLARE
  v_biz uuid := '00000000-0000-4000-8000-000000000011';
  v_tpl uuid;
  b record;
  v_check_violated boolean := false;
BEGIN
  DELETE FROM public.businesses WHERE id = v_biz;
  INSERT INTO public.businesses (id, name) VALUES (v_biz, '__MULTI_TEST__');

  INSERT INTO public.checklist_templates (name, frequency, business_id)
  VALUES ('__MULTI_TPL__', 'daily', v_biz)
  RETURNING id INTO v_tpl;

  -- defaults: single-per-day, min 1
  SELECT * INTO b FROM public.checklist_templates WHERE id = v_tpl;
  ASSERT b.multi_per_day = false AND b.min_per_day = 1,
         format('defaults wrong: %s/%s', b.multi_per_day, b.min_per_day);

  -- hourly-style template: multi with min 0 is allowed
  UPDATE public.checklist_templates
     SET multi_per_day = true, min_per_day = 0 WHERE id = v_tpl;
  SELECT * INTO b FROM public.checklist_templates WHERE id = v_tpl;
  ASSERT b.multi_per_day = true AND b.min_per_day = 0, 'multi/min=0 roundtrip failed';

  -- negative min rejected by CHECK
  BEGIN
    UPDATE public.checklist_templates SET min_per_day = -1 WHERE id = v_tpl;
  EXCEPTION WHEN check_violation THEN
    v_check_violated := true;
  END;
  ASSERT v_check_violated, 'expected check_violation for min_per_day = -1';

  DELETE FROM public.businesses WHERE id = v_biz; -- cascades the template
END $$;
SELECT 'MULTI PER DAY TESTS PASSED' AS result;
```

- [ ] **Step 2: RED** — expected error mentioning `multi_per_day`.

- [ ] **Step 3: Write the migration**

```sql
-- Multi-per-day checklists, counter model (spec 2026-06-07 v-next, item 5).
-- multi_per_day=true: template may be completed repeatedly within a day;
-- done when today's completions >= min_per_day (0 = optional/no obligation).
-- Old clients ignore both columns (accepted: they show done after the first
-- completion until the mobile release lands).
ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS multi_per_day boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_per_day   integer NOT NULL DEFAULT 1;

ALTER TABLE public.checklist_templates
  DROP CONSTRAINT IF EXISTS checklist_templates_min_per_day_check;
ALTER TABLE public.checklist_templates
  ADD CONSTRAINT checklist_templates_min_per_day_check CHECK (min_per_day >= 0);
```

- [ ] **Step 4: GREEN** — `[{"result":"MULTI PER DAY TESTS PASSED"}]`

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/sql/06_multi_per_day.test.sql supabase/migrations/20260607150100_checklist_multi_per_day.sql
git commit -m "feat(db): multi_per_day + min_per_day on checklist_templates"
```

---

### Task 3: checklist_drafts table + RLS

**Files:**
- Create: `supabase/tests/sql/07_checklist_drafts.test.sql`
- Create: `supabase/migrations/20260607150200_checklist_drafts.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- checklist_drafts: per-user partial fills, invisible to old clients (spec item 2).
-- RLS verified under role 'authenticated' with simulated JWT claims.
DO $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_tpl uuid;
  v_cnt int;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE email = 'testpush@g.com';
  ASSERT v_profile.id IS NOT NULL, 'test profile testpush@g.com missing';

  -- a template in the test user's business to draft against
  INSERT INTO public.checklist_templates (name, frequency, business_id)
  VALUES ('__DRAFT_TPL__', 'daily', v_profile.business_id)
  RETURNING id INTO v_tpl;

  -- become the test user (transaction-local)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_profile.id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- upsert draft (the client call pattern)
  INSERT INTO public.checklist_drafts (template_id, business_id, created_by, responses)
  VALUES (v_tpl, v_profile.business_id, v_profile.id, '{"item-1":"5.0"}'::jsonb)
  ON CONFLICT (template_id, created_by)
  DO UPDATE SET responses = EXCLUDED.responses, updated_at = now();

  -- same-user upsert replaces, not duplicates
  INSERT INTO public.checklist_drafts (template_id, business_id, created_by, responses)
  VALUES (v_tpl, v_profile.business_id, v_profile.id, '{"item-1":"5.0","item-2":"yes"}'::jsonb)
  ON CONFLICT (template_id, created_by)
  DO UPDATE SET responses = EXCLUDED.responses, updated_at = now();

  SELECT count(*) INTO v_cnt FROM public.checklist_drafts WHERE template_id = v_tpl;
  ASSERT v_cnt = 1, format('expected 1 draft, got %s', v_cnt);
  ASSERT (SELECT responses->>'item-2' FROM public.checklist_drafts
           WHERE template_id = v_tpl AND created_by = v_profile.id) = 'yes',
         'upsert did not replace responses';

  -- another user must see nothing (RLS)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000099', 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_cnt FROM public.checklist_drafts WHERE template_id = v_tpl;
  ASSERT v_cnt = 0, format('RLS leak: foreign user sees %s drafts', v_cnt);

  -- back to postgres for cleanup
  RESET ROLE;
  DELETE FROM public.checklist_drafts WHERE template_id = v_tpl;
  DELETE FROM public.checklist_templates WHERE id = v_tpl;
END $$;
SELECT 'CHECKLIST DRAFTS TESTS PASSED' AS result;
```

- [ ] **Step 2: RED** — expected error: relation `public.checklist_drafts` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- Checklist drafts: save partway, finish later (spec 2026-06-07 v-next, item 2).
-- A SEPARATE table on purpose: old clients compute checklist status from
-- checklist_completions; a draft row there would read as "done" to them.
CREATE TABLE IF NOT EXISTS public.checklist_drafts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  responses   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, created_by)
);

ALTER TABLE public.checklist_drafts ENABLE ROW LEVEL SECURITY;

-- Drafts are strictly personal: only the author sees/edits their draft,
-- and only within their own business.
DROP POLICY IF EXISTS "Own drafts" ON public.checklist_drafts;
CREATE POLICY "Own drafts" ON public.checklist_drafts
  FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid() AND business_id = public.get_my_business_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_drafts TO authenticated;
```

- [ ] **Step 4: GREEN** — `[{"result":"CHECKLIST DRAFTS TESTS PASSED"}]`

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/sql/07_checklist_drafts.test.sql supabase/migrations/20260607150200_checklist_drafts.sql
git commit -m "feat(db): checklist_drafts table with per-user RLS"
```

---

### Task 4: atomic recipe-creation RPC

**Files:**
- Create: `supabase/tests/sql/08_create_recipe_rpc.test.sql`
- Create: `supabase/migrations/20260607150300_create_recipe_rpc.sql`

Depends on Task 1 (writes the override columns).

- [ ] **Step 1: Write the failing test**

```sql
-- create_recipe_with_ingredients: the atomic save behind AI import (spec item 6).
DO $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_result jsonb;
  v_recipe_id uuid;
  v_existing_ing uuid;
  v_cnt int;
  b record;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE email = 'testpush@g.com';
  ASSERT v_profile.id IS NOT NULL, 'test profile testpush@g.com missing';

  -- pre-existing ingredient: the RPC must REUSE it (case-insensitive), not duplicate
  INSERT INTO public.ingredients (business_id, name, allergens)
  VALUES (v_profile.business_id, '__RPC_TEST_FLOUR__', ARRAY['gluten'])
  RETURNING id INTO v_existing_ing;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_profile.id, 'role', 'authenticated')::text, true);

  v_result := public.create_recipe_with_ingredients(jsonb_build_object(
    'recipe', jsonb_build_object(
      'name', '__RPC_TEST_RECIPE__',
      'category', 'Main',
      'description', 'rpc test',
      'instructions', 'mix and bake',
      'vegetarian_override', true
    ),
    'ingredients', jsonb_build_array(
      jsonb_build_object('name', '__rpc_test_flour__', 'allergens', jsonb_build_array('gluten'),
                         'quantity', '200', 'unit', 'g'),
      jsonb_build_object('name', '__RPC_TEST_MILK__', 'allergens', jsonb_build_array('milk'),
                         'quantity', '100', 'unit', 'ml')
    )
  ));
  v_recipe_id := (v_result->>'recipe_id')::uuid;
  ASSERT v_recipe_id IS NOT NULL, 'no recipe_id returned';

  SELECT * INTO b FROM public.recipes WHERE id = v_recipe_id;
  ASSERT b.business_id = v_profile.business_id AND b.created_by = v_profile.id,
         'recipe ownership wrong';
  ASSERT b.vegetarian_override = true AND b.vegan_override IS NULL,
         'override passthrough wrong';

  -- two join rows; flour REUSED (no new __rpc_test_flour__ row), milk created
  SELECT count(*) INTO v_cnt FROM public.recipe_ingredients WHERE recipe_id = v_recipe_id;
  ASSERT v_cnt = 2, format('expected 2 recipe_ingredients, got %s', v_cnt);
  SELECT count(*) INTO v_cnt FROM public.ingredients
   WHERE business_id = v_profile.business_id AND lower(name) = '__rpc_test_flour__';
  ASSERT v_cnt = 1, format('flour duplicated: %s rows', v_cnt);
  ASSERT EXISTS (SELECT 1 FROM public.recipe_ingredients
                  WHERE recipe_id = v_recipe_id AND ingredient_id = v_existing_ing),
         'existing flour not linked';

  -- unauthenticated call refused
  PERFORM set_config('request.jwt.claims', NULL, true);
  BEGIN
    PERFORM public.create_recipe_with_ingredients('{"recipe":{"name":"x"}}'::jsonb);
    ASSERT false, 'expected Not authenticated';
  EXCEPTION WHEN raise_exception THEN
    NULL; -- expected
  END;

  -- cleanup (recipe cascades its join rows)
  DELETE FROM public.recipes WHERE id = v_recipe_id;
  DELETE FROM public.ingredients
   WHERE business_id = v_profile.business_id AND lower(name) IN ('__rpc_test_flour__','__rpc_test_milk__');
END $$;
SELECT 'CREATE RECIPE RPC TESTS PASSED' AS result;
```

- [ ] **Step 2: RED** — expected: function `public.create_recipe_with_ingredients(jsonb)` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- Atomic recipe + ingredients creation (spec 2026-06-07 v-next, item 6).
-- Replaces the clients' fragile 3-step save (recipe insert -> per-ingredient
-- find-or-create -> join rows): a mid-sequence failure used to leave a
-- half-created recipe and surface an error. All-or-nothing here.
-- SECURITY DEFINER; caller is validated the same way the "Chefs can manage
-- recipes" RLS policy does (owner/manager/chef of their own business).
CREATE OR REPLACE FUNCTION public.create_recipe_with_ingredients(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_business uuid;
  v_role text;
  v_recipe_id uuid;
  v_ing record;
  v_ing_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT business_id, role INTO v_business, v_role
    FROM public.profiles WHERE id = v_user;
  IF v_business IS NULL THEN
    RAISE EXCEPTION 'User has no business';
  END IF;
  IF v_role NOT IN ('owner','manager','chef') THEN
    RAISE EXCEPTION 'Only owner/manager/chef can create recipes';
  END IF;
  IF COALESCE(p->'recipe'->>'name','') = '' THEN
    RAISE EXCEPTION 'Recipe name is required';
  END IF;

  INSERT INTO public.recipes (
    business_id, created_by, name, description, category, instructions,
    cooking_method, cooking_temp, cooking_time, cooking_time_unit,
    reheating_instructions, hot_holding_required, chilling_method,
    freezing_instructions, defrosting_instructions, haccp_methods,
    vegan_override, vegetarian_override, gluten_free_override, dairy_free_override
  ) VALUES (
    v_business, v_user,
    p->'recipe'->>'name',
    p->'recipe'->>'description',
    COALESCE(p->'recipe'->>'category', 'Main'),
    COALESCE(p->'recipe'->>'instructions', ''),
    p->'recipe'->>'cooking_method',
    (p->'recipe'->>'cooking_temp')::numeric,
    (p->'recipe'->>'cooking_time')::numeric,
    p->'recipe'->>'cooking_time_unit',
    p->'recipe'->>'reheating_instructions',
    COALESCE((p->'recipe'->>'hot_holding_required')::boolean, false),
    p->'recipe'->>'chilling_method',
    p->'recipe'->>'freezing_instructions',
    p->'recipe'->>'defrosting_instructions',
    COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(
        COALESCE(p->'recipe'->'haccp_methods', '[]'::jsonb)) x), '{}'),
    (p->'recipe'->>'vegan_override')::boolean,
    (p->'recipe'->>'vegetarian_override')::boolean,
    (p->'recipe'->>'gluten_free_override')::boolean,
    (p->'recipe'->>'dairy_free_override')::boolean
  ) RETURNING id INTO v_recipe_id;

  FOR v_ing IN
    SELECT * FROM jsonb_to_recordset(COALESCE(p->'ingredients', '[]'::jsonb))
      AS t(name text, allergens text[], quantity text, unit text, notes text)
  LOOP
    CONTINUE WHEN COALESCE(v_ing.name, '') = '';
    SELECT id INTO v_ing_id FROM public.ingredients
     WHERE business_id = v_business AND lower(name) = lower(v_ing.name)
     LIMIT 1;
    IF v_ing_id IS NULL THEN
      INSERT INTO public.ingredients (business_id, name, allergens)
      VALUES (v_business, v_ing.name, COALESCE(v_ing.allergens, '{}'))
      RETURNING id INTO v_ing_id;
    END IF;
    INSERT INTO public.recipe_ingredients (recipe_id, ingredient_id, quantity, unit, notes)
    VALUES (v_recipe_id, v_ing_id, v_ing.quantity, v_ing.unit, v_ing.notes);
    v_ing_id := NULL;
  END LOOP;

  RETURN jsonb_build_object('recipe_id', v_recipe_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_recipe_with_ingredients(jsonb) TO authenticated;
```

- [ ] **Step 4: GREEN** — `[{"result":"CREATE RECIPE RPC TESTS PASSED"}]`. Also re-run tests 05–07 (must stay green).

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/sql/08_create_recipe_rpc.test.sql supabase/migrations/20260607150300_create_recipe_rpc.sql
git commit -m "feat(db): atomic create_recipe_with_ingredients RPC"
```

---

### Task 5: docs + full sweep

**Files:**
- Modify: `docs/superpowers/README.md` (append)

- [ ] **Step 1: Append ops notes**

```markdown

## v-next Phase 1 — DB (2026-06-07)

- recipes: `*_override` boolean NULL=auto (vegan/vegetarian/gluten_free/dairy_free);
  effective = override ?? computed-from-allergens.
- checklist_templates: `multi_per_day` (bool), `min_per_day` (int ≥0, 0 = optional).
- `checklist_drafts` — личные черновики (RLS: только автор), уникальность (template_id, created_by);
  клиент апсертит `ON CONFLICT (template_id, created_by)`.
- RPC `create_recipe_with_ingredients(jsonb)` — атомарное сохранение рецепта
  (рецепт + find-or-create ингредиентов + связи); клиенты переходят на него в фазах 2–3.
- Тесты: supabase/tests/sql/05–08.
```

- [ ] **Step 2: Final verification sweep**

Re-run ALL SQL test files 01–08 via the runner; every output must be its PASSED marker. (01–04 guard the subscription arbitration — they must not regress; 02/04 each send one "ignore push" ntfy to the founder topic — expected.)

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/README.md
git commit -m "docs: v-next phase 1 DB ops notes"
```

---

## Self-review (done at plan time)

- **Spec coverage (Phase 1 scope):** item 1 → Task 1; item 2 → Task 3; item 5 → Task 2; item 6 DB-side → Task 4. Items 3/4/7 need no DB work (item 3 is a client-side item type over the existing text `item_type`; item 4's `deadline_time` exists; item 7 is navigation). Phases 2–3 get their own plans.
- **Placeholders:** none — full SQL in every step, expected outputs stated.
- **Type consistency:** override column names identical in Task 1 and Task 4 (`vegan_override`, `vegetarian_override`, `gluten_free_override`, `dairy_free_override`); drafts unique key `(template_id, created_by)` matches the test's ON CONFLICT; RPC signature `(p jsonb) RETURNS jsonb` matches the test call.
- **Safety notes:** all migrations additive + idempotent (`IF NOT EXISTS` / `OR REPLACE` / `DROP POLICY IF EXISTS`); RLS tests restore role via transaction scope; tests clean their rows; the only touched real account is the dedicated `testpush@g.com`.
