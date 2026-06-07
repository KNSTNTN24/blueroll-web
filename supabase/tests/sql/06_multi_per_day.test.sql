-- multi_per_day / min_per_day on checklist_templates (spec item 5).
DO $$
DECLARE
  v_biz uuid := '00000000-0000-4000-8000-000000000011';
  v_tpl uuid;
  b record;
  v_check_violated boolean := false;
BEGIN
  DELETE FROM public.businesses WHERE id = v_biz;
  INSERT INTO public.businesses (id, name) VALUES (v_biz, '__MULTI_TEST__');

  INSERT INTO public.checklist_templates (name, frequency, business_id)
  VALUES ('__MULTI_TPL__', 'daily', v_biz)
  RETURNING id INTO v_tpl;

  -- defaults: single-per-day, min 1
  SELECT * INTO b FROM public.checklist_templates WHERE id = v_tpl;
  ASSERT b.multi_per_day = false AND b.min_per_day = 1,
         format('defaults wrong: %s/%s', b.multi_per_day, b.min_per_day);

  -- hourly-style template: multi with min 0 is allowed
  UPDATE public.checklist_templates
     SET multi_per_day = true, min_per_day = 0 WHERE id = v_tpl;
  SELECT * INTO b FROM public.checklist_templates WHERE id = v_tpl;
  ASSERT b.multi_per_day = true AND b.min_per_day = 0, 'multi/min=0 roundtrip failed';

  -- negative min rejected by CHECK
  BEGIN
    UPDATE public.checklist_templates SET min_per_day = -1 WHERE id = v_tpl;
  EXCEPTION WHEN check_violation THEN
    v_check_violated := true;
  END;
  ASSERT v_check_violated, 'expected check_violation for min_per_day = -1';

  DELETE FROM public.businesses WHERE id = v_biz; -- cascades the template
END $$;
SELECT 'MULTI PER DAY TESTS PASSED' AS result;
