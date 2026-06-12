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

  -- tag-aware payload: no category; valid tags (one duplicated after normalisation) + blank/overlong/null entries that must be silently skipped
  v_result := public.create_recipe_with_ingredients(jsonb_build_object(
    'recipe', jsonb_build_object('name', '__RPC_TAGS_TEST__', 'instructions', 'mix'),
    'ingredients', '[]'::jsonb,
    'tags', jsonb_build_array('  Pasta RPC ', 'pasta rpc', 'Hits RPC', '   ', repeat('x', 41), null)
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
