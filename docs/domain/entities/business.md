# Business (`businesses`)

> The customer account: one restaurant, café or group of sites that signs up, pays, and owns every record in Blueroll.

**Tables:** `businesses` (31 columns), helpers `trial_grants`, `demo_force_exit` · **Scope:** business (the root of
all scoping) · **Last verified:** 2026-10-13 against `main@b50e9d1` and the live DB (84 businesses)

## What it is for

Every other row (sites, members, checklists, documents, recipes…) carries a `business_id`, and RLS reads the caller's
business through `function public.get_my_business_id()`. A business is created once, by its owner, during onboarding.
For a multi-site group the business is the **group** and each location is a [Site](site.md). The subscription lives on the
business, not on a person or a site.

## Parameters

| Field (UI label) | DB column | Meaning | Allowed values | Enforced by |
|---|---|---|---|---|
| Business / group name | `name` | Shown in the topbar, dashboard, Settings > Profile, HACCP Plan. Copied to the first site's name. | text, not null | DB `NOT NULL`. No UI edits it after onboarding |
| Address | `address` | Joined from the FSA establishment (`AddressLine1, AddressLine2, PostCode`) — `onboarding/page.tsx:709-711`. | text or null | — |
| Postcode | `post_code` | From the FSA establishment. 75 of 84 set. | text or null | — |
| FHRS id | `fhrs_id` | The FSA Food Hygiene Rating Scheme establishment id picked in onboarding. 62 of 84 set. | integer or null | — |
| FSA rating | `fsa_rating` | The `RatingValue` string from the FSA API **at signup**, never refreshed. | `0`–`5`, or FSA text (`AwaitingInspection`, `Improvement Required`, `Pass`, …) | nowhere — see Known drift |
| Registration number | `registration_number` | Local-authority registration. Only in the mobile model (`haccp-mobile/lib/models/business.dart:27`). | text | **legacy: 0 live rows set, nothing writes it** |
| Equipment | `equipment` | Kitchen equipment list that pre-fills the AI checklist wizard (`checklists/new/page.tsx:335`). | `text[]`, default `{}` | code only. Saved only from the wizard's "Save to profile" toast (`:226-236`) |
| HACCP auto-fill | `haccp_auto_fill` | Whether the HACCP Pack/Plan fill answers from live data. | boolean, default `true` | toggled on `/haccp-pack` (`haccp-pack/page.tsx:351-365`); read by `_shared/haccp-plan/load.ts:42,137` |
| Last HACCP review | `haccp_last_reviewed_at` | Drives the "4-weekly review" banner (overdue after 28 days) — `haccp-pack/page.tsx:421-434`. | timestamp or null | **nothing writes it** (Gotcha 3) |
| Notification settings | `notification_prefs` | Business-wide email/push switches (keys below). | `jsonb`, default `{}` | code only (`settings/notifications-settings.tsx`) |
| WhatsApp / Telegram | `whatsapp_enabled`, `telegram_enabled` | Master switch for the chat channel. A channel works only when this is on **and** the business is entitled (`function channel_ready`, `whatsapp_ready`). | boolean, default `false` | triggers `guard_whatsapp_enabled`, `guard_telegram_enabled`: only active owners/managers (`is_active_business_manager`) |
| — | `deleted_at` | Soft delete. Set only by the `delete-account` edge function. | timestamp or null | trigger `protect_business_deleted_at` blocks `authenticated`/`anon` |
| — | `signup_trial` | True when the trial was the automatic signup grant (not a comp). | boolean | set by `set_default_trial` / `consume_trial` |
| Subscription | `subscription_status`, `trial_ends_at`, `stripe_customer_id`, `subscription_id`, `stripe_status`, `stripe_until`, `iap_provider`, `iap_product_id`, `iap_purchase_token`, `iap_original_transaction_id`, `iap_status`, `iap_expires_at`, `manual_status`, `manual_until` | See below. | `iap_provider` ∈ `apple`, `google` | DB `CHECK businesses_iap_provider_check`; trigger `protect_business_entitlement` |

