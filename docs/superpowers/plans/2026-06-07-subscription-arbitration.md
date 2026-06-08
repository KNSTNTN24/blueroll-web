# Subscription Arbitration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make subscription overwrites structurally impossible: per-source columns + a DB trigger that computes `subscription_status`/`trial_ends_at` as the best of all live sources.

**Architecture:** Pure SQL function `compute_entitlement()` (unit-testable, no table deps) + thin `BEFORE INSERT OR UPDATE` trigger on `businesses`. Five edge functions and the web paywall stub switch to writing per-source fields only. Backfill migration with an in-transaction sanity check.

**Tech Stack:** Supabase Postgres (plpgsql/sql), Deno edge functions, Next.js web. Tests: plain-SQL ASSERT scripts run via Supabase Management API (Docker is not available on this machine — `supabase test db`/pgTAP fallback per spec). Spec: `docs/superpowers/specs/2026-06-07-subscription-arbitration-design.md`.

**Conventions for every task:**
- Repo: `~/HACCP/web`, branch `KNS/iap-foundation`. Commit ONLY files named in the task (the branch has unrelated uncommitted files — `CLAUDE.md`, `team/page.tsx`, `.agents/` etc. — do not touch them).
- `SQL_API` helper (Task 0) executes a SQL file against the live project `rszrggreuarvodcqeqrj`.
- ⚠️ Tasks 2–7 are a single sitting: from the moment migration B lands until all 5 edge functions are deployed, a new store purchase would set `iap_*` but not `iap_status`. Keep the window to minutes, then run the reconcile query (Task 9).

**Mobile follow-up (Buy gating for owner, team-flag-as-cache) is a separate plan** — different repo and release cycle; backend does not depend on it.

---

### Task 0: SQL runner helper + infra sanity

**Files:**
- Create: `scripts/sql-api.sh`

- [ ] **Step 1: Write the helper**

```bash
#!/usr/bin/env bash
# Run a SQL file against the live Supabase project via Management API.
# Usage: scripts/sql-api.sh path/to/file.sql
set -euo pipefail
TOKEN="${SUPABASE_ACCESS_TOKEN:?export SUPABASE_ACCESS_TOKEN first}"
FILE="${1:?usage: sql-api.sh file.sql}"
python3 - "$FILE" <<'EOF' > /tmp/sql-payload.json
import json, sys
print(json.dumps({"query": open(sys.argv[1]).read()}))
EOF
curl -sf -X POST \
  "https://api.supabase.com/v1/projects/rszrggreuarvodcqeqrj/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d @/tmp/sql-payload.json
echo
```

- [ ] **Step 2: Verify it works**

Run: `chmod +x scripts/sql-api.sh && echo "SELECT 1 AS ok" > /tmp/ping.sql && SUPABASE_ACCESS_TOKEN=sbp_… scripts/sql-api.sh /tmp/ping.sql`
Expected: `[{"ok":1}]`

- [ ] **Step 3: Commit**

```bash
git add scripts/sql-api.sh && git commit -m "test: SQL runner helper for live-DB test scripts"
```

---

### Task 1: `compute_entitlement()` — pure function (spec tests 1–8)

**Files:**
- Create: `supabase/tests/sql/01_compute_entitlement.test.sql`
- Create: `supabase/migrations/20260607120000_compute_entitlement.sql`

- [ ] **Step 1: Write the failing tests** (`supabase/tests/sql/01_compute_entitlement.test.sql`)

```sql
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
END $$;
SELECT 'COMPUTE_ENTITLEMENT TESTS PASSED' AS result;
```

- [ ] **Step 2: Run to verify RED**

Run: `scripts/sql-api.sh supabase/tests/sql/01_compute_entitlement.test.sql`
Expected: error `function public.compute_entitlement(...) does not exist`

- [ ] **Step 3: Write the function** (`supabase/migrations/20260607120000_compute_entitlement.sql`)

```sql
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
```

⚠️ Do NOT "simplify" the two CASE blocks into COALESCE — a live unbounded source (test 7) returns a legitimately NULL until, and COALESCE would fall through to the wrong branch.

- [ ] **Step 4: Apply + verify GREEN**

