-- ─────────────────────────────────────────────────────────────────────
-- ntfy push notifications for Blueroll  (v2 — fixed for pg_net + ntfy)
--
-- Sends a push to the founder's phone via ntfy.sh on key business events:
--   • New signup            (auth.users INSERT)
--   • Subscription change   (businesses.subscription_status UPDATE)
--
-- Run in Supabase Dashboard → SQL Editor.
-- Idempotent — safe to re-run.
--
-- TOPIC SECRET: change the topic constant below if you rotate it.
-- Anyone who knows the topic can send pushes to your phone.
--
-- ⚠️  pg_net is ASYNC — net.http_post() returns a request_id immediately
--     and the HTTP call happens in the background. To see if the actual
--     request succeeded, query net._http_response WHERE id = <request_id>.
-- ─────────────────────────────────────────────────────────────────────

-- Step 1 — enable pg_net extension
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;


-- Step 2 — helper that POSTs to ntfy as JSON (ntfy.sh native JSON publishing)
CREATE OR REPLACE FUNCTION public._ntfy_push(
  p_title    text,
  p_message  text,
  p_priority int  DEFAULT 4,
  p_tags     text DEFAULT 'bell',
  p_click    text DEFAULT 'https://app.blueroll.app/'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id bigint;
  v_body       jsonb;
BEGIN
  v_body := jsonb_build_object(
    'topic',    'blueroll-kn-a7c3f9b2',
    'title',    p_title,
    'message',  p_message,
    'priority', p_priority,
    'tags',     string_to_array(p_tags, ','),
    'click',    p_click
  );

  -- pg_net function lives in `net` schema (not `extensions.net`)
  v_request_id := net.http_post(
    url     := 'https://ntfy.sh',          -- JSON publishing endpoint
    body    := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  RETURN v_request_id;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- Step 3 — Trigger 1: new signup in auth.users
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._on_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email    text := NEW.email;
  v_provider text := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');
BEGIN
  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;
  -- Skip internal / test domains
  IF v_email LIKE '%@blueroll.app'
     OR v_email LIKE '%@getblueroll.com'
     OR v_email LIKE '%@example.com'
     OR v_email LIKE '%@example.org' THEN
    RETURN NEW;
  END IF;

  PERFORM public._ntfy_push(
    p_title    := 'New signup',
    p_message  := v_email || ' (via ' || v_provider || ')',
    p_priority := 4,
    p_tags     := 'tada,bust_in_silhouette',
    p_click    := 'https://app.blueroll.app/'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '_on_auth_user_created push failed: % %', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ntfy_auth_user_created ON auth.users;
CREATE TRIGGER trg_ntfy_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public._on_auth_user_created();


-- ─────────────────────────────────────────────────────────────────────
-- Step 4 — Trigger 2: subscription_status change on public.businesses
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._on_subscription_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old   text := COALESCE(OLD.subscription_status, 'none');
  v_new   text := COALESCE(NEW.subscription_status, 'none');
  v_email text := COALESCE(NEW.owner_email, '(no owner email)');
  v_name  text := COALESCE(NEW.name, '(unnamed business)');
  v_title text;
  v_tags  text;
  v_msg   text;
  v_prio  int  := 4;
BEGIN
  IF v_old = v_new THEN
    RETURN NEW;
  END IF;
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
$$;

DROP TRIGGER IF EXISTS trg_ntfy_subscription_change ON public.businesses;
CREATE TRIGGER trg_ntfy_subscription_change
AFTER UPDATE OF subscription_status ON public.businesses
FOR EACH ROW
WHEN (OLD.subscription_status IS DISTINCT FROM NEW.subscription_status)
EXECUTE FUNCTION public._on_subscription_status_change();


-- ─────────────────────────────────────────────────────────────────────
-- Step 5 — Manual test
--    The function returns a request_id. To confirm the HTTP call actually
--    fired, query the pg_net response table afterwards.
-- ─────────────────────────────────────────────────────────────────────

-- 1. Fire a test push:
--    SELECT public._ntfy_push(
--      'Supabase test',
--      'pg_net is alive — push from inside Postgres works',
--      4,
--      'test_tube,white_check_mark'
--    );
--    -- expect: bigint request_id (e.g. 17)

-- 2. Check the request actually went through (~1-3 sec after step 1):
--    SELECT id, status_code, content_type, headers, content, error_msg
--    FROM net._http_response
--    ORDER BY id DESC LIMIT 5;
--    -- expect: status_code 200, content_type application/json,
--    --        content = '{"id":"...","time":...,"topic":"blueroll-kn-a7c3f9b2",...}'


-- ─────────────────────────────────────────────────────────────────────
-- Uninstall (if you ever want to remove)
-- ─────────────────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_ntfy_auth_user_created     ON auth.users;
-- DROP TRIGGER IF EXISTS trg_ntfy_subscription_change   ON public.businesses;
-- DROP FUNCTION IF EXISTS public._on_auth_user_created();
-- DROP FUNCTION IF EXISTS public._on_subscription_status_change();
-- DROP FUNCTION IF EXISTS public._ntfy_push(text,text,int,text,text);
