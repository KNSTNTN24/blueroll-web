-- checklist_drafts: per-user partial fills, invisible to old clients (spec item 2).
-- RLS verified under role 'authenticated' with simulated JWT claims.
DO $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_tpl uuid;
  v_cnt int;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE email = 'testpush@g.com';
  ASSERT v_profile.id IS NOT NULL, 'test profile testpush@g.com missing';

  -- a template in the test user's business to draft against
  INSERT INTO public.checklist_templates (name, frequency, business_id)
  VALUES ('__DRAFT_TPL__', 'daily', v_profile.business_id)
  RETURNING id INTO v_tpl;

  -- become the test user (transaction-local)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_profile.id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- upsert draft (the client call pattern)
  INSERT INTO public.checklist_drafts (template_id, business_id, created_by, responses)
  VALUES (v_tpl, v_profile.business_id, v_profile.id, '{"item-1":"5.0"}'::jsonb)
  ON CONFLICT (template_id, created_by)
  DO UPDATE SET responses = EXCLUDED.responses, updated_at = now();

  -- same-user upsert replaces, not duplicates
  INSERT INTO public.checklist_drafts (template_id, business_id, created_by, responses)
  VALUES (v_tpl, v_profile.business_id, v_profile.id, '{"item-1":"5.0","item-2":"yes"}'::jsonb)
  ON CONFLICT (template_id, created_by)
  DO UPDATE SET responses = EXCLUDED.responses, updated_at = now();

  SELECT count(*) INTO v_cnt FROM public.checklist_drafts WHERE template_id = v_tpl;
  ASSERT v_cnt = 1, format('expected 1 draft, got %s', v_cnt);
  ASSERT (SELECT responses->>'item-2' FROM public.checklist_drafts
           WHERE template_id = v_tpl AND created_by = v_profile.id) = 'yes',
         'upsert did not replace responses';

  -- another user must see nothing (RLS)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000099', 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_cnt FROM public.checklist_drafts WHERE template_id = v_tpl;
  ASSERT v_cnt = 0, format('RLS leak: foreign user sees %s drafts', v_cnt);

  -- back to postgres for cleanup
  RESET ROLE;
  DELETE FROM public.checklist_drafts WHERE template_id = v_tpl;
  DELETE FROM public.checklist_templates WHERE id = v_tpl;
END $$;
SELECT 'CHECKLIST DRAFTS TESTS PASSED' AS result;
