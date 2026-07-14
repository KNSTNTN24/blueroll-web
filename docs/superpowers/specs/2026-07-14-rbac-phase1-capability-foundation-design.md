# RBAC Phase 1 — Capability foundation (behavior-preserving)

**Date:** 2026-07-14
**Branch:** `KNS/multisite-rls` (staging-first; NOT merged to main)
**Status:** Approved design → implementation plan next
**Part of:** the flexible-RBAC feature (custom role names + per-member grants + per-site access), decomposed into 4 phases. This spec is **Phase 1** only.

## Goal

Decouple RLS from hardcoded role-name strings (`get_my_role() in ('owner','manager')`)
by moving enforcement onto **capabilities**. Ship it as an invisible refactor:
after Phase 1, every user can do **exactly** what they can today — the plumbing
just changes so that later phases (custom role names, per-member grants) become
possible without breaking RLS.

## Why (the constraint that forces this)

Today a "role" is both an identity (name) and a permission bundle, and RLS checks
the role **string**. So if a restaurant renames "Manager" to "Shift Lead" (Phase 3),
every `get_my_role() = 'manager'` policy silently stops matching. Capabilities break
that coupling: RLS checks `has_capability('manage_checklists')`; the role's *name*
becomes free text that no policy depends on.

## Scope

**In scope (Phase 1):**
- Capability catalog (app-level constant).
- `roles` table (per business) seeded with 5 presets whose capability sets equal
  today's behavior exactly.
- `profiles.role_id` → `roles`; **keep `profiles.role` (text) as a synced back-compat column**.
- `has_capability(cap)` SECURITY DEFINER helper.
- Migrate every role-gated RLS policy from role-string checks to `has_capability()`,
  preserving all other conditions (business scope, site scope, ownership like
  `completed_by = auth.uid()`).
- Data migration: seed presets per existing business; set each member's `role_id`.
- New-business trigger seeds the 5 presets.

**Out of scope (later phases):**
- Client-side gating stays as-is (it reads `profiles.role`, which we preserve) —
  Phase 3/4 introduces the `useCapabilities()` hook and rips out `isManager` etc.
- Multi-site membership (`member_sites` M:N) — **Phase 2**.
- Custom role rename/create UI — **Phase 3**.
- Per-member capability overrides (grant/revoke) — **Phase 4**.
- Fixing the `view_documents` oddity (see below) — deliberately NOT fixed here;
  Phase 1 preserves current behavior byte-for-byte.

## Capability catalog (~14, fixed, app-level)

```
manage_checklists     complete_checklists   sign_off
manage_recipes        manage_documents      view_documents
manage_incidents      manage_deliveries     manage_suppliers
manage_team           manage_roles          manage_sites
manage_billing        view_reports
```

Stored as a Postgres `text[]` on `roles.capabilities`, validated against a
`CHECK` (or a small `capabilities` reference table) so typos can't creep in.
The canonical list also lives in `src/lib/constants.ts` for later client use.

## Preset → capability matrix (this IS current behavior, derived from live RLS)

| capability | Owner | Manager | Chef | Kitchen Staff | Front of House |
|---|:--:|:--:|:--:|:--:|:--:|
| complete_checklists (daily logging: complete, incidents, deliveries, check-in) | ✅ | ✅ | ✅ | ✅ | ✅ |
| view_reports (read completions/reports) | ✅ | ✅ | ✅ | ✅ | ✅ |
| manage_checklists (templates, template_items, four_weekly_reviews, notification_rules) | ✅ | ✅ | — | — | — |
| sign_off (delete/sign-off completions) | ✅ | ✅ | — | — | — |
| manage_recipes (recipes, recipe_ingredients, recipe_tags, ingredients, menu_items) | ✅ | ✅ | ✅ | — | — |
| manage_documents (documents insert/update, document_access insert) | ✅ | ✅ | — | — | — |
| view_documents (documents SELECT) | ✅ | — | — | — | — |
| manage_suppliers (suppliers write) | ✅ | ✅ | — | — | — |
| manage_incidents / manage_deliveries | ✅ | ✅ | ✅ | ✅ | ✅ |
| manage_team (profiles update = change members; invites) | ✅ | ✅ | — | — | — |

