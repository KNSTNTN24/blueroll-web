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
