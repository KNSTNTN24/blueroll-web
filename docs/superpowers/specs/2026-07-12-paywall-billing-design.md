# Paywall Hardening + Multisite Billing — Design

- **Date:** 2026-07-12
- **Status:** Approved (Konstantin), ready for implementation plan
- **Scope:** Supabase (migrations, RLS, edge functions), Web client (`~/HACCP/web`). Phase 2 depends on the multisite data model (`sites`) being built by Maria on branch `KNS/multisite` (worktree `~/HACCP/web-multisite`).
- **Structure:** ONE spec, TWO phases. Phase 1 (paywall hardening) ships independently on the current model. Phase 2 (multisite billing) lands on Maria's multisite once it merges.

## Problem

The paywall is not enforced and leaks money; and billing does not yet scale to multi-site groups.

Paywall holes found in the 2026-07 audit:
- `/paywall` is a **test stub**: its button writes `manual_status='trialing'` for 14 days with **no payment**, so an expired user just clicks it and is back in — indefinitely. There is no working paid path on web.
- **Self-grant**: a logged-in user (owner or member) can `PATCH businesses` setting `manual_status='active'`, `manual_until='2099'` via the auto-generated REST API; the arbiter then computes `active`. Free forever. (Column-level `REVOKE` is inert — a table-level UPDATE grant overrides it; the fix is a trigger, as used for `deleted_at`.)
- **Unlimited trials**: `set_default_trial` grants a fresh 14-day trial on every new business INSERT, with no dedup — a new email = another trial, forever.
- **No server-side enforcement**: gating is a client-side redirect only; an expired user with a valid JWT reads and writes all data directly via PostgREST (RLS scopes by business membership, never by subscription).
- `manage-subscription` `portal`/`cancel`/`reactivate`/`sync` actions are unauthenticated (callable with any id via the anon key).

Multisite billing: Maria's model is **sites UNDER a business** (`sites.business_id → businesses.id`; no separate `groups` table — the `businesses` row is the group). Billing lives on the `businesses` row. It must scale by number of sites.

## Decisions (locked)

