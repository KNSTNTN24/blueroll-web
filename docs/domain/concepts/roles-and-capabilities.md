# Tiers, roles and capabilities

> How Blueroll decides who may do what: every member has one **role**; a role has a **tier** and a set of
> **capabilities**; a person can get or lose single capabilities through **overrides**; **site membership**
> decides which sites' data they see.

**Touches:** Member (`profiles`), Business, Site, Invite, Checklist template, Document ·
**Last verified:** 2026-10-13 against `main@b50e9d1` and the live DB (`rszrggreuarvodcqeqrj`)

## The rule in plain words

```
can(person, capability) =
     person.role.tier == owner                                   -- owners can do everything, always
  OR ( (capability ∈ person.role.capabilities OR override(person, capability) = granted)
       AND NOT override(person, capability) = revoked )          -- a revoke beats the role and a grant

sees(person, row on site S) =
     person.is_group_admin                                       -- whole estate
  OR person has no member_sites rows                             -- not scoped yet → whole business
  OR (person, S) ∈ member_sites
```

That is what the **database** enforces (`public.has_capability`, `public.can_see_site_row`). The **web and mobile UI
do not use capabilities**: they still gate on the tier string (`profiles.role` in owner/manager/chef).
See *Gotchas* 1.

## Terms

| Term | Meaning | Where it lives |
|---|---|---|
| **Tier** | One of five built-in levels: `owner`, `manager`, `chef`, `kitchen_staff`, `front_of_house`. The coarse "kind" of a role. | `roles.base_tier` (DB `CHECK`); mirrored as text in `profiles.role` and `invites.role`; TS `USER_ROLES`, `ROLE_LABELS` `src/lib/constants.ts:16-22` |
| **Role** | A named set of capabilities a business gives to members, built on a tier. Each business has 5 **preset** roles (`is_system = true`) and may add **custom** roles. Names are unique per business. | table `roles` (`supabase/migrations/20260714130000_rbac_schema.sql:12-21`) |
| **Preset role** | Owner, Manager, Chef, Kitchen Staff, Front of House — seeded for every business. Can be renamed and have capabilities edited; cannot be deleted. | trigger `trg_seed_business_roles` → `seed_business_roles()` on `businesses` insert (`20260714130200_rbac_functions.sql:28-44`); delete blocked by `guard_role_delete()` |
| **Capability** | One permission. 14 exist (below). Unknown names are rejected. | `capability_catalog`; trigger `validate_role_capabilities`; TS `CAPS` `src/lib/permissions.ts:10-18` |
| **Override** | Per-person exception: `granted = true` adds a capability on top of the role, `false` removes it. No row = inherit. | `member_capability_overrides` (`20260714160000_member_capability_overrides.sql:3-12`) |
| **Site membership** | Which sites a member works at. Many-to-many. `profiles.site_id` is kept pointing at one of them ("primary site"). | `member_sites`; trigger `keep_primary_site` (`20260714140000_member_sites.sql:3-45`) |
| **Group admin** | Sees every site of the business (estate-wide scope). Not an admin *grant* — it is about scope — but the DB treats group admins like owners in two guards (Gotcha 4). | `profiles.is_group_admin`; `am_i_group_admin()` (`20260712100100_multisite_rls_helpers.sql:4-7`) |
| **Legacy role text** | `profiles.role` — the tier as text, kept for old readers. Two-way synced with `profiles.role_id`. | trigger `trg_sync_profile_role` → `sync_profile_role_text()` (`20260716173000_profile_role_two_way_sync.sql:14-54`) |

## The 14 capabilities and the presets

