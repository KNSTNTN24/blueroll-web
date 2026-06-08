-- Phase-1 review hardenings (quality review 2026-06-07):
-- I1: checklist_drafts policy — template must belong to the caller's business.
-- I2: ingredients — dedupe case-insensitive duplicates per business, then a
--     unique index so the RPC's find-or-create race yields a clean conflict
--     (whole-RPC rollback + retry) instead of silent duplicate rows.

-- ── I1 ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Own drafts" ON public.checklist_drafts;
CREATE POLICY "Own drafts" ON public.checklist_drafts
  FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (
    created_by = auth.uid()
    AND business_id = public.get_my_business_id()
    AND template_id IN (SELECT id FROM public.checklist_templates
                         WHERE business_id = public.get_my_business_id())
  );

-- ── I2: dedupe ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_before int;
  v_after int;
  v_remapped int := 0;
  v_deleted int := 0;
BEGIN
  SELECT count(*) INTO v_before FROM (
    SELECT 1 FROM public.ingredients
    GROUP BY business_id, lower(name) HAVING count(*) > 1
  ) d;

  -- keeper per (business, lower(name)) = smallest id; remap join rows, drop the rest
  CREATE TEMP TABLE _ing_dupes ON COMMIT DROP AS
  SELECT i.id AS dupe_id, k.keeper_id
  FROM public.ingredients i
  JOIN (
    SELECT business_id, lower(name) AS lname, min(id::text)::uuid AS keeper_id
    FROM public.ingredients
    GROUP BY business_id, lower(name)
    HAVING count(*) > 1
  ) k ON k.business_id = i.business_id AND lower(i.name) = k.lname
  WHERE i.id <> k.keeper_id;

  UPDATE public.recipe_ingredients ri
     SET ingredient_id = d.keeper_id
    FROM _ing_dupes d
   WHERE ri.ingredient_id = d.dupe_id
     -- avoid creating a duplicate (recipe, ingredient) pair if the recipe
     -- already references the keeper
     AND NOT EXISTS (SELECT 1 FROM public.recipe_ingredients x
                      WHERE x.recipe_id = ri.recipe_id
                        AND x.ingredient_id = d.keeper_id);
  GET DIAGNOSTICS v_remapped = ROW_COUNT;

  -- join rows still pointing at dupes are themselves duplicates -> drop
  DELETE FROM public.recipe_ingredients ri
   USING _ing_dupes d WHERE ri.ingredient_id = d.dupe_id;

  DELETE FROM public.ingredients i USING _ing_dupes d WHERE i.id = d.dupe_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  SELECT count(*) INTO v_after FROM (
    SELECT 1 FROM public.ingredients
    GROUP BY business_id, lower(name) HAVING count(*) > 1
  ) d;

  RAISE NOTICE 'ingredient dedupe: % dup-groups before, % join rows remapped, % rows deleted, % groups after',
    v_before, v_remapped, v_deleted, v_after;
  ASSERT v_after = 0, format('dedupe incomplete: %s dup groups remain', v_after);
  -- no recipe may have lost all its links to a deduped ingredient pair:
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.recipe_ingredients ri
    LEFT JOIN public.ingredients i ON i.id = ri.ingredient_id
    WHERE i.id IS NULL
  ), 'orphaned recipe_ingredients after dedupe';
END $$;

-- ── I2: index ───────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS ingredients_business_lower_name_uniq
  ON public.ingredients (business_id, lower(name));
