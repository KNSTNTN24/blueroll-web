# Subscription Arbitration — Design Spec

**Date:** 2026-06-07
**Status:** Approved by Konstantin (sections 1–3 reviewed in session)
**Repo scope:** `blueroll-web` (DB migration + edge functions + web), `haccp-mobile` (follow-up release)

## Problem

`businesses.subscription_status` / `trial_ends_at` have 7 independent writers (Stripe webhook,
`manage-subscription` sync/cancel/reactivate, `create-subscription`, Play/Apple webhooks, web
paywall stub, DB default-trial trigger, manual SQL). All write unconditionally — last writer wins.

Real incident (2026-06-07 investigation): business `e242f2e4` (Bobo & Wild) was manually granted
`active` until 2027-05-26, but every web page load by any team member triggered
`use-auth.ts → syncSubscriptionFromStripe() → manage-subscription(sync)`, which overwrote the
grant with the stale Stripe state `trialing / 2026-06-09`. The same class of bug threatens any
business with both a Stripe customer record and a non-Stripe entitlement (IAP or manual).

Latent bug found during design: status `canceling` (set on cancel-at-period-end) is treated as
NOT subscribed by both web (`use-auth.ts`) and mobile (`purchase_provider.dart`) — users who
cancel lose access immediately instead of at period end.

## Decision summary (user-approved)

- **Scope:** systemic fix (not a point guard).
- **Policy:** generous — entitlement = best of all live sources (`max` by expiry).
- **Compatibility:** `subscription_status` / `trial_ends_at` stay and become the **computed
  result**; shipped mobile builds and existing web code keep working unchanged.
- **Approach:** per-source columns + DB trigger arbiter (approach A; structurally closes ALL
  write paths, including Studio and manual SQL).
- Team-user amendments (4 points) accepted — see "Team members" below.

## Section 1 — Schema & arbitration

New columns on `businesses` (one slot per source):

```
manual_status  TEXT         -- 'active' | 'trialing' | NULL
manual_until   TIMESTAMPTZ  -- manual grant / default trial boundary

stripe_status  TEXT         -- Stripe subscription status as-is
stripe_until   TIMESTAMPTZ  -- trial_end / period boundary from Stripe
-- stripe_customer_id, subscription_id: unchanged

iap_status     TEXT         -- mapped status from play/apple webhooks
-- iap_provider, iap_product_id, iap_purchase_token, iap_original_transaction_id,
-- iap_expires_at: unchanged; iap_expires_at serves as iap_until
```

`subscription_status` + `trial_ends_at` are written ONLY by the arbiter trigger.

`set_default_trial` (BEFORE INSERT) changes to write `manual_status='trialing'`,
`manual_until=now()+interval '14 days'` instead of the computed columns.

### Arbitration rules

Pure SQL function `compute_entitlement(manual_status, manual_until, stripe_status,
stripe_until, iap_status, iap_until) RETURNS (status TEXT, until TIMESTAMPTZ)`;
trigger `BEFORE INSERT OR UPDATE ON businesses` is a thin wrapper.

1. A source is **live** iff `status IN ('active','trialing','canceling')` AND
   (`until IS NULL` OR `until > now()`). `NULL until` = unbounded (paid Stripe sub
   without trial_end).
2. Among live sources pick the one with the **latest** `until` (`NULL` = infinity);
   publish its status and until into the computed columns.
3. **`canceling` is never published**: a live-but-canceling source publishes as
   `active` (keeps its until). Reason: both clients only honour `active|trialing`;
   publishing `canceling` would eject paid users early (fixes the latent bug).
4. No live sources → `subscription_status='canceled'` if any source ever existed,
   else `'none'`; `trial_ends_at = max(until)` across sources (display "when it ended").
5. **Direct writes to computed columns are ignored**: the trigger always recomputes
   from the NEW source fields, so legacy writers / Studio / manual SQL are
   structurally neutralized. Such writes emit `RAISE WARNING` for observability.

Incident check: Farkhod = manual(active, 2027) live + stripe(trialing, 06-09, expired)
→ computed active/2027 regardless of how often Stripe sync writes. ✓

### Team members ("second-level" users) — 4 accepted amendments

Facts: entitlement lives on the business row; invited users (`join_with_invite`)
inherit it. Mobile invite flow sets a permanent local `blueroll_team_member` flag
(`grantTeamAccess()`, `setup_screen.dart`) that bypasses the server check until
sign-out/reinstall. Web gates staff on every load. Staff cannot record purchases
(`record_iap_purchase` is owner-only) but the native Buy button is currently visible
to them.

1. Arbiter never publishes `canceling` (see rule 3).
2. **Mobile paywall: Buy visible to owner only**; staff see "Subscription inactive —
   ask the owner" + Restore. (Prevents staff paying from their personal store account
   for a business they don't own.)
3. **Mobile team flag demoted from permanent override to cache**: when online,
   re-check the business row. Old builds keep legacy behaviour — accepted compromise.
4. Webhook fallback by `obfuscatedExternalAccountId` (= business_id tagged at purchase)
   stays — the linkage is explicit and correct.

Items 2–3 are `haccp-mobile` changes and ship in the next app release; the backend
does not depend on them.

## Section 2 — Writer changes, backfill, deploy order

### Writers

