-- ntfy subscription-change trigger: end-to-end on a throwaway row.
-- Verifies the push was actually QUEUED in pg_net (delivery itself is async
-- and already proven by historical 200s in net._http_response).
-- Atomic: on ANY failure the whole DO rolls back, including the queued push.
-- NOTE: a green run sends ONE real push to the founder ntfy topic
-- ("__NTFY_TEST__ (ignore push)") — intentional, it proves the wiring.
DO $$
DECLARE
  v_id uuid := '00000000-0000-4000-8000-000000000002';
  v_q_before bigint;
  v_q_after  bigint;
  b record;
BEGIN
  SELECT COALESCE(max(id), 0) INTO v_q_before FROM net.http_request_queue;

  DELETE FROM public.businesses WHERE id = v_id;
  INSERT INTO public.businesses (id, name) VALUES (v_id, '__NTFY_TEST__ (ignore push)');
  -- per-source write flips computed status trialing -> active;
  -- the ntfy trigger must fire on the VALUE change, not on a syntactic
  -- mention of subscription_status in the UPDATE statement
  UPDATE public.businesses
     SET manual_status = 'active', manual_until = now() + interval '1 day'
   WHERE id = v_id;

  SELECT * INTO b FROM public.businesses WHERE id = v_id;
  ASSERT b.subscription_status = 'active', format('status=%s', b.subscription_status);

  SELECT COALESCE(max(id), 0) INTO v_q_after FROM net.http_request_queue;
  ASSERT v_q_after > v_q_before,
         'ntfy push was not queued — trigger did not fire or handler failed silently';

  DELETE FROM public.businesses WHERE id = v_id;
END $$;
SELECT 'NTFY TRIGGER TESTS PASSED' AS result;
