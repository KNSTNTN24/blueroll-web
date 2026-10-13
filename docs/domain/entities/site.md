# Site (`sites`)

> One premises of a business — a café, a kitchen, a branch. A single-site café has one; a group with three
> restaurants has three. Checks, incidents, deliveries and the team's day happen *at a site*.

**Tables:** `sites`, `member_sites` (who works where) · **Scope:** business (a site belongs to exactly one business) ·
**Last verified:** 2026-10-13 (review pass) against `main@b50e9d1` and the live DB (107 sites in 81 businesses)

## What it is for

Multisite (July 2026) split the business into sites so a group can run several premises under one account and one
bill: each site has its own checklists, team, records, FSA rating and HACCP Pack, while recipes, suppliers, roles and
the subscription stay business-wide. Live: 70 businesses have 1 site, 8 have 2, 1 has 3, one has 8, one has 10;
3 live businesses have **no site at all** (2026-10-13).

## Parameters

| Field (UI label) | DB column | Meaning | Allowed values | Enforced by |
|---|---|---|---|---|
| Name | `name` | Shown in the switcher, lists, channel messages, the HACCP Plan. | text, required | DB `NOT NULL` |
| Address, Postcode | `address`, `postcode` | Where it is. Web "Add site" fills postcode from the FSA register; address only by edit. | text or null | — (76 of 107 have no postcode) |
| FSA rating | `fsa_rating` | Food hygiene rating copied from the FSA register at creation. Never refreshed. | text (`'0'`–`'5'`, or FSA strings like `AwaitingInspection`) | nowhere |
| Manager | `manager_id` | The person in charge, shown on the site panel, estate dashboard and HACCP Plan. Not a permission. | profile id or null | FK `ON DELETE SET NULL`; set only on web (`sites-settings.tsx:142`). 23 sites have one |
| Status | `status` | `onboarding` = just added, not set up yet; `active` = running; `removed` = soft-deleted (see Lifecycle). | `active`, `onboarding`, `removed` (code); `archived` (billing function) | **no DB `CHECK`**; default `'active'` |
| Removed | `removed_at` | When the site was removed. Non-null = gone from the estate, records kept. | timestamp or null | set together with `status='removed'` by web only |
| Time zone | `timezone` | IANA zone for "today", period starts and reminder times in channels (WhatsApp/Telegram). | IANA name | `NOT NULL DEFAULT 'Europe/London'` (`20261010120000_whatsapp_channel.sql:8`); no UI writes it |

Also `id`, `business_id` (FK `ON DELETE CASCADE`), `created_at` (shown as "live since").

### Known drift (live data, 2026-10-13)

- `status`: `active` 85, `onboarding` 22. **All 22 onboarding sites are older than 30 days** — nothing ever moves a site
  to `active` (Gotcha 2). No `removed` or `archived` rows exist yet; `removed_at` is null on all 107.
- `timezone`: `Europe/London` on all 107 rows.

## Lifecycle

**Created by:**

| Path | Status | Seeds checklists? | Where |
|---|---|---|---|
| Business insert → trigger `trg_business_default_site` → `create_default_site()` | `active`, name = business name or "Main site", rating copied | no (business-level seeding does it) | `20260707175109_business_default_site.sql` |
| Web multi-site onboarding: deletes the default site, inserts one row per chosen FSA establishment, invites a manager per site (`invites.site_id` matched by postcode), owner becomes `is_group_admin`, `profiles.site_id = null` | `onboarding` | only the business-level SQL `seed_default_checklists` run by `setup_business` (no `site_id`) | `src/app/(auth)/onboarding/page.tsx:742-775` |
| Mobile multi-site onboarding: same sequence after RPC `setup_business` | `onboarding` | no | `haccp-mobile/lib/providers/auth_provider.dart:233-300` |
| Web Settings → Sites → "Add site" (FSA postcode search) | `onboarding` | **no** | `src/app/(dashboard)/settings/sites-settings.tsx:297-316` |
| Mobile Profile → Group → Sites → add (group admins; capped at 3) | `onboarding` | yes, `DefaultChecklists.seedForSite` (inactive templates, 12 s timeout) | `haccp-mobile/lib/features/sites/manage_sites_sheet.dart:20,50,407-455`, `utils/default_checklists.dart:79` |