| Writer | Now writes | Will write |
|---|---|---|
| `set_default_trial` (INSERT trigger) | computed cols | `manual_status='trialing'`, `manual_until` |
| `create-subscription` (web onboarding) | computed cols + stripe ids | `stripe_status`, `stripe_until` (+ ids) |
| `stripe-webhook` | computed cols | `stripe_status`, `stripe_until` (lookup by `stripe_customer_id` unchanged) |
| `manage-subscription` sync/cancel/reactivate | computed cols | `stripe_status`/`stripe_until`; cancel → `stripe_status='canceling'` |
| `play-webhook` / `apple-webhook` | computed cols + `iap_*` | `iap_status` (mapped) + `iap_*` |
| Web paywall stub | computed cols | `manual_status='trialing'`, `manual_until` |
| `record_iap_purchase` RPC | `iap_*` token fields only | unchanged |
| Manual grants (ops) | computed cols | `manual_status`/`manual_until` — documented in README |

### Backfill migration (single, idempotent)

Provenance rules, in order:

1. `iap_provider IS NOT NULL` → `iap_status = subscription_status`
   (until already lives in `iap_expires_at`)
2. else `subscription_id IS NOT NULL` → `stripe_status = subscription_status`,
   `stripe_until = trial_ends_at`
3. else → `manual_status = subscription_status`, `manual_until = trial_ends_at`
   (default trials; Farkhod active/2027; Green Kitchen trialing/2099; Plan B)

After backfill, install the trigger, then **sanity check**: recompute all rows and
diff against pre-migration `subscription_status`. Only planned diffs allowed
(`canceling`→`active`). Any unplanned diff → stop before deploying functions.

### Deploy order

1. **Migration** (columns + backfill + trigger + new `set_default_trial`).
   From this moment old edge functions can no longer corrupt computed columns;
   their `iap_*`/stripe-id writes still land.
2. **Immediately after — 5 edge functions** (play, apple, stripe,
   manage-subscription, create-subscription).
   ⚠️ Window between 1 and 2: a new store purchase writes `iap_*` but not
   `iap_status` → no entitlement. Keep the window to minutes; afterwards run
   reconcile: `SELECT id FROM businesses WHERE iap_provider IS NOT NULL AND iap_status IS NULL`.
3. **Web** (paywall stub) — Vercel, not time-critical.
4. **Mobile** (Buy gating, team-flag-as-cache) — separate release.
5. README: how to do manual grants (`manual_status`/`manual_until`).

**Rollback:** `DROP TRIGGER` restores direct writability of computed columns; old
function versions redeploy from git. Source columns are harmless to leave.

## Section 3 — Error handling, observability, TDD

### Error handling

- The trigger must never break writes to `businesses` (equipment, onboarding also
  write here). Logic lives in the pure function; trigger wraps with
  `EXCEPTION WHEN OTHERS → RAISE WARNING` and keeps previous computed values
  (`NEW.subscription_status := OLD.subscription_status`, same for `trial_ends_at`).
  Degradation = "status not recomputed", never "restaurant can't save settings".
- Unknown store/Stripe statuses → not live, fall through; webhook mapping keeps
  current `default: incomplete`.
- Edge functions keep current non-fatal error behaviour.

### Observability

1. `RAISE WARNING` on direct computed-column writes (visible in postgres logs;
   doubles as a detector for not-yet-updated writers).
2. Reconcile query (above) documented in README.
3. *Optional, out of core scope:* fix and re-enable the ntfy trigger
   (`_on_subscription_status_change`, broken `NEW.owner_email`, disabled since
   05-29) — resolve owner email via JOIN `profiles WHERE role='owner'`, fire only
   on computed-status transitions. Separate decision: fix vs drop.

### TDD plan

Infra: pgTAP via `supabase test db` (local Supabase CLI stack; Docker availability
checked at implementation start; fallback — same tests as plain SQL `ASSERT` script
against local Postgres). Tests are written BEFORE the function (red → green):

1. **Farkhod regression:** manual(active, 2027) + stripe(trialing, past) → (active, 2027)
2. **Emily+web regression:** iap(active, future) + stripe(canceled) → (active, iap_until)
3. **canceling→active:** stripe(canceling, future) → (active, until)
4. **Default trial:** manual(trialing, future) only → (trialing, until)
5. **All expired** → (canceled, max(until))
6. **Never any source** → (none, null)
7. **Unbounded Stripe:** stripe(active, null) → (active, null)
8. **Two live sources:** later until wins (null = infinity)
9. **Trigger-level structural protection:** direct `UPDATE subscription_status='trialing'`
   on a row with live manual(active) → row stays active. *The headline test.*
10. **INSERT new business** → manual trial via new `set_default_trial` + arbiter recompute
11. **Backfill check:** replay of today's real cases (Farkhod, Emily, Green Kitchen,
    defaults) — post-backfill recompute equals pre-reform status except planned
    `canceling`→`active`

Edge functions: extract pure pieces (status mapping, payload building) → thin Deno
tests; live webhook paths verified manually after deploy (Stripe CLI trigger / Play
test purchase).

### Definition of done

- All tests green; backfill sanity check: 0 unplanned diffs.
- Live regression test: a web login by Farkhod's team does not change his status.
- Session md + README updated (manual grants via `manual_*`).

## Out of scope

- Stripe ↔ IAP double-billing UI guards beyond existing paywall redirects.
- Dropping the web paywall test stub / real Stripe paywall rework.
- ntfy trigger fix (optional item above).
- Removing legacy `blueroll_team_member` behaviour from already-shipped builds.

## Related context

- Incident analysis: session notes `~/HACCP/sessions/2026-06-07.md`.
- Bobo & Wild interim fix (2026-06-07): stripe ids nulled on row `e242f2e4`, manual
  active/2027 restored; orphaned Stripe sub `sub_1TbPl5AJ1gsWpnv6sTluiRq6` pending
  cancellation decision — independent of this design.