Run: `scripts/sql-api.sh supabase/migrations/20260607120000_compute_entitlement.sql && scripts/sql-api.sh supabase/tests/sql/01_compute_entitlement.test.sql`
Expected: `[{"result":"COMPUTE_ENTITLEMENT TESTS PASSED"}]`

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/sql/01_compute_entitlement.test.sql supabase/migrations/20260607120000_compute_entitlement.sql
git commit -m "feat(db): compute_entitlement() pure arbiter + unit tests"
```

---

### Task 2: columns, backfill, sanity check, triggers (spec tests 9–11) — ⚠️ starts the deploy window

**Files:**
- Create: `supabase/tests/sql/02_arbiter_trigger.test.sql`
- Create: `supabase/migrations/20260607120100_subscription_arbitration.sql`

- [ ] **Step 1: Write the failing trigger tests** (`supabase/tests/sql/02_arbiter_trigger.test.sql`)

```sql
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
```

- [ ] **Step 2: Run to verify RED**

Run: `scripts/sql-api.sh supabase/tests/sql/02_arbiter_trigger.test.sql`
Expected: ASSERT failure on t10 (`manual_status` column does not exist yet → error mentioning `manual_status`)

- [ ] **Step 3: Write migration B** (`supabase/migrations/20260607120100_subscription_arbitration.sql`)

```sql
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
```

- [ ] **Step 4: Apply + verify GREEN**

Run: `scripts/sql-api.sh supabase/migrations/20260607120100_subscription_arbitration.sql && scripts/sql-api.sh supabase/tests/sql/02_arbiter_trigger.test.sql`
Expected: migration returns without `sanity check failed`; tests return `[{"result":"ARBITER TRIGGER TESTS PASSED"}]`
Also re-run Task 1 tests (must still pass): `scripts/sql-api.sh supabase/tests/sql/01_compute_entitlement.test.sql`

- [ ] **Step 5: Spot-check real rows**

Run via `scripts/sql-api.sh` (inline file):
```sql
SELECT name, subscription_status, trial_ends_at, manual_status, stripe_status, iap_status
FROM businesses
WHERE id IN ('e242f2e4-b903-4f6f-a410-311c4a35d91f',  -- Farkhod: expect active/2027, manual_status=active
             'c2b77a5e-068c-424f-aeea-40e158043175',  -- Emily:   expect active/2026-06-20, iap_status=active
             'd472de8e-2354-4a28-a184-e8a192dda023'); -- Green Kitchen: trialing/2099, manual_status=trialing
```
Expected: statuses unchanged vs pre-migration.

- [ ] **Step 6: Commit**

```bash
git add supabase/tests/sql/02_arbiter_trigger.test.sql supabase/migrations/20260607120100_subscription_arbitration.sql
git commit -m "feat(db): per-source subscription columns, backfill + arbiter trigger"
```

---

### Task 3: play-webhook → `iap_status`

**Files:**
- Modify: `supabase/functions/play-webhook/index.ts:258-265`

- [ ] **Step 1: Replace the payload** (in `applySubscriptionUpdate`)

Old:
```ts
  const payload = {
    subscription_status: status,
    trial_ends_at: expiry, // re-using the existing column for the entitlement boundary
    iap_provider: "google",
    iap_product_id: productId,
    iap_purchase_token: purchaseToken,
    iap_expires_at: expiry,
  };
```
New:
```ts
  // Computed subscription_status/trial_ends_at are owned by the DB arbiter
  // (trg_zz_subscription_arbiter); we only report Google's view via iap_*.
  const payload = {
    iap_status: status,
    iap_provider: "google",
    iap_product_id: productId,
    iap_purchase_token: purchaseToken,
    iap_expires_at: expiry,
  };
```

- [ ] **Step 2: Deploy**

Run: `SUPABASE_ACCESS_TOKEN=sbp_… supabase functions deploy play-webhook --project-ref rszrggreuarvodcqeqrj --no-verify-jwt`
Expected: `Deployed Function play-webhook`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/play-webhook/index.ts
git commit -m "feat(play-webhook): write iap_status, leave computed columns to DB arbiter"
```

---

### Task 4: apple-webhook → `iap_status`

**Files:**
- Modify: `supabase/functions/apple-webhook/index.ts:257-264` (`applyAppleUpdate`)

- [ ] **Step 1: Replace the payload**

Old:
```ts
  const payload = {
    subscription_status: status,
    trial_ends_at: expiresAt,
    iap_provider: "apple",
    iap_product_id: i.productId,
    iap_original_transaction_id: i.originalTransactionId,
    iap_expires_at: expiresAt,
  };
```
New:
```ts
  // Computed columns are owned by the DB arbiter; report Apple's view via iap_*.
  const payload = {
    iap_status: status,
    iap_provider: "apple",
    iap_product_id: i.productId,
    iap_original_transaction_id: i.originalTransactionId,
    iap_expires_at: expiresAt,
  };
```

- [ ] **Step 2: Deploy**