> **Behavior-preservation note on incidents & deliveries:** today these have **no
> role gate** — every business member can create/edit/delete them (member-level
> policies). So in Phase 1 `manage_incidents` / `manage_deliveries` are granted to
> **all 5 presets** (everyone), and **no RLS policy is changed** for those tables.
> The capabilities exist in the catalog only so a future phase can *tighten* them
> (e.g. "only managers edit incidents") — but Phase 1 adds zero new restriction.
> Only `suppliers` among this group is genuinely role-gated (owner+manager) and
> therefore migrated.
| manage_sites | ✅ | — | — | — | — |
| manage_billing | ✅ | — | — | — | — |
| manage_roles | ✅ | — | — | — | — |

- **Owner** is a protected super-role: its preset holds every capability and its
  `is_system = true`; at least one owner must always exist (unchanged from today).
- **`view_documents` is owner-only today** even though managers can insert/update
  documents (managers can edit a doc but not see the list) — almost certainly a
  latent bug. Phase 1 replicates it exactly (view_documents → Owner only). Flag it
  for a Phase-3+ product fix; do NOT change it here.

## Data model

### `roles`
```
id           uuid pk
business_id  uuid not null references businesses(id) on delete cascade
name         text not null                 -- "Manager" now; free-text later
capabilities text[] not null default '{}'  -- validated against the catalog
is_system    boolean not null default false -- true for the seeded presets; owner preset especially
created_at   timestamptz not null default now()
unique (business_id, name)
```
RLS: `select` = members of the business; `all` (manage) = `has_capability('manage_roles')`
(owner only until Phase 4). The owner preset row is protected from deletion/edit
in Phase 3; Phase 1 just seeds it.

### `profiles`
- Add `role_id uuid references roles(id)`.
- **Keep `profiles.role text`** — it's read by the published mobile app and by the
  current client. A trigger keeps it in sync: when `role_id` is set/changed,
  `profiles.role` := the preset's base tier (owner/manager/chef/kitchen_staff/
  front_of_house). For custom roles created in Phase 3, `role` falls back to the
  role's nearest base tier (a `roles.base_tier` column, seeded = the preset tier,
  carries this). So mobile always sees a valid legacy role string.

> **Decision:** add `roles.base_tier text` (one of the 5 legacy roles) now, set on
> the presets = their identity. It is the bridge that keeps `profiles.role` valid
> for any future custom role, and lets `has_capability` short-circuit owner.

## Helper: `has_capability(cap text) -> boolean`

`SECURITY DEFINER`, `set search_path = public`. Effective capabilities in Phase 1 =
the member's role capabilities (overrides arrive in Phase 4):

```
returns true if the caller's role is the owner preset (base_tier='owner', is_system)
        OR cap = any(that role's capabilities)
```
Reads `profiles` + `roles` directly (definer bypasses RLS, no recursion). Returns
false when the caller has no `role_id` (fail-closed). Granted to `authenticated`.

## RLS migration (the enforcement swap)

For every policy currently gated on `get_my_role()`, replace **only** the role
sub-expression with `has_capability('<cap>')`, leaving business scope, the
multisite site-scope (`can_see_site_row` / `can_write_kitchen_row`, added in the
multisite work — orthogonal, untouched), and ownership predicates
(`completed_by = auth.uid()`, `reported_by = auth.uid()`) intact.

