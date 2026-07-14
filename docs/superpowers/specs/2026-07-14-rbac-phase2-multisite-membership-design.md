# RBAC Phase 2 — Multi-site membership (behavior-preserving)

**Date:** 2026-07-14
**Branch:** `KNS/multisite-rls` (staging-first; NOT merged to main)
**Status:** Approved design → implementation plan next
**Part of:** the flexible-RBAC feature. Phase 1 (capability foundation) is done + live. This is **Phase 2**.

## Goal

Replace the single "one home site per member" model (`profiles.site_id`) with a
**many-to-many membership** (`member_sites`): a member can be granted access to a
*subset* of the estate's sites (same role across all of them). Ship it as a
behavior-preserving foundation — after Phase 2 every member still has exactly one
site (migrated 1:1 from `profiles.site_id`), so nothing visibly changes; Phase 4's
per-member editor is what lets an owner assign additional sites.

## Access model (approved)

- **`is_group_admin = true`** → whole estate (bypass; `member_sites` not consulted). Unchanged.
- **Everyone else** → access = their rows in `member_sites`.
- **`profiles.site_id` stays as the member's PRIMARY/default site** — read by the web
  client (`currentSiteId` init) and possibly the published mobile app. Kept in sync
  (always one of the member's `member_sites`), the same back-compat pattern used for
  `profiles.role` in Phase 1.

## Scope

**In scope (Phase 2):**
- `member_sites` table (M:N).
- Redefine the site RLS helper `can_see_site_row()` to check membership instead of the
  single `profiles.site_id`. The kitchen helpers (`can_see_shared_row`,
  `can_write_kitchen_row`) call `can_see_site_row`, so they inherit the change (they're
  dormant today since kitchen is business-level, but stay correct for the future).
- Data migration: each member with a `site_id` gets one `member_sites` row; group admins
  get none (bypass); `profiles.site_id` preserved as primary; a trigger keeps it valid.
- Web client: `use-auth` loads the member's **accessible** sites (their `member_sites`, or
  all sites for a group admin); the topbar switcher offers that set. Post-migration every
  non-admin has exactly one accessible site → **no visible change**.

**Out of scope (later phases):**
- The UI to assign multiple sites to a member — **Phase 4** (per-member editor).
- Role rename/create UI — **Phase 3**.
- Per-member capability overrides — **Phase 4**.
- Per-site *roles* (different role at different sites) — explicitly NOT this feature
  (approved: one role across a member's sites).
- Kitchen per-site enablement — deferred (separate later phase).

## Data model

### `member_sites`
```
profile_id  uuid not null references profiles(id) on delete cascade
site_id     uuid not null references sites(id)    on delete cascade
created_at  timestamptz not null default now()
primary key (profile_id, site_id)
```
Indexes on both columns. RLS enabled:
- `select` = members of the business (a member's business owns the site).
- `all` (manage) = `has_capability('manage_team')` for the business that owns the site.

### `profiles.site_id` (kept)
Stays as the PRIMARY site. A trigger keeps it consistent with membership:
- When a `member_sites` row is deleted and it was the member's `profiles.site_id`,
  repoint `profiles.site_id` to another of the member's sites (or NULL if none — but
  a non-admin should always have ≥1 site; enforced in the Phase-4 editor).
- When a member gains their FIRST `member_sites` row and `profiles.site_id` is NULL,
  set it to that site.
- Adding additional sites does NOT change the primary.

## RLS helper change

Current `can_see_site_row(p_site)` = `am_i_group_admin() OR p_site = (profiles.site_id of auth.uid())`.
New:
```
am_i_group_admin()
OR exists (select 1 from member_sites ms where ms.profile_id = auth.uid() and ms.site_id = p_site)
```
`SECURITY DEFINER`, `set search_path = public` (unchanged). `can_see_shared_row` and
`can_write_kitchen_row` are unchanged in source — they delegate to `can_see_site_row`
and pick up the new behavior automatically. `get_my_site_id()` is left as-is (returns
the primary `profiles.site_id`) for any caller that uses it; access is now decided by
membership, not by that single value.

**Equivalence:** post-migration each non-admin has exactly one `member_sites` row equal
to their old `profiles.site_id`, so `can_see_site_row` returns the identical result as
before for every user. Group admins are unaffected (bypass). This is the safety argument.

## Data migration (order matters)

1. Create `member_sites` (+ indexes, RLS).
2. Backfill: `insert into member_sites (profile_id, site_id) select id, site_id from profiles where site_id is not null and is_group_admin = false on conflict do nothing`. (Group admins deliberately get no rows — they bypass.)
3. Add the `profiles.site_id` ↔ `member_sites` consistency trigger.
4. **Verification gate:** every non-admin profile with a `site_id` has a matching
   `member_sites` row; no `member_sites` row points outside its member's business.
5. Redefine `can_see_site_row()` to the membership version (single `create or replace` —
   the swap; wrapped so it is atomic).

## Web client change

- `auth-store`: add the member's accessible-site set (e.g. keep `sites` = all business
  sites for admins, and add `accessibleSiteIds` = `member_sites` for non-admins; group
  admins → all).
- `use-auth`: load `member_sites` for the current user; compute accessible sites.
- `topbar`: the switcher is shown for a group admin (all sites, existing behavior) OR a
  non-admin with **>1** accessible site; a non-admin with exactly one site keeps the
  read-only site chip (existing). `currentSiteId` is constrained to the accessible set.
- Because every non-admin has exactly one accessible site post-migration, this is
  behavior-neutral until Phase 4 grants a member additional sites.

## Rollout & rollback

Shared production Supabase (staging sits on it). Additive: steps 1-3 change no access
(existing `can_see_site_row` still reads the single site until step 5). Gate (step 4).
Step 5 (`create or replace can_see_site_row`) is the only behavior-touching change and is
a no-op because membership == the old single site for everyone. **Rollback**: a one-liner
that `create or replace`s `can_see_site_row` back to the single-`profiles.site_id`
version (kept verbatim), outside `supabase/migrations/`.

## Testing

- **Equivalence (the bar):** for a representative non-admin at a site, impersonate and
  assert the set of rows visible on a site-scoped table (checklist_completions,
  incidents) is IDENTICAL before and after step 5. Group admin still sees all sites.
- **Membership works:** manually add a second `member_sites` row for one test member and
  confirm they can now see that second site's rows (proving the M:N path), then remove it.
- **Primary-site trigger:** deleting the primary `member_sites` row repoints
  `profiles.site_id` to a remaining site (test member with 2 sites).
- `profiles.site_id` distribution unchanged for all real members (mobile back-compat).

## Success criteria

- `member_sites` is the access source; `can_see_site_row` checks it.
- Zero behavior change: before/after visibility identical for every member.
- A member with multiple `member_sites` rows can access all those sites (M:N proven).
- `profiles.site_id` still valid as primary for every member.
- Client switcher offers a member's accessible sites (still one each until Phase 4).
