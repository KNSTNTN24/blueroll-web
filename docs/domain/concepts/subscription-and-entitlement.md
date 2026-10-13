# Subscription and entitlement

> A business is **entitled** (may write data) when one of its three payment sources — Stripe, Apple/Google
> in-app, or a manual grant — is live; the database picks a winner into `subscription_status`, RLS blocks
> writes when it is not live, and web and mobile each show a paywall by their own, different rule.

**Touches:** Business (`businesses`), Site, Member (`profiles`), [Roles & capabilities](roles-and-capabilities.md) ·
**Last verified:** 2026-10-13 (review pass) against `main@b50e9d1` and the live DB (`rszrggreuarvodcqeqrj`)

## The rule in plain words

```
source is live    = status ∈ {active, trialing, canceling} AND (until IS NULL OR until > now())
subscription_status (computed, on every INSERT/UPDATE of the row):
    any live source → the one with the latest until (NULL = forever; tie: manual > iap > stripe),
                      published as its status, but 'canceling' → 'active'
    none live, some source ever set → 'canceled'      no source at all → 'none'
trial_ends_at     = winner's until (or max(until) when canceled)

is_business_entitled(b) =  NOT deleted
  AND ( status = 'active' OR (status = 'trialing' AND (trial_ends_at IS NULL OR trial_ends_at > now()))
        OR stripe past_due within 7 days of stripe_until  OR iap past_due/on_hold within 7 days of iap_expires_at )
```

Entitlement is **per business**: all sites open and close together. Not entitled = you can still **read and
delete**, but every INSERT/UPDATE on business data is refused. The client paywall is UX on top of that.

## Terms and columns (`businesses`)

| Column / object | Meaning | Written by |
|---|---|---|
| `manual_status`, `manual_until` | Manual source: the signup trial and admin comps ("free until 2027"). | `set_default_trial` (BEFORE INSERT), `consume_trial`, ops SQL; cleared by `create-subscription` |
| `stripe_customer_id`, `subscription_id` | Stripe customer / subscription ids. | `create-subscription/index.ts:95-99,134-145` |
| `stripe_status`, `stripe_until` | Stripe source. `canceling` = cancel at period end. `until` = trial end while trialing, else paid period end. | `stripe-webhook/payload.ts:24-46`, `manage-subscription` (cancel/reactivate/sync) |
| `iap_provider` (`apple`/`google`), `iap_product_id`, `iap_purchase_token` (Google), `iap_original_transaction_id` (Apple) | Which store purchase belongs to the business; webhooks look the row up by these. | `record_iap_purchase` (owner-only RPC), `play-webhook`, `apple-webhook` |
| `iap_status`, `iap_expires_at` | In-app source. | `play-webhook/index.ts:229-240`, `apple-webhook/index.ts:236-247` |
| `subscription_status`, `trial_ends_at` | **Computed** — never write them; the arbiter overwrites and warns. Default `'none'`. | trigger `trg_zz_subscription_arbiter` → `_subscription_arbiter()` → `compute_entitlement()` |
| `signup_trial` | `true` = the current manual grant is the automatic signup trial, not a comp. Only the mobile paywall reads it. | `set_default_trial`, `consume_trial` (live only — Gotcha 9) |
| `deleted_at` | Soft delete; makes `is_business_entitled` false whatever was paid. | `delete-account`; guarded by `trg_protect_business_deleted_at` |
| `trial_grants(email, granted_at)` | One row per email that has ever had a trial. RLS on, no policies (server-only). 128 rows live. | `consume_trial`, called by `setup_business` |
| `entitlement_write_gate_*` | 54 RESTRICTIVE INSERT/UPDATE policies on 27 tables calling `is_business_entitled`. | `20260712180200_entitlement_write_gate.sql` (+ later table additions) |
| `protect_business_entitlement` | Blocks `authenticated`/`anon` from changing the source and computed columns (not `iap_provider/product_id/token/tx id`, not `signup_trial`). | trigger, `20260712180100_protect_entitlement_columns.sql:1-35` |

## Payment sources

