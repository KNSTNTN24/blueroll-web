# Channels: WhatsApp and Telegram

> Staff without the app do checklists in chat. **WhatsApp** = a *team* per site, each member in a 1:1 chat with the bot,
> answering in WhatsApp Flows. **Telegram** = a linked staff *group* with one shared live list, answering in a Mini App
> form. In both, any member may fill in a team/group checklist and the **first submit per period wins**.

**Touches:** [Checklist template](../entities/checklist-template.md), [Checklist completion](../entities/checklist-completion.md),
[Business](../entities/business.md) (switches), [Member](../entities/member.md) (chat-only members), [Site](../entities/site.md) ·
**Last verified:** 2026-10-13 against `main@b50e9d1` and the live DB (84 businesses: WhatsApp on 1, Telegram on 2; 1 WhatsApp
team with 2 active members; 2 Telegram groups; 12 checklist mappings; 37 published Flows; 6 identities, 4 active; 149 logged messages)

## The rule in plain words

| | WhatsApp (teams, spec 2026-10-12) | Telegram (groups, spec 2026-10-11) |
|---|---|---|
| Switch | `businesses.whatsapp_enabled` **and** entitled (`whatsapp_ready()` / `channel_ready(b,'whatsapp')`) | `telegram_enabled` and entitled (`channel_ready(b,'telegram')`) |
| Unit | `channel_groups` row, `channel='whatsapp'`, one `site_id`, no chat | `channel_groups` row, `channel='telegram'`, `chat_id` of the group, any sites |
| Who gets in | Manager adds name + phone (Settings or shares a contact with the bot) → `team_invite` template → person taps **Join** = consent | Manager issues a 6-digit code, someone sends `/link <code>` in the group; **everyone in the group** can then fill in |
| What they get | Morning list 1 h before the team's earliest deadline (08:00 if none); one "overdue" nudge at each deadline (within 1 h); 🎉 or missed summary at day end | The live list is reposted 30 min before each deadline; silently edited every 10 min; 🎉 when all done |
| How they answer | WhatsApp Flow (one per template × site) with a `checklist` form token bound to person + team | Mini App at `/tg/form` with a `group_checklist` token bound to the group |
| First submit wins | `channel_group_takes` row per (team, template, site, period) — claimed for **every** WhatsApp team mapping that checklist at that site | The group token is single-use; the winner's first name is stored in `used_by_name` |
| Out of range | Corrective Flow to the submitter → manager alert; 30 min nudge, 60 min "No corrective action recorded" | Action is **required** in the form (`400 corrective_required`) → alert to WhatsApp-linked managers and "Alerts" groups |

Which checklists reach chat is decided **only** by `channel_group_checklists` (team/group ↔ template), never by the
template's assigned roles. Due/period/flagging rules are the shared core — see
[Checklist template](../entities/checklist-template.md) and [Checklist completion](../entities/checklist-completion.md).

## Tables

