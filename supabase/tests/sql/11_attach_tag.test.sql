-- attach_tag: normalised find-or-create + link; orphan tags self-delete
-- when their last link goes (spec Section 1, derived decision 2).
-- Also closes Task-1 review gaps: positive write under `authenticated`,
-- role gate (non-writer cannot attach), cross-business link rejection.
DO $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_recipe_a uuid;
  v_recipe_b uuid;
  v_tag public.tags%ROWTYPE;
  v_tag2 public.tags%ROWTYPE;
  v_biz_b uuid := '00000000-0000-4000-8000-000000000211';
  v_tag_b uuid;
  v_cnt int;
  v_violated boolean := false;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE email = 'testpush@g.com';
  ASSERT v_profile.id IS NOT NULL, 'test profile testpush@g.com missing';
  ASSERT v_profile.role IN ('owner','manager','chef'),
         format('test profile must be a recipe-writer role, got %s', v_profile.role);

  INSERT INTO public.recipes (business_id, created_by, name, category)
  VALUES (v_profile.business_id, v_profile.id, '__ATTACH_TEST_A__', 'main')
  RETURNING id INTO v_recipe_a;
  INSERT INTO public.recipes (business_id, created_by, name, category)
  VALUES (v_profile.business_id, v_profile.id, '__ATTACH_TEST_B__', 'main')
  RETURNING id INTO v_recipe_b;

  -- foreign business fixture for the cross-link test
  DELETE FROM public.businesses WHERE id = v_biz_b;
  INSERT INTO public.businesses (id, name) VALUES (v_biz_b, '__ATTACH_BIZ_B__');
  INSERT INTO public.tags (business_id, name) VALUES (v_biz_b, '__FOREIGN_TAG__')
  RETURNING id INTO v_tag_b;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_profile.id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- positive write path under authenticated (Task-1 review gap #1):
  -- direct INSERT into tags and recipe_tags as a recipe-writer succeeds
  INSERT INTO public.tags (business_id, name)
  VALUES (public.get_my_business_id(), '__DIRECT_WRITE__');
  INSERT INTO public.recipe_tags (recipe_id, tag_id)
  SELECT v_recipe_a, id FROM public.tags
   WHERE business_id = public.get_my_business_id() AND name_norm = '__direct_write__';
  SELECT count(*) INTO v_cnt FROM public.recipe_tags rt
    JOIN public.tags t ON t.id = rt.tag_id WHERE t.name_norm = '__direct_write__';
  ASSERT v_cnt = 1, 'authenticated recipe-writer could not write tag/link directly';
  DELETE FROM public.recipe_tags rt USING public.tags t
   WHERE rt.tag_id = t.id AND t.name_norm = '__direct_write__'; -- orphan trigger removes the tag

  -- cross-business link rejection (Task-1 review gap #2, spec TDD item 3):
  -- linking MY recipe to ANOTHER business's tag must fail the WITH CHECK
  v_violated := false;
  BEGIN
    INSERT INTO public.recipe_tags (recipe_id, tag_id) VALUES (v_recipe_a, v_tag_b);
  EXCEPTION WHEN insufficient_privilege THEN
    v_violated := true;
  END;
  ASSERT v_violated, 'cross-business recipe->tag link was not rejected';

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
  v_violated := false;
  BEGIN
    PERFORM public.attach_tag(v_recipe_a, '   ');
  EXCEPTION WHEN raise_exception THEN
    v_violated := true;
  END;
  ASSERT v_violated, 'blank tag name accepted by attach_tag';

  -- role gate (Task-1 review gap #3, spec TDD item 4): demote the test user to
  -- front_of_house within this transaction; reads still work, attach fails.
  RESET ROLE;
  UPDATE public.profiles SET role = 'front_of_house' WHERE id = v_profile.id;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_cnt FROM public.tags WHERE id = v_tag.id;
  ASSERT v_cnt = 1, 'front_of_house cannot read tags';
  v_violated := false;
  BEGIN
    PERFORM public.attach_tag(v_recipe_a, '__FOH_TAG__');
  EXCEPTION WHEN insufficient_privilege THEN
    v_violated := true;
  END;
  ASSERT v_violated, 'front_of_house could attach a tag';
  RESET ROLE;
  UPDATE public.profiles SET role = v_profile.role WHERE id = v_profile.id;
  SET LOCAL ROLE authenticated;

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

  -- cleanup
  DELETE FROM public.recipes WHERE id = v_recipe_b;
  DELETE FROM public.businesses WHERE id = v_biz_b; -- cascades its tag
END $$;
SELECT 'ATTACH TAG TESTS PASSED' AS result;