| Source | How it starts | Status mapping | Grace |
|---|---|---|---|
| **Manual** | Every new business: `manual = trialing`, `until = now()+14 days`, `signup_trial = true` (`set_default_trial`). Comps by ops SQL. | as written | none |
| **Stripe (web)** | Card form (`card-form.tsx:89`, onboarding `page.tsx:270`) → `create-subscription`: one `STRIPE_PRICE_ID`, trial aligned to the current `trial_ends_at`, or a fresh 14 days if that has passed (`index.ts:110-126`); then wipes `manual_*`. | Stripe status as-is; `cancel_at_period_end` → `canceling` | 7 days on `past_due` (DB only) |
| **Google Play** | App buys `proProductIdFor(sites)`, `record_iap_purchase`, Pub/Sub → `play-webhook` reads Play API v2 | ACTIVE, IN_GRACE → `active`; CANCELED → `canceling`; EXPIRED → `canceled`; ON_HOLD → `past_due`; PAUSED → `paused`; PENDING/other → `incomplete` (`play-webhook/status-map.ts`) | store grace already = `active`; +7 days on `past_due` |
| **Apple** | StoreKit purchase tagged with the user id (`appAccountToken`), `record_iap_purchase`, App Store notification → `apple-webhook` queries App Store Server API | 1, 4 → `active`; 2, 5 → `canceled`; 3 → `past_due`; other → `incomplete` (`apple-webhook/status-map.ts`) | same as Google |

## Trial rules

1. Signup: `setup_business` inserts the business (14-day manual trial) then `consume_trial(email)`.
2. First time for that email (lower-cased) → row in `trial_grants`, trial stands.
3. Email already in `trial_grants` → trial cut to **24 hours** (still `signup_trial = true`) so onboarding can save
   its sites before the paywall appears (`consume_trial` live body). The spec said "starts unentitled"; live differs.
4. `trial_grants` outlives account deletion and purge, so a re-signup after deleting gets 24 h, not 14 days.

## What the paywall blocks

| Layer | Rule | Location |
|---|---|---|
| Database | Writes refused on 27 tables unless `is_business_entitled`; reads and deletes allowed | policies `entitlement_write_gate_*` |
| Web | `isSubscribed = status = 'active' OR (status = 'trialing' AND trial_ends_at not passed)`; dashboard redirects to `/paywall` otherwise. Gates on the user's own business even in demo mode (`realBusiness`). No grace. | `src/hooks/use-auth.ts:192-199`, `src/app/(dashboard)/layout.tsx:33-35` |
| Web `/paywall` | Sends anyone with `active` **or `trialing`** back to `/dashboard` (no date check) | `src/app/(auth)/paywall/page.tsx:50-52` |
| Mobile | `entitled` as web (but `trialing` with NULL end = false) **and** "subscribed" = live `iap_status`/`stripe_status` OR `signup_trial = false`. So a signup-trial owner sees the paywall on mobile while web lets them in. Cached in SharedPreferences; a server error keeps cached access. | `haccp-mobile/lib/providers/purchase_provider.dart:593-633`, `config/router.dart:116-120` |
| Mobile legacy | Accounts created before 2026-04-11 skip the paywall forever (`grantTeamAccess`) | `screens/auth/paywall_screen.dart:31,63-68` |

The paywall blocks the whole app (all routes), not single features; there is no feature tiering.

## Per-site billing

- `billable_site_count(b)` = sites with `status <> 'archived'`. Nothing in web or mobile calls it.
- Mobile sells one store product per site count: 1/2/3+ sites = £24.99/£49.99/£74.99, clamped to 3,
  counted from the **visible sites list** (`paywall_screen.dart:96-117`, `purchase_provider.dart:20-38`).
- Web: `create-subscription` sends one price with no `quantity`; the paywall copy says £24.99/mo.
- Trigger `trg_sites_sync_quantity` (AFTER INSERT/DELETE on `sites`) posts to edge function
  `sync-site-quantity` via `pg_net`. **That function's source is not in the repo** (`supabase/functions/` on main), but it
  **is deployed** live (v11, `verify_jwt = false`). Archiving a site is an UPDATE and does not fire the trigger.

## Cancellation and account deletion

- **Web**: Settings → Stripe Customer Portal (`manage-subscription` `portal`, `settings/page.tsx:107`). Portal
  cancel → webhook writes `canceling` → published as `active` until period end → then `canceled`.
  `manage-subscription` also has `cancel` / `reactivate` actions; no client calls them.
- **Mobile**: cancel in the App Store / Play Store; the webhook does the rest *(UI path unverified)*.
- **Delete account** (mobile only, `profile_screen.dart:135`): `delete-account` checks the caller is an owner
  (text role), **immediately deletes** the Stripe subscription (no refund logic), sets `deleted_at`; cron
  `purge-deleted-businesses` (03:00 daily) hard-deletes after 30 days. Store subscriptions are **not** cancelled.

## Known drift (live, 2026-10-13, 84 businesses incl. 1 soft-deleted)