| Table | Holds | Key columns / rules |
|---|---|---|
| `channel_identities` | Person ↔ WhatsApp number / Telegram user id | `profile_id`, `channel` (`whatsapp`/`telegram`, `CHECK`), `external_id` (E.164 digits or TG user id), `consent_at`, `consent_source` (default `qr_code`; written today: `team_invite`, `group_form`), `consent_text_version` (always 1), `linked_by`, `last_inbound_at` (24 h window), `revoked_at`. One active per (business, channel, external id) and per (profile, channel); a WhatsApp number is active in **one business only** (`uq_channel_identity_whatsapp_active`). Read: managers + self. No client writes. |
| `channel_link_codes` | Legacy per-person 6-digit link codes | `code ~ '^[0-9]{6}$'`, `profile_id`, `site_id`, `expires_at` = +15 min, `used_at`. Issued by `issue_link_code()`. **Retired** (Gotcha 2). |
| `channel_groups` | A WhatsApp team or a Telegram group | `channel`, `chat_id` (required for Telegram), `site_id` (required for WhatsApp), `title` (non-blank for WhatsApp), `alerts` (Telegram "Alerts" group), `linked_by/at`, `last_permission_check_at`, `last_permission_warning_at`, `unlinked_at` (= unlinked / team deleted). Trigger `trg_guard_channel_groups_update`: clients may only flip `alerts` and set `unlinked_at` once; on INSERT it stamps creator and times. Clients insert only WhatsApp teams (policy `managers create whatsapp teams`). |
| `channel_group_members` | WhatsApp team members | `phone` (`^[0-9]{10,15}$`), `status` `invited`/`active`/`removed`, `invited_by/at`, `joined_at`, `removed_at`, `last_invite_sent_at` (resend ≤ 1/h), `unreachable_at` (Meta 131026/131047/131051). Clients may only set `status='removed'` (trigger `trg_guard_channel_group_members_update`). |
| `channel_group_link_codes` | Telegram group link codes | 6 digits, 15 min, one use, `issue_group_link_code('telegram')` only; 5 wrong codes per chat per hour → locked (`tg-group-bot.ts:22-23,45`). |
| `channel_group_checklists` | Which templates a team/group does | PK (group, template). Insert policy: same business, group linked, and for a WhatsApp team the template is business-wide or at the team's site. |
| `channel_group_takes` | First-submit-wins claims (WhatsApp) | PK (group, template, site, `period_key`); several-a-day checklists use `period#1`, `#2`… (`team-day.ts:75-77`). Service role only; deleted after 60 days. |
| `channel_group_events` | Once-only team messages | PK (group, kind, key): `morning:<member id>` + local date, `overdue` + `<template>:<period>`, `day_end` / `day_end_app` + date. Claim-then-send, released on retryable failure. |
| `channel_group_reminders_sent` | Telegram reminder once per (group, template, site, period) | Service role only; 60-day cleanup. |
| `channel_live_lists` | The one Telegram list message per (group, site) | `message_id`, `list_date`, `tokens` (template → token), `rendered_hash` (or `celebration:<ms>`). |
| `channel_flows` | WhatsApp Flow per template × site | `flow_id`, `items_hash`, `item_ids`, `status` `published`/`error`/`unsupported`, `error`, `prev_flow_id` + `prev_replaced_at` (old Flow kept 25 h, then deprecated). |
| `channel_form_tokens` | One-off form links | `token` (32 hex, `crypto.randomUUID`), `kind` `checklist` / `corrective` / `group_checklist`, owner `profile_id` and/or `group_id` (`CHECK` per kind), `site_id`, `template_id`, `item_ids`, `response_id` (corrective), `expires_at` (+24 h), `used_at`, `used_by_name`. Service role only. |
| `channel_messages_log` | Every in/out message, dedupe and billing | `direction`, `kind`, `template_name`, `billable`, `ref_id`, `wa_message_id` (inbound dedupe `uq_channel_inbound_msg`; Telegram uses `grp:<update id>`). Managers read. Kept 12 months. |
| `channel_reminders_sent` | Old per-person reminders | History only since 2026-10-12 (last row 2026-10-11). |

Plus `businesses.whatsapp_enabled` / `telegram_enabled` (guards `trg_guard_whatsapp_enabled`, `trg_guard_telegram_enabled`:
active owner/manager by text role) and `profiles` trigger `trg_revoke_channel_identities`. All tables also have `created_at`/`sent_at`-style timestamps.

## How it works

1. **Turn on.** Settings → Messaging (`src/app/(dashboard)/settings/whatsapp-settings.tsx:54-79`). The WhatsApp toggle shows only
   when `NEXT_PUBLIC_WHATSAPP_NUMBER` is set (`src/lib/whatsapp/client.ts:8`); switching it on calls `whatsapp-sync-flows {all:true}`.
