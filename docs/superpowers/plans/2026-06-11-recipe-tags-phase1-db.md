# Recipe Tags Phase 1 (DB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All DB groundwork for per-business recipe tags: `tags` + `recipe_tags` tables with RLS, `attach_tag` RPC, orphan-tag cleanup trigger, `create_recipe_with_ingredients` accepting `tags[]`, and the category→tags backfill. `recipes.category` is NOT dropped (shipped mobile builds crash without it — spec "New facts" #1).

**Architecture:** Four additive migrations, each TDD'd with SQL ASSERT test files run via `scripts/sql-api.sh` against the live project (no Docker on this machine — same infra as plans 2026-06-07). Old clients unaffected: they neither select nor join the new tables, and `category` keeps working via `DEFAULT 'other'`. Spec: `docs/superpowers/specs/2026-06-11-recipe-tags-design.md`.

**Tech Stack:** Supabase Postgres, plpgsql, existing RLS helpers `get_my_business_id()` / `get_my_role()`.

**Conventions for every task:**
- Repo `~/HACCP/web`, branch `KNS/recipe-tags` **forked from `KNS/iap-foundation`** (v-next work is not merged to main yet and the recipes pages depend on it). Create once: `git checkout KNS/iap-foundation && git checkout -b KNS/recipe-tags`. Commit ONLY files named in the task.
- Runner: `SUPABASE_ACCESS_TOKEN=<from ~/Secrets/blueroll/README.md> scripts/sql-api.sh <file.sql>`. On HTTP errors re-run the curl from the script without `-f` to see the JSON error body.
- TDD: run the test file BEFORE its migration, paste the RED output; apply the migration via the same runner; paste GREEN. If RED doesn't fail — STOP, report BLOCKED.
- Test identity: profile `testpush@g.com` (dedicated test account; resolve `id`/`business_id` inside the test). Simulate auth with `PERFORM set_config('request.jwt.claims', json_build_object('sub', <uuid>, 'role', 'authenticated')::text, true);` and for RLS checks additionally `SET LOCAL ROLE authenticated;` — both transaction-local; one runner call = one transaction.
- Throwaway rows use fixed uuids `00000000-0000-4000-8000-0000000001XX` and `__…_TEST__` names; every test deletes what it created (`RESET ROLE` first for cleanup).

---

### Task 1: tags + recipe_tags tables, RLS, default on category

