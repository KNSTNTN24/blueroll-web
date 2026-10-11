# Telegram group checklists — Design Spec

**Date:** 2026-10-11 · **Status:** draft for review · **Decisions:** Kostya (11.10.2026)
**Builds on:** `2026-10-10-telegram-checklists-design.md`, `2026-10-11-telegram-live-list-design.md` (the live list is
implemented first; a group is one more kind of chat for it).

## 1. Goal

A manager creates Telegram groups such as "Kitchen", "BOH", "FOH", adds the right staff, and links each group to the
checklists it owns. **Anyone in the group can fill in that group's checklists.** Staff turnover is handled by group
membership: added = can fill in, removed = can't. No per-person QR codes.

Success criteria:
- A manager links a group and picks its checklists in under two minutes.
- A new hire added to the group can fill in a check without anyone touching Blueroll.
- Every record still names the person who did it.
- Someone removed from the group can no longer submit, even from a form they already opened.

## 2. Decisions

| Topic | Decision |
|---|---|
| Who can fill in | Any current member of a linked group, for that group's checklists. |
| Access control | Telegram's own: the manager owns the group and turns off "add members" for members (admins invite; optional "approve new members"). The bot warns when members can invite, and checks membership before every form open and submit. |
| Which checklists | A **separate mapping**: Settings → "Telegram groups" → per group, a list of checklists. Stored in its own table; existing checklist settings and assignments are not touched. A checklist may be mapped to several groups. |
| Personal reminders | A checklist mapped to any linked group gets **no personal Telegram reminder** and is left out of personal Telegram lists. App and WhatsApp behaviour unchanged. |
| Who is recorded | The Telegram user who submitted. If they already have a Blueroll identity in this business, that profile; otherwise a **channel-only staff profile is created automatically** from their Telegram name ("Anna K."), visible in Team, renamable/removable by the manager. |
| New person | Managers are alerted the first time a new person submits in a group: "New in Kitchen: Anna K. filled in Fridge & Freezer Temperatures." |
| Group messages | The live list (one per group and site), reminders as list reposts, as in the live-list spec. Done lines show who did it. |
| Check-in / shifts | Out of scope (later, after the group pilot). |

## 3. Linking a group

1. Settings → Telegram groups → **Link a group** shows a 6-digit code and short steps.
2. The manager adds @BluerollChecksBot to the group and sends `/link 123456` there.
3. The bot checks the code (15 min, one use, same brute-force limit as personal codes, per chat), stores the group,
   replies in the group "Linked to <business>. A manager will choose which checks this group does.", and checks the
   group's permissions (§6).
4. The group appears in Settings with its Telegram title; the manager ticks its checklists.

Unlinking: "Unlink" in Settings, or the bot being removed from the group (`my_chat_member` update → status `left`/`kicked`).
On unlink the bot deletes its live lists in that group (best effort) and forgets the group.

Group-related bot commands (privacy mode stays on, so the bot only sees commands): `/link <code>`, `/checks` (repost the
group's lists), `/help`. Everything else in a group is ignored.

## 4. Filling in from a group

Inline `web_app` buttons only work in private chats, so group lists use **URL buttons to the bot's Mini App direct link**:
`https://t.me/BluerollChecksBot/<app>?startapp=<token>` (`<app>` is a Mini App registered once in BotFather with
`/newapp`, URL `https://app.blueroll.app/tg/form`). The Mini App reads `startapp` from `initDataUnsafe.start_param` and
uses it exactly like `?t=` today. Token charset is already `[A-Za-z0-9_-]`, length ≤ 64.

Group form tokens: one per (group, site, template, period), minted for the live list; **not bound to a person**. Open and
submit both:
1. Verify `initData` (as today) → Telegram user id.
2. `getChatMember(group chat id, user id)`: allowed statuses `creator`, `administrator`, `member`, or `restricted` with
   `is_member: true`. Otherwise 403 "You're no longer in this group."
3. Check the template is still mapped to the group and the group still linked.
4. Submit: atomic take (first submit wins; a second person sees "Already submitted ✓ by Anna"), resolve or create the
   person (§5), record with `source = 'telegram'`, alerts as today, refresh the group's live list.

## 5. People

- Lookup: an active `channel_identities` row (`channel = 'telegram'`, `external_id = user id`) in this business → its profile.
- Otherwise create a channel-only member (the same path as `team-create-channel-member`: auth user without password,
  profile in the business, no site restriction) named from Telegram `first_name` + last-name initial, plus a
  `channel_identities` row with `consent_source = 'group_form'`. The form shows, the first time only, a one-line notice:
  "Your name will be recorded with checks in <business>'s food safety records." Submitting = consent.
- If the Telegram account is already linked to **another** business: 409 "This Telegram account is connected to another
  Blueroll team." (known MVP limit: one business per Telegram account).
- Removed profiles (`removed_at`) are not reused; a new one is created if the person comes back.

## 6. Group permissions check

On link, and on the first cron run each day per group, the bot calls `getChat` and reads `permissions.can_invite_users`.
If members can invite: one message in the group ("Anyone in this group can add people. To keep checks safe, an admin
should turn off 'Add members' for members in group settings.") and the same note to managers; at most once a day.

## 7. Data

- `telegram_groups`: `id`, `business_id`, `chat_id text unique`, `title`, `linked_by`, `linked_at`,
  `last_permission_warning_at`, `unlinked_at`.
- `telegram_group_checklists`: `group_id` (cascade), `template_id` (cascade), PK both.
- `telegram_group_link_codes`: `code`, `business_id`, `issued_by`, `expires_at`, `used_at`, `created_at`;
  RPC `issue_group_link_code()` for active managers (same CSPRNG code generation as `issue_link_code`).
- `channel_form_tokens`: new `group_id uuid null`; `profile_id` becomes nullable with a check
  `(profile_id is not null) <> (group_id is not null)`; kind `'group_checklist'`.
- `channel_live_lists.profile_id` null for group rows (already allowed by the live-list spec).
- RLS: managers of the business read/write groups and mappings and issue codes; everything else service role only.

## 8. Web

Settings → **Messaging** tab (the Telegram/WhatsApp toggles move here from Notifications) with a "Telegram groups"
section: linked groups (title, linked date), per group a checklist picker grouped by site, Unlink, and "Link a group".
Team shows auto-created group members like other members without app login, labelled "via Telegram group".

## 9. Security

Group membership is the access boundary, enforced by Telegram (who can join) and checked by us on every open/submit.
A leaked group invite link is mitigated by the permission warning, join approval, the new-person alert to managers, and
removal taking effect immediately. Tokens stay one-time and 24-hour; the page holds no credentials.

## 10. Testing

- `parseUpdate`: group `/link`, `/checks@BluerollChecksBot`, ignored group chatter, `my_chat_member` left/kicked.
- Link: valid/expired/used code, brute-force limit per chat, permission warning.
- Form: member/left/kicked/restricted, unmapped template, unlinked group, first-submit-wins with the winner's name,
  auto-profile creation, reuse of an existing identity, other-business 409, consent notice only the first time.
- Reminders: a group-mapped checklist reposts the group list and is skipped in personal lists/reminders.
- Pilot on Fern & Fig: a "Kitchen" group with Kostya and Maria; both fill in; Maria leaves the group and is blocked.

## 11. Out of scope

Shift check-in, WhatsApp groups, per-member roles inside a group, groups spanning several businesses.