2. **WhatsApp team.** Settings → WhatsApp teams (`whatsapp-teams.tsx`, `src/lib/whatsapp/teams.ts`): create team (name + site),
   tick checklists, add a person → edge `whatsapp-team-member` → `addPersonToTeam` (`_shared/channels/team-members.ts:58-71`):
   reuse the profile if the number is linked in this business, else create a chat-only member (Kitchen Staff preset,
   `members.ts:16-60`), upsert `invited`, send `team_invite`. Managers can also share a contact with the bot (`team-admin.ts`).
3. **Join = consent.** Quick reply `join:<member id>` from **that** phone, within 14 days of the last invite (`team-members.ts:82-105`):
   revoke the number's other identities, insert identity `consent_source='team_invite'`, member `active`, drop the number's team rows
   in other businesses, tell the inviter.
4. **Telegram group.** Manager gets a code (`src/lib/telegram/groups.ts:44-48`), adds `@BluerollChecksBot`, sends `/link <code>`
   (`tg-group-bot.ts:42-63`). Relinking to another business clears mappings and expires the old list's tokens. Bot checks daily
   whether members can add people and warns the group + managers (`tg-group-bot.ts:26-38`).
5. **Cron** `whatsapp-reminders`, every 10 min (pg_cron, `x-cron-secret` from vault): WhatsApp teams (`team-cron.ts:35-123`),
   WhatsApp corrective follow-ups (`whatsapp-reminders/index.ts:61-112`), Telegram groups (`tg-cron.ts:16-87`), housekeeping
   (`:114-133`). Cron `whatsapp-sync-flows` 03:30 daily republishes changed Flows and deprecates replaced ones.
6. **WhatsApp submit** (`bot.ts:240-298`): token taken atomically by owner only (`db.ts:146-152`) → still an active member,
   checklist still mapped, same site → still open (completion from **any** source closes it) → claim take → `recordCompletion`
   `source='whatsapp'` → corrective Flow per flagged answer → 🎉 if that closed the day.
7. **Telegram submit** (`form-api.ts:51-172`): signed `initData` (≤ 24 h, `telegram.ts:184`) → token → group still linked →
   `getChatMember` (still in the group) → unused/unexpired → checklist still mapped, item ids unchanged → answers + corrective
   validated → `takeGroupToken` → unknown Telegram user becomes a chat-only member with identity `consent_source='group_form'`
   (consent text shown in the form, `form-api.ts:29,82-83`) → record `source='telegram'` → list refresh.
8. **Billable** = a WhatsApp *template* sent outside the person's 24 h window since `last_inbound_at` (`service-window.ts:5-6`,
   `team-members.ts:31`, `alerts.ts:45`). Free-form replies, 🎉 and the inviter note go only inside the window. Telegram is free.
   Live: 3 of 44 WhatsApp template sends were billable.
9. **Removal.** Profile soft-removed or moved business → `revoke_channel_identities_on_profile_change` revokes all identities; profile
   deleted → cascade. Team "Remove" sets `status='removed'` (identity kept, open forms answer "You're no longer in …").
   `STOP` revokes the identity (`bot.ts:319`). Unlinking a Telegram group from the web sets `unlinked_at`; the cron deletes its lists.

## Known drift (live data, 2026-10-13)

- `consent_source`: `group_form` 2 (Telegram, active), `team_invite` 1 (active), `qr_code` 3 (1 active WhatsApp from the retired
  link flow, 2 Telegram revoked by the groups migration). `consent_text_version` is 1 everywhere.
- `channel_messages_log.kind` still holds retired kinds (`reminder` 41, `link`, `link_fail`); `team_overdue`, `team_all_done` not seen yet.
- `channel_link_codes`, `channel_group_link_codes`: 0 rows (cleaned by housekeeping). `channel_form_tokens`: 33 rows, 15 used.
- Repo and live agree on columns, policies, triggers and both cron jobs.

## Gotchas