**Files:**
- Create: `supabase/tests/sql/10_recipe_tags_schema.test.sql`
- Create: `supabase/migrations/20260611120000_recipe_tags_schema.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- tags + recipe_tags: schema, normalisation, uniqueness, RLS (spec Section 1).
DO $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_recipe_id uuid;
  v_tag_id uuid;
  v_cnt int;
  v_violated boolean := false;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE email = 'testpush@g.com';
  ASSERT v_profile.id IS NOT NULL, 'test profile testpush@g.com missing';

  INSERT INTO public.recipes (business_id, created_by, name, category)
  VALUES (v_profile.business_id, v_profile.id, '__TAGS_SCHEMA_TEST__', 'main')
  RETURNING id INTO v_recipe_id;

  -- category default exists (old mobile builds depend on the column staying NOT NULL)
  INSERT INTO public.recipes (business_id, created_by, name)
  VALUES (v_profile.business_id, v_profile.id, '__TAGS_NO_CAT_TEST__');
  ASSERT (SELECT category FROM public.recipes WHERE name = '__TAGS_NO_CAT_TEST__'
           AND business_id = v_profile.business_id) = 'other',
         'recipes.category DEFAULT ''other'' missing';

  -- name_norm is generated; uniqueness is per business and case/space-insensitive
  INSERT INTO public.tags (business_id, name) VALUES (v_profile.business_id, '  Pasta Dishes ')
  RETURNING id INTO v_tag_id;
  ASSERT (SELECT name_norm FROM public.tags WHERE id = v_tag_id) = 'pasta dishes',
         'name_norm not normalised';
  BEGIN
    INSERT INTO public.tags (business_id, name) VALUES (v_profile.business_id, 'PASTA DISHES');
  EXCEPTION WHEN unique_violation THEN
    v_violated := true;
  END;
  ASSERT v_violated, 'duplicate normalised tag name not rejected';

  -- empty / overlong names rejected by CHECK
  v_violated := false;
  BEGIN
    INSERT INTO public.tags (business_id, name) VALUES (v_profile.business_id, '   ');
  EXCEPTION WHEN check_violation THEN
    v_violated := true;
  END;
  ASSERT v_violated, 'blank tag name not rejected';
  v_violated := false;
  BEGIN
    INSERT INTO public.tags (business_id, name) VALUES (v_profile.business_id, repeat('x', 41));
  EXCEPTION WHEN check_violation THEN
    v_violated := true;
  END;
  ASSERT v_violated, '41-char tag name not rejected';

  -- link row + PK dedupe
  INSERT INTO public.recipe_tags (recipe_id, tag_id) VALUES (v_recipe_id, v_tag_id);
  v_violated := false;
  BEGIN
    INSERT INTO public.recipe_tags (recipe_id, tag_id) VALUES (v_recipe_id, v_tag_id);
  EXCEPTION WHEN unique_violation THEN
    v_violated := true;
  END;
  ASSERT v_violated, 'duplicate recipe_tags pair not rejected';

  -- RLS: owner of the business sees the tag, can write
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_profile.id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_cnt FROM public.tags WHERE id = v_tag_id;
  ASSERT v_cnt = 1, 'member cannot see own-business tag';

  -- RLS: a user from another (nonexistent) business sees nothing, cannot insert
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000199', 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_cnt FROM public.tags WHERE id = v_tag_id;
  ASSERT v_cnt = 0, format('RLS leak: foreign user sees %s tags', v_cnt);
  SELECT count(*) INTO v_cnt FROM public.recipe_tags WHERE tag_id = v_tag_id;
  ASSERT v_cnt = 0, format('RLS leak: foreign user sees %s recipe_tags', v_cnt);
  v_violated := false;
  BEGIN
    INSERT INTO public.tags (business_id, name) VALUES (v_profile.business_id, '__EVIL__');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_violated := true;
  WHEN others THEN
    v_violated := true; -- RLS WITH CHECK violation surfaces as 42501/new-row violation
  END;
  ASSERT v_violated, 'foreign user could insert a tag into another business';

  -- cleanup
  RESET ROLE;
  DELETE FROM public.recipes WHERE id = v_recipe_id; -- cascades recipe_tags
  DELETE FROM public.recipes WHERE business_id = v_profile.business_id AND name = '__TAGS_NO_CAT_TEST__';
  DELETE FROM public.tags WHERE business_id = v_profile.business_id AND name_norm = 'pasta dishes';
END $$;
SELECT 'RECIPE TAGS SCHEMA TESTS PASSED' AS result;
```

- [ ] **Step 2: RED** — expected error: relation `public.tags` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- Per-business recipe tags, M:N (spec 2026-06-11 recipe-tags, Section 1).
-- recipes.category is intentionally KEPT: shipped mobile builds (<=1.4.0+21)
-- parse it non-nullably; the DEFAULT keeps rows created by tag-aware clients
-- readable for them. Dropped in a later cycle (deploy order step 5).
ALTER TABLE public.recipes ALTER COLUMN category SET DEFAULT 'other';

CREATE TABLE IF NOT EXISTS public.tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 40),
  name_norm   text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name_norm)
);

