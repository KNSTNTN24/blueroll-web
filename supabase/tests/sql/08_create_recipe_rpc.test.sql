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
      'category', 'main',
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