1. **The old per-person WhatsApp flow is gone.** Role-assigned reminders, QR/LINK codes and "30 min before deadline" personal
   reminders were replaced by teams on 2026-10-12 (`bot.ts:1-4`, `whatsapp-reminders/index.ts:2-5`). Only Telegram groups still
   remind 30 min before a deadline (`reminders.ts:4`). Personal Telegram chats were dropped on 2026-10-11 (migration `20261011130000:175-176`).
2. **Dead but live:** `issue_link_code()`, `revoke_channel_identity()`, edge `team-create-channel-member`, `channel_link_codes` and
   `channel_reminders_sent` have no caller in web or mobile. `whatsapp_ready()` and `channel_ready()` duplicate each other.
3. **A Telegram group is the security boundary.** Anyone the group admits can fill in checks and is auto-created as a Blueroll
   Kitchen Staff member on first submit. Only a warning protects it ("Add members" on).
4. **Telegram "first submit wins" is per token, not per checklist.** `authorize` never re-checks whether the period is already
   done, and a silent list refresh (`tg-live.ts:141-172`) does not expire tokens of checklists completed elsewhere — an open form
   can still record a second completion for 24 h; two groups mapping the same checklist each hold a token. WhatsApp teams do check
   (takes span all WhatsApp teams at the site + any-source completions), but nothing spans WhatsApp ↔ Telegram.
5. **Corrective follow-ups are WhatsApp-only** and app completions never get `corrective_status`. [#79](https://github.com/KNSTNTN24/blueroll-web/issues/79)
6. **Removal leaves team rows "Active".** Revoking identities (soft removal, `STOP`, number moved) does not touch
   `channel_group_members`; the person just stops receiving messages because `recipients()` needs an active identity
   (`teams-db.ts:217-231`). Removed members keep app/DB access. [#57](https://github.com/KNSTNTN24/blueroll-web/issues/57)
7. **Manager checks use the text role** (`is_active_business_manager`, `isManager`, edge functions), not capabilities. [#55](https://github.com/KNSTNTN24/blueroll-web/issues/55)
8. **Flows go stale on every template save** (items are deleted and re-inserted): the bot sends "only in the app" until the
   per-save or nightly sync republishes (`bot.ts:209-214`). A required `photo` item makes the Flow `unsupported`; channels never ask `photo`/`initials`.
9. **WhatsApp morning list skips nothing-open days and invited members**; the missed summary is capped at 23:50 local and the overdue
   nudge is skipped if the cron is down more than 1 h after the deadline (`team-day.ts:10-17`).
10. **No mobile UI.** Mobile has no channel code; the web Team page shows WhatsApp team / "via Telegram group" columns.

## Where it is enforced

| Layer | What is checked | Location |
|---|---|---|
| Database | switches, group/member column guards, mapping site rule, single active identity, revoke on removal, unique takes/events | triggers + policies above; `20261010120000`…`20261012140000` migrations |
| Edge functions | Meta signature (`whatsapp-webhook`), Telegram secret header (`telegram-webhook`), `initData` + group membership (`channel-form`), cron secret, owner/manager JWT (`whatsapp-team-member`, `whatsapp-sync-flows`) | `supabase/functions/*`, `_shared/channels/*`, `_shared/checklists-core/*` |
| Web UI | Messaging settings, teams, groups, Mini App form | `settings/{whatsapp-settings,whatsapp-teams,telegram-groups}.tsx`, `src/app/tg/form/` |
| Mobile | nothing | — |

## History

- 2026-10-12 WhatsApp teams (`2026-10-12-whatsapp-teams-design.md`, `20261012140000_whatsapp_teams.sql`; main `b50e9d1`).
- 2026-10-11 Telegram groups + live list + Mini App (`2026-10-11-telegram-groups-design.md`, `20261011130000_channel_groups.sql`).
- 2026-10-10 Telegram personal chats (`2026-10-10-telegram-checklists-design.md`, `20261011120000_telegram_channel.sql`) — superseded.
- 2026-10-09 WhatsApp per-person checklists, Flows, corrective, cron (`2026-10-09-whatsapp-checklists-design.md`, `20261010120000/120100`).