**Edited:** web only — name, address, manager (`sites-settings.tsx:139-148`). Mobile has no edit.

**Removed (soft):** web only — `status='removed', removed_at=now()`, blocked if it is the last site
(`sites-settings.tsx:150-161`, "records kept for 4 years"). Records stay; web and mobile site lists hide
`status='removed'` (`src/hooks/use-auth.ts:81-87`, `haccp-mobile/lib/providers/sites_provider.dart:12-17`), channels
hide `removed_at is not null` (`supabase/functions/_shared/channels/groups-db.ts:206`, `teams-db.ts:139-140`).
**Deleted (hard):** only the multi-site onboarding replace step. FKs to `sites`: 25 `ON DELETE CASCADE`
(all records of the site go) and 4 `SET NULL` (`profiles`, `invites`, `feedback_requests`, `channel_messages_log`).
Business purge cascades through `business_id`.

**Billing:** `trg_sites_sync_quantity` (AFTER INSERT/DELETE) → `sites_sync_quantity()` → `pg_net` POST to edge
function `sync-site-quantity`, which sets the Stripe subscription item quantity to `billable_site_count(business)`
(= sites with `status <> 'archived'`) with proration, if the business has a Stripe `subscription_id` (7 of 84 do).
The function is deployed (v11) but its source is **not on main** (only in `web-integrate`; #59). Mobile store
pricing is tiered by site count clamped to 1–3 (`kTierPrice`, `purchase_provider.dart:33-38`). The entitlement itself
is per business: all sites open and close together (`docs/ENTITLEMENT_MATRIX.md` §5).

## Who can do what

| Action | Rule | Enforced in |
|---|---|---|
| See (list) | business member AND `can_list_site(id)`: group admin, or no `member_sites` rows (fallback: whole business), or a member of that site | RLS `sites_select`; `demo_read` for the demo business |
| Add / edit / remove / delete | `manage_sites` (Owner preset only) + business entitled | RLS `sites_write`, `entitlement_write_gate_*` |
| Assign people to sites | owner tier or group admin | RLS `member_sites_write` |
| UI | web Settings → Sites tab: `profiles.role` owner **or manager**; mobile Sites sheet: `is_group_admin` | `settings/page.tsx:45-50`, `profile_screen.dart:362-374` |

`member_sites`, `is_group_admin` and the visibility rule are explained in
[Tiers, roles and capabilities](../concepts/roles-and-capabilities.md).

## Choosing a site in the UI ("current site")

- **Web:** topbar switcher appears only when the user can list more than one site (`src/components/layout/topbar.tsx:31,88-115`);
  **"All sites"** (`currentSiteId = null`) is offered only to group admins (`topbar.tsx:100-107`). Choice is stored in
  `localStorage` key `br_current_site` (`src/stores/auth-store.ts:47-53`). Default: last choice → group admin with >1 site
  = All sites → own `profiles.site_id` → first site (`use-auth.ts:89-97`).
- **Mobile:** `currentSiteIdProvider`; same defaults (`sites_provider.dart:23-34`); "All sites" from Profile (`profile_screen.dart:316-321`).
- Lists add `.eq('site_id', currentSiteId)` when a site is chosen and no filter on All sites (checklists, incidents,
  deliveries, diary, documents, reports — e.g. `checklists/page.tsx:62`, `incidents/page.tsx:72`). All sites shows
  the estate dashboard / group views instead (`dashboard/page.tsx:63`, `haccp-pack/page.tsx:137`).

## What is per-site vs business-wide

Live DB, 2026-10-13. "Trigger" = `trg_site_id_default` (`set_site_id_default`): on INSERT a null `site_id` becomes
`get_my_site_id()` = the inserter's `profiles.site_id` (null for multi-site owners, so it can stay null).
"CSSR" = policy uses `can_see_site_row(site_id)`; no policy uses `can_list_site` except `sites_select`.

| Table | Column | Null rows | Trigger | RLS site-scoped? |
|---|---|---|---|---|
| `checklist_templates` | `site_id` (null = every site) | 71 / 1438 | yes | CSSR (select, write) |
| `checklist_instances` | `site_id` | 0 / 45 373 | yes | CSSR (select) |
| `checklist_completions` | `site_id` | 0 | yes | CSSR (all) |
| `incidents`, `deliveries`, `diary_entries`, `staff_checkins` | `site_id` | 0 | yes | CSSR (`staff_checkins` check-out update: own row only) |
| `haccp_signoffs` | `site_id` NOT NULL | 0 | yes | CSSR, **AND** restrictive manager-only policies on writes |
| `haccp_pack_data` | `site_id` (null = group pack) | 0 / 9 | yes | **no** — business only |
| `haccp_plan_shares` | `site_id` (null = whole business) | 0 | no | CSSR or null |
| `recipe_sites` | `site_id` NOT NULL | — | no | CSSR |
| `documents` | `site_id` | 0 / 148 | no | **no** — see [Document](document.md) |
| `recipes` | `site_id` (legacy; sites via `recipe_sites`) | 211 / 211 | no | no |
| `suppliers` | `site_id` | 41 / 49 | no | no |
| `menu_items` | `site_ids uuid[]` NOT NULL | 0 empty | no | no |
| `menu_categories` | `site_id` NOT NULL | — | no | no |
| `haccp_setup_sessions` | `site_id` NOT NULL | — | no | manager of business; site must belong to it |
| `member_sites` | `site_id` | — | no | site must be in my business |
| `profiles` (primary site), `invites` | `site_id` | 15 / 154, 56 / 76 | no | no |
| `channel_groups`, `channel_link_codes`, `channel_messages_log`, `channel_flows` | `site_id` | 2/3, 0, 65/150, — | no | manager of business, no site check |
| `channel_form_tokens`, `channel_live_lists`, `channel_reminders_sent`, `channel_group_reminders_sent`, `channel_group_takes` | `site_id` NOT NULL | — | no | no policies (service role only) |
| `feedback_requests` | `site_id` | 0 | no | own rows |

Business-wide by design (no site column): roles, capabilities, ingredients, tags, training records, notifications,
the subscription.

**Null `site_id`:** RLS `can_see_site_row(null)` is true only for group admins and members with no `member_sites`
rows; a member scoped to sites cannot see the row. In the UI a null row appears only under "All sites" — picking a
site hides it (`.eq('site_id', …)`), except *Set up my HACCP* which asks for `site_id = X or null`
(`src/lib/haccp-setup/api.ts:57`) and the HACCP Pack, where null is the group pack (`haccp-pack/page.tsx:162`).
The nightly `generate_checklist_instances` fans a null-site template out to **every** site of the business.

## Related

- **Entities:** [Checklist template](checklist-template.md) (null site = all sites), [Document](document.md) (site is cosmetic),
  Member (`profiles.site_id` = primary site, kept by `keep_primary_site`), Invite (`invites.site_id` → `member_sites` on join).
- **Concepts:** [Tiers, roles and capabilities](../concepts/roles-and-capabilities.md); business vs site scoping; entitlement.

## Where in code

| Area | Location |
|---|---|
| Web | `src/app/(dashboard)/settings/sites-settings.tsx`, `src/components/layout/topbar.tsx`, `src/hooks/use-auth.ts`, `src/stores/auth-store.ts`, `src/app/(dashboard)/dashboard/estate-dashboard.tsx`, onboarding `src/app/(auth)/onboarding/page.tsx` |
| Mobile | `haccp-mobile/lib/models/site.dart`, `providers/sites_provider.dart`, `features/sites/manage_sites_sheet.dart`, `providers/auth_provider.dart` |
| Edge | `sync-site-quantity` (deployed, not on main), `_shared/channels/*` (timezone), `_shared/haccp-plan/load.ts:48,128` |
| DB | `create_default_site`, `sites_sync_quantity`, `billable_site_count`, `can_list_site`, `can_see_site_row`, `set_site_id_default`, `get_my_site_id`, `grant_default_site_membership`, `keep_primary_site`, `copy_kitchen`, `generate_checklist_instances`; RLS `sites_select`, `sites_write` |

## Gotchas

1. **Removing a site keeps billing and keeps generating work.** Web writes `status='removed'`, but `billable_site_count`
   only excludes `'archived'` (a status nothing writes), and the quantity trigger fires on INSERT/DELETE, not UPDATE —
   so Stripe quantity is never lowered. `generate_checklist_instances` ignores `removed_at`/`status`, so a removed site
   keeps getting daily instances (later "missed"). The code comment "hiding it … stops billing" is false. [#74](https://github.com/KNSTNTN24/blueroll-web/issues/74)
2. **`onboarding` is a dead-end status.** Every added site starts `onboarding`; no code, RPC or trigger sets `active`.
   It only paints an "Onboarding" badge and makes the estate dashboard list the site under triage forever
   (`estate-dashboard.tsx:60,87`). 22 live sites are stuck. [#74](https://github.com/KNSTNTN24/blueroll-web/issues/74)
3. **No `CHECK` on `status`**: `removed` (web/mobile), `archived` (billing) and `active`/`onboarding` are three
   vocabularies that never meet. Filters disagree too: lists use `status`, channels and membership triggers use `removed_at`.
4. **Web "Add site" is half a flow:** no checklist seeding (mobile seeds), and the manager invite gets no `site_id` and
   no email (`sites-settings.tsx:307-309` vs onboarding / mobile which patch `invites.site_id` and call `send-invite`).
   The joining manager then lands on no site; with >1 site `grant_default_site_membership` does nothing, so they fall
   back to seeing **every** site. [#74](https://github.com/KNSTNTN24/blueroll-web/issues/74)
5. **UI gate ≠ DB gate.** Web shows the Sites tab to managers, mobile to any group admin, but only `manage_sites`
   (Owner preset) may write — a manager's "Add site" fails with an RLS error (#55).
6. **Web has no site cap, mobile caps at 3** (`kMaxSelfServeSites`); web text says "£24.99/mo per site" while store
   pricing is tiered and clamped to 3.
7. **Null-site default templates.** The SQL seed `seed_default_checklists` (called by `setup_business`) writes `site_id`
   null; `src/lib/seed-checklists.ts` is never imported. All 71 null-site templates are old default seeds in 12
   single-site businesses. They are invisible to members scoped by `member_sites` and hidden whenever a site is picked.
8. **Members with no `member_sites` row see the whole business** (fallback in both helpers, `20260901120000`). Removed
   members' memberships are not cleared (#57).
9. **`timezone` is used only by edge functions** (channel reminders, live lists, form times, HACCP Plan). The web uses
   the browser clock and the nightly generator uses the DB date in UTC; nothing lets a user change the zone.
10. **`haccp_signoffs` writes need both a site and a manager check.** The permissive `haccp_signoffs_write` (ALL,
    site-scoped) is ANDed with the *restrictive* `haccp_signoffs_manager_insert/update/delete`
    (`is_active_business_manager`, legacy tier text), so only owners/managers who can see the site can sign off.
11. **Multi-site onboarding hard-deletes the default site.** If the insert that follows fails, the business has no
    site (3 live businesses have none). The `removed_at` migration was applied directly in prod
    (`20260713110523_sites_soft_delete_removed_at.sql` is a no-op placeholder, #59).
12. FSA rating and postcode are copied once from the register and never refreshed; the business row has its own `fsa_rating`.

## History

- 2026-10-10 `sites.timezone` added for WhatsApp channel (`20261010120000_whatsapp_channel.sql`).
- 2026-09-01 membership fallback for data rows (`20260901120000_site_membership_fallback.sql`).
- 2026-08-02 sites list scoped by membership (`20260802140000_sites_membership_scoped.sql`).
- 2026-07-31 per-site menu categories and HACCP Pack (`20260731120000`, `20260731180000`).
- 2026-07-14 `member_sites`, owner-only site writes, `recipe_sites` (`20260714120000`–`20260714180000`).
- 2026-07-13 billing: `billable_site_count`, quantity sync trigger; soft delete `removed_at` (`2026-07-12-paywall-billing-design.md`).
- 2026-07-12 site RLS helpers and backfill (`20260712100000`–`20260712100300`).
- 2026-07-07 multisite foundation, default site per business (`20260707084039`, `20260707175109`).
