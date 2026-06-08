-- Unit tests for compute_entitlement(). Read-only: safe against the live DB.
DO $$
DECLARE r record; u timestamptz;
BEGIN
  -- 1. Farkhod regression: manual(active, +360d) beats stripe(trialing, expired)
  u := now() + interval '360 days';
  r := public.compute_entitlement('active', u, 'trialing', now() - interval '1 day', NULL, NULL);
  ASSERT r.status = 'active' AND r.until_ts = u, format('t1 got %s/%s', r.status, r.until_ts);

  -- 2. Emily+web regression: iap(active, future) beats stripe(canceled)
  u := now() + interval '13 days';
  r := public.compute_entitlement(NULL, NULL, 'canceled', now() - interval '1 day', 'active', u);
  ASSERT r.status = 'active' AND r.until_ts = u, format('t2 got %s/%s', r.status, r.until_ts);

  -- 3. canceling publishes as active
  u := now() + interval '5 days';
  r := public.compute_entitlement(NULL, NULL, 'canceling', u, NULL, NULL);
  ASSERT r.status = 'active' AND r.until_ts = u, format('t3 got %s/%s', r.status, r.until_ts);

  -- 4. default trial: manual(trialing, future) only
  u := now() + interval '14 days';
  r := public.compute_entitlement('trialing', u, NULL, NULL, NULL, NULL);
  ASSERT r.status = 'trialing' AND r.until_ts = u, format('t4 got %s/%s', r.status, r.until_ts);

  -- 5. all expired -> canceled, max(until)
  u := now() - interval '1 day';
  r := public.compute_entitlement('trialing', now() - interval '10 days', 'trialing', u, NULL, NULL);
  ASSERT r.status = 'canceled' AND r.until_ts = u, format('t5 got %s/%s', r.status, r.until_ts);

  -- 6. never any source -> none/null
  r := public.compute_entitlement(NULL, NULL, NULL, NULL, NULL, NULL);
  ASSERT r.status = 'none' AND r.until_ts IS NULL, format('t6 got %s/%s', r.status, r.until_ts);

  -- 7. unbounded stripe active (null until) wins and stays null
  r := public.compute_entitlement('trialing', now() + interval '3 days', 'active', NULL, NULL, NULL);
  ASSERT r.status = 'active' AND r.until_ts IS NULL, format('t7 got %s/%s', r.status, r.until_ts);

  -- 8. two live sources: later until wins
  u := now() + interval '300 days';
  r := public.compute_entitlement('active', u, NULL, NULL, 'active', now() + interval '20 days');
  ASSERT r.status = 'active' AND r.until_ts = u, format('t8 got %s/%s', r.status, r.until_ts);

  -- 8b. tie-break on equal NULL untils: manual > iap > stripe (status of winner published)
  r := public.compute_entitlement('trialing', NULL, 'active', NULL, NULL, NULL);
  ASSERT r.status = 'trialing', format('t8b got %s', r.status);

  -- 9. expired canceling must NOT republish as active
  u := now() - interval '1 day';
  r := public.compute_entitlement(NULL, NULL, 'canceling', u, NULL, NULL);
  ASSERT r.status = 'canceled' AND r.until_ts = u, format('t9 got %s/%s', r.status, r.until_ts);

  -- 10. unknown/non-entitled statuses never grant access
  r := public.compute_entitlement('past_due', now() + interval '5 days', NULL, NULL, NULL, NULL);
  ASSERT r.status = 'canceled', format('t10 got %s', r.status);

  -- 11. until exactly = now() is expired (strict >)
  u := now();
  r := public.compute_entitlement('trialing', u, NULL, NULL, NULL, NULL);
  ASSERT r.status = 'canceled' AND r.until_ts = u, format('t11 got %s/%s', r.status, r.until_ts);
END $$;
SELECT 'COMPUTE_ENTITLEMENT TESTS PASSED' AS result;
