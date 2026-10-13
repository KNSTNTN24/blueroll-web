# Member (`profiles`) and Invite (`invites`)

> A person on a business's team: the owner who signed up, a manager or cook who joined with an invite code,
> or a "chat only" member who only uses WhatsApp/Telegram. An **invite** is the 6-digit code that lets someone join.

**Tables:** `profiles` (1 row per `auth.users` row), `invites`, `staff_checkins`, `training_records` ·
**Scope:** business (primary site in `site_id`, real site scope in `member_sites`) ·
**Last verified:** 2026-10-13 (review pass) against `main@b50e9d1` and the live DB (154 profiles, 76 invites)

## What it is for

A member is how Blueroll knows *who* did a check, signed off, received a delivery or reported an incident, and what
they may do. Permissions (role, tier, capabilities, overrides, site scope) are described once in
[Tiers, roles and capabilities](../concepts/roles-and-capabilities.md) — this page does not repeat them.

## Parameters

| Field (UI label) | DB column | Meaning | Allowed values | Enforced by / written by |
|---|---|---|---|---|
| — | `id` | Same uuid as `auth.users.id`. | — | FK `profiles_id_fkey` `ON DELETE CASCADE` |
| Email | `email` | Copied from `auth.users` at creation; never re-synced. Channel-only members get a synthetic `wa+<uuid>@noreply.blueroll.app` / `tg+…` (web shows "Chat only", `src/app/(dashboard)/team/page.tsx:313`). | text, not null | `setup_business`, `join_with_invite`, `_shared/channels/members.ts:47` |
| Name | `full_name` | Display name everywhere (team lists, HACCP Plan, who-did-it). | text | onboarding; web Settings → Profile (first + last joined); mobile `auth_provider.dart:340-352` |
| Role (legacy) | `role` | Tier as text. **Still what both UIs gate on.** | `owner`, `manager`, `chef`, `kitchen_staff`, `front_of_house` | DB `CHECK profiles_role_check`; two-way synced with `role_id` by `sync_profile_role_text` |
| Role | `role_id` | The real role (preset or custom). | `roles.id` | FK `ON DELETE SET NULL`; see [roles](../concepts/roles-and-capabilities.md) |
| Business | `business_id` | The one business this person belongs to. One login = one business, for life. | uuid, not null | FK `ON DELETE CASCADE` |
| Primary site | `site_id` | "Home" site: default for new rows (trigger `set_site_id_default` → `get_my_site_id()`), web Team tabs filter by it. **Not** the access scope — that is `member_sites`. | `sites.id` or null | FK `ON DELETE SET NULL` |
| Full estate access | `is_group_admin` | Sees every site. Set for multi-site owners at onboarding (web `onboarding/page.tsx:743`, mobile `auth_provider.dart:255`) and by owners in Settings/Team. | bool, default false | trigger `guard_group_admin_escalation` |
| Certifications | `certifications` | Free-text training badges shown on the web Team page; "trained" = has one matching `/food hygiene/i` **and** one matching `/allergen/i` (`team/page.tsx:23,103`). | text[] | **no writer in either app** (Gotcha 6) |
| Preferences | `preferences` | Per-person display settings. Keys: `language` (`en-GB`), `timezone` (`Europe/London`), `temp_unit` (`celsius`), `date_format` (`DD/MM/YYYY`). | jsonb object | written by web Settings only (`settings/page.tsx:61-79`); **read by nothing else** |
| Avatar | `avatar_url` | Storage path (not a URL) in bucket `avatars` (fallback `documents`); raw http URLs pass through. | text | mobile only (`auth_provider.dart:349`, `widgets/member_avatar.dart:63-66`); web ignores it |
| Removed | `removed_at` | Soft-removal stamp from `remove_member`. Null = active. | timestamp | RPC `remove_member` (live only, Gotcha 9) |

Timestamps `created_at`, `updated_at` (trigger `update_profiles_updated_at`) also exist.

**Invite** (`invites`): `email` (lower-cased by `create_invite`), `role` (tier text, `CHECK` same five values; `create_invite`
refuses `owner`), `role_id` (real role, patched in by the client after creation), `site_id` (site scope, patched in),
`token` (6 digits since 2026-05-31; default is still a 64-char hex; `UNIQUE`), `expires_at` (now + 7 days),
`used_at`, `invited_by` (FK to `profiles`, **no** `ON DELETE` — blocks hard-deleting an inviter), `business_id`, `created_at`.

### Known drift (live data, 2026-10-13)

