# Incident (`incidents`) and Notification (`notifications`)

> **Incident:** something that went wrong in the kitchen (a burn, a broken fridge, a customer complaint), what was done
> about it, and whether it is closed. **Notification:** a line in a person's in-app inbox ("New incident reported",
> "Overdue checklist") with a link to the thing it is about.

**Tables:** `incidents` · `notifications` (+ unused `notification_rules`) · **Scope:** incident = site row of a business;
notification = one person · **Last verified:** 2026-10-13 (review pass) against `main@b50e9d1` and the live DB
(35 incidents in 8 businesses; 9,467 notifications for 57 people, 647 read)

## What it is for

Incidents are the SFBB "problems and changes" log: an inspector expects to see what happened and the action taken.
They show on the Incidents page, the dashboard "Open incidents" feed, the estate dashboard and the Diary.
Notifications are the only alerting system for people inside the app: rows written by the client (or an edge function)
that each app polls. There is **no push and no email** behind them (Gotcha 9).

## Parameters — Incident

| Field (UI label) | DB column | Meaning | Allowed values | Enforced by |
|---|---|---|---|---|
| Type | `type` | Complaint from a customer vs internal incident. | `complaint`, `incident` | DB `CHECK incidents_type_check` (the only enforcement; `INCIDENT_TYPES` `src/lib/constants.ts:69` is unused). Mobile derives it: `Complaint` category → `complaint` (`haccp-mobile/lib/providers/ops_provider.dart:20,145`) |
| Category | `category` | What kind of problem. | `Injury`, `Equipment`, `Illness`, `Complaint`, `Other` (capitalised), default `Other` | DB `CHECK incidents_category_chk`; mobile `_kCategories` `features/ops/incidents_tab.dart:17`. **Web never sets or shows it** |
| Severity | `severity` | How bad. | `low`, `medium`, `high`, `critical`, default `medium` | DB `CHECK incidents_severity_chk`. **Web never sets or shows it** |
| Description | `description` | What happened. Mobile writes `"<title> — <description>"` when a title is typed (`ops_provider.dart:83`). | text, required | `NOT NULL` |
| Action taken, Follow-up | `action_taken`, `follow_up` | Immediate fix and what happens next. | text | web form only; mobile never writes them |
| Date | `date` | Day it happened (can be back-dated on web). | date, default `CURRENT_DATE` (UTC) | web form; mobile leaves default |
| Status | `status` | Open or closed. | `open` (default), `resolved` | nowhere (no `CHECK`); both apps write only these two |
| Resolved by / at / note | `resolved_by`, `resolved_at`, `resolved_notes` | Who closed it, when, and how. Cleared on reopen. | profile id / timestamp / text | client code only (`incidents/page.tsx:128-130,144`, `ops_provider.dart:104-128`) |
| Reported by | `reported_by` | Who logged it; gets the "resolved" notice. | profile id | RLS insert requires `= auth.uid()`; FK no cascade |
| Site | `site_id` | Which premises. Null on insert → reporter's site. | uuid | trigger `trg_site_id_default` (`set_site_id_default()`); FK `ON DELETE CASCADE` |

Also `id`, `business_id` (FK cascade), `created_at`, `updated_at` (written by mobile only; no trigger maintains it).

## Parameters — Notification

| Field | DB column | Meaning | Allowed values | Enforced by |
|---|---|---|---|---|
| Recipient | `user_id` | The one person who sees it. | profile id | FK `ON DELETE CASCADE`; RLS select/update `user_id = auth.uid()` |
| Type | `type` | Drives icon and grouping (`src/lib/notification-meta.tsx:26-36`, mobile `features/notifications/notif_meta.dart`). | `checklist`, `checkin`, `team`, `incident`, `document`, `delivery`, `signoff`, `critical` (+ `haccp` in an uncalled web helper) | nowhere (no `CHECK`) |
| Title, Message | `title`, `message` | Text shown. Each app has its own wording and casing (Known drift). | text | — |
| Read | `read` | Cleared by clicking it or "Mark all read" (web `notif-bell.tsx:45-54`, `notifications/page.tsx:55-64`; mobile `providers/notif_provider.dart:32-41`). | bool, default false | — |
| Link | `link` | In-app path to open. | `/checklists[/<template id>]`, `/incidents[/<id>]`, `/documents[/<id>]`, `/dashboard`, `/team`, `/settings`, `/haccp-pack` or null | nowhere; trigger `trg_resolve_checklist_notif_link` rewrites bare `/checklists` |

