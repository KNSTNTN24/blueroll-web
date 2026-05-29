-- Ensure every new business gets a 14-day trial.
-- Without this, signups land with subscription_status='none' + trial_ends_at=null,
-- which the web paywall (use-auth.ts: sub === 'active' || 'trialing') treats as unpaid.

CREATE OR REPLACE FUNCTION public.set_default_trial()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.trial_ends_at IS NULL THEN
    NEW.trial_ends_at := NOW() + INTERVAL '14 days';
  END IF;
  IF NEW.subscription_status IS NULL OR NEW.subscription_status = 'none' THEN
    NEW.subscription_status := 'trialing';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_default_trial ON public.businesses;

CREATE TRIGGER trg_set_default_trial
  BEFORE INSERT ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_default_trial();