Affected policies (capability in brackets), verified against the live DB:
- `checklist_templates` ALL → `manage_checklists`
- `checklist_template_items` ALL → `manage_checklists`
- `four_weekly_reviews` ALL → `manage_checklists`
- `notification_rules` ALL → `manage_checklists`
- `checklist_completions` DELETE (`completed_by = auth.uid() OR role∈…`) → `completed_by = auth.uid() OR has_capability('sign_off')`
- `recipes` / `recipe_ingredients` / `recipe_tags` / `ingredients` / `menu_items` ALL → `manage_recipes`
- `invites` ALL → `manage_team`
- `profiles` UPDATE "Admins can manage member profiles" → `manage_team`
- `documents` INSERT + UPDATE(owner_manager) and `document_access` INSERT → `manage_documents`
- `documents` SELECT → `view_documents`; `documents` DELETE + the owner-only UPDATE + `document_access` DELETE → keep **owner-only** access set (map to `view_documents`, which is owner-only in the presets, so the resulting access set is byte-identical). The exact per-policy SQL for the messy `documents` set is worked out in the plan; the rule is "same access set, no behavior change."
- `sites` ALL `sites_write` → `manage_sites` (already owner-only)

- `suppliers` ALL "Managers can manage suppliers" → `manage_suppliers` (keep `can_write_kitchen_row`, it's a kitchen table).

**Do NOT touch** the `incidents` and `deliveries` policies: they are member-level
today (no role gate), so there is nothing to migrate and Phase 1 must not add a
restriction (`manage_incidents`/`manage_deliveries` are granted to all presets).
The plan enumerates the exact current policy text per affected table before swapping.

## Data migration (order matters)

1. Create `roles` + add `profiles.role_id`, `roles.base_tier`.
2. Seed 5 preset roles for **every existing business** (Owner/Manager/Chef/
   Kitchen Staff/Front of House) with the capability sets from the matrix above,
   `base_tier` = the legacy tier, `is_system = true`.
3. Set every profile's `role_id` = its business's preset matching `profiles.role`.
   (Owner preset holds all caps.)
4. Add the `profiles.role` ↔ `role_id` sync trigger (keeps legacy `role` correct).
5. Add the new-business trigger: on `businesses` insert, seed the 5 presets
   (compose with the existing `create_default_site` trigger).
6. `has_capability()` helper.
7. **Verification gate:** every non-deleted business has exactly the 5 presets;
   every active member has a non-null `role_id`; no capability string outside the
   catalog. Halt the policy swap unless all pass.
8. Swap the RLS policies (single transaction, per the migration section).

## Rollout & rollback (additive-on-prod)

Same discipline as the multisite work — the DB is the **shared production**
Supabase (staging sits on it):
- Steps 1-6 are additive (new tables/columns/functions/triggers, backfill) and do
  not change any access — current RLS still reads `get_my_role()`. Safe.
- Step 7 gates the swap.
- Step 8 (swap) is the point of change; wrapped in a transaction.
- **Rollback** migration recreates the exact pre-swap role-string policies (kept
  verbatim in the plan) and lives **outside** `supabase/migrations/` so
  `supabase db push` can't silently revert it (same pattern as the multisite RLS
  rollback).
- Because presets == current behavior, the swap is a **no-op for every existing
  user** — single-role members keep the identical access set. This is the core
  safety argument; the verification (below) proves it.

## Testing

Behavior-equivalence is the acceptance bar. Using impersonation on the shared DB
(the RLS-test pattern already used for multisite):
1. For a representative member of each of the 5 roles, snapshot what they can
   SELECT/INSERT/UPDATE/DELETE on the affected tables **before** the swap, and
   assert it is **identical after** the swap.
2. Assert `profiles.role` is unchanged for every member (mobile back-compat).
3. Assert a new business (created via the trigger) gets 5 presets + its owner
   profile maps to the owner preset with all capabilities.
4. Assert `has_capability()` returns the matrix above for each preset.

## Success criteria

- Every role-gated RLS policy checks `has_capability()`, none check role strings.
- Zero behavior change: the before/after access snapshots match for all 5 roles.
- `profiles.role` still valid for all members (mobile unaffected).
- New businesses auto-seed the 5 presets.
- Custom role **names** would no longer break any RLS policy (the whole point) —
  demonstrable by renaming a preset and confirming access is unchanged.

## Out-of-scope reminders

Client `isManager`/`isOwner` checks, the estate/site RLS site-scoping, the
`document_access` per-document sharing model, and the paywall
`entitlement_write_gate_*` RESTRICTIVE policies are all left exactly as they are.