Also `id`, `created_at`. No `business_id` and no `site_id`: a notification is personal and business-wide.

### Known drift (live data, 2026-10-13)

- `incidents`: all values inside the canonical sets; `type` and `category` agree on every row (7 complaint/Complaint).
  16 rows have the defaults `medium`/`Other` (web-created). 1 row is `resolved` with no `resolved_at`. No null `site_id`.
- `notifications.type`: `checklist` 8,654, `checkin` 673, `team` 78, `incident` 52, `document` 7, `delivery` 1, `signoff` 1,
  `critical` 1. The last three (one row each, demo-style titles) are written by no code in either repo.
- Titles exist twice: mobile Title Case (`New Incident Reported` 16, `Staff Checked In` 434) and web sentence case
  (`New incident reported` 19, `Staff checked in` 55). `Overdue Checklist` alone is 6,301 rows (67%) — Gotcha 7.
- `link`: 352 still bare `/checklists` (trigger could not resolve the name), 596 null, 17 `/incidents/<id>`.
- `notification_rules`: **0 rows**. `diary_entries`: 4 rows, 1 business, March 2026. `four_weekly_reviews`: 0 rows.

## Lifecycle

**Incident created by:** web `/incidents` slide-over (type, description, action, follow-up, date; `site_id` = current
site or null in "All sites" → trigger fills it) — `src/app/(dashboard)/incidents/page.tsx:99-114`; mobile Ops → Incidents
report sheet (title, category, severity, description) — `providers/ops_provider.dart:11-26,75-101`. The old mobile
`screens/incidents/incidents_screen.dart` still has an insert but is not routed. No edge function, RPC or channel creates incidents.

**Changed:** web edit (type, description, action, follow-up, date — `page.tsx:102-106`); mobile edit (description,
category, severity, type — `ops_provider.dart:137-150`). **Resolve** sets status + resolver + time + note, **Reopen**
clears them (both apps). **Deleted:** both apps call `delete()`, but there is **no DELETE policy** — Gotcha 1.
Business purge deletes incidents (`purge_deleted_businesses`); a hard-deleted site cascades its incidents.

**Notification created by** (always a plain `insert` from whoever acts; nothing server-side reacts to table changes):

| Event | Web (`src/lib/notifications.ts`) | Mobile (`utils/notification_helper.dart`) | Edge functions |
|---|---|---|---|
| Incident reported → owners+managers | `notifyNewIncident` `:37`, link `/incidents` | `onNewIncident` `:153`, link `/incidents/<id>`, reporter excluded | — |
| Incident resolved → reporter | `notifyIncidentResolved` `:42` | `onIncidentResolved` `:173` | — |
| Check-in / out → managers | `:27-35` (dashboard) | `:120-147` | — |
| Flagged item / sign-off required | `:53-61` (checklist fill) | `:209-242` | flagged: `_shared/checklists-core/record.ts:33-37` (WhatsApp/Telegram completions) |
| Overdue checklist, expiring document | `:46,63` — **never called** | `:191,245` from `utils/startup_checks.dart` — see Gotcha 7 | team day-end "checks missed" `_shared/channels/team-cron.ts:94-98` |
| Member joined | `notifyNewMember` — never called | `onNewMemberJoined` (`providers/auth_provider.dart:194`) | inviter fallback `team-members.ts:117`; Telegram group notes `groups-db.ts:76-78` |

Recipients are picked by **tier text** `profiles.role in ('owner','manager')` (web `notifications.ts:3-10`, mobile `:34-38`,
edge `channels/db.ts:79-82`), not by capability or site. Only the edge version skips removed members.