| Capability | UI label (`CAP_LABEL`) | Owner | Manager | Chef | Kitchen Staff | Front of House | Enforced in DB? |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `complete_checklists` | Complete checklists | ✓ | ✓ | ✓ | ✓ | ✓ | no |
| `view_reports` | View reports | ✓ | ✓ | ✓ | ✓ | ✓ | no |
| `manage_incidents` | Manage incidents | ✓ | ✓ | ✓ | ✓ | ✓ | no |
| `manage_deliveries` | Manage deliveries | ✓ | ✓ | ✓ | ✓ | ✓ | no |
| `manage_recipes` | Manage recipes & menu | ✓ | ✓ | ✓ | | | RLS on recipes, ingredients, tags, menu, recipe_sites |
| `manage_checklists` | Manage checklists | ✓ | ✓ | | | | RLS on templates, items, 4-weekly reviews, notification rules |
| `sign_off` | Sign off checklists | ✓ | ✓ | | | | RLS: delete others' completions |
| `manage_documents` | Manage documents | ✓ | ✓ | | | | RLS on documents (see [Document](../entities/document.md)) |
| `manage_suppliers` | Manage suppliers | ✓ | ✓ | | | | RLS on suppliers |
| `manage_team` | Manage team | ✓ | ✓ | | | | RLS on invites, profiles (update), training_records |
| `view_documents` | View documents | ✓ | | | | | RLS on documents — **much wider than the label**, Gotcha 3 |
| `manage_sites` | Manage sites | ✓ | | | | | RLS `sites_write` |
| `manage_roles` | Manage roles | ✓ | | | | | RLS on overrides (and `roles` in the repo, not live — Gotcha 6) |
| `manage_billing` | Manage billing | ✓ | | | | | no |

Presets come from `seed_business_roles()` (live DB) and `PRESET_CAPS` (`src/lib/permissions.ts:70-78`); the two
must match (comment at `permissions.ts:62-69`). Live data, 2026-10-13: 424 roles, 14 of them custom.

## How it works

1. **Business created** → five preset roles seeded (`seed_business_roles`). The signing-up user becomes the Owner.
2. **Invite** → `create_invite(email, role)` (RPC; caller must be owner/manager by the *text* role; tier `owner`
   is refused). The client then patches `invites.role_id` and `invites.site_id` (`src/app/(dashboard)/team/page.tsx:111-121`,
   `settings/members-roles.tsx:502-511`). Email via edge function `send-invite`.