1. **Structure:** one spec, two phases (Phase 1 paywall-hardening ships now; Phase 2 multisite-billing after Maria's multisite merges).
2. **Pricing:** per-site with a **volume discount** — graduated Stripe pricing, `quantity` = number of active sites (default: first site £15, additional sites at a discounted rate; exact rates configured in Stripe, not hardcoded).
3. **Over-quantity:** **auto-add + auto-charge** — adding a site immediately increments the Stripe subscription `quantity` (pro-rata). Because `quantity` always tracks the site count, **every site is always covered** → per-site entitlement collapses to **business-level** entitlement (no per-site quota gate).
4. **Enforcement:** block **writes** when a business is not entitled (RLS on write tables); **reads of existing data stay open** (no "I lost everything" panic; clean upgrade path).
5. **Grace:** a failed renewal (`past_due` / IAP grace) is treated as entitled for **7 days** past the paid-through date before blocking.
6. **Trial dedup:** by **email** — one trial per email, ever.

## Shared core (built in Phase 1, used by both phases)

### `is_business_entitled(business_id uuid) → boolean`
`SECURITY DEFINER`, `STABLE`, `SET search_path`. Single source of truth for server-side gating. Returns true iff:
- the business `deleted_at IS NULL`, AND
- the business's subscription is live: computed `subscription_status IN ('active','trialing')` (with `trial_ends_at` in the future when `trialing`), **OR** a channel is in a payment-grace state (`past_due` / IAP grace) whose paid-through date is within the last 7 days.

Grace mechanism (extend `compute_entitlement` to treat `past_due`/grace-within-window as live, vs handling it inside `is_business_entitled`) is decided in the plan — the requirement is that a 7-day grace is honored. Sites resolve to their business (`sites.business_id`); there is no separate per-site entitlement — a site is entitled iff its business is.

### Entitlement-column write protection
A `BEFORE UPDATE` trigger on `businesses` that blocks `authenticated`/`anon` from writing the server-owned columns: `manual_status`, `manual_until`, `stripe_status`, `stripe_until`, `iap_status`, `iap_expires_at`, `subscription_id`, `stripe_customer_id`, `subscription_status`, `trial_ends_at`. Only `service_role` (webhooks / edge functions) may write them. (Same pattern proven for `deleted_at`; column-level `REVOKE` alone is inert here.)

## Phase 1 — Paywall hardening (ships now, current single-subscription-per-business model)

1. **Server-side write enforcement.** Add `is_business_entitled(business_id)` as an additional `WITH CHECK` (and `USING` for UPDATE) condition on the INSERT/UPDATE RLS policies of the business write tables: `recipes`, `recipe_ingredients`, `recipe_tags`, `tags`, `menu_items`, `checklist_templates`, `checklist_template_items`, `checklist_completions`, `checklist_responses`, `documents`, `incidents`, `diary_entries`, `suppliers`, `deliveries`, `delivery_photos`, `staff_checkins`, `haccp_pack_data` (final list verified against the live schema during the plan). **SELECT/DELETE policies are NOT changed** — reads of existing data stay open. This blocks unpaid writes even via the direct API.
   - **Coordination (critical):** these are the same tables Maria is adding **per-site RLS isolation** to (`KNS/multisite`: helpers `am_i_group_admin`, `can_see_site_row`, `can_write_kitchen_row`, …). The entitlement check must be added as an **additional AND condition** compatible with her per-site policies, or via a shared helper both compose. Merge order and the exact policy shape must be coordinated with Maria so the two RLS changes don't clobber each other.
2. **Replace the `/paywall` test stub with real payment.** The button must run the real Stripe card flow (reuse the onboarding `card` step → `create-subscription` edge function), not write a `manual` trial. Remove the no-payment `manual_status='trialing'` write.
3. **Trial dedup by email.** A record of trials already granted (e.g. a `trial_grants(email text primary key, granted_at timestamptz)` table). `set_default_trial` grants the 14-day trial only if the owner's email has no prior grant; otherwise the new business starts unentitled (`none`) and must pay. Backfill existing businesses' emails so current customers aren't re-trialed.
4. **Authenticate `manage-subscription`.** Require a valid JWT and verify the caller owns the target business (resolve `auth.uid()` → `profiles` → require `business_id` matches the `businessId`/`customerId` and role is `owner`) for `portal`/`cancel`/`reactivate`/`sync`. (The `delete` action was already removed.)
5. **Grace period.** Honor a 7-day grace on `past_due`/IAP-grace before blocking (see shared core).

## Phase 2 — Multisite billing (on Maria's `sites` model, after multisite merges)

1. **Stripe `quantity` = count of active sites** for the business. On site create (including the `create_default_site` trigger that makes the first site) → increment the subscription quantity (pro-rata charge); on site archive/delete → decrement. A service-role path (edge function or webhook-backed sync) updates Stripe when the `sites` set changes; the Stripe webhook already reflects the resulting subscription state back into the channel columns.
2. **Graduated per-site pricing** configured in Stripe (first site £15, additional at a discount — exact rates in the Stripe dashboard, not in code). A single graduated price; `quantity` drives the total.
3. **Entitlement stays business-level.** `is_business_entitled` already covers all of a business's sites (quantity tracks count). An unpaid business blocks all its sites together via the Phase 1 write-gate. No per-site entitlement function.
4. **Solo restaurants unaffected.** 1 business + 1 site = quantity 1 = £15 (current behavior preserved).

## Data flow

Payment (Stripe card / Apple / Google) → provider webhooks (service role) write the channel columns (which clients cannot write) → arbiter computes `subscription_status`/`trial_ends_at` → `is_business_entitled` reads the result → RLS write-gate + client UI honor it. Adding a site → Stripe quantity synced → pro-rata charge → business stays entitled (quantity covers the new site).

## Testing

SQL ASSERT (via `scripts/sql-api.sh`, impersonating `authenticated`):
- `is_business_entitled` returns true for active/trialing(not expired)/grace-within-7d and false for canceled/expired-trial/past_due-beyond-grace/soft-deleted.
- A normal user cannot write any entitlement column (trigger raises).
- An unentitled business: INSERT/UPDATE on a write table is denied by RLS; SELECT still returns existing rows.
- An entitled business: the same writes succeed.
- `set_default_trial`: a second business for an email that already had a trial starts unentitled.
- `manage-subscription`: unauthenticated and wrong-owner calls are rejected.

Phase 2:
- Creating/removing a site changes the Stripe subscription quantity (verified against Stripe test mode or a mocked call).

## Out of scope (YAGNI)

- Per-site *separate-company* billing (each site its own subscription) — not needed; no franchise customers with separate legal entities yet.
- A separate `groups`/organizations entity — the `businesses` row is the group.
- Per-site entitlement quota logic (`oldest-N` coverage) — obsolete given auto-add+auto-charge.
- Migrating existing customers to per-site pricing beyond keeping solo = £15.

## Parameters

- Grace: **7 days**.
- Trial dedup key: **email**.
- Pricing: **first site £15, additional sites at a discounted rate** (exact rates in Stripe; parameterized, no code change to adjust).

## Files likely touched

Phase 1:
- `supabase/migrations/*` — `is_business_entitled()`; entitlement-column write-protection trigger; write-gate RLS on business tables (coordinated with Maria's per-site RLS); `trial_grants` + `set_default_trial` update; grace handling.
- `supabase/functions/manage-subscription/index.ts` — auth + ownership check.
- `src/app/(auth)/paywall/page.tsx` — replace stub with the real Stripe card flow.
- `supabase/functions/create-subscription/index.ts` — reuse for the paywall path (confirm/verify caller).

Phase 2:
- Site→Stripe quantity sync (edge function and/or triggers) + Stripe graduated price config.