CREATE TABLE IF NOT EXISTS public.recipe_tags (
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  tag_id    uuid NOT NULL REFERENCES public.tags(id)    ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_recipe_tags_tag ON public.recipe_tags(tag_id);

ALTER TABLE public.tags        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_tags ENABLE ROW LEVEL SECURITY;

-- Read: any member of the business. Write: same roles that may write recipes
-- (mirrors create_recipe_with_ingredients' owner/manager/chef gate).
DROP POLICY IF EXISTS "Members read tags" ON public.tags;
CREATE POLICY "Members read tags" ON public.tags
  FOR SELECT USING (business_id = public.get_my_business_id());

DROP POLICY IF EXISTS "Recipe writers manage tags" ON public.tags;
CREATE POLICY "Recipe writers manage tags" ON public.tags
  FOR ALL
  USING (business_id = public.get_my_business_id()
         AND public.get_my_role() IN ('owner','manager','chef'))
  WITH CHECK (business_id = public.get_my_business_id()
              AND public.get_my_role() IN ('owner','manager','chef'));

DROP POLICY IF EXISTS "Members read recipe_tags" ON public.recipe_tags;
CREATE POLICY "Members read recipe_tags" ON public.recipe_tags
  FOR SELECT USING (
    recipe_id IN (SELECT id FROM public.recipes
                   WHERE business_id = public.get_my_business_id()));

-- Both sides pinned to the caller's business: no cross-business linking.
DROP POLICY IF EXISTS "Recipe writers manage recipe_tags" ON public.recipe_tags;
CREATE POLICY "Recipe writers manage recipe_tags" ON public.recipe_tags
  FOR ALL
  USING (
    public.get_my_role() IN ('owner','manager','chef')
    AND recipe_id IN (SELECT id FROM public.recipes
                       WHERE business_id = public.get_my_business_id()))
  WITH CHECK (
    public.get_my_role() IN ('owner','manager','chef')
    AND recipe_id IN (SELECT id FROM public.recipes
                       WHERE business_id = public.get_my_business_id())
    AND tag_id IN (SELECT id FROM public.tags
                    WHERE business_id = public.get_my_business_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags        TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.recipe_tags TO authenticated;
```

- [ ] **Step 4: GREEN** — `[{"result":"RECIPE TAGS SCHEMA TESTS PASSED"}]`

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/sql/10_recipe_tags_schema.test.sql supabase/migrations/20260611120000_recipe_tags_schema.sql
git commit -m "feat(db): tags + recipe_tags tables with per-business RLS"
```
(Append the standard `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` footer to every commit in this plan.)

---

### Task 2: attach_tag RPC + orphan cleanup trigger

**Files:**
- Create: `supabase/tests/sql/11_attach_tag.test.sql`
- Create: `supabase/migrations/20260611120100_attach_tag_rpc.sql`

Depends on Task 1.

- [ ] **Step 1: Write the failing test**

```sql
-- attach_tag: normalised find-or-create + link; orphan tags self-delete
-- when their last link goes (spec Section 1, derived decision 2).
DO $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_recipe_a uuid;
  v_recipe_b uuid;
  v_tag public.tags%ROWTYPE;
  v_tag2 public.tags%ROWTYPE;
  v_cnt int;
  v_violated boolean := false;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE email = 'testpush@g.com';
  ASSERT v_profile.id IS NOT NULL, 'test profile testpush@g.com missing';

  INSERT INTO public.recipes (business_id, created_by, name, category)
  VALUES (v_profile.business_id, v_profile.id, '__ATTACH_TEST_A__', 'main')
  RETURNING id INTO v_recipe_a;
  INSERT INTO public.recipes (business_id, created_by, name, category)
  VALUES (v_profile.business_id, v_profile.id, '__ATTACH_TEST_B__', 'main')
  RETURNING id INTO v_recipe_b;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_profile.id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- find-or-create: first call creates (keeps first-writer casing), second reuses
  v_tag  := public.attach_tag(v_recipe_a, '  Pasta Special ');
  v_tag2 := public.attach_tag(v_recipe_b, 'pasta special');
  ASSERT v_tag.id = v_tag2.id, 'same normalised name produced two tags';
  ASSERT v_tag.name = 'Pasta Special', format('casing not preserved: %s', v_tag.name);
  SELECT count(*) INTO v_cnt FROM public.recipe_tags WHERE tag_id = v_tag.id;
  ASSERT v_cnt = 2, format('expected 2 links, got %s', v_cnt);

  -- re-attaching is a no-op, not an error
  v_tag2 := public.attach_tag(v_recipe_a, 'Pasta Special');
  SELECT count(*) INTO v_cnt FROM public.recipe_tags WHERE tag_id = v_tag.id;
  ASSERT v_cnt = 2, 're-attach duplicated a link';

  -- blank name rejected
  BEGIN
    PERFORM public.attach_tag(v_recipe_a, '   ');
  EXCEPTION WHEN raise_exception OR check_violation THEN
    v_violated := true;
  END;
  ASSERT v_violated, 'blank tag name accepted by attach_tag';

  -- orphan cleanup: detaching one of two keeps the tag …
  DELETE FROM public.recipe_tags WHERE recipe_id = v_recipe_b AND tag_id = v_tag.id;
  SELECT count(*) INTO v_cnt FROM public.tags WHERE id = v_tag.id;
  ASSERT v_cnt = 1, 'tag deleted while still linked';
  -- … detaching the last link deletes it
  DELETE FROM public.recipe_tags WHERE recipe_id = v_recipe_a AND tag_id = v_tag.id;
  SELECT count(*) INTO v_cnt FROM public.tags WHERE id = v_tag.id;
  ASSERT v_cnt = 0, 'orphan tag not cleaned up';

  -- recipe DELETE cascade also triggers cleanup
  v_tag := public.attach_tag(v_recipe_a, '__CASCADE_TAG__');
  RESET ROLE;
  DELETE FROM public.recipes WHERE id = v_recipe_a;
  SELECT count(*) INTO v_cnt FROM public.tags WHERE id = v_tag.id;
  ASSERT v_cnt = 0, 'cascade-orphaned tag not cleaned up';

  DELETE FROM public.recipes WHERE id = v_recipe_b;
END $$;
SELECT 'ATTACH TAG TESTS PASSED' AS result;
```

- [ ] **Step 2: RED** — expected: function `public.attach_tag(uuid, text)` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- attach_tag: normalise -> find-or-create -> link (spec Section 1).
-- SECURITY INVOKER on purpose: RLS on tags/recipe_tags is the authorisation
-- (per-business pinning + owner/manager/chef role gate). ON CONFLICT makes the
-- find-or-create race-safe; the no-op DO UPDATE makes RETURNING always yield
-- the row.
CREATE OR REPLACE FUNCTION public.attach_tag(p_recipe_id uuid, p_name text)
RETURNS public.tags
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_tag public.tags;
BEGIN
  IF v_name = '' OR char_length(v_name) > 40 THEN
    RAISE EXCEPTION 'Tag name must be 1-40 characters';
  END IF;

  INSERT INTO public.tags (business_id, name)
  VALUES (public.get_my_business_id(), v_name)
  ON CONFLICT (business_id, name_norm) DO UPDATE SET name = tags.name
  RETURNING * INTO v_tag;

  INSERT INTO public.recipe_tags (recipe_id, tag_id)
  VALUES (p_recipe_id, v_tag.id)
  ON CONFLICT DO NOTHING;

  RETURN v_tag;
END;
$$;

GRANT EXECUTE ON FUNCTION public.attach_tag(uuid, text) TO authenticated;

-- Orphan cleanup: with no tag-management screen (spec approach A), tags exist
-- only while >=1 recipe carries them. SECURITY DEFINER so cascades fired by
-- recipe deletion clean up regardless of the deleting user's tag policies;
-- trigger functions are not callable via PostgREST.
CREATE OR REPLACE FUNCTION public.cleanup_orphan_tag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.tags t
   WHERE t.id = OLD.tag_id
     AND NOT EXISTS (SELECT 1 FROM public.recipe_tags rt WHERE rt.tag_id = OLD.tag_id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_orphan_tag ON public.recipe_tags;
CREATE TRIGGER trg_cleanup_orphan_tag
  AFTER DELETE ON public.recipe_tags
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_orphan_tag();
```

- [ ] **Step 4: GREEN** — `[{"result":"ATTACH TAG TESTS PASSED"}]`. Re-run test 10 (must stay green).

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/sql/11_attach_tag.test.sql supabase/migrations/20260611120100_attach_tag_rpc.sql
git commit -m "feat(db): attach_tag RPC + orphan tag cleanup trigger"
```

---

### Task 3: create_recipe_with_ingredients accepts tags[]

**Files:**
- Create: `supabase/tests/sql/12_create_recipe_rpc_tags.test.sql`
- Create: `supabase/migrations/20260611120200_create_recipe_rpc_tags.sql`

Depends on Tasks 1–2.

- [ ] **Step 1: Write the failing test**

```sql
-- create_recipe_with_ingredients: optional p->'tags' creates+links atomically;
-- legacy payloads (category, no tags) still work (spec Sections 1-2).
DO $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_result jsonb;
  v_recipe_id uuid;
  v_cnt int;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE email = 'testpush@g.com';
  ASSERT v_profile.id IS NOT NULL, 'test profile testpush@g.com missing';

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_profile.id, 'role', 'authenticated')::text, true);

  -- tag-aware payload: no category, two tags (one will pre-exist via the other recipe path)
  v_result := public.create_recipe_with_ingredients(jsonb_build_object(
    'recipe', jsonb_build_object('name', '__RPC_TAGS_TEST__', 'instructions', 'mix'),
    'ingredients', '[]'::jsonb,
    'tags', jsonb_build_array('  Pasta RPC ', 'pasta rpc', 'Hits RPC')
  ));
  v_recipe_id := (v_result->>'recipe_id')::uuid;
  ASSERT v_recipe_id IS NOT NULL, 'no recipe_id returned';

  -- duplicate-after-normalisation collapses to one tag -> 2 links total
  SELECT count(*) INTO v_cnt FROM public.recipe_tags WHERE recipe_id = v_recipe_id;
  ASSERT v_cnt = 2, format('expected 2 tag links, got %s', v_cnt);
  ASSERT EXISTS (SELECT 1 FROM public.recipe_tags rt JOIN public.tags t ON t.id = rt.tag_id
                  WHERE rt.recipe_id = v_recipe_id AND t.name_norm = 'pasta rpc'),
         'pasta tag not linked';

  -- category not sent -> column default applied (old mobile builds keep rendering)
  ASSERT (SELECT category FROM public.recipes WHERE id = v_recipe_id) = 'other',
         'category default not applied by RPC';

  -- legacy payload: category present, no tags -> still works, no tag links
  v_result := public.create_recipe_with_ingredients(jsonb_build_object(
    'recipe', jsonb_build_object('name', '__RPC_LEGACY_TEST__', 'category', 'main'),
    'ingredients', '[]'::jsonb
  ));
  ASSERT (v_result->>'recipe_id') IS NOT NULL, 'legacy payload failed';
  SELECT count(*) INTO v_cnt FROM public.recipe_tags
   WHERE recipe_id = (v_result->>'recipe_id')::uuid;
  ASSERT v_cnt = 0, 'legacy payload unexpectedly created tags';

  -- cleanup (recipe delete cascades links; orphan trigger removes the tags)
  DELETE FROM public.recipes WHERE business_id = v_profile.business_id
    AND name IN ('__RPC_TAGS_TEST__', '__RPC_LEGACY_TEST__');
  SELECT count(*) INTO v_cnt FROM public.tags
   WHERE business_id = v_profile.business_id AND name_norm IN ('pasta rpc','hits rpc');
  ASSERT v_cnt = 0, 'test tags survived cleanup';
END $$;
SELECT 'CREATE RECIPE RPC TAGS TESTS PASSED' AS result;
```

- [ ] **Step 2: RED** — expected: the first ASSERT on tag links fails (`expected 2 tag links, got 0`) because the current RPC ignores `p->'tags'`.

- [ ] **Step 3: Write the migration** — full replacement of the function. It is the Task-4 function from plan `2026-06-07-v-next-phase1-db.md` with: (a) the `category` insert line now relying on the column default when absent, (b) a tags loop appended after ingredients. Complete SQL:

```sql
-- create_recipe_with_ingredients v2: optional tags[] (spec 2026-06-11 recipe-tags).
-- Tags use the same normalised find-or-create as attach_tag, inside the same
-- transaction. 'category' in the payload is still accepted (legacy clients);
-- when absent the column DEFAULT 'other' applies.
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
  v_tag_name text;
  v_tag_id uuid;
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
    COALESCE(p->'recipe'->>'category', 'other'),
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

  FOR v_tag_name IN
    SELECT btrim(x) FROM jsonb_array_elements_text(COALESCE(p->'tags', '[]'::jsonb)) x
  LOOP
    CONTINUE WHEN v_tag_name = '' OR char_length(v_tag_name) > 40;
    INSERT INTO public.tags (business_id, name)
    VALUES (v_business, v_tag_name)
    ON CONFLICT (business_id, name_norm) DO UPDATE SET name = tags.name
    RETURNING id INTO v_tag_id;
    INSERT INTO public.recipe_tags (recipe_id, tag_id)
    VALUES (v_recipe_id, v_tag_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object('recipe_id', v_recipe_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_recipe_with_ingredients(jsonb) TO authenticated;
```

- [ ] **Step 4: GREEN** — `[{"result":"CREATE RECIPE RPC TAGS TESTS PASSED"}]`. Re-run test 08 (the original RPC test — must stay green; it sends `category`, which this version still accepts).

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/sql/12_create_recipe_rpc_tags.test.sql supabase/migrations/20260611120200_create_recipe_rpc_tags.sql
git commit -m "feat(db): create_recipe_with_ingredients accepts tags[]"
```

---

### Task 4: category → tags backfill

**Files:**
- Create: `supabase/tests/sql/13_tags_backfill.test.sql`
- Create: `supabase/migrations/20260611120300_category_to_tags_backfill.sql`

Depends on Tasks 1–2. **Order note:** the test here verifies invariants AFTER the migration (the backfill touches live data, so the red/green cycle uses a synthetic business inside the test for the mapping logic, then asserts global invariants post-apply).

- [ ] **Step 1: Write the test** (also serves as the post-apply sanity check)

```sql
-- Backfill invariants (spec Section 2):
-- every recipe with a real category is linked to the tag named by its label;
-- 'other' recipes got no tag from the backfill; idempotent.
DO $$
DECLARE
  v_missing int;
  v_cnt int;
BEGIN
  -- (1) full coverage: category (except 'other') -> linked tag with the mapped label
  WITH mapping(category, tag_name) AS (
    VALUES ('starter','Starters'),('main','Mains'),('dessert','Desserts'),
           ('side','Sides'),('sauce','Sauces'),('drink','Drinks'),
           ('cocktail','Cocktails'),('beverage','Beverages')
  )
  SELECT count(*) INTO v_missing
  FROM public.recipes r
  JOIN mapping m ON m.category = r.category
  WHERE NOT EXISTS (
    SELECT 1 FROM public.recipe_tags rt
    JOIN public.tags t ON t.id = rt.tag_id
    WHERE rt.recipe_id = r.id
      AND t.business_id = r.business_id
      AND t.name_norm = lower(m.tag_name));
  ASSERT v_missing = 0, format('%s recipes missing their category tag', v_missing);

  -- (2) no business got an 'Other' tag from the backfill
  SELECT count(*) INTO v_cnt FROM public.tags WHERE name_norm = 'other';
  ASSERT v_cnt = 0, format('%s unexpected "Other" tags', v_cnt);
END $$;
SELECT 'TAGS BACKFILL TESTS PASSED' AS result;
```

- [ ] **Step 2: RED** — run before the migration. Expected: `recipes missing their category tag` with a non-zero count (every existing recipe). If the live DB has zero recipes with non-'other' categories (unlikely), note it and continue — the assert passes trivially; verify idempotency in Step 4 instead.

- [ ] **Step 3: Write the migration**

```sql
-- Backfill: distinct categories -> per-business tags + links (spec Section 2).
-- Human labels (web RECIPE_CATEGORY_LABELS) on purpose - tags are user-facing.
-- 'other' is skipped: those recipes start untagged (derived decision 1).
-- Idempotent: both inserts are ON CONFLICT-guarded.
WITH mapping(category, tag_name) AS (
  VALUES ('starter','Starters'),('main','Mains'),('dessert','Desserts'),
         ('side','Sides'),('sauce','Sauces'),('drink','Drinks'),
         ('cocktail','Cocktails'),('beverage','Beverages')
)
INSERT INTO public.tags (business_id, name)
SELECT DISTINCT r.business_id, m.tag_name
FROM public.recipes r
JOIN mapping m ON m.category = r.category
ON CONFLICT (business_id, name_norm) DO NOTHING;

WITH mapping(category, tag_name) AS (
  VALUES ('starter','Starters'),('main','Mains'),('dessert','Desserts'),
         ('side','Sides'),('sauce','Sauces'),('drink','Drinks'),
         ('cocktail','Cocktails'),('beverage','Beverages')
)
INSERT INTO public.recipe_tags (recipe_id, tag_id)
SELECT r.id, t.id
FROM public.recipes r
JOIN mapping m ON m.category = r.category
JOIN public.tags t ON t.business_id = r.business_id
                  AND t.name_norm = lower(m.tag_name)
ON CONFLICT DO NOTHING;

-- Sanity inside the migration too: fail loudly rather than half-migrate.
DO $$
DECLARE
  v_missing int;
BEGIN
  WITH mapping(category, tag_name) AS (
    VALUES ('starter','Starters'),('main','Mains'),('dessert','Desserts'),
           ('side','Sides'),('sauce','Sauces'),('drink','Drinks'),
           ('cocktail','Cocktails'),('beverage','Beverages')
  )
  SELECT count(*) INTO v_missing
  FROM public.recipes r
  JOIN mapping m ON m.category = r.category
  WHERE NOT EXISTS (
    SELECT 1 FROM public.recipe_tags rt
    JOIN public.tags t ON t.id = rt.tag_id
    WHERE rt.recipe_id = r.id AND t.business_id = r.business_id
      AND t.name_norm = lower(m.tag_name));
  ASSERT v_missing = 0, format('backfill incomplete: %s recipes unlinked', v_missing);
END $$;
```

- [ ] **Step 4: GREEN + idempotency** — apply, run test 13 → PASSED. Apply the migration a SECOND time (must succeed, no duplicates), run test 13 again → PASSED.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/sql/13_tags_backfill.test.sql supabase/migrations/20260611120300_category_to_tags_backfill.sql
git commit -m "feat(db): backfill recipe categories into per-business tags"
```

---

### Task 5: docs + full sweep

**Files:**
- Modify: `docs/superpowers/README.md` (append)
- Modify: `docs/04-DATABASE.md` (recipes table section + new tables)

- [ ] **Step 1: Append ops notes to `docs/superpowers/README.md`**

```markdown

## Recipe tags — DB (2026-06-11)

- `tags(business_id, name, name_norm GENERATED, uniq(business_id,name_norm))` +
  `recipe_tags(recipe_id, tag_id)`; RLS: читают все члены бизнеса, пишут owner/manager/chef.
- RPC `attach_tag(recipe_id, name)` — SECURITY INVOKER, normalise + find-or-create
  + link (ON CONFLICT race-safe). Detach = обычный DELETE из recipe_tags.
- Теги-сироты самоудаляются (`trg_cleanup_orphan_tag` AFTER DELETE ON recipe_tags).
- `create_recipe_with_ingredients` принимает опциональный `tags[]`.
- Бэкфилл: категории → теги с человеческими лейблами ("Mains"), 'other' пропущен.
- **`recipes.category` НЕ дропнута** (старые мобильные билды крашатся без неё) —
  `DEFAULT 'other'`, новый код её игнорирует; дроп отдельной миграцией после
  раскатки мобильного релиза с тегами.
- Тесты: supabase/tests/sql/10–13.
```

- [ ] **Step 2: Update `docs/04-DATABASE.md`** — in the recipes table section mark `category` as `DEPRECATED — kept for old mobile builds, DEFAULT 'other', pending drop`; add `tags` and `recipe_tags` table descriptions and the `attach_tag` RPC next to `create_recipe_with_ingredients` (follow the doc's existing table format).

- [ ] **Step 3: Final verification sweep** — re-run ALL SQL test files 01–13 via the runner; every output must be its PASSED marker. (01–04 guard subscription arbitration; 02/04 each send one "ignore push" ntfy to the founder topic — expected.)

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/README.md docs/04-DATABASE.md
git commit -m "docs: recipe tags DB notes, category marked deprecated"
```

---

## Self-review (done at plan time)

- **Spec coverage (Phase 1 scope):** Section 1 schema/RLS → Task 1; attach_tag + orphan cleanup → Task 2; RPC tags → Task 3; Section 2 backfill + category default → Tasks 1+4; docs/DoD documentation item → Task 5. The category DROP is explicitly out of scope (spec deploy order step 5).
- **Placeholders:** none — full SQL in every step, expected outputs stated.
- **Type consistency:** `attach_tag(uuid, text) RETURNS public.tags` matches test calls and the web plan's `supabase.rpc('attach_tag', {p_recipe_id, p_name})` (PostgREST maps named args `p_recipe_id`/`p_name` — parameter names in SQL are `p_recipe_id`, `p_name` ✓). Tag-name rules identical in CHECK, attach_tag, and RPC loop (btrim ≠ '', ≤40). Mapping labels identical in Task 4 migration and test 13.
- **Safety:** all migrations additive + idempotent (`IF NOT EXISTS` / `OR REPLACE` / `DROP POLICY IF EXISTS` / ON CONFLICT); category column untouched except adding a DEFAULT; tests clean their rows and only use `testpush@g.com`.