**Link fix-up:** `BEFORE INSERT` trigger `trg_resolve_checklist_notif_link` (`resolve_checklist_notif_link()`, live-only,
not in migrations — [#59](https://github.com/KNSTNTN24/blueroll-web/issues/59)) parses the checklist name out of the
message (`… is past its deadline`, `… in X is out of range`, `… completed X`) and swaps `/checklists` for
`/checklists/<template id>`. Web overdue/sign-off wording (`"X" has not been completed`, `"X" needs your sign-off`) does not match.

**Read / deleted:** opening marks read; there is no delete in either app and **no DELETE policy**, so the inbox only grows.
Web shows the latest 50 (bell, polled every 60 s — `notif-bell.tsx:24-31`) or 500 (`/notifications`); mobile 50.
Rows go with the profile (FK cascade) or business purge.

## Who can do what

| Action | Rule | Enforced in |
|---|---|---|
| See incidents | business member who can see the site; anyone on the demo business | RLS `Business members can view incidents`, `demo_read` |
| Report | any member, as themselves, on a visible site, business entitled | RLS `Business members can create incidents`, `entitlement_write_gate_ins` |
| Edit / resolve / reopen | **any** member who can see the site (business entitled) | RLS `incidents_update`, `entitlement_write_gate_upd` |
| Delete | nobody (no policy) | — |
| UI | web: Resolve/Reopen for all, Edit/Delete for tier owner/manager (`page.tsx:43,483-490`); mobile: everything for all (`incidents_tab.dart:559-571`) | client only |
| See / mark read own notifications | recipient | RLS `Users can view own notifications`, `Users can update own notifications` |
| Create a notification | **any signed-in user, for any `user_id`** | RLS `Authenticated users can insert notifications` (`WITH CHECK true`) |

The `manage_incidents` capability ("Log and resolve incidents", `src/lib/permissions.ts:27,44`) is in every preset
(`BASE_CAPS` `:70`) but **no policy or screen checks it** — see [roles and capabilities](../concepts/roles-and-capabilities.md).

## Related

- **Entities:** [Business](business.md) (`notification_prefs`), [Site](site.md), [Member](member.md) (recipients, check-ins),
  [Checklist completion](checklist-completion.md) (flagged/sign-off notices), [Document](document.md) (expiry notices).
- **Not in:** the HACCP Plan (`supabase/functions/_shared/haccp-plan/` never reads incidents), Reports (`/reports` has no
  incident section), the HACCP Pack. Incidents appear only in the Diary (web `diary/page.tsx:66-93`, mobile
  `screens/diary/diary_screen.dart:38-44`, PDF `utils/diary_export.dart:49`) and dashboards.
- **Channels:** WhatsApp/Telegram reminders are sent by `whatsapp-reminders` (cron every 10 min) straight to the
  channel; they only touch `notifications` in the cases in the table above. Channel pages (identity, group, teams) are planned.
- **Not this:** `_ntfy_push()` triggers (`20260523_ntfy_push_notifications.sql`) push signups and subscription changes to
  the founder's phone via ntfy.sh — an internal alert, not customer notifications.

### Related, barely used

- **`notification_rules`** (`trigger_type`, `trigger_config jsonb`, `recipient_roles`, `channels` default `{in_app}`, `active`):
  from `001_initial_schema.sql:236`. 0 rows; no code in web, mobile or edge functions reads or writes it.
- **`diary_entries`** (`date`, `opening_done`, `closing_done`, `notes`, `signed_by`, `site_id`; unique per business+day):
  4 rows from March 2026. No current code writes it — the Diary page is built from completions and incidents instead.
- **`four_weekly_reviews`** (`period_start/end`, `summary`, `action_items jsonb`, `reviewed_by/at`): 0 rows, no code.
  The 4-weekly review lives as a `four_weekly` checklist template instead (`ai-generate-checklist/index.ts:45`).

## Where in code

| Area | Location |
|---|---|
| Web | `src/app/(dashboard)/incidents/page.tsx`, `notifications/page.tsx`, `src/components/layout/notif-bell.tsx`, `src/lib/notifications.ts`, `src/lib/notification-meta.tsx`, `settings/notifications-settings.tsx` |
| Mobile | `providers/ops_provider.dart`, `features/ops/incidents_tab.dart`, `utils/notification_helper.dart`, `utils/startup_checks.dart`, `providers/notif_provider.dart`, `features/notifications/` |
| Edge | `_shared/checklists-core/record.ts`, `_shared/channels/{db,team-cron,team-members,groups-db}.ts` |
| DB | `incidents_*_chk`, `trg_site_id_default`, `trg_resolve_checklist_notif_link`, RLS above |

## Gotchas

1. **Deleting an incident does nothing.** No DELETE policy on `incidents`; the delete matches 0 rows without error and
   both apps toast "Incident deleted" (`page.tsx:151-153`, `incidents_tab.dart:680-692`). The row returns on refresh. [#87](https://github.com/KNSTNTN24/blueroll-web/issues/87)
2. **Anyone can resolve, reopen or rewrite any incident** on a site they see — staff included; `manage_incidents` is decorative. [#87](https://github.com/KNSTNTN24/blueroll-web/issues/87)
3. **Web and mobile capture different halves.** Web writes action taken, follow-up and date but no severity/category
   (everything is `medium`/`Other`); mobile writes severity/category but no action/follow-up. Editing on mobile re-derives
   `type` from category, so a web complaint left as `Other` silently becomes an `incident`. [#87](https://github.com/KNSTNTN24/blueroll-web/issues/87)
4. **Notification insert is open to every signed-in user** (`WITH CHECK true`): any account can drop a notification with
   any title and link into any user's inbox, including other businesses'. Web follows the link with `router.push` unchecked. [#82](https://github.com/KNSTNTN24/blueroll-web/issues/82)
5. **Mobile incident links 404 on web.** Mobile writes `/incidents/<id>`; the web has no such route (17 live rows).
   Conversely mobile ignores `/settings` links. Notification texts are duplicated in web and mobile and parsed by a DB
   trigger to build links. [#108](https://github.com/KNSTNTN24/blueroll-web/issues/108)
6. **Recipients are by tier text**, not capability or site: custom roles with `manage_incidents` get nothing, managers of
   other sites get everything, and web/mobile helpers still notify removed members ([#57](https://github.com/KNSTNTN24/blueroll-web/issues/57), [#88](https://github.com/KNSTNTN24/blueroll-web/issues/88)).
7. **Overdue and expiry notices come from a client loop.** `StartupChecks` fires on each device once per day, per business,
   ignoring site, frequency and the business time zone — 6,301 duplicates-prone "Overdue Checklist" rows. In current mobile
   source its only caller, `screens/dashboard/dashboard_screen.dart:28`, is no longer routed, yet rows still arrive (last
   2026-10-12), presumably from older installed builds *(unverified)*. The last expiry notice (type `document`) is from 2026-07-30 and
   has the web wording ("… expires in 14 days"), so `notifyExpiringDocument` was called at least once; it has no caller in
   current code (see [Document](document.md)) ([#58](https://github.com/KNSTNTN24/blueroll-web/issues/58), [#61](https://github.com/KNSTNTN24/blueroll-web/issues/61), [#88](https://github.com/KNSTNTN24/blueroll-web/issues/88)).
8. **"Critical" means nothing.** Severity `critical` triggers no special notice; settings promise "Critical alerts — high-risk
   incidents" (`notifications-settings.tsx:15`) but no code writes type `critical`.
9. **No push, no email.** No FCM/APNs package in `pubspec.yaml`, no device-token table, `notifications` is not in the
   realtime publication; web polls every 60 s. Resend is used only by `send-invite` and `send-feedback`. The Settings
   email/push toggles (`businesses.notification_prefs`) are saved and never read ([#75](https://github.com/KNSTNTN24/blueroll-web/issues/75), [#88](https://github.com/KNSTNTN24/blueroll-web/issues/88)).
10. **Notification failures are swallowed.** Web awaits the insert but ignores its error; mobile wraps it in `try/catch`
    or fires it un-awaited. A report always succeeds even if nobody is told.
11. Only 7% of notifications are ever read; nothing expires or deletes them.

## History

- 2026-10-12 WhatsApp teams: day-end "checks missed" app notice to managers (`2026-10-12-whatsapp-teams-design.md`).
- 2026-10-11 Telegram groups: "new person" notes to managers (`2026-10-11-telegram-groups-design.md`).
- 2026-07-12 entitlement write gate on `incidents`, `notification_rules` (`20260712180200_entitlement_write_gate.sql:102-110`).
- 2026-07-12 site-aware incident RLS (`20260712100200_multisite_site_rls_compliance.sql:34-43`); 2026-07-07 `site_id` added.
- 2026-07-11 web notification bell + page redesign (`0bdf137`); 2026-07-06 incidents detail view (#12–#14).
- Severity, category, status/resolution columns and the link trigger exist live only (not in migrations, [#59](https://github.com/KNSTNTN24/blueroll-web/issues/59)).
- 2026-04 initial schema (`001_initial_schema.sql`): incidents, notifications, notification_rules, diary_entries, four_weekly_reviews.
