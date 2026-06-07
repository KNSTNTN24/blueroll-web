-- 1. Per-source columns ─────────────────────────────────────────────
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS manual_status text,
  ADD COLUMN IF NOT EXISTS manual_until  timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_status text,
  ADD COLUMN IF NOT EXISTS stripe_until  timestamptz,
  ADD COLUMN IF NOT EXISTS iap_status    text;

-- 2. Backfill by provenance (idempotent: only fills NULL slots) ─────
UPDATE public.businesses
   SET iap_status = subscription_status
 WHERE iap_provider IS NOT NULL AND iap_status IS NULL;

UPDATE public.businesses
   SET stripe_status = subscription_status, stripe_until = trial_ends_at
 WHERE iap_provider IS NULL AND subscription_id IS NOT NULL AND stripe_status IS NULL;

UPDATE public.businesses
   SET manual_status = subscription_status, manual_until = trial_ends_at
 WHERE iap_provider IS NULL AND subscription_id IS NULL AND manual_status IS NULL;

-- Stale-active remedy: an 'active' row with a past until would flip to
-- canceled at cutover; unbound it and let the next real event tighten it.
UPDATE public.businesses SET manual_until = NULL
 WHERE manual_status = 'active' AND manual_until < now();
UPDATE public.businesses SET stripe_until = NULL
 WHERE stripe_status = 'active' AND stripe_until < now();
-- (no iap remedy: iap until lives in iap_expires_at, real store data — don't touch)

-- 3. Sanity check: only planned diffs allowed ───────────────────────
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM (
    SELECT b.id, b.subscription_status AS old_s, b.trial_ends_at AS old_u,
           (public.compute_entitlement(b.manual_status, b.manual_until,
                                       b.stripe_status, b.stripe_until,
                                       b.iap_status,    b.iap_expires_at)).status AS new_s
    FROM public.businesses b
  ) t
  WHERE new_s IS DISTINCT FROM old_s
    AND NOT (old_s = 'canceling' AND new_s = 'active')                       -- planned
    AND NOT (new_s = 'canceled' AND old_s = 'trialing' AND old_u <= now())   -- planned
    AND NOT (new_s = 'canceled' AND old_s NOT IN ('active','trialing'));     -- non-entitled -> canonical 'canceled'
  IF bad > 0 THEN
    RAISE EXCEPTION 'subscription backfill sanity check failed: % unplanned diffs', bad;
  END IF;
END $$;

-- 4. Default trial now seeds manual_* (arbiter computes the rest) ───
CREATE OR REPLACE FUNCTION public.set_default_trial()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $$
BEGIN
  IF NEW.manual_status IS NULL AND NEW.stripe_status IS NULL AND NEW.iap_status IS NULL THEN
    NEW.manual_status := 'trialing';
    NEW.manual_until  := COALESCE(NEW.manual_until, NOW() + INTERVAL '14 days');
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Arbiter trigger ────────────────────────────────────────────────
-- Name MUST sort after 'trg_set_default_trial' (alphabetical firing order).
CREATE OR REPLACE FUNCTION public._subscription_arbiter()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $$
DECLARE v_status text; v_until timestamptz;
BEGIN
  BEGIN
    SELECT ce.status, ce.until_ts INTO v_status, v_until
      FROM public.compute_entitlement(
        NEW.manual_status, NEW.manual_until,
        NEW.stripe_status, NEW.stripe_until,
        NEW.iap_status,    NEW.iap_expires_at) ce;
    IF TG_OP = 'UPDATE'
       AND (NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
            OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at)
       AND (NEW.subscription_status IS DISTINCT FROM v_status
            OR NEW.trial_ends_at IS DISTINCT FROM v_until) THEN
      RAISE WARNING 'direct write to computed subscription columns ignored (business %)', NEW.id;
    END IF;
    NEW.subscription_status := v_status;
    NEW.trial_ends_at := v_until;
  EXCEPTION WHEN OTHERS THEN
    -- Never block writes to businesses; degrade to "not recomputed".
    RAISE WARNING 'subscription arbiter failed (business %): %', NEW.id, SQLERRM;
    IF TG_OP = 'UPDATE' THEN
      NEW.subscription_status := OLD.subscription_status;
      NEW.trial_ends_at := OLD.trial_ends_at;
    END IF;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_subscription_arbiter ON public.businesses;
CREATE TRIGGER trg_zz_subscription_arbiter
  BEFORE INSERT OR UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public._subscription_arbiter();

-- 6. Resync every row through the arbiter (applies planned diffs now) ─
UPDATE public.businesses SET updated_at = updated_at;
