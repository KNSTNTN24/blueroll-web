# WhatsApp = team checklists in 1:1 chats — Design Spec

**Date:** 2026-10-12 · **Status:** draft for review · **Decisions:** Kostya (12.10.2026)
**Replaces** the role-assignment reminders of `2026-10-09-whatsapp-checklists-design.md` for WhatsApp. Telegram groups
(`2026-10-11-telegram-groups-design.md`) are unchanged. The WhatsApp Flows, corrective form, manager alerts, form tokens
and the 10-minute cron are reused.

## 1. Why not WhatsApp groups

Checked 12.10.2026 against Meta docs and the live API (prod number +44 7858 269313, WABA 1452892610306685):
- Groups API is for Official Business Accounts only: `POST /{phone}/groups` → `(#131215) This phone number is not
  eligible to access Groups APIs`.
- Groups do not support interactive messages (buttons, lists, Flows), message edit or delete; max 8 participants.

So the Telegram group UX (one shared live list, tap to fill in) cannot be built on WhatsApp now. A support request to Meta
is pending. This spec delivers the same team semantics in 1:1 chats, without groups.

## 2. Goal

A manager creates a WhatsApp **team** per site (e.g. "Kitchen — Ashfield Row"), maps checklists to it and adds people —
from Settings or by sharing a contact with the bot in their own WhatsApp. **Any active member can fill in the team's
checklists; the first submit closes the checklist for the period.** Each member gets one morning list a day, one nudge per
overdue checklist and an end-of-day result.

Success criteria:
- A manager adds a person from their WhatsApp in under 30 seconds (share contact → pick team).
- The person starts filling in checks after one tap (Join); no app, no QR, no code.
- Per member per day: one morning list + at most one message per overdue checklist + at most one end-of-day message.
- Two people never both record the same checklist for the same period through WhatsApp.
- A removed member can no longer submit, even from a form already open.

## 3. Decisions

| Topic | Decision |
|---|---|
| Groups | Not used (§1). WhatsApp group support is a later project if Meta grants access. |
| Assignment | **Teams only.** Role assignments in the app no longer drive WhatsApp. Only checklists mapped to a team reach WhatsApp. |
| Team scope | **One site per team.** A person working at two sites is in two teams. |
| Adding people | Manager, from Settings (name + phone, or an existing Team member) or from WhatsApp (share contact → pick team). No QR, no self-join. |
| Consent | The person must tap **Join** on the invite before anything else is sent. Join = consent (`consent_source = 'team_invite'`). |
| Morning list | One message per member per team per day, **1 hour before the team's earliest deadline**; 08:00 site time if no mapped checklist has a deadline. |
| Overdue | If a checklist is still open at its deadline: one message to every active member, once per (team, checklist, period). |
| Others' completions | Silent. An old button on a closed checklist answers "Already done ✓ by Anna 08:47" and the fresh menu. |
| End of day | All done → "🎉 All <team> checks done today" to each member **whose 24 h service window is open** (free); others get nothing. Something missed → summary to members and managers 1 hour after the team's latest deadline (22:00 site time if none). |
| Alerts | Out-of-range → corrective form to the submitter, then manager alert (unchanged). |
| Who manages | Owners and managers: Settings, or WhatsApp if their own number is linked. |

## 4. People and membership

- **Add.** Manager provides a name and phone (Settings), picks an existing Team member and adds a phone (Settings), or
  shares a WhatsApp contact (bot). Phone normalised to E.164 digits.
  - Number already linked in this business (active `channel_identities`, channel `whatsapp`) → reuse that profile.
  - Otherwise create a channel-only member (same path as `team-create-channel-member`: auth user without password,
    staff profile in the business, site = team site) named from the provided or contact name. No identity yet.
  - Insert `channel_group_members` row `status = 'invited'` and send the `team_invite` template with a **Join** quick
    reply (payload `join:<member id>`).
- **Join.** Inbound button `join:<member id>` from the invited phone → create or activate the `channel_identities` row
  (`consent_source = 'team_invite'`), member `status = 'active'`, `joined_at`; reply "You're in <team> at <site> ✓"; tell
  the manager who added them ("Anna joined Kitchen ✓": WhatsApp if linked and window open, else app notification).
  A join payload from any other phone is ignored. An invite older than 14 days answers "This invite has expired — ask your
  manager to add you again."
- **Remove** (Settings, or the bot's `team` → Remove): `status = 'removed'`. The identity stays (the person may be in
  other teams). Removed members get nothing more from that team, and their open forms for it fail with "You're no longer
  in <team>."
- **Resend invite** (Settings): re-sends `team_invite` for an `invited` member, at most once per hour.
- **Not reachable:** Meta errors 131026 (undeliverable) or 131047/131051 on invite or list → member flag
  `unreachable_at`; shown in Settings; cleared on the next successful delivery.

## 5. A member's day

**Morning list** (template `checklist_reminder_list`, already approved): team, site and open checklists with deadlines;
quick reply **Fill in checks**. Sent once per (team, member, site-local date). Nothing open → nothing sent.

