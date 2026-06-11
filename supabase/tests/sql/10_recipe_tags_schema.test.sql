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
