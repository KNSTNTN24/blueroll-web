# Telegram = group checklists with a live list — Design Spec

**Date:** 2026-10-11 · **Status:** draft for review · **Decisions:** Kostya (10–11.10.2026)
**Replaces** the personal-chat model of `2026-10-10-telegram-checklists-design.md` for Telegram. WhatsApp keeps the
personal model and is unchanged. The Mini App form, form API, Telegram adapter, alerts and reminders cron are reused.

## 1. Goal

Telegram works **only through groups**. A manager creates groups such as "Kitchen", "BOH", "FOH", adds staff, links each
group to Blueroll and picks the checklists it owns. **Anyone in the group can fill in that group's checklists.** Each
group has **one live list message per site** that shows what is left today, updates itself silently and disappears when
everything is done. Staff turnover is handled by group membership.

Success criteria:
- A manager links a group and picks its checklists in under two minutes.
- A new hire added to the group can fill in a check without anyone touching Blueroll.
- Every record names the person who did it.
- Someone removed from the group can no longer submit, even from a form they already opened.
- At any time a group holds at most one list message per site; the phone only notifies on a reminder or `/checks`.

## 2. Decisions

| Topic | Decision |
|---|---|
| Personal chats | **Dropped for Telegram.** No personal linking, reminders or lists. Any private message gets: "Blueroll checks happen in your team's Telegram group. Ask your manager to add you." |
| Who can fill in | Any current member of a linked group, for that group's checklists — regardless of checklist assignments in the app. |
| Access control | Telegram's own: the manager owns the group and turns off "add members" for members (optional "approve new members"). The bot warns when members can invite and checks membership on every form open and submit. |
| Which checklists | A **separate mapping** (own table, Settings → Messaging → Telegram groups). Existing checklist settings and assignments are not touched. A checklist may be mapped to several groups. |
| Who is recorded | The Telegram user who submitted: their existing Blueroll profile in this business if linked, else an **auto-created channel-only staff profile** from their Telegram name. |
| Several businesses | Allowed: one Telegram account can be a member in any number of businesses (one profile per business). |
| New person | Managers are alerted the first time a new person submits in a business. |
| First submit wins | A second person opening the same checklist sees "Already submitted ✓ by Anna". |
| Out-of-range alerts | Sent **to the group where the check was filled in** and **to every group marked "Alerts"** in that business (an alerts group may have no checklists). App push/email unchanged; WhatsApp managers unchanged. |
| Check-in / shifts | Out of scope (after the group pilot). |

## 3. Linking a group

1. Settings → Messaging → Telegram groups → **Link a group** shows a 6-digit code and the steps.
2. The manager adds @BluerollChecksBot to the group and sends `/link 123456` there.
3. The bot checks the code (15 min, one use; at most 5 failed attempts per chat per hour), stores the group, replies
   "Linked to <business>. A manager will choose which checks this group does.", and runs the permission check (§8).
4. The group appears in Settings with its Telegram title; the manager ticks its checklists and/or "Alerts".

Unlinking: "Unlink" in Settings, or the bot removed from the group (`my_chat_member` → `left`/`kicked`). The bot deletes
its live lists in that group (best effort) and marks the group unlinked. A group migrated to a supergroup
(`migrate_to_chat_id`) keeps its link under the new chat id.

Bot commands in groups (privacy mode stays on, so the bot only sees commands): `/link <code>`, `/checks` (repost this
group's lists), `/help`. Everything else in a group is ignored.

## 4. The live list

One message per **(group, site)**:

```
📋 Wharf Side — 2 of 5 done
🔴 Fridge & Freezer Temperatures · due 10:00
🟠 Hot Holding Checks · due 12:00
⚪ Cleaning Schedule · due 23:00
⚪ Weekly Deep Clean
✅ Daily Opening Checks · 08:47 Anna
✅ Delivery Check · 09:05 Alex

[ 🔴 Fridge & Freezer Temperatures ]
[ 🟠 Hot Holding Checks ]
[ ⚪ Cleaning Schedule ]
[ ⚪ Weekly Deep Clean ]
```

- Contents: the group's mapped checklists at that site that are due in the current period (`dueChecklists` with the group
  mapping instead of person assignment) plus those completed in the current period (any source: Telegram, app, web).
- Header `📋 <b>site</b> — <done> of <total> done`; HTML parse mode, all dynamic text escaped.
- Open lines sorted: overdue, due soon, later with a deadline (by deadline), no deadline (by name).
  🔴 deadline passed · 🟠 deadline within 30 min · ⚪ later or no deadline. Time shown as a clock time (`due 10:00`),
  never a countdown, so the text only changes on a state change.
- App-only checklists (required photo, nothing fillable): `· app only`, no button.
- Done lines last: `✅ <name> · <HH:MM> <first name>`.
- One URL button per open fillable checklist: `<icon> <name>` (64-char clip) → Mini App direct link (§5).

**Repost** (reminder or `/checks`) for (group, site): render → `sendMessage` (notifies) → upsert the row → `deleteMessage`
the previous one (best effort). Nothing is sent if there are no open items; `/checks` then answers
"Nothing is due right now 👍" once.

**Refresh** (every reminders cron run, every 10 min; and right after a form submit for that group and site):
1. List from a previous local day (site timezone) → delete message and row.
2. No open items → delete message and row (everything done).
3. Rendered hash unchanged → nothing.
4. Otherwise `editMessageText` (silent) and store the hash.

