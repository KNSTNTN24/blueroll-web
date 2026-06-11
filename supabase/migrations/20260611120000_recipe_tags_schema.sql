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