Also `id`, `created_at`, `updated_at` (trigger `update_businesses_updated_at`).

**Subscription columns, in one paragraph.** Three sources each write their own pair — Stripe (`stripe_status`/`stripe_until`),
app stores (`iap_status`/`iap_expires_at` + IAP ids), and manual grants/trials (`manual_status`/`manual_until`).
The BEFORE trigger `trg_zz_subscription_arbiter` (`_subscription_arbiter`) folds them into the legacy summary pair
`subscription_status`/`trial_ends_at`, which clients still read (web paywall `paywall/page.tsx:42-50`, mobile
`purchase_provider.dart:594-610`). Clients cannot write any of them (`protect_business_entitlement`). New businesses get a
14-day `manual_status = 'trialing'` (`set_default_trial`), or 24 hours if the email already had a trial (`consume_trial` +
`trial_grants`). Full rules: [Subscription & entitlement](../concepts/subscription-and-entitlement.md).

**`notification_prefs` keys** (`notifications-settings.tsx:12-62`): `<topic>.email` and `<topic>.push` for 9 topics —
`critical`, `temp_warnings`, `missed_checks`, `invites_joins`, `signoff`, `invoices`, `payment_issues`,
`product_updates`, `tips` — plus `digest` (weekly summary, default on). `critical` and `payment_issues` are shown
"Always on" and cannot be toggled. A missing key means the UI default. **No code anywhere reads these keys** (Gotcha 2).

### Known drift (live data, 2026-10-13)

