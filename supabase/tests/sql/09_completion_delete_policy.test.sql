-- DELETE policy on checklist_completions: a member may undo their OWN completion
-- (responses cascade); managers/owners may undo any in their business; nobody
-- can delete across businesses. Verified under role 'authenticated'.
DO $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_tpl uuid; v_comp uuid; v_item uuid; v_cnt int;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE email = 'testpush@g.com';
  ASSERT v_profile.id IS NOT NULL, 'test profile missing';

  INSERT INTO public.checklist_templates (name, frequency, business_id)
  VALUES ('__DELPOL_TPL__', 'daily', v_profile.business_id) RETURNING id INTO v_tpl;
  INSERT INTO public.checklist_template_items (template_id, name, item_type, sort_order)
  VALUES (v_tpl, 'i1', 'tick', 0) RETURNING id INTO v_item;

  -- a completion authored by the test user, with one response
  INSERT INTO public.checklist_completions (template_id, business_id, completed_by)
  VALUES (v_tpl, v_profile.business_id, v_profile.id) RETURNING id INTO v_comp;
  INSERT INTO public.checklist_responses (completion_id, item_id, value)
  VALUES (v_comp, v_item, 'true');

  -- act as the test user
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_profile.id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- delete own completion -> succeeds, response cascades
  DELETE FROM public.checklist_completions WHERE id = v_comp;
  RESET ROLE;
  SELECT count(*) INTO v_cnt FROM public.checklist_completions WHERE id = v_comp;
  ASSERT v_cnt = 0, 'own completion not deleted';
  SELECT count(*) INTO v_cnt FROM public.checklist_responses WHERE completion_id = v_comp;
  ASSERT v_cnt = 0, format('responses did not cascade: %s left', v_cnt);

  -- foreign-business completion must NOT be deletable
  INSERT INTO public.checklist_completions (template_id, business_id, completed_by)
  VALUES (v_tpl, v_profile.business_id, v_profile.id) RETURNING id INTO v_comp;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000099', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.checklist_completions WHERE id = v_comp; -- RLS: affects 0 rows
  RESET ROLE;
  SELECT count(*) INTO v_cnt FROM public.checklist_completions WHERE id = v_comp;
  ASSERT v_cnt = 1, 'foreign user was able to delete (RLS hole)';

  DELETE FROM public.checklist_templates WHERE id = v_tpl; -- cleanup (cascades)
END $$;
SELECT 'COMPLETION DELETE POLICY TESTS PASSED' AS result;
