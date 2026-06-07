-- Pure entitlement arbiter. No table dependencies — unit-testable anywhere.
-- Rules (spec 2026-06-07): live = status in (active,trialing,canceling) and
-- (until is null or until > now()); winner = latest until (null = infinity),
-- tie-break manual > iap > stripe; 'canceling' is published as 'active';
-- no live sources -> 'canceled' if any source ever existed, else 'none'.
CREATE OR REPLACE FUNCTION public.compute_entitlement(
  p_manual_status text, p_manual_until timestamptz,
  p_stripe_status text, p_stripe_until timestamptz,
  p_iap_status    text, p_iap_until    timestamptz,
  OUT status text, OUT until_ts timestamptz
)
LANGUAGE sql STABLE
AS $fn$
WITH sources(prio, s, u) AS (
  VALUES (3, p_manual_status, p_manual_until),
         (2, p_iap_status,    p_iap_until),
         (1, p_stripe_status, p_stripe_until)
),
live AS (
  SELECT * FROM sources
  WHERE s IN ('active', 'trialing', 'canceling')
    AND (u IS NULL OR u > now())
),
winner AS (
  SELECT * FROM live
  ORDER BY (u IS NULL) DESC, u DESC, prio DESC
  LIMIT 1
)
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM winner) THEN
      (SELECT CASE WHEN w.s = 'canceling' THEN 'active' ELSE w.s END FROM winner w)
    WHEN EXISTS (SELECT 1 FROM sources WHERE s IS NOT NULL) THEN 'canceled'
    ELSE 'none'
  END,
  CASE
    WHEN EXISTS (SELECT 1 FROM winner) THEN (SELECT w.u FROM winner w)
    WHEN EXISTS (SELECT 1 FROM sources WHERE s IS NOT NULL) THEN (SELECT max(u) FROM sources)
    ELSE NULL
  END
$fn$;
