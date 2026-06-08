-- Farkhod-class attack simulation on the real row, then self-cleaning.
DO $$
DECLARE
  v_id uuid := 'e242f2e4-b903-4f6f-a410-311c4a35d91f'; -- Bobo & Wild
  b record;
BEGIN
  -- simulate a stale Stripe sync write (what use-auth used to trigger)
  UPDATE public.businesses
     SET stripe_status = 'trialing', stripe_until = now() - interval '1 day'
   WHERE id = v_id;
  SELECT * INTO b FROM public.businesses WHERE id = v_id;
  ASSERT b.subscription_status = 'active', format('regression: status=%s', b.subscription_status);
  ASSERT b.trial_ends_at > now() + interval '300 days', format('regression: until=%s', b.trial_ends_at);
  -- clean up the simulation
  UPDATE public.businesses SET stripe_status = NULL, stripe_until = NULL WHERE id = v_id;
END $$;
SELECT 'LIVE REGRESSION PASSED' AS result;