Telegram errors: "message to edit/delete not found" or "can't be deleted" → drop the row (the next reminder or `/checks`
posts a fresh list); "message is not modified" → success; 403 / "bot was kicked" → unlink the group; anything else →
keep the row, retry next run.

**Reminders:** 30 min before a mapped checklist's deadline, once per (group, template, site, period) → repost that
group's list for that site. Planned with the existing planner logic over groups instead of people.

## 5. Filling in from a group

Inline `web_app` buttons only work in private chats, so the list uses **URL buttons to the Mini App direct link**
`https://t.me/BluerollChecksBot/<app>?startapp=<token>`. `<app>` is registered once in BotFather (`/newapp`, URL
`https://app.blueroll.app/tg/form`). The page reads `Telegram.WebApp.initDataUnsafe.start_param` (falls back to `?t=`).

Group tokens: one per (group, site, template, period), minted for the live list and kept until the list is reposted;
24 h TTL; not bound to a person. Open and submit both:
1. Verify `initData` (unchanged) → Telegram user id.
2. `getChatMember(group chat id, user id)`: allowed `creator`, `administrator`, `member`, or `restricted` with
   `is_member: true`; otherwise 403 "You're no longer in this group."
3. Group still linked and the template still mapped; otherwise 410 "This check was moved — open the list again."
4. Submit only: atomic take (loser gets "Already submitted ✓ by <first name>"), resolve or create the person (§6),
   record (`source = 'telegram'`), alerts (§2), refresh the group's list. No "Recorded ✓" chat message.

## 6. People

- Lookup: active `channel_identities` row (`channel = 'telegram'`, `external_id = user id`, this business) → its profile.
- Otherwise create a channel-only member (same path as `team-create-channel-member`: auth user without password,
  profile in the business) named from Telegram `first_name` + last-name initial, and a `channel_identities` row with
  `consent_source = 'group_form'`. The form shows, the first time in a business only: "Your name will be recorded with
  checks in <business>'s food safety records." Submitting = consent.
- Removed profiles are not reused; a new one is created if the person comes back.
- Uniqueness becomes per business: one active identity per (business, channel, external id).

## 7. Removing the personal Telegram flow

- Team: no "Connect Telegram" QR; "Add staff without app login" offers WhatsApp only (hidden while WhatsApp is off).
  The Team channel column shows WhatsApp, and "via Telegram group" for auto-created members.
- Bot: `/start <code>` and any private message → the "use your team's group" reply. The private `/checks`, `/stop` and
  personal reminder paths for Telegram are removed.
- Existing personal Telegram identities are revoked by the migration (pilot only: Fern & Fig).
- Settings: a new **Messaging** tab holds the Telegram/WhatsApp toggles (moved from Notifications) and Telegram groups.

## 8. Group permissions check

On link, and on the first cron run each day per group, `getChat` → `permissions.can_invite_users`. If members can invite:
one message in the group ("Anyone in this group can add people. To keep checks safe, an admin should turn off 'Add
members' for members in group settings.") and the same note to managers (app notification); at most once a day.

## 9. Data

- `telegram_groups`: `id`, `business_id`, `chat_id text unique`, `title`, `alerts boolean default false`, `linked_by`,
  `linked_at`, `last_permission_warning_at`, `unlinked_at`.
- `telegram_group_checklists`: `group_id` (cascade), `template_id` (cascade), PK both.
- `telegram_group_link_codes`: `code`, `business_id`, `issued_by`, `expires_at`, `used_at`, `created_at`; RPC
  `issue_group_link_code()` for active managers (same CSPRNG generation as `issue_link_code`).
- `telegram_group_reminders_sent`: PK (`group_id`, `template_id`, `site_id`, `period_key`).
- `channel_live_lists`: `id`, `group_id` (cascade), `site_id` (cascade), `list_date date`, `message_id text`,
  `tokens jsonb` (`{template_id: token}`), `rendered_hash`, `created_at`, `updated_at`; unique (`group_id`, `site_id`).
- `channel_form_tokens`: new `group_id uuid null`; `profile_id` nullable with check
  `(profile_id is not null) <> (group_id is not null)`; kind `'group_checklist'`.
- `channel_identities`: replace `uq_channel_identity_active (channel, external_id)` with
  `(business_id, channel, external_id) where revoked_at is null`.
- RLS: managers of the business read/write groups, mappings, the alerts flag, and issue codes; the rest service role only.

## 10. Testing

- `parseUpdate`: group `/link`, `/checks@BluerollChecksBot`, ignored chatter, `my_chat_member` left/kicked, migration,
  any private message → help reply.
- Link: valid/expired/used code, failure limit per chat, permission warning.
- Live list: renderer (order, icons, app-only, done lines, counts, escaping, clip, stable hash); refresh decision;
  repost sends then deletes; error mapping.
- Form: member/left/kicked/restricted, unmapped template, unlinked group, first-submit-wins with the winner's name,
  auto-profile, existing identity reuse, a person in two businesses, consent notice only the first time.
- Alerts: to the source group and every alerts group, once each.
- Reminders: per group, once per period; personal Telegram reminders gone; WhatsApp unchanged.
- Pilot on Fern & Fig: "Kitchen" group (Kostya, Maria) and "Managers" alerts group; both fill in; out-of-range alert in
  both groups; Maria leaves Kitchen and is blocked; a completion in the mobile app shows ✅ within 10 min.

## 11. Out of scope

Shift check-in, the "Today" Mini App screen with colours/pulsing, WhatsApp groups, roles inside a group.
