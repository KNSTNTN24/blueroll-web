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