- `profiles.role`: owner 75, manager 27, kitchen_staff 24, chef 14, front_of_house 14. No row has `role_id` null or a tier mismatch. 1 business has 2 owners.
- `preferences`: 1 profile has keys (all four); 153 are `{}`. `certifications`: 3 profiles (values `Allergen Awareness` 3, `HACCP` 2, `Food Hygiene L3` 2, `Food Hygiene L2` 1). `avatar_url`: 4 (all storage paths).
- `removed_at`: **0** rows soft-removed. 3 channel-only profiles. 3 emails with upper case.
- Site scope: 37 profiles have no `member_sites` row (= see the whole business, by the fallback); 22 have a `site_id` that is not among their `member_sites`; 15 have `site_id` null.
- `auth.users` 157 vs profiles 154: 3 logins with no profile (abandoned or failed join — Gotcha 4).
- `invites`: 76 total — 45 used, 30 expired unused, 1 active; 53 six-digit, 23 legacy 64-hex; `role_id` null on 64 (pre-RBAC);
  1 used **after** its expiry (Gotcha 2). Test token `123456` belongs to a live business with 8 members, `expires_at` in 2099.
- `staff_checkins.mood`: `Smooth` 46, `Rough` 33, `Busy` 22, null 19, and legacy emoji `😎` 50, `😊` 46, `💪` 13, `😴` 9, `🔥` 9, `🤒` 3. Canonical: `Smooth`/`Busy`/`Rough` (web `dashboard/page.tsx:15`, mobile `site_dashboard.dart:258-262`); mobile colours unknown values as Smooth (`utils/mood.dart`).
- `staff_checkins`: 250 rows, 151 never checked out (150 older than yesterday); 5 user-days with 2 open check-ins. `training_records`: **0 rows**.

## Lifecycle

**Signup → profile.** No trigger creates a profile (`auth.users` only has `trg_ntfy_auth_user_created`, a signup push to ntfy).
Every path inserts it explicitly:

| Path | How | Role / site |
|---|---|---|
| Owner, web | `supabase.auth.signUp` then RPC `setup_business` (`src/app/(auth)/onboarding/page.tsx:682,707`) | `owner`; business insert seeds preset roles + one default site; `consume_trial`, `seed_default_checklists`. Multi-site: client then sets `is_group_admin`, deletes the default site, inserts the real ones and invites managers (`:743-770`) |
| Owner, mobile | `AuthNotifier.setupBusiness` / `setupBusinessGroup` → same RPC (`haccp-mobile/lib/providers/auth_provider.dart:125,235-305`) | same |
| Join, web + mobile | signUp then RPC `join_with_invite(token, name)` (`onboarding/page.tsx:693`, `auth_provider.dart:168`) | `invites.role_id` or the tier's preset; `site_id` + `member_sites` from the invite; single-site business auto-granted by `grant_default_site_membership` |
| Chat-only (WhatsApp) | edge `team-create-channel-member` (owner/manager by text role, non-owner role, live site) → `createChannelOnlyMember` (`supabase/functions/_shared/channels/members.ts:43-60`): service-role `auth.admin.createUser` with a synthetic email, **banned for 100 years**, `app_metadata.channel_only`, then profile + `member_sites` (rolled back on failure). Also from Settings → WhatsApp teams (`teams-db.ts:209`) | chosen role |
| Chat-only (Telegram) | created on a person's first submit of the group form (`_shared/channels/groups-db.ts:272`) | `defaultStaffRole` → Kitchen Staff preset |

**Invite lifecycle.** `create_invite(p_email, p_role)` (owner/manager by *text* role; tier must not be owner; 6-digit
token unique among *active* invites; 7-day expiry) → client patches `role_id`/`site_id` by token
(`team/page.tsx:111-121`, `settings/members-roles.tsx:502-511`, mobile `ops_provider.dart:167-185`) → edge
`send-invite` emails the code and a link `/onboarding?invite=CODE` via Resend (`send-invite/index.ts:28-29`) — best-effort,
the code works without it → `join_with_invite` marks `used_at`. Test token `123456` is never marked used (reusable).
Neither app lists, resends or revokes pending invites (only `update … eq('token')` patches exist); expired rows are never cleaned up.

**Changed:** name (self), role/site/group admin (managers/owners — see roles page), preferences (self, web), avatar (self, mobile).

