-- ntfy: stop reporting a queued cancellation as "Subscription ACTIVE".
--
-- The arbiter publishes stripe_status='canceling' as subscription_status=
-- 'active' on purpose (paid users keep access to period end), so the ntfy
-- trigger never sees 'canceling' and its warning branch was dead code. The
-- visible symptom: a trial owner switching auto-renew OFF flipped published
-- status trialing -> active and the founder got a celebratory
-- "Subscription ACTIVE" push for what is actually a cancellation
-- (Laung Laachi, 29.09.2026).
--
-- Now the handler looks at the underlying stripe_status too: published
-- 'active' with stripe 'canceling' pushes "Cancellation queued" with the
-- date access ends.

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
  v_extra text := '';
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
  ELSIF v_new = 'active' AND COALESCE(NEW.stripe_status, '') = 'canceling' THEN
    -- The arbiter publishes a queued cancellation as 'active' (access runs
    -- to period end), so read the source column to tell the truth here.
    v_title := 'Cancellation queued'; v_tags := 'warning,wave'; v_prio := 4;
    IF NEW.stripe_until IS NOT NULL THEN
      v_extra := E'\naccess ends ' || to_char(NEW.stripe_until, 'DD Mon');
    END IF;
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

  v_msg := v_name || ' — ' || v_email || E'\n(' || v_old || ' → ' || v_new || ')' || v_extra;

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