3. **Join** → `join_with_invite(token, name)` inserts the profile with `role_id` (or the tier's preset if none),
   adds `member_sites` from `invite.site_id`, marks the invite used. A business with exactly one site grants it
   automatically (`grant_default_site_membership`).
4. **Change role** → client sets `profiles.role_id` (`members-roles.tsx:195`, mobile `team_tab.dart:645`);
   `sync_profile_role_text` rewrites `profiles.role`; `guard_owner_role_assignment` allows moving someone *into*
   an owner-tier role only if the actor is an owner or group admin.
5. **Overrides** → stored in `member_capability_overrides` (needs `manage_roles`). No client writes them yet (Gotcha 2).
6. **Remove member** → RPC `remove_member` (mobile only; owner/manager by text role; cannot remove an owner or
   yourself). Deletes their pending invites, then hard-deletes the profile; if other rows reference it, soft-removes
   instead: `removed_at = now()`, `role_id`, `site_id` cleared, `is_group_admin = false`. Channel identities are
   revoked by trigger `trg_revoke_channel_identities`.
7. **Every query** → RLS combines business (`get_my_business_id()`), capability (`has_capability(cap)`), site
   (`can_see_site_row(site_id)`) and subscription (`is_business_entitled`, write policies `entitlement_write_gate_*`).

## Where it is enforced

| Layer | What is checked | Location |
|---|---|---|
| Database — capabilities | `has_capability(cap)` in RLS of the tables listed above | `20260714130300_rbac_rls_swap.sql`, `20260714130400_rbac_fix_kitchen_business_level.sql` |
| Database — legacy tier | `get_my_role()` / `is_business_manager()` / `is_active_business_manager()` (text role in owner/manager) | `create_invite`, `remove_member`, live `roles_write`, `haccp_setup_sessions`, WhatsApp/Telegram tables, `haccp_plan_shares` (inspector links), storage delete on `documents` bucket |
| Database — site scope | `can_see_site_row`, `can_list_site` | `20260901120000_site_membership_fallback.sql:22-28`, `20260802140000_sites_membership_scoped.sql:34-45` |
| Database — guards | owner assignment, group-admin escalation, role delete, capability names | triggers on `profiles` and `roles` (see Terms) |
| Web UI | tier string only: `isManager` / `canManageRecipes` (`src/hooks/use-auth.ts:204-205`), sidebar/command palette `managerOnly`, page-level checks (suppliers, checklists, recipes, documents, incidents, team, haccp-setup, haccp-pack, site sign-off) | e.g. `src/components/layout/sidebar.tsx:52,77`, `src/app/(dashboard)/settings/page.tsx:48` |
| Mobile | tier string only (`isManager`, `canManageRecipes`) | `haccp-mobile/lib/models/profile.dart:92-96` |
| Edge functions | text role in owner/manager | `haccp-assistant/index.ts:37-38`, `team-create-channel-member/index.ts:14-22`, `whatsapp-sync-flows/index.ts:298`, `_shared/haccp-plan/handler.ts:25-37` |

## Gotchas

1. **UI and database disagree.** The DB enforces capabilities; the UI shows/hides by tier. A custom role or an edited
   preset changes what the DB allows but not what the screens show (e.g. a Chef given `manage_checklists` can save
   templates through the API but never sees the editor). New code: check capabilities, not the tier text.
2. **Overrides exist only in the database.** Nothing in web or mobile writes `member_capability_overrides`.
3. **`view_documents` is really "owner-level documents".** It lets you see every document, update any document,
   delete documents and remove per-person document access — not "view only" as the label says. Only Owner has it.
4. **Group admins count as owners in two guards** (`guard_owner_role_assignment`, `guard_group_admin_escalation`),
   while the UI treats `is_group_admin` as scope only. Every owner was back-filled as group admin (38 live).
5. **⚠ Possible owner escalation via invites (unverified end-to-end).** `invites` is writable by anyone with
   `manage_team` (Managers), including `role_id`. `join_with_invite` *inserts* the profile with that `role_id`, and
   the owner guard fires only `BEFORE UPDATE`. So a manager could invite an address they control with the Owner role.
   `create_invite` refuses tier `owner`, but the client patches `role_id` afterwards.
6. **Live DB differs from the repo.** Repo `roles_write` checks `has_capability('manage_roles')`
   (`20260714130200_rbac_functions.sql:47-50`); the live policy checks `get_my_role() in (owner, manager)`.
   `get_my_role()` and `remove_member()` exist live but in no repo migration.
7. **"Start from Owner" creates an owner-tier custom role** (`members-roles.tsx:267,276,318-327`) — anyone given it
   gets full access whatever boxes are ticked, because tier `owner` short-circuits `has_capability`.
8. **Removed members keep database access.** `get_my_business_id()` does not check `removed_at`; the web does not
   sign them out (`use-auth.ts:46-68`) and the web members lists do not filter them. Mobile does sign them out
   (`haccp-mobile/lib/providers/auth_provider.dart:34-38`). Only mobile can remove a member.
9. **Five capabilities are not enforced anywhere** (`complete_checklists`, `view_reports`, `manage_incidents`,
   `manage_deliveries`, `manage_billing`) although the role editor offers them.
10. **Multiple owners are allowed**; `manage-subscription` and `delete-account` just check the caller is an owner.
11. **`sites.manager_id`** is set (back-filled to the owner) but no permission code reads it.
12. **The test invite token `123456` is reusable** by design (`join_with_invite`, `20260411095739_test_invite_123456.sql`).

## History

- 2026-08-02 `rbac_member_access_guard` — only owner/group admin may edit site memberships or grant group admin.
- 2026-07-17 `guard_owner_role_assignment`; 2026-07-16 two-way role text sync.
- 2026-07-14 RBAC: `roles`, presets, `has_capability`, overrides, `member_sites`, RLS swap from tier to capabilities.
- 2026-07-07/12 multisite foundation: `sites`, `is_group_admin`, site-scoped RLS.
- No dedicated RBAC spec; rationale lives in the migration header comments. Paywall vs tier: `docs/ENTITLEMENT_MATRIX.md`.
