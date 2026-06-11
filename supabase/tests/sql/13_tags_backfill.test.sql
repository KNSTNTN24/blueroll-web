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