**Removed:** RPC `remove_member(p_profile)` — **mobile only** (`haccp-mobile/lib/features/ops/team_tab.dart:625`). Caller
owner/manager by text role; target not an owner, not self. Deletes all invites to the target's email in that business, then
tries a **hard delete** of the profile; on any FK violation falls back to **soft removal** (`removed_at = now()`, `site_id`,
`role_id` null, `is_group_admin` false). Hard delete succeeds only when nothing non-cascading references the person
(no completions, sign-offs, recipes, incidents, sent invites, reviews, diary signatures, …) and then **cascades**: their
uploaded documents, check-ins, training records, notifications, `member_sites`, overrides, channel identities/links,
HACCP-plan share links. `deliveries.received_by`, `menu_items.attested_by`, `haccp_signoffs.signed_by`, `sites.manager_id` are set null.
Either way the **`auth.users` row stays**. Soft removal revokes channel identities (trigger `trg_revoke_channel_identities`).
Business deletion (`delete-account` → 30 days → `purge_deleted_businesses`) deletes all profiles **and** their auth users.

**Check-ins** (`staff_checkins`: `user_id`, `business_id`, `site_id`, `date` default `CURRENT_DATE`, `checked_in_at`,
`checked_out_at`, `mood`): a person picks a mood to check in and taps it again (web) or "Check out" (mobile) to leave; managers
are notified. Web inserts without `site_id` (trigger fills the primary site) and finds "today" by `checked_in_at` ≥ local
midnight (`dashboard/page.tsx:83,121-123`); mobile sets the current site and dedupes by `date` (`checkin_provider.dart:70-90`).
No automatic check-out; no delete policy.

**Training records** (`training_records`: `profile_id`, `safe_method`, `trained_at`, `trained_by`, `notes`): table, RLS and
purge exist, but **no web or mobile code reads or writes it**; 0 live rows. The HACCP Pack's training answer comes from
`training`/`certificate` [documents](document.md) instead.

## Who can do what

| Action | Rule | Enforced in |
|---|---|---|
| See profiles | own row; every profile of my business; the demo business's profiles | RLS `Users can view own profile`, `Users can view business profiles`, `demo_read` |
| Create own profile | `id = auth.uid()` and target business entitled | RLS `Users can create own profile`, `entitlement_write_gate_ins` (normally via the SECURITY DEFINER RPCs) |
| Edit own profile | any column of own row | RLS `Users can update own profile` (no `WITH CHECK`) — Gotcha 1 |
| Edit others | `manage_team` in same business | RLS `Admins can manage member profiles`; guards on owner role / group admin |
| Remove | owner/manager by text role | RPC `remove_member` (no `DELETE` policy on `profiles`) |
| Invites | create: owner/manager by text role (RPC); read/patch/delete: `manage_team` | `create_invite`; RLS `Managers can manage invites` |
| Check in / out | self, own business, visible site; see check-ins of visible sites | RLS on `staff_checkins` |
| Training records | see: business members (not site-scoped); write: `manage_team` | RLS on `training_records` |

## Related

- **Concepts:** [Tiers, roles and capabilities](../concepts/roles-and-capabilities.md) (role, overrides, `member_sites`, group admin).
- **Entities:** [Document](document.md) (`uploaded_by` cascades), [Checklist template](checklist-template.md) (assignees, sign-off), Business, Site, Channel identity (planned).
- **Channel identities:** `channel_identities` links a profile to a WhatsApp number / Telegram user (the old one-time `channel_link_codes` flow is retired — see [Channels](../concepts/channels.md)); revoked on soft removal or business change. Live: WhatsApp 2 active, Telegram 2 active + 2 revoked.
- **Demo:** every signed-in user can *read* the showcase business `a8ff4795-…` (`src/lib/demo.ts:8`, migration `20260824120000_demo_mode_read_policies.sql`); it has a single owner profile and no demo staff. `demo_force_exit` hides it for 24 h. Cron `demo-daily-refresh` keeps it fresh and trims its check-ins to 45 days.

## Where in code

| Area | Location |
|---|---|
| Web | `src/app/(auth)/onboarding/page.tsx`, `src/app/(dashboard)/team/page.tsx`, `settings/members-roles.tsx`, `settings/page.tsx` (profile, preferences), `dashboard/page.tsx` (check-in), `src/hooks/use-auth.ts` |
| Mobile | `lib/providers/auth_provider.dart`, `providers/ops_provider.dart`, `features/ops/team_tab.dart`, `providers/checkin_provider.dart`, `screens/auth/setup_screen.dart` (legacy), `models/profile.dart` |
| Edge | `send-invite`, `team-create-channel-member`, `_shared/channels/members.ts`, `delete-account`, `purge-deleted-businesses` |
| DB | `setup_business`, `join_with_invite`, `create_invite`, `remove_member`, `sync_profile_role_text`, `guard_*`, `grant_default_site_membership`, `revoke_channel_identities_on_profile_change`, `_on_auth_user_created` |

