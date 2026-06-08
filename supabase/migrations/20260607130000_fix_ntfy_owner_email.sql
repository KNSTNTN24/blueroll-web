-- Fix the ntfy subscription-change notifier (disabled since 2026-05-29).
--
-- Two bugs:
-- 1. The handler read NEW.owner_email — a column that does not exist on
--    businesses (it errored on 05-29 and the trigger was disabled). Owner
--    email is now resolved via profiles (role='owner').
-- 2. The trigger was AFTER UPDATE OF subscription_status — a SYNTACTIC
--    condition. After the 2026-06-07 arbitration cutover writers only touch
--    per-source columns (manual_*/stripe_*/iap_status) and the computed
--    subscription_status is set by a BEFORE trigger, so an OF-trigger never
--    fires. Recreated without the OF clause; the WHEN clause (evaluated on
--    final stored values, after BEFORE triggers) keeps it to real changes.
--
-- ⚠️ Bulk resyncs that flip many statuses (like the cutover's
-- UPDATE ... SET updated_at = updated_at) will now push once per changed
-- row — disable this trigger around any future bulk resync.

CREATE OR REPLACE FUNCTION public._on_subscription_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old   text := COALESCE(OLD.subscription_status, 'none');
  v_new   text := COALESCE(NEW.subscription_status, 'none');
  v_email text;
  v_name  text := COALESCE(NEW.name, '(unnamed business)');
  v_title text;
  v_tags  text;
  v_msg   text;
  v_prio  int  := 4;
BEGIN
  IF v_old = v_new THEN
    RETURN NEW;
  END IF;

  -- businesses has no owner_email column; the owner's email lives on profiles
  SELECT p.email INTO v_email
    FROM public.profiles p
   WHERE p.business_id = NEW.id AND p.role = 'owner'
   LIMIT 1;
  v_email := COALESCE(v_email, '(no owner email)');

  IF v_email LIKE '%@blueroll.app'
     OR v_email LIKE '%@getblueroll.com'
     OR v_email LIKE '%@example.com'
     OR v_email LIKE '%@planb.london'
     OR v_email LIKE '%@example.org' THEN
    RETURN NEW;
  END IF;

  -- Title MUST be plain ASCII for some HTTP clients; tags carry emoji
  IF v_new = 'trialing' THEN
    v_title := 'Trial started'; v_tags := 'tada,rocket'; v_prio := 5;
  ELSIF v_new = 'active' THEN
    v_title := 'Subscription ACTIVE'; v_tags := 'moneybag,tada'; v_prio := 5;
  ELSIF v_new = 'canceling' THEN
    v_title := 'Cancellation queued'; v_tags := 'warning,wave'; v_prio := 4;
  ELSIF v_new IN ('canceled','cancelled') THEN
    v_title := 'Subscription cancelled'; v_tags := 'broken_heart'; v_prio := 4;
  ELSIF v_new IN ('past_due','unpaid') THEN
    v_title := 'Payment issue'; v_tags := 'warning,credit_card'; v_prio := 5;
  ELSE
    v_title := 'Subscription: ' || v_old || ' -> ' || v_new; v_tags := 'bell';
  END IF;

  v_msg := v_name || ' — ' || v_email || E'\n(' || v_old || ' → ' || v_new || ')';

  PERFORM public._ntfy_push(
    p_title    := v_title,
    p_message  := v_msg,
    p_priority := v_prio,
    p_tags     := v_tags,
    p_click    := 'https://app.blueroll.app/'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '_on_subscription_status_change push failed: % %', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ntfy_subscription_change ON public.businesses;
CREATE TRIGGER trg_ntfy_subscription_change
  AFTER UPDATE ON public.businesses
  FOR EACH ROW
  WHEN (OLD.subscription_status IS DISTINCT FROM NEW.subscription_status)
  EXECUTE FUNCTION public._on_subscription_status_change();
