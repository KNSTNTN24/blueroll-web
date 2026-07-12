# Multi-site: hard per-site access isolation (RLS)

**Date:** 2026-07-12
**Branch:** `KNS/multisite`
**Status:** Approved design → implementation plan next

## Problem

The multi-site foundation added a `sites` table and a `site_id` column to every
operational table, but **access control is still purely business-level**. Every
RLS policy uses `get_my_business_id()` (plus role for writes); no policy ever
references `site_id`. Verified against prod: **zero** policies mention `site_id`.

Consequently `site_id` is only a *soft* filter applied by the app (the
"Borough Market / Shared across all sites" switcher adds `.eq('site_id', …)` to
queries). At the database level a front-of-house user at Site A can read Site B's
checklists, incidents, etc. — RLS allows it.

**Goal:** make per-site isolation a real security boundary enforced by RLS, not a
UI convenience.

## Access model (approved)

A new SECURITY DEFINER helper `am_i_group_admin()` returns the caller's
`profiles.is_group_admin`. The base visibility predicate for isolated tables:

```sql
business_id = get_my_business_id()
AND ( am_i_group_admin() OR site_id = get_my_site_id() )
```

- **`is_group_admin = true`** (all owners today + a couple of designated managers)
  → sees / manages the whole estate.
- **Everyone else** (including non-admin managers) → locked to their own
  `profiles.site_id`.

`get_my_site_id()` already exists and returns the caller's `profiles.site_id`.
`get_my_business_id()` and `get_my_role()` already exist. All are SECURITY DEFINER
so they do not recurse through the RLS of the tables they read.

## Table matrix

| Group | Tables | SELECT | INSERT / UPDATE |
|---|---|---|---|
| **Compliance — isolated** | `checklist_templates`, `checklist_completions`, `checklist_instances`, `incidents`, `deliveries`, `diary_entries`, `staff_checkins`, `haccp_pack_data`, `haccp_signoffs` | base predicate | own site only (admin: any site); keep existing gates — `checklist_templates` write stays `owner/manager`, `incidents` INSERT stays `reported_by = auth.uid()` — AND the site scope |
| **Kitchen — shared-or-site** | `recipes`, `suppliers` | `site_id IS NULL` (shared, all sites) OR `am_i_group_admin()` OR `site_id = get_my_site_id()` | **shared (`site_id IS NULL`) rows: `am_i_group_admin()` only**; site rows: `owner/manager` of that site |
| **Unchanged — group-wide** | `documents`, `tags`, `ingredients`, `businesses`, `sites`, `profiles`, `invites` | current business-level + role policies, untouched | unchanged |

Notes:
- `tags` / `ingredients` have **no** `site_id` column — they stay a group-shared
  library by construction.
- `documents` keeps group-wide visibility by decision (shared policy/cert library).
- `sites` / `profiles` / `invites` already carry the right business+role policies
  (a member sees the group's sites; owners/managers manage members and invites,
  invites can target a specific `site_id`).

## Pre-flight data cleanup (MANDATORY, runs before any policy change)

Tightening RLS to `site_id = get_my_site_id()` breaks anyone whose row or profile
has `site_id IS NULL` (SQL `= NULL` is never true → they'd see empty lists). Prod
currently has such rows, so cleanup is a hard prerequisite.

**Known NULLs at design time (prod):**
- `profiles`: 6 with NULL `site_id`. 3 are group admins (unaffected). Of the
  remaining 3, `Connor` (manager) is in a **single-site** business
  (`Mr Thomas's Chop House`) → trivial; the other two are demo users in
  `The Green Kitchen`. **Confirmed by owner: all NULL-site profiles are our test
  accounts except Connor.**
- Operational rows with NULL `site_id`: `checklist_instances` 151,
  `checklist_completions` 48, `checklist_templates` 13, `staff_checkins` 9,
  `incidents` 1. These sit in multi-site businesses that are all demo/test data.

**Cleanup steps:**
1. Backfill `profiles.site_id` where NULL → the business's **oldest site**
   (`sites` row with min `created_at`). Single-site businesses have exactly one,
   so this is unambiguous for Connor and every real client.
2. Backfill every isolated table's NULL `site_id` rows → the business's **oldest
   site** (deterministic; only touches demo data in practice).
3. Add a `BEFORE INSERT` guard trigger on each isolated table: if `site_id IS NULL`,
   set it to `get_my_site_id()`. Prevents new NULLs regardless of the app.
4. **Verification gate:** a check that asserts `0` NULL `site_id` across
   `profiles` and every isolated table. The policy swap must not run unless this
   passes.

## Application changes (`KNS/multisite`)

- **Lock non-admins to their site.** For a user with `is_group_admin = false`,
  the site switcher in the topbar is hidden and `currentSiteId` is pinned to
  `profiles.site_id`. (Chosen: hide, not a disabled/read-only control.)
- **Stamp `site_id` on writes.** Every operational insert path sets `site_id`
  (checklist completion already does — commit `74d5817`; audit and fill the rest:
  incidents, deliveries, diary, staff check-ins, checklist templates/instances,
  HACCP pack/signoffs). The app is authoritative for the target site: a
  `group_admin` creating data while viewing Site B must send `site_id = B`, not
  rely on the trigger (whose `get_my_site_id()` default is the admin's *home*
  site, which may differ). The guard trigger is only a NULL backstop for
  non-admins writing to their single locked site.
- `is_group_admin` continues to drive the estate dashboard / all-sites view.

## Rollout & rollback (additive-on-prod)

Chosen approach: additive on prod, validated with test accounts, instant revert.
Migration ordering, each idempotent:

1. `..._multisite_backfill_site_ids.sql` — backfill profiles + operational rows,
   add guard triggers.
2. `..._multisite_verify_no_null_sites.sql` — verification gate (raises if any
   NULL remains; halts the deploy).
3. `..._am_i_group_admin.sql` — the helper function.
4. `..._multisite_site_rls.sql` — the policy swap, wrapped in a transaction:
   `DROP` the business-level SELECT/write policies on the isolated + kitchen
   tables and `CREATE` the site-scoped ones.

**Rollback:** a down-migration that drops the site-scoped policies and recreates
the previous business-level policies verbatim. The exact current policy text is
captured in the plan so revert is copy-paste and immediate.

## Testing

Use the existing demo **The Green Kitchen (8 sites)** rather than creating a new
business:
1. Create/point one non-admin user at Site A and another at Site B.
2. Assert: Site-A user sees only Site-A checklists/incidents/etc.; cannot read or
   write Site-B rows.
3. Assert: a `group_admin` sees all sites; the switcher works for them.
4. Assert: a single-site business (e.g. a real client) is **unchanged** — same
   rows visible before and after (the no-op case).
5. Assert: shared (`site_id IS NULL`) recipes/suppliers are visible to all sites;
   only a `group_admin` can edit them.

## Blast radius

Only multi-site businesses are affected; single-site businesses are a strict
no-op (every member's `site_id` equals the sole site, every row carries it).
At design time the multi-site businesses in prod are almost all demo/test
(`The Green Kitchen`, `Pizza Pizza`, `My Restaurant`, `Tst`, …); real clients are
overwhelmingly single-site.

## Out of scope

- Multi-site membership (one person mapped to several sites) — current model is
  one home site per profile plus the group-admin bypass.
- Per-site roles (a person being manager at Site A and staff at Site B).
- Splitting `documents` / `haccp_pack_data` into per-site vs group libraries
  beyond what the matrix specifies.
- Changing the 5-tier role model (`owner/manager/chef/kitchen_staff/front_of_house`).