## Gotchas

1. **⚠ Members can rewrite their own profile (unverified end-to-end).** `Users can update own profile` has no `WITH CHECK`
   and no column limits, and the owner guard only blocks owner-tier roles. Reading the policies, a Kitchen Staff member can
   set their own `role_id` to the Manager preset, or their `business_id` to any entitled business id they know. Likewise a
   fresh login with no profile can `INSERT` itself into any entitled business with any `role_id` (owner guard is `UPDATE` only; cf. #50).
2. **Invite expiry is not enforced.** `join_with_invite` checks only `used_at`, not `expires_at` (1 live invite used after expiry),
   and does not compare the signup email to `invites.email` — anyone holding the 6 digits joins. Live: 31 expired 6-digit
   codes are still joinable, and there is no rate limit on guessing codes. [#69](https://github.com/KNSTNTN24/blueroll-web/issues/69)
3. **`123456` is a live back door** into a real business (8 members) as Kitchen Staff, forever (`expires_at` 2099).
   Separately, the legacy mobile `/setup` screen (reached after login with no profile) treats `123456` as a local
   "team access" flag and opens the dashboard **without joining anything** (`screens/auth/setup_screen.dart:188-195`).
4. **Signup happens before join/setup.** If `join_with_invite` fails (bad code), the web leaves a login with no profile and a
   retry says "already registered" (`onboarding/page.tsx:682-700`). 3 such live logins.
5. **`send-invite` sends any email to anyone.** It only checks that an `Authorization` header is present and trusts `to`, `code`,
   names (inserted into the HTML unescaped) from the body (`send-invite/index.ts:3-4,20-32`). It is deployed with
   `verify_jwt = false`, so the public anon key alone passes (same for `create-subscription`). [#65](https://github.com/KNSTNTN24/blueroll-web/issues/65)
6. **`certifications` has no writer.** Web shows it (and counts "trained") but neither app edits it; mobile ignores it. **`preferences`**
   is saved but no screen uses it (no °F, timezone or date-format rendering).
7. **Hard delete can destroy records.** A removed member with no blocking history is deleted and their uploaded documents cascade
   away (see [Document](document.md), [#114](https://github.com/KNSTNTN24/blueroll-web/issues/114)); their login survives, so they can sign in again and start a new business.
   A soft-removed member cannot rejoin anywhere ("User already has a profile"). Removed members keep web access
   ([#57](https://github.com/KNSTNTN24/blueroll-web/issues/57)); a soft-removed manager also keeps the text-role powers, because `remove_member` nulls `role_id` but
   leaves `profiles.role`, and `get_my_role()` ignores `removed_at`.
8. **Web Settings → Sites "Add site" invite is lost:** it calls `create_invite` but never sends the email, attaches the site or shows
   the code (`settings/sites-settings.tsx:307-309`). Also `create_invite` checks uniqueness only among active invites while `token` is
   globally `UNIQUE` — a collision with one of 52 old six-digit tokens fails the insert instead of retrying.
9. **Live-only objects:** `remove_member`, `get_my_role`, and the columns `removed_at`, `certifications`, `avatar_url` are in no repo migration (#59).
10. **Check-ins never close** on their own (150 stale open rows inflate "on shift" counts on mobile, which reads by `date`); web and mobile
    disagree on what "today" means and on which site a check-in belongs to. Legacy emoji moods remain in data.
11. **Single-site owners are not group admins** (only the one-off back-fill and the multi-site onboarding set it): 37 of 75 owners are group admins.

## History

- 2026-10-10 WhatsApp channel: chat-only members, `trg_revoke_channel_identities` (`20261010120000_whatsapp_channel.sql`).
- 2026-08-24 demo mode read policies. 2026-08-02 member access guard.
- 2026-07-14 RBAC: `role_id`, `member_sites`, invites `role_id` (`20260714150000_rbac_phase3_invites_and_guard.sql`); 2026-07-13 `preferences` jsonb.
- 2026-07-12 account deletion purge (`2026-07-12-account-deletion-design.md`); 2026-07-07 `site_id`, `is_group_admin`, invites `site_id`.
- 2026-05-31 `create_invite` RPC, 6-digit tokens (`20260531_create_invite_rpc.sql`); 2026-04-11 reusable test token `123456`.