**Filling in.** "Fill in checks" or `checks` → one menu per team in the format shipped in PR #48 (`due-menu.ts`):
header "📋 <team> · <site> — N of M done", body with every open checklist (🔴/🟠/⚪ + "due HH:MM") and done ones
("✅ <name> — HH:MM <first name>"), footer "Forms open on your phone", "Choose a check" list of up to 10 rows (title ≤24,
description = status + due time, full name when cut; "+N more" line when cut) → pick → the checklist's Flow (unchanged
builder). Submit:
1. Token valid; member still `active` in the token's team; checklist still mapped to the team.
2. Atomic take on `channel_group_takes (group_id, template_id, site_id, period_key)`. Lost, or a completion from any source
   already exists in the period → "Already done ✓ by <first name> <HH:MM>" + the fresh menu; nothing recorded.
3. Record the completion (`source = 'whatsapp'`); out-of-range → corrective flow → manager alert (unchanged).
4. If that closed the team's last open checklist today → end-of-day "all done" (§3).

**Overdue** (template `checklist_reminder`, already approved): at the checklist's deadline, still open → once per
(team, checklist, period) to every active member, with a **Fill in** quick reply.

**Missed summary** (new template `team_day_summary`): "<team> at <site> today: <done> of <total> done. Missed: <names>."
1 hour after the team's latest deadline (22:00 if none), only if something is still open. To active members and to
managers (WhatsApp if linked; always an app notification).

## 6. Manager in WhatsApp

Only for numbers linked to an active owner/manager profile of the business; anyone else gets "Only managers can add
people to teams."
- **Shared contact** (inbound `contacts` message; first contact with a phone is used) → "Add <name> (+44 7••• ••23) to
  which team?" with reply buttons (≤3 teams) or a list (4–10). One team → skip the question. No teams → "Create a team
  in Blueroll → Settings → Messaging first." Pick → §4 Add → "Invite sent to <name> ✓".
- **`team`** → one message per team: members with status; list rows "Remove <name>" (≤10 per message). Pick → confirm
  buttons "Remove" / "Cancel" → §4 Remove.

## 7. Data

- `channel_groups`: `chat_id` becomes nullable with check `channel <> 'telegram' or chat_id is not null`; new `site_id uuid
  references sites(id) on delete cascade`, check `channel <> 'whatsapp' or site_id is not null`. A WhatsApp team uses
  `title`, `site_id`, `linked_by` (= created by), `unlinked_at` (= deleted).
- `channel_group_checklists`: unchanged (shared with Telegram).
- `channel_group_members`: `id`, `group_id` (cascade), `profile_id` (cascade), `phone text`, `status` (`invited` /
  `active` / `removed`), `invited_by`, `invited_at`, `joined_at`, `removed_at`, `last_invite_sent_at`, `unreachable_at`;
  unique (`group_id`, `profile_id`).
- `channel_group_events`: PK (`group_id`, `kind`, `key`), `sent_at`. Kinds: `morning:<member id>` with key = local date;
  `overdue` with key = `<template id>:<period key>`; `day_end` with key = local date. Claim-then-send, released on failure.
- `channel_group_takes`: PK (`group_id`, `template_id`, `site_id`, `period_key`), `profile_id`, `taken_at`.
- `channel_form_tokens`: WhatsApp team tokens carry both `profile_id` (the member) and `group_id`; the check becomes
  `profile_id is not null or group_id is not null`.
- RLS: managers of the business read/write teams, mappings and members; events and takes are service role only.

## 8. Web

**Settings → Messaging → WhatsApp teams** (below the WhatsApp toggle, shown while it is on):
- "New team": name + site.
- Team card: checklists of that site (tick to map); members (name, masked phone, Invited / Active / Not reachable);
  "Add person" (name + phone, or pick from Team), "Resend invite", "Remove"; "Delete team".
- Hint: "Managers can also add people from WhatsApp — share a contact with the Blueroll bot."

**Team page:** the per-person WhatsApp QR/link code is removed; the channel column shows "WhatsApp · <team>" or "Invited".

## 9. Removing the role-based WhatsApp flow

- The cron no longer plans personal WhatsApp reminders from assignments; `channel_reminders_sent` stays for history.
- `link` codes and the per-person connect flow are retired for WhatsApp (existing identities keep working).
- `checks` for a linked person who is in no team → "You're not in a team yet — ask your manager to add you."

## 10. Templates

New, category UTILITY, `en_GB`: `team_invite` (body: business, team, site; quick reply "Join") and `team_day_summary`
(body: team, site, done, total, missed list). Reused: `checklist_reminder_list`, `checklist_reminder`, `manager_alert`,
`corrective_nudge`. Free-form text (🎉, "Already done", replies) only inside the 24 h service window.

## 11. Testing

- Planner: morning time (earliest deadline − 1 h, 08:00 fallback, site timezone, DST day), overdue once per period,
  missed summary timing, all-done only once, nothing sent to invited/removed members.
- Takes: two concurrent submits → one completion, the other "Already done by"; app completion counts as done.
- Membership: removed member's open form fails; join from another phone ignored; expired invite; resend limit.
- Manager bot: contact share by a manager / by staff; 1, 3 and 5 teams; `team` → Remove → confirm.
- Window: 🎉 only to members with an open window.
- Role-based reminders gone; Telegram unchanged.
- Pilot on Fern & Fig: team "Kitchen — Ashfield Row" with 3 checklists; Kostya adds Maria by contact; morning list, first
  submit wins, overdue, out-of-range + alert, 🎉 or missed summary, Maria removed → blocked.

## 12. Out of scope

WhatsApp groups (pending Meta), shift check-in, teams spanning several sites, per-team morning time setting.
