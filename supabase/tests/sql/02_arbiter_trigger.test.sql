-- Trigger-level tests. Mutating: uses a dedicated row, deletes it at the end.
DO $$
DECLARE
  v_id uuid := '00000000-0000-4000-8000-000000000001';
  b record;
BEGIN
  DELETE FROM public.businesses WHERE id = v_id; -- clean slate on re-run

  -- t10: INSERT -> default 14d trial via manual_* + arbiter recompute
  INSERT INTO public.businesses (id, name) VALUES (v_id, '__ARBITER_TEST__');
  SELECT * INTO b FROM public.businesses WHERE id = v_id;
  ASSERT b.manual_status = 'trialing', format('t10 manual_status=%s', b.manual_status);
  ASSERT b.subscription_status = 'trialing', format('t10 status=%s', b.subscription_status);
  ASSERT b.trial_ends_at BETWEEN now() + interval '13 days' AND now() + interval '15 days',
         format('t10 until=%s', b.trial_ends_at);

  -- t9 (headline): direct write to computed columns is ignored
  UPDATE public.businesses
     SET manual_status = 'active', manual_until = now() + interval '100 days'
   WHERE id = v_id;
  UPDATE public.businesses
     SET subscription_status = 'trialing', trial_ends_at = now() - interval '1 day'
   WHERE id = v_id;  -- the "attack": legacy writer / Studio / manual SQL
  SELECT * INTO b FROM public.businesses WHERE id = v_id;
  ASSERT b.subscription_status = 'active', format('t9 status=%s', b.subscription_status);
  ASSERT b.trial_ends_at > now() + interval '99 days', format('t9 until=%s', b.trial_ends_at);

  DELETE FROM public.businesses WHERE id = v_id;
END $$;
SELECT 'ARBITER TRIGGER TESTS PASSED' AS result;