| Column | Values |
|---|---|
| `subscription_status` | `trialing` 48 · `active` 20 · `canceled` 16 (no `none`) |
| …recomputed now | 45 of the 48 `trialing` would be `canceled` (trial ended, row not touched since) + 1 more stale; only **23 of 83** live (not deleted) businesses are entitled [#72](https://github.com/KNSTNTN24/blueroll-web/issues/72) |
| `manual_status` | `trialing` 58 · `active` 19 · NULL 6 · literal `'none'` 1 |
| `stripe_status` | NULL 77 · `canceling` 3 (all past `until`) · `active` 3 · `canceled` 1 |
| `iap_status` | NULL 69 · `active` 10 · `canceled` 4 · literal `'none'` 1 |
| `iap_provider` | NULL 71 · `google` 10 · `apple` 3 |
| `signup_trial` | `true` 44 · `false` 40 |

`'none'` is not a status any writer produces; the arbiter counts it as "a source existed", so those rows
read `canceled`, not `none`. `subscription_status` defaults to the literal `'none'`; the source columns default to NULL.

## Gotchas

1. **`subscription_status` goes stale.** It is recomputed only when the row is written; nothing recomputes it
   when a trial or period ends (no cron). 45 businesses still say `trialing` with a past `trial_ends_at`. Always
   pair it with `trial_ends_at`, or call `is_business_entitled`.
2. **Web redirect loop for expired trials.** `/paywall` bounces any `trialing` to `/dashboard` without the date
   check; the dashboard bounces an expired `trialing` back to `/paywall` (Gotcha 1 makes this hit 45 businesses).
3. **Grace exists only in the DB.** Web and mobile show the paywall on `past_due` while RLS still allows writes.
   The `in_grace` branch in `is_business_entitled` is dead (no webhook writes it).
4. **Web and mobile disagree** on signup-trial owners (mobile paywalls, web does not), on `trialing` with NULL end,
   and on pre-2026-04-11 accounts (mobile free forever, web paywalls).
5. **`create-subscription` has no auth check** (body `userId`/`businessId`, service role, `verify_jwt = false`) and
   always nulls `manual_*` — a business on a manual comp that adds a card loses the comp; anyone can run it against any
   business without a `subscription_id`.
6. **An expired trial gets a fresh 14-day Stripe trial** on `/paywall` (`create-subscription/index.ts:117-120`);
   `trial_grants` dedup does not cover Stripe trials.
7. **IAP lookup columns are client-writable.** Any member may update their business row (policy
   "Users can update own business"), and the protect trigger skips `iap_purchase_token` /
   `iap_original_transaction_id` / `signup_trial`. Webhooks update *every* row matching the token.
8. **Apple JWS is verified only against its own embedded leaf cert** (`apple-webhook/index.ts:136-160`, no chain to
   Apple Root); the state itself comes from Apple's API, but which business it lands on comes from the payload.
9. **Live objects missing from migrations:** `signup_trial` column, `set_default_trial` setting it, and the 24-hour
   `consume_trial` branch exist only live (repo: `20260607120100_subscription_arbitration.sql:52-64`,
   `20260712180350_consume_trial_race_safe.sql:16`). See #59.
10. **Web Stripe sync runs for every member** on login (`use-auth.ts:15-36`) but `manage-subscription` is owner-only
    → silent 403 for staff; their status only refreshes via webhooks.
11. **`billable_site_count`, `is_business_entitled`, `compute_entitlement` are executable by `anon`** for any id
    (SECURITY DEFINER) — leaks site counts and paid status of any business id.
12. Owner checks use the **text role** (`profiles.role = 'owner'`) in `record_iap_purchase`, `manage-subscription`,
    `delete-account`, not the `manage_billing` capability (never enforced, see roles page).
13. `demo_force_exit` exists **live only** (a table, 2 rows, read by the live `demo_business_id()`; see
    [Business](../entities/business.md)). Demo mode reads the demo business but the web gate uses `realBusiness`.

## History

- 2026-10-06 `manage-subscription` sync uses the webhook payload mapping (Tootoomoo re-lock).
- 2026-08-31 `stripe-webhook/payload.ts`: `stripe_until` = paid period end after conversion (D3 fix; deploy state *(unverified)*).
- 2026-09-03 `docs/ENTITLEMENT_MATRIX.md` (Russian) — full 235-case test matrix; this page supersedes its §1/§4/§5 facts.
- 2026-07-12/13 Paywall hardening + multisite billing: `is_business_entitled`, write gates, column protection,
  `trial_grants`, `billable_site_count`, quantity trigger — `docs/superpowers/specs/2026-07-12-paywall-billing-design.md`.
- 2026-06-07 Subscription arbitration (three sources, computed status) — `docs/superpowers/specs/2026-06-07-subscription-arbitration-design.md`.
- 2026-05-28 default 14-day trial trigger.