Run: `SUPABASE_ACCESS_TOKEN=sbp_… supabase functions deploy apple-webhook --project-ref rszrggreuarvodcqeqrj --no-verify-jwt`
Expected: `Deployed Function apple-webhook`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/apple-webhook/index.ts
git commit -m "feat(apple-webhook): write iap_status, leave computed columns to DB arbiter"
```

---

### Task 5: stripe-webhook → `stripe_status`/`stripe_until`

**Files:**
- Modify: `supabase/functions/stripe-webhook/index.ts:100-111` (`subscriptionUpdatePayload`)

- [ ] **Step 1: Replace the payload builder**

Old:
```ts
function subscriptionUpdatePayload(sub: StripeSubscription) {
  return {
    subscription_id: sub.id,
    // Mirror what manage-subscription action=sync writes: a canceling
    // subscription stays accessible until period end, so we tag it differently
    // from a fully terminated one.
    subscription_status: sub.cancel_at_period_end ? "canceling" : sub.status,
    trial_ends_at: sub.trial_end
      ? new Date(sub.trial_end * 1000).toISOString()
      : null,
  };
}
```
New:
```ts
function subscriptionUpdatePayload(sub: StripeSubscription) {
  return {
    subscription_id: sub.id,
    // Stripe's view only. The DB arbiter (trg_zz_subscription_arbiter) computes
    // subscription_status/trial_ends_at from all sources; it publishes a live
    // 'canceling' as 'active' so paid users keep access until period end.
    stripe_status: sub.cancel_at_period_end ? "canceling" : sub.status,
    stripe_until: sub.trial_end
      ? new Date(sub.trial_end * 1000).toISOString()
      : null,
  };
}
```

- [ ] **Step 2: Deploy**

Run: `SUPABASE_ACCESS_TOKEN=sbp_… supabase functions deploy stripe-webhook --project-ref rszrggreuarvodcqeqrj --no-verify-jwt`
Expected: `Deployed Function stripe-webhook`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat(stripe-webhook): write stripe_status/stripe_until only"
```

---

### Task 6: manage-subscription (cancel / reactivate / sync) → `stripe_*`

**Files:**
- Modify: `supabase/functions/manage-subscription/index.ts:74,97,125-131`

- [ ] **Step 1: cancel** (line ~74)

Old: `.update({ subscription_status: "canceling" })`
New: `.update({ stripe_status: "canceling" })`

- [ ] **Step 2: reactivate** (line ~97)

Old: `.update({ subscription_status: sub.status })`
New: `.update({ stripe_status: sub.status })`

- [ ] **Step 3: sync** (lines ~125-131)

Old:
```ts
          .update({
            subscription_id: sub.id,
            subscription_status: sub.cancel_at_period_end ? "canceling" : sub.status,
            trial_ends_at: trialEnd,
          })
```
New:
```ts
          .update({
            subscription_id: sub.id,
            stripe_status: sub.cancel_at_period_end ? "canceling" : sub.status,
            stripe_until: trialEnd,
          })
```
(The "no subscriptions found" branch writes nothing — verified, no change.)

- [ ] **Step 4: Deploy**

Run: `SUPABASE_ACCESS_TOKEN=sbp_… supabase functions deploy manage-subscription --project-ref rszrggreuarvodcqeqrj --no-verify-jwt`
Expected: `Deployed Function manage-subscription`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/manage-subscription/index.ts
git commit -m "feat(manage-subscription): cancel/reactivate/sync write stripe_* only"
```

---

### Task 7: create-subscription → `stripe_*`

**Files:**
- Modify: `supabase/functions/create-subscription/index.ts:122-128`

- [ ] **Step 1: Replace the update**

Old:
```ts
    await supabase
      .from("businesses")
      .update({
        subscription_id: subscription.id,
        subscription_status: subscription.status, // "trialing" on success
        trial_ends_at: trialEndIso,
      })
      .eq("id", businessId);
```
New:
```ts
    await supabase
      .from("businesses")
      .update({
        subscription_id: subscription.id,
        stripe_status: subscription.status, // "trialing" on success
        stripe_until: trialEndIso,
      })
      .eq("id", businessId);
```

- [ ] **Step 2: Deploy + close the window**

Run: `SUPABASE_ACCESS_TOKEN=sbp_… supabase functions deploy create-subscription --project-ref rszrggreuarvodcqeqrj --no-verify-jwt`
Expected: `Deployed Function create-subscription`. **Deploy window closed.**

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/create-subscription/index.ts
git commit -m "feat(create-subscription): write stripe_status/stripe_until only"
```

---

### Task 8: web paywall stub → `manual_*`

**Files:**
- Modify: `src/app/(auth)/paywall/page.tsx:91-98`

- [ ] **Step 1: Replace the update**