- `fsa_rating`: `5` 34, null 19, `3` 11, `4` 10, **`AwaitingInspection` 6, `Improvement Required` 3, `Pass` 1**. The text
  values are genuine FSA `RatingValue`s (Scottish FHIS uses `Pass` / `Improvement Required`), stored verbatim. No `0`–`2` live.
  `sites.fsa_rating` has the same mix. Canonical for display: `0`–`5`; code that does `parseInt` treats the rest as "no rating". [#60](https://github.com/KNSTNTN24/blueroll-web/issues/60)
- `equipment`: 0 businesses have a non-empty list; `registration_number` 0; `haccp_last_reviewed_at` 0; `haccp_auto_fill = false` 0.
- `notification_prefs`: 3 businesses have saved prefs (all 19 keys, boolean); 81 are `{}`.
- 3 businesses have no site and 2 have no profile (half-built signups). 1 business is soft-deleted (0 days old).

## Lifecycle

**Created** — only through RPC `setup_business(business_name, owner_name, business_address, p_fhrs_id, p_fsa_rating, p_post_code)`
(SECURITY DEFINER; there is no INSERT policy on `businesses`). It refuses if the caller already has a profile, inserts the
business, the owner profile (`role = 'owner'`), then calls `consume_trial` and `seed_default_checklists`.

| Path | Notes |
|---|---|
| Web onboarding | `src/app/(auth)/onboarding/page.tsx:701-716`. FSA lookup straight from `api.ratings.food.gov.uk` (`:515`, `:662`). Multi-site: name = group name, FSA fields from the first site; then deletes the trigger-made site and inserts the real list (`:741-752`) |
| Mobile onboarding | `haccp-mobile/lib/providers/auth_provider.dart:125` (single) and `:235` (group, mirrors web). FSA via `features/onboarding/data/fsa_api_client.dart` |
| Join flow | `join_with_invite` — joins an existing business, never creates one. See [Member](member.md) / [Invite](invite.md) |

**Triggers on insert:** BEFORE `trg_set_default_trial` (14-day trial), BEFORE `trg_zz_subscription_arbiter`;
AFTER `trg_business_default_site` (`create_default_site`: one `active` site named after the business, copying `fsa_rating`)
and `trg_seed_business_roles` (`seed_business_roles`: system roles Owner, Manager, Chef, Kitchen Staff, Front of House with their
capabilities — see [Tiers, roles and capabilities](../concepts/roles-and-capabilities.md)). `seed_default_checklists` is **not** a
trigger: `setup_business` calls it and it adds 6 inactive default templates (Fridge & Freezer Temperatures, Daily Opening
Checks, Delivery Acceptance, End of Day Closing, Weekly Deep Clean & Calibration, 4-Weekly HACCP Review) with `site_id` null —
see [Checklist template](checklist-template.md).

**Changed** — by members directly (RLS `Users can update own business`): `notification_prefs`, `equipment`,
`haccp_auto_fill`, channel toggles (`settings/whatsapp-settings.tsx:29`). Subscription columns only by webhooks/RPCs.

**Soft-deleted** — owner only, mobile only (`haccp-mobile/lib/screens/profile/profile_screen.dart:135` → edge function
`delete-account`). It checks `profiles.role = 'owner'` (`delete-account/index.ts:31`), cancels the Stripe subscription
best-effort (`:36-45`) and sets `deleted_at` (`:48-49`). From that moment `get_my_business_id()` returns null and the
SELECT policy hides the row, so every member is locked out at once. On web the store's `business` stays null and the
dashboard layout simply never gates (`src/app/(dashboard)/layout.tsx:32`) — members see an empty app, with no "account deleted" message *(UI unverified)*.

**Purged** — cron `purge-deleted-businesses` (`0 3 * * *`) posts to edge function `purge-deleted-businesses`, which removes
storage under `{business_id}/` in buckets `documents` and `videos` for businesses deleted more than 30 days ago
(`purge-deleted-businesses/index.ts:15-16,79-103`), then calls `function purge_deleted_businesses()`: deletes all child rows
in FK order, members' `profiles` and their `auth.users`, then the business. All 34 FKs to `businesses` are also `ON DELETE CASCADE`.
`trial_grants` (by email) survives, so a re-signup gets only the 24-hour trial.

**Demo business** — "St James's Cafe", `a8ff4795-…` (`src/lib/demo.ts:8`). Not a customer: a showcase every signed-in user can
read (policy `demo_read` on 32 tables, predicate `demo_business_id()`), switched on from the web demo bar
(`applyDemoOverlay`, `demo.ts:54-79`) — web only, mobile has no demo mode. Cron `demo-daily-refresh` (`45 7 * * *`) runs
`demo_daily_refresh()`: clones the activity of 7 days ago to today (`demo_clone_day`) and deletes demo activity older than 45 days.
`demo_force_exit(user_id, created_at)`: a row less than 24 h old makes `demo_business_id()` return the zero uuid for that user,
hiding the demo (2 live rows; nothing in either repo writes it).

## Who can do what

| Action | Rule | Enforced in |
|---|---|---|
| See | own business, not deleted; plus the demo business | RLS `Users can view own business`, `demo_read` |
| Create | anyone signed in without a profile, via RPC | `setup_business` (no INSERT policy) |
| Edit | **any member** of the business, any column except below | RLS `Users can update own business` |
| Channel toggles | active owner or manager | triggers `guard_whatsapp_enabled`, `guard_telegram_enabled` |
| Subscription columns, `deleted_at` | server only | triggers `protect_business_entitlement`, `protect_business_deleted_at` |
| Delete | owner (`profiles.role`), mobile only, soft | edge function `delete-account` (no DELETE policy) |
| UI | Settings tabs: Notifications for everyone; Sites, Team, Messaging for `role` owner/manager | `settings/page.tsx:48-50` |

## Related

- **Entities:** [Site](site.md) (one per location; first one made by trigger), [Member](member.md) (`profiles.business_id`),
  [Checklist template](checklist-template.md) (seeded defaults), [Document](document.md) (storage purged with the business), HACCP Pack / Plan (`haccp_auto_fill`).
- **Concepts:** [Subscription & entitlement](../concepts/subscription-and-entitlement.md), [Tiers, roles and capabilities](../concepts/roles-and-capabilities.md), channels, soft delete, FSA/FHRS rating.

## Where in code

| Area | Location |
|---|---|
| Web | `src/app/(auth)/onboarding/page.tsx`, `src/app/(dashboard)/settings/` (`notifications-settings.tsx`, `whatsapp-settings.tsx`), `src/hooks/use-auth.ts`, `src/stores/auth-store.ts`, `src/lib/demo.ts` |
| Mobile | `lib/models/business.dart`, `providers/auth_provider.dart`, `providers/purchase_provider.dart`, `features/onboarding/` |
| Edge functions | `delete-account`, `purge-deleted-businesses`, `_shared/haccp-plan/load.ts`, Stripe/Apple/Play webhooks |
| DB | RPC `setup_business`, `consume_trial`, `seed_default_checklists`, `purge_deleted_businesses`, `get_my_business_id`, `demo_business_id`, `demo_daily_refresh`; triggers listed above; cron `purge-deleted-businesses`, `demo-daily-refresh` |

## Gotchas

1. **Any member can rewrite the business.** The UPDATE policy is just `id = get_my_business_id()`: kitchen staff can change
   `name`, `fsa_rating`, `equipment`, `haccp_auto_fill`, `notification_prefs` by direct API call, and the Notifications tab is shown to every role.
2. **`notification_prefs` is write-only.** The settings page saves 19 keys, but no edge function, cron or mobile code reads them —
   switches have no effect. They are also business-wide, not per person, so one member's change applies to everyone.
3. **The 4-weekly HACCP review banner is always "Never reviewed".** `haccp_last_reviewed_at` is read by the HACCP Pack and Plan but no code writes it (0 live rows).
4. **FSA rating is a signup snapshot.** Nothing re-fetches it from the FSA; there is no edit UI. The topbar and dashboard print
   `{fsa_rating}/5` (`topbar.tsx:81-84`, `dashboard/page.tsx:149`), giving "AwaitingInspection/5" or "Pass/5". For multi-site the business copies the first site's rating.
5. **The trigger's default site is thrown away for groups.** Web and mobile group onboarding delete it client-side and insert the real
   sites; if that step fails the business keeps zero or one wrong site (3 live businesses have no site).
6. **Deletion is mobile-only and owner-by-legacy-role.** No web UI; the check uses `profiles.role`, not capabilities. App-store
   subscriptions are not cancelled (only Stripe), so a deleted iOS/Android customer can keep being billed by the store.
7. **Equipment is effectively unused.** The Settings editor described in older notes no longer exists; the only writer is a toast in the AI checklist wizard. 0 live rows.
8. **Live-only objects:** `demo_force_exit`, `demo_daily_refresh`, `demo_clone_day`, `seed_default_checklists`, and the live
   `demo_business_id()` (with force-exit) are not in repo migrations, which still define `demo_business_id()` as an `IMMUTABLE` constant (`20260824120000_demo_mode_read_policies.sql:13-15`). [#59](https://github.com/KNSTNTN24/blueroll-web/issues/59)
9. `src/lib/seed-checklists.ts` (`seedDefaultChecklists`) is dead code — nothing imports it; seeding is the SQL function.
10. `registration_number` is a legacy column kept only in the mobile model; `subscription_status`/`trial_ends_at` are legacy summaries kept for old clients.

## History

- 2026-10-11 / 10-10 Telegram and WhatsApp channels add `telegram_enabled`, `whatsapp_enabled` and guards (`20261011120000_telegram_channel.sql`, `20261010120000_whatsapp_channel.sql`).
- 2026-08-24 demo mode read policies (`20260824120000_demo_mode_read_policies.sql`).
- 2026-07-12 account deletion: soft delete, purge function, storage purge via edge function (`20260712140000`–`20260712170000`).
- 2026-07-07 `notification_prefs` (`20260707190000_business_notification_prefs.sql`); default site trigger (`20260707175109_business_default_site.sql`).
- 2026-05-28 default 14-day trial trigger (`20260528_default_trial_trigger.sql`); later subscription arbitration (PR #5).
- 2026-04 `equipment`, `haccp_auto_fill`, HACCP Pack (v2 launch).