Old:
```ts
      // TEST STUB: write trialing status directly to DB instead of Stripe
      const { error: updateError } = await supabase
        .from('businesses')
        .update({
          subscription_status: 'trialing',
          trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq('id', profile.business_id)
```
New:
```ts
      // TEST STUB: seed a manual trial; the DB arbiter computes
      // subscription_status/trial_ends_at from per-source fields.
      const { error: updateError } = await supabase
        .from('businesses')
        .update({
          manual_status: 'trialing',
          manual_until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq('id', profile.business_id)
```

- [ ] **Step 2: Build check**

Run: `npm run build 2>&1 | tail -5`
Expected: build succeeds (page is typed loosely; no other references to the removed keys in this file)

- [ ] **Step 3: Commit** (deploys to prod with the next normal merge → `vercel --prod`; not time-critical — old stub writes are neutralized by the trigger anyway)

```bash
git add "src/app/(auth)/paywall/page.tsx"
git commit -m "feat(paywall-stub): seed manual_* instead of computed columns"
```

---

### Task 9: live regression + reconcile (spec "Definition of done")

**Files:**
- Create: `supabase/tests/sql/03_live_regression.test.sql`

- [ ] **Step 1: Write + run the live regression**

```sql
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
```

Run: `scripts/sql-api.sh supabase/tests/sql/03_live_regression.test.sql`
Expected: `[{"result":"LIVE REGRESSION PASSED"}]`

- [ ] **Step 2: Reconcile the deploy window**

Run via `scripts/sql-api.sh` (inline file):
```sql
SELECT id, name FROM businesses WHERE iap_provider IS NOT NULL AND iap_status IS NULL;
```
Expected: `[]`. If rows appear (purchase during the window): for each, set
`iap_status` from the store state — for Google re-trigger the webhook is hard, so:
`UPDATE businesses SET iap_status = 'active' WHERE id = '<id>' AND iap_expires_at > now();`

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/sql/03_live_regression.test.sql
git commit -m "test: live regression for subscription arbiter (Farkhod-class attack)"
```

---

### Task 10: docs

**Files:**
- Modify: `CLAUDE.md` (web repo) — "Ключи"/workflow area
- Modify: `~/HACCP/sessions/2026-06-07.md` (sessions repo — separate commit there)

- [ ] **Step 1: Add to web `CLAUDE.md`** (append to the end; the file has unrelated uncommitted edits — append only, commit only if the diff is clean, otherwise put the note in `docs/superpowers/specs/` README and reference it)

```markdown
## Subscription arbitration (2026-06-07)
- businesses.subscription_status / trial_ends_at — ВЫЧИСЛЯЕМЫЕ, пишет только триггер
  trg_zz_subscription_arbiter (см. docs/superpowers/specs/2026-06-07-subscription-arbitration-design.md).
- Ручной грант: UPDATE businesses SET manual_status='active', manual_until='<date>' WHERE id='…';
  (прямые записи в subscription_status игнорируются триггером, в логах будет WARNING).
- Reconcile после деплоев вебхуков: SELECT id FROM businesses WHERE iap_provider IS NOT NULL AND iap_status IS NULL;
```

- [ ] **Step 2: Append implementation summary to `~/HACCP/sessions/2026-06-07.md`** and commit in the sessions repo:

```bash
cd ~/HACCP/sessions && git add 2026-06-07.md && git commit -m "2026-06-07: subscription arbitration deployed (per-source columns + trigger)"
```

- [ ] **Step 3: Final verification sweep**

Re-run all three test files via `scripts/sql-api.sh` — all green, zero WARNINGs in fresh postgres logs from the arbiter except intentional attack tests.

---

## Self-review (done at plan time)

- **Spec coverage:** schema+rules→T1/T2; trigger ordering→T2 (name `trg_zz_…`, test t10); canceling→active→t3+stripe-webhook comment; writers table→T3–T8; backfill+remedy+sanity→T2; deploy order→T2–T7 sequencing note; observability WARNING→T2 step 3 (§5) + T10; reconcile→T9; live regression→T9; docs→T10. Mobile amendments → explicitly split into a separate plan (scope check). Optional ntfy fix → out of scope (spec).
- **Placeholders:** none — every code step carries the full code; commands carry expected output.
- **Type consistency:** `compute_entitlement(p_manual_status, p_manual_until, p_stripe_status, p_stripe_until, p_iap_status, p_iap_until) → (status, until_ts)` used identically in T1 tests, T2 sanity, T2 trigger; trigger name `trg_zz_subscription_arbiter` consistent in T2/T9 docs; column names `manual_status/manual_until/stripe_status/stripe_until/iap_status` consistent across T2–T8.
