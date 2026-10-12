# WhatsApp Teams (team checklists in 1:1 chats) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WhatsApp checks work through per-site **teams**: a manager creates a team, maps checklists and adds people (Settings, or by sharing a contact with the bot); a person taps **Join** once, then gets one morning list a day, one nudge per overdue checklist and one end-of-day message; any active member can fill in, the first submit wins.

**Architecture:** WhatsApp teams reuse the channel-neutral group tables (`channel_groups` with `channel = 'whatsapp'`, a `site_id` and no chat) plus three new tables (members, events, takes). New pure modules over injected deps, unit-tested with in-memory fakes: a team data contract (`teams-db.ts`), a day planner (`team-day.ts`), membership (`team-members.ts`), the cron step (`team-cron.ts`) and the manager commands (`team-admin.ts`); the member side lives in the existing `bot.ts`, which loses the role-based reminders and link codes. One small edge function (`whatsapp-team-member`) lets Settings add people and resend invites (templates need the server-side token). The web gets a "WhatsApp teams" section in Settings → Messaging; the Team page loses the per-person QR connect.

**Tech Stack:** WhatsApp Cloud API (templates with quick replies, interactive list/button messages, Flows, `contacts` inbound, delivery `statuses`), Supabase Edge Functions (Deno), Postgres + RLS, Next.js 16 App Router, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-whatsapp-teams-design.md` (binding; read it before every task). Builds on `docs/superpowers/plans/2026-10-11-telegram-groups.md` (the group tables, `members.ts`, `due-menu.ts`). Execution: superpowers:subagent-driven-development.

## Global Constraints

- The spec is binding. Copy every client-facing string exactly (plain text, English, no markdown):
  - join reply `You're in <team> at <site> ✓`; to the manager who added them `<first name> joined <team> ✓` (WhatsApp if linked and window open, else app notification)
  - expired invite `This invite has expired — ask your manager to add you again.`; a join payload from any other phone is **ignored** (no reply)
  - removed member's form `You're no longer in <team>.`
  - closed checklist `Already done ✓ by <first name> <HH:MM>` followed by the fresh menu
  - all done `🎉 All <team> checks done today` — only to members **whose 24 h service window is open**
  - linked person in no team `You're not in a team yet — ask your manager to add you.`
  - staff sharing a contact `Only managers can add people to teams.`; no teams `Create a team in Blueroll → Settings → Messaging first.`
  - picker `Add <name> (+44 7••• ••23) to which team?` (phone via `maskPhone`); after the pick `Invite sent to <name> ✓`
  - missed summary (template `team_day_summary`) `<team> at <site> today: <done> of <total> done. Missed: <names>.`
  - Settings hint `Managers can also add people from WhatsApp — share a contact with the Blueroll bot.`
- Menu (`renderDueMenu` from `due-menu.ts`, shipped in PR #48): header `📋 <team> · <site> — N of M done`; open lines 🔴/🟠/⚪ + `due HH:MM`; done lines `✅ <name> — HH:MM <first name>`; footer `Forms open on your phone`; button `Choose a check`; at most **10** rows (`MENU_ROWS_MAX`), row title ≤ 24 (full name in the description when cut), description = status + due time, `+N more` line when cut. One menu **per team**.
- Day: morning list **1 hour before the team's earliest deadline**, **08:00** site time if no mapped checklist has a deadline; once per (team, member, site-local date); nothing open → nothing sent. Overdue: at the checklist's deadline, still open → once per (team, checklist, period) to every active member, quick reply payload `tfill:<group id>:<template id>`. Missed summary: **1 hour after the team's latest deadline**, **22:00** if none, only if something is still open, to active members and managers (WhatsApp if linked; always an app notification). 🎉 and the summary share one `day_end` event per team per local date (at most one end-of-day message).
- Membership: `status` ∈ `invited` / `active` / `removed`; invite = template `team_invite` with quick reply **Join**, payload `join:<member id>`; Join = consent, `consent_source = 'team_invite'`; invite older than **14 days** is expired; resend at most **once per hour**; Meta errors **131026, 131047, 131051** on invite or list → `unreachable_at`, cleared on the next delivered/read status. One site per team.
- `channel_group_events` kinds/keys: `morning:<member id>` + local date; `overdue` + `<template id>:<period key>`; `day_end` + local date. Claim-then-send, released on failure. `channel_group_takes` PK (`group_id`, `template_id`, `site_id`, `period_key`).
- Templates: new `team_invite`, `team_day_summary` (category UTILITY, `en_GB`); reused `checklist_reminder_list`, `checklist_reminder`, `manager_alert`, `corrective_nudge`. Free-form text (🎉, "Already done", replies) only inside the 24 h service window (`SERVICE_WINDOW_MS`).
- Role assignments no longer drive WhatsApp: only checklists mapped to a team reach WhatsApp. `LINK` codes and the per-person connect flow are retired for WhatsApp; existing identities keep working; `channel_reminders_sent` stays for history. Telegram groups are unchanged (their tests must pass unmodified).
- Shared modules under `supabase/functions/_shared/**` import siblings with explicit `.ts` and must not touch `Deno` at import time; Vitest imports them directly. No runtime import cycles: team modules import only *types* from `bot.ts`; `isBillable` moves to `service-window.ts`.
- Tests: `npm test` green after every task. Baseline **617** passing. The only tests that may be deleted are the ones named in Task 6 (`planReminders`) and Task 7 (role-based / LINK bot tests, replaced by `team-bot.test.ts`).
- Typecheck: `npx tsc --noEmit 2>&1 | grep -c "error TS"` must stay **3** (pre-existing: `src/app/(dashboard)/reports/page.tsx` ×2, `src/components/ui/dropdown-menu.tsx`) — "no new errors". Test files are type-checked too.
- Deno: `cd supabase/functions && deno check whatsapp-webhook/index.ts whatsapp-reminders/index.ts channel-form/index.ts telegram-webhook/index.ts whatsapp-sync-flows/index.ts team-create-channel-member/index.ts` must pass after every task that touches `_shared/channels/**` (plus `whatsapp-team-member/index.ts` from Task 9 on).
- Never log raw phone numbers (use `maskPhone`). Never log tokens.
- **External / prod steps are controller only and need Kostya's explicit "yes"**: applying the migration, Meta template submission (Task 11), deploying functions, merging to `main` (Task 12). Implementer subagents never touch the database, Meta or Vercel. Do not push; do not switch branches (`KNS/whatsapp-teams`).
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before writing web code read the relevant guide under `node_modules/next/dist/docs/` (AGENTS.md: this Next.js has breaking changes). Client components here use only `'use client'`, React state and TanStack Query.

## Review Focus

1. **DST day (Europe/London, 25 Oct 2026, clocks go back)** — the morning list must go out 1 h before the deadline *in local time* (09:00 deadline → 08:00 GMT = 08:00Z on the 25th, 07:00Z the day before), and the 08:00 fallback likewise. Test in Task 4.
2. **A person in two teams at the same site, with the same checklist mapped to both** — two menus (one per team); once anyone records it (either team, or the app), the other team's button answers "Already done ✓ by …" and nothing is recorded twice. Test in Task 7.
3. **A manager who is also a member of the team** — the missed summary reaches their number once (not as member *and* manager), and the app notification is still created once. Test in Task 6.
4. **Inviting a number already linked in another business** — WhatsApp allows one business per number. The invite goes out; on Join the person's tap moves the number (the other business's identity is revoked, a `team_invite` identity is created here), exactly like the retired LINK flow. Test in Task 5.
5. **Template not approved yet (Meta 132001)** — an invite must not burn the hourly resend slot or flag the member "Not reachable", and Settings/WhatsApp must say it failed; a missed summary must release its `day_end` claim and not create app notifications, so the next run retries. Tests in Task 5 and Task 6.

---

## File Structure

```
supabase/migrations/20261012140000_whatsapp_teams.sql        teams on channel_groups, members, events, takes, token check, RLS, triggers
supabase/tests/whatsapp_teams_verify.sql                     rolled-back verify DO block
supabase/functions/_shared/channels/types.ts                  (modify) contact inbound, DeliveryStatus, SendResult.errorCode
supabase/functions/_shared/channels/whatsapp.ts               (modify) normalisePhone, contacts parsing, parseStatuses, list section, error code
supabase/functions/_shared/channels/service-window.ts         SERVICE_WINDOW_MS, isBillable (moved out of bot.ts)
supabase/functions/_shared/channels/team-text.ts              all team copy (TEAM_TEXT), firstName
supabase/functions/_shared/channels/due-menu.ts               (modify) done "by", custom row ids
supabase/functions/_shared/channels/teams-db.ts               TeamDeps contract + Supabase implementation
supabase/functions/_shared/channels/team-day.ts               pure day planner: state, times, plan, take key, summary params
supabase/functions/_shared/channels/team-members.ts           sendTracked, invite/add/resend, Join, delivery statuses
supabase/functions/_shared/channels/team-cron.ts              runWhatsAppTeams (morning, overdue, summary), celebrateTeam
supabase/functions/_shared/channels/team-admin.ts             manager commands: shared contact, team picker, `team`, remove
supabase/functions/_shared/channels/team-api.ts               Settings API (add person, resend invite) — pure over TeamDeps
supabase/functions/_shared/channels/bot.ts                    (rewrite) member side over teams; LINK + role-based paths removed
supabase/functions/_shared/channels/db.ts                     (modify) BotDeps impl: link codes out, teams in, token group_id
supabase/functions/_shared/channels/alerts.ts                 (modify) isBillable import
supabase/functions/_shared/checklists-core/reminders.ts       (modify) planReminders/reminderKey removed
supabase/functions/whatsapp-reminders/index.ts                (modify) teams run replaces role-based reminders; housekeeping
supabase/functions/whatsapp-webhook/index.ts                  (modify) teams deps, delivery statuses
supabase/functions/whatsapp-team-member/index.ts              new edge function for Settings (add / resend)
src/lib/whatsapp/teams.ts                                     web client for WhatsApp teams + pure labels
src/lib/whatsapp/client.ts                                    (modify) callFn exported; LINK/QR helpers removed
src/app/(dashboard)/settings/whatsapp-teams.tsx               Settings → Messaging → WhatsApp teams
src/app/(dashboard)/settings/whatsapp-settings.tsx            (modify) mount WhatsApp teams, new toggle copy
src/app/(dashboard)/team/page.tsx                             (modify) channel column "WhatsApp · <team>" / "Invited"; QR connect removed
src/app/(dashboard)/team/{whatsapp-connect,add-whatsapp-member}.tsx   (delete)
src/lib/whatsapp/__tests__/fakes/team-deps.ts                 in-memory TeamDeps + send fake (Tasks 3–8)
src/lib/whatsapp/__tests__/fakes/team-bot-deps.ts             BotDeps over the TeamDeps fake (Tasks 7–8)
src/lib/whatsapp/__tests__/{teams-db,team-day,team-members,team-cron,team-bot,team-admin,team-api}.test.ts
src/lib/whatsapp/__tests__/teams.test.ts                      web lib helpers
```

---

### Task 1: Migration — WhatsApp teams, members, events, takes, token check, RLS

**Files:**
- Create: `supabase/migrations/20261012140000_whatsapp_teams.sql`
- Create: `supabase/tests/whatsapp_teams_verify.sql`

**Interfaces:**
- Consumes: `public.is_active_business_manager(uuid)`; tables `channel_groups`, `channel_group_checklists`, `channel_form_tokens` (`20261011130000_channel_groups.sql`), `profiles`, `sites`, `checklist_templates`.
- Produces (DB contract for every later task):
  - `channel_groups`: `chat_id` nullable, check `channel_groups_chat_check (channel <> 'telegram' or chat_id is not null)`; new `site_id uuid references sites(id) on delete cascade`, check `channel_groups_site_check (channel <> 'whatsapp' or site_id is not null)`; check `channel_groups_title_check (channel <> 'whatsapp' or length(btrim(title)) > 0)`. A WhatsApp team = `channel 'whatsapp'`, `title`, `site_id`, `linked_by` (creator), `unlinked_at` (deleted). Managers may INSERT a WhatsApp team (trigger stamps `linked_by = auth.uid()`, `linked_at`, `alerts = false`); UPDATE as before (`alerts`, unlink) — `site_id` is also immutable for clients.
  - `channel_group_checklists`: the insert policy now also requires the template to apply at the team's site (`t.site_id is null or g.site_id is null or t.site_id = g.site_id`).
  - `channel_group_members(id, group_id, profile_id, phone, status, invited_by, invited_at, joined_at, removed_at, last_invite_sent_at, unreachable_at)`, unique (`group_id`, `profile_id`); FK name `channel_group_members_profile_id_fkey` (PostgREST embeds must name it — there are two FKs to `profiles`). Managers SELECT; UPDATE only `status → 'removed'` (trigger stamps `removed_at`). No client INSERT/DELETE.
  - `channel_group_events(group_id, kind, key, sent_at)` PK (`group_id`, `kind`, `key`) — service role only.
  - `channel_group_takes(group_id, template_id, site_id, period_key, profile_id, taken_at)` PK (`group_id`, `template_id`, `site_id`, `period_key`) — service role only.
  - `channel_form_tokens`: `channel_form_tokens_owner_check (profile_id is not null or group_id is not null)`; `channel_form_tokens_group_kind_check`: `group_checklist` ⇒ group, no profile; `checklist` ⇒ profile (group optional = WhatsApp team); `corrective` ⇒ profile, no group.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20261012140000_whatsapp_teams.sql
-- WhatsApp = team checklists in 1:1 chats (spec docs/superpowers/specs/2026-10-12-whatsapp-teams-design.md §7).
set search_path = public;

-- 1. channel_groups: a WhatsApp team has no chat, exactly one site ------------------------------------------------
alter table public.channel_groups alter column chat_id drop not null;
alter table public.channel_groups add column if not exists site_id uuid references public.sites(id) on delete cascade;
alter table public.channel_groups drop constraint if exists channel_groups_chat_check;
alter table public.channel_groups add constraint channel_groups_chat_check check (channel <> 'telegram' or chat_id is not null);
alter table public.channel_groups drop constraint if exists channel_groups_site_check;
alter table public.channel_groups add constraint channel_groups_site_check check (channel <> 'whatsapp' or site_id is not null);
alter table public.channel_groups drop constraint if exists channel_groups_title_check;
alter table public.channel_groups add constraint channel_groups_title_check check (channel <> 'whatsapp' or length(btrim(title)) > 0);
create index if not exists idx_channel_groups_site on public.channel_groups(site_id) where unlinked_at is null;

-- Managers create WhatsApp teams from Settings (Telegram groups are still linked by the bot only).
drop policy if exists "managers create whatsapp teams" on public.channel_groups;
create policy "managers create whatsapp teams" on public.channel_groups for insert with check (
  channel = 'whatsapp' and chat_id is null
  and public.is_active_business_manager(business_id)
  and exists (select 1 from public.sites s
               where s.id = channel_groups.site_id and s.business_id = channel_groups.business_id and s.removed_at is null));

-- Same guard as before, now also for INSERT (stamps the creator) and with site_id immutable.
-- Security INVOKER on purpose: current_user is the caller's role; service_role/postgres skip it.
create or replace function public.guard_channel_groups_update()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_op = 'INSERT' then
      new.linked_by := auth.uid();
      new.linked_at := now();
      new.created_at := now();
      new.alerts := false;
      new.last_permission_check_at := null;
      new.last_permission_warning_at := null;
      new.unlinked_at := null;
      return new;
    end if;
    if new.business_id is distinct from old.business_id or new.chat_id is distinct from old.chat_id
       or new.channel is distinct from old.channel or new.site_id is distinct from old.site_id
       or new.title is distinct from old.title or new.linked_by is distinct from old.linked_by
       or new.linked_at is distinct from old.linked_at or new.created_at is distinct from old.created_at
       or new.last_permission_check_at is distinct from old.last_permission_check_at
       or new.last_permission_warning_at is distinct from old.last_permission_warning_at
       or (new.unlinked_at is distinct from old.unlinked_at and (old.unlinked_at is not null or new.unlinked_at is null)) then
      raise exception 'only the alerts flag and unlinking can be changed' using errcode = 'insufficient_privilege';
    end if;
    if new.unlinked_at is not null and old.unlinked_at is null then
      new.unlinked_at := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_channel_groups_update on public.channel_groups;
create trigger trg_guard_channel_groups_update before insert or update on public.channel_groups
  for each row execute function public.guard_channel_groups_update();

-- 2. Mappings: a WhatsApp team only does checklists of its own site ---------------------------------------------
drop policy if exists "managers add group checklists" on public.channel_group_checklists;
create policy "managers add group checklists" on public.channel_group_checklists for insert with check (
  exists (select 1 from public.channel_groups g
            join public.checklist_templates t on t.id = channel_group_checklists.template_id and t.business_id = g.business_id
           where g.id = channel_group_checklists.group_id and g.unlinked_at is null
             and (g.site_id is null or t.site_id is null or t.site_id = g.site_id)
             and public.is_active_business_manager(g.business_id)));

-- 3. Team members ---------------------------------------------------------------------------------------------------
create table if not exists public.channel_group_members (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null references public.channel_groups(id) on delete cascade,
  profile_id          uuid not null references public.profiles(id) on delete cascade,
  phone               text not null check (phone ~ '^[0-9]{10,15}$'),
  status              text not null default 'invited' check (status in ('invited','active','removed')),
  invited_by          uuid references public.profiles(id) on delete set null,
  invited_at          timestamptz not null default now(),
  joined_at           timestamptz,
  removed_at          timestamptz,
  last_invite_sent_at timestamptz,
  unreachable_at      timestamptz,
  unique (group_id, profile_id)
);
create index if not exists idx_channel_group_members_phone on public.channel_group_members(phone) where status <> 'removed';
create index if not exists idx_channel_group_members_profile on public.channel_group_members(profile_id) where status = 'active';
alter table public.channel_group_members enable row level security;
drop policy if exists "managers read team members" on public.channel_group_members;
create policy "managers read team members" on public.channel_group_members for select using (
  exists (select 1 from public.channel_groups g
           where g.id = channel_group_members.group_id and public.is_active_business_manager(g.business_id)));
drop policy if exists "managers remove team members" on public.channel_group_members;
create policy "managers remove team members" on public.channel_group_members for update
  using (exists (select 1 from public.channel_groups g
                  where g.id = channel_group_members.group_id and public.is_active_business_manager(g.business_id)))
  with check (exists (select 1 from public.channel_groups g
                       where g.id = channel_group_members.group_id and public.is_active_business_manager(g.business_id)));
-- No client INSERT/DELETE: adding a person sends an invite, so it goes through the whatsapp-team-member function.

-- Clients may only remove a member (status → 'removed'); the trigger stamps removed_at. Column grants are inert under
-- our RLS setup, so this is a trigger. Security INVOKER: service_role/postgres skip it.
create or replace function public.guard_channel_group_members_update()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('authenticated','anon') then
    if new.group_id is distinct from old.group_id or new.profile_id is distinct from old.profile_id
       or new.phone is distinct from old.phone or new.invited_by is distinct from old.invited_by
       or new.invited_at is distinct from old.invited_at or new.joined_at is distinct from old.joined_at
       or new.last_invite_sent_at is distinct from old.last_invite_sent_at
       or new.unreachable_at is distinct from old.unreachable_at
       or (new.status is distinct from old.status and (new.status <> 'removed' or old.status = 'removed'))
       or (new.removed_at is distinct from old.removed_at and new.status is not distinct from old.status) then
      raise exception 'only removing a member can be changed here' using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'removed' and old.status <> 'removed' then
      new.removed_at := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_channel_group_members_update on public.channel_group_members;
create trigger trg_guard_channel_group_members_update before update on public.channel_group_members
  for each row execute function public.guard_channel_group_members_update();

-- 4. Once-per-key team messages (morning:<member id>/date, overdue/<template>:<period>, day_end/date) -------------
create table if not exists public.channel_group_events (
  group_id uuid not null references public.channel_groups(id) on delete cascade,
  kind     text not null,
  key      text not null,
  sent_at  timestamptz not null default now(),
  primary key (group_id, kind, key)
);
alter table public.channel_group_events enable row level security;  -- service role only

-- 5. First submit wins: one take per (team, checklist, site, period) ------------------------------------------------
create table if not exists public.channel_group_takes (
  group_id    uuid not null references public.channel_groups(id) on delete cascade,
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  site_id     uuid not null references public.sites(id) on delete cascade,
  period_key  text not null,
  profile_id  uuid references public.profiles(id) on delete set null,
  taken_at    timestamptz not null default now(),
  primary key (group_id, template_id, site_id, period_key)
);
alter table public.channel_group_takes enable row level security;  -- service role only

-- 6. Form tokens: a WhatsApp team token carries both the member (profile_id) and the team (group_id) -------------
alter table public.channel_form_tokens drop constraint if exists channel_form_tokens_owner_check;
alter table public.channel_form_tokens add constraint channel_form_tokens_owner_check
  check (profile_id is not null or group_id is not null);
alter table public.channel_form_tokens drop constraint if exists channel_form_tokens_group_kind_check;
alter table public.channel_form_tokens add constraint channel_form_tokens_group_kind_check check (
  case kind
    when 'group_checklist' then group_id is not null and profile_id is null
    when 'checklist' then profile_id is not null
    else profile_id is not null and group_id is null
  end);
```

- [ ] **Step 2: Write the verify script**

```sql
-- supabase/tests/whatsapp_teams_verify.sql
-- Run via the Management API as ONE DO block after the migration; it always raises so everything rolls back.
-- Demo business «Fern & Fig» (owner 981197ca-…), never a client.
do $v$
declare
  biz uuid := '2693f7de-c0ba-4d52-bbe9-602106eac784';
  owner uuid := '981197ca-3648-4c6c-9f18-ff7b6ae68786';
  non_manager uuid;
  v_site uuid;
  v_other_site uuid;
  v_tpl uuid;
  v_tpl_other uuid;
  v_team uuid;
  v_member uuid;
  res jsonb := '{}';
begin
  select id into non_manager from profiles
   where business_id = biz and role not in ('owner','manager') and removed_at is null limit 1;
  select id into v_site from sites where business_id = biz and removed_at is null order by created_at limit 1;
  select id into v_other_site from sites where business_id = biz and removed_at is null and id <> v_site limit 1;
  select id into v_tpl from checklist_templates where business_id = biz and (site_id is null or site_id = v_site) limit 1;
  select id into v_tpl_other from checklist_templates
   where business_id = biz and site_id is not null and site_id <> v_site limit 1;

  -- 1. the owner creates a WhatsApp team (creator stamped), maps a checklist of its site, can't move it or add Telegram
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into channel_groups (business_id, channel, title, site_id, linked_by)
  values (biz, 'whatsapp', 'Verify team', v_site, null) returning id into v_team;
  res := res || jsonb_build_object('owner_team',
    (select linked_by = owner and chat_id is null and site_id = v_site from channel_groups where id = v_team));
  insert into channel_group_checklists (group_id, template_id) values (v_team, v_tpl);
  res := res || jsonb_build_object('owner_mapping', (select count(*) from channel_group_checklists where group_id = v_team));
  if v_tpl_other is not null then
    begin
      insert into channel_group_checklists (group_id, template_id) values (v_team, v_tpl_other);
      res := res || '{"other_site_mapping":"ALLOWED (BAD)"}';
    exception when insufficient_privilege then res := res || '{"other_site_mapping":"rejected"}'; end;
  else
    res := res || '{"other_site_mapping":"skipped"}';
  end if;
  if v_other_site is not null then
    begin
      update channel_groups set site_id = v_other_site where id = v_team;
      res := res || '{"owner_site_change":"ALLOWED (BAD)"}';
    exception when insufficient_privilege then res := res || '{"owner_site_change":"rejected"}'; end;
  else
    res := res || '{"owner_site_change":"skipped"}';
  end if;
  begin
    insert into channel_groups (business_id, channel, chat_id, title) values (biz, 'telegram', '-100999000222', 'x');
    res := res || '{"owner_telegram_insert":"ALLOWED (BAD)"}';
  exception when insufficient_privilege then res := res || '{"owner_telegram_insert":"rejected"}'; end;
  execute 'reset role';

  -- 2. table checks (service role)
  begin
    insert into channel_groups (business_id, channel, title) values (biz, 'whatsapp', 'No site');
    res := res || '{"team_without_site":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"team_without_site":"rejected"}'; end;
  begin
    insert into channel_groups (business_id, channel, title) values (biz, 'telegram', 'No chat');
    res := res || '{"telegram_without_chat":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"telegram_without_chat":"rejected"}'; end;

  -- 3. members: service role invites; the owner sees and removes; nothing else changes from a client
  insert into channel_group_members (group_id, profile_id, phone, invited_by)
  values (v_team, owner, '447700900001', owner) returning id into v_member;
  begin
    insert into channel_group_members (group_id, profile_id, phone) values (v_team, owner, '447700900001');
    res := res || '{"member_dupe":"ALLOWED (BAD)"}';
  exception when unique_violation then res := res || '{"member_dupe":"rejected"}'; end;
  begin
    insert into channel_group_members (group_id, profile_id, phone) values (v_team, owner, '+44 7700');
    res := res || '{"bad_phone":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"bad_phone":"rejected"}'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  res := res || jsonb_build_object('owner_sees_members', (select count(*) from channel_group_members where group_id = v_team));
  begin
    update channel_group_members set phone = '447700900002' where id = v_member;
    res := res || '{"owner_phone_change":"ALLOWED (BAD)"}';
  exception when insufficient_privilege then res := res || '{"owner_phone_change":"rejected"}'; end;
  update channel_group_members set status = 'removed' where id = v_member;
  res := res || jsonb_build_object('owner_remove',
    (select status = 'removed' and removed_at is not null from channel_group_members where id = v_member));
  begin
    update channel_group_members set status = 'active' where id = v_member;
    res := res || '{"owner_reactivate":"ALLOWED (BAD)"}';
  exception when insufficient_privilege then res := res || '{"owner_reactivate":"rejected"}'; end;
  res := res || jsonb_build_object('owner_sees_events', (select count(*) from channel_group_events));
  execute 'reset role';

  -- 4. a non-manager sees no members and can't create a team
  if non_manager is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', non_manager, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    res := res || jsonb_build_object('non_manager_sees_members', (select count(*) from channel_group_members where group_id = v_team));
    begin
      insert into channel_groups (business_id, channel, title, site_id) values (biz, 'whatsapp', 'Nope', v_site);
      res := res || '{"non_manager_team":"ALLOWED (BAD)"}';
    exception when insufficient_privilege then res := res || '{"non_manager_team":"rejected"}'; end;
    execute 'reset role';
  end if;

  -- 5. events and takes: one row per key
  insert into channel_group_events (group_id, kind, key) values (v_team, 'day_end', '2026-10-14');
  begin
    insert into channel_group_events (group_id, kind, key) values (v_team, 'day_end', '2026-10-14');
    res := res || '{"event_dupe":"ALLOWED (BAD)"}';
  exception when unique_violation then res := res || '{"event_dupe":"rejected"}'; end;
  insert into channel_group_takes (group_id, template_id, site_id, period_key, profile_id) values (v_team, v_tpl, v_site, '2026-10-14', owner);
  begin
    insert into channel_group_takes (group_id, template_id, site_id, period_key, profile_id) values (v_team, v_tpl, v_site, '2026-10-14', owner);
    res := res || '{"take_dupe":"ALLOWED (BAD)"}';
  exception when unique_violation then res := res || '{"take_dupe":"rejected"}'; end;

  -- 6. form tokens
  insert into channel_form_tokens (token, kind, business_id, profile_id, group_id, site_id, template_id, item_ids)
  values ('verify-team', 'checklist', biz, owner, v_team, v_site, v_tpl, '{}');
  res := res || '{"team_token":"ok"}';
  begin
    insert into channel_form_tokens (token, kind, business_id, profile_id, group_id, site_id, template_id)
    values ('verify-bad1', 'corrective', biz, owner, v_team, v_site, v_tpl);
    res := res || '{"corrective_with_group":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"corrective_with_group":"rejected"}'; end;
  begin
    insert into channel_form_tokens (token, kind, business_id, profile_id, group_id, site_id, template_id)
    values ('verify-bad2', 'group_checklist', biz, owner, v_team, v_site, v_tpl);
    res := res || '{"group_token_with_profile":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"group_token_with_profile":"rejected"}'; end;
  begin
    insert into channel_form_tokens (token, kind, business_id, group_id, site_id, template_id)
    values ('verify-bad3', 'checklist', biz, v_team, v_site, v_tpl);
    res := res || '{"checklist_without_profile":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"checklist_without_profile":"rejected"}'; end;

  raise exception 'VERIFY_RESULT %', res;
end
$v$;
```

Expected `VERIFY_RESULT` (record it in the report): `owner_team: true`, `owner_mapping: 1`, `other_site_mapping: "rejected"` (or `"skipped"`), `owner_site_change: "rejected"` (or `"skipped"`), `owner_telegram_insert: "rejected"`, `team_without_site: "rejected"`, `telegram_without_chat: "rejected"`, `member_dupe: "rejected"`, `bad_phone: "rejected"`, `owner_sees_members: 1`, `owner_phone_change: "rejected"`, `owner_remove: true`, `owner_reactivate: "rejected"`, `owner_sees_events: 0`, `non_manager_sees_members: 0`, `non_manager_team: "rejected"`, `event_dupe: "rejected"`, `take_dupe: "rejected"`, `team_token: "ok"`, `corrective_with_group: "rejected"`, `group_token_with_profile: "rejected"`, `checklist_without_profile: "rejected"`.

- [ ] **Step 3: Parse-check both files with pglast** (venv in the scratchpad; nothing touches a database):

```bash
python3 -m venv "$TMPDIR/pg" && "$TMPDIR/pg/bin/pip" -q install pglast
"$TMPDIR/pg/bin/python" - <<'PY'
import pglast
mig = 'supabase/migrations/20261012140000_whatsapp_teams.sql'
ver = 'supabase/tests/whatsapp_teams_verify.sql'
for f in [mig, ver]:
    pglast.parse_sql(open(f).read()); print('ok', f)
src = open(mig).read()
for body in src.split('$$')[1::2]:
    pglast.parse_plpgsql('create function f() returns trigger language plpgsql as $$' + body + '$$'); print('ok plpgsql body')
v = open(ver).read()
pglast.parse_plpgsql('create function f() returns void language plpgsql as $$' + v.split('$v$')[1] + '$$'); print('ok verify body')
PY
```
Expected: `ok` for both files, two `ok plpgsql body`, `ok verify body`; no exception.

- [ ] **Step 4: Hand over — do NOT apply.** The migration and the verify block are applied by the controller in Task 12 after Kostya's explicit "yes". Report both file paths.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261012140000_whatsapp_teams.sql supabase/tests/whatsapp_teams_verify.sql
git commit -m "feat(db): WhatsApp teams — members, events, takes, team tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Building blocks — contacts inbound, delivery statuses, phone numbers, menu "by", team copy

**Files:**
- Modify: `supabase/functions/_shared/channels/types.ts`
- Modify: `supabase/functions/_shared/channels/whatsapp.ts`
- Create: `supabase/functions/_shared/channels/service-window.ts`
- Create: `supabase/functions/_shared/channels/team-text.ts`
- Modify: `supabase/functions/_shared/channels/due-menu.ts`
- Modify: `supabase/functions/_shared/channels/bot.ts` (re-export `isBillable`; contact events get the fallback for now)
- Modify: `supabase/functions/_shared/channels/alerts.ts` (import `isBillable` from `service-window.ts`)
- Test: `src/lib/whatsapp/__tests__/whatsapp.test.ts`, `src/lib/whatsapp/__tests__/due-menu.test.ts`, `src/lib/whatsapp/__tests__/team-text.test.ts`

**Interfaces:**
- Consumes: existing `parseInbound`, `listMessage`, `makeSender`, `renderDueMenu`, `maskPhone`.
- Produces:

```ts
// types.ts
export type InboundEvent =
  | { kind: 'text'; from: string; text: string; id: string }
  | { kind: 'button'; from: string; payload: string; id: string }
  | { kind: 'flow'; from: string; token: string; response: Record<string, unknown>; id: string }
  | { kind: 'contact'; from: string; name: string; phone: string; id: string }   // phone = E.164 digits
export interface SendResult { id: string | null; ok: boolean; status: number; errorCode?: number }   // Meta error.code on failure
export interface DeliveryStatus { id: string; recipient: string; status: string; errorCode: number | null }

// whatsapp.ts
export function normalisePhone(raw: string, defaultCountryCode?: string /* '44' */): string | null   // E.164 digits, 10–15
export function parseStatuses(body: unknown): DeliveryStatus[]
export const listMessage: (to: string, m: { header: string; body: string; footer: string; button: string; rows: { id: string; title: string; description: string }[]; section?: string /* default 'Open checks' */ }) => OutboundMessage

// service-window.ts
export const SERVICE_WINDOW_MS: number   // 24 h
export const isBillable: (lastInboundAt: string | null | undefined, now: Date) => boolean

// due-menu.ts
export interface MenuDone { name: string; completedAt: string; by?: string | null }          // done line "✅ name — HH:MM by"
export interface DueMenuInput { siteId: string; siteName: string; tz: string; now: Date; open: MenuOpen[]; done: MenuDone[]; rowId?: (templateId: string) => string }

// team-text.ts
export const TEAM_TEXT: { notInTeam, noLongerIn(team), alreadyDone(by, time), allDone(team), joined(team, site), managerJoined(name, team),
  inviteExpired, unavailable, onlyManagers, onlyManagersTeam, noTeams, whichTeam(name, masked), inviteSent(name), alreadyMember(name, team),
  inviteTooSoon(name), inviteFailed(name), teamHeader(team, site), noPeople, confirmRemove(name, team), removed(name, team), cancelled,
  teamGone, summary(team, site, done, total, missed), joinedTitle, missedTitle(team) }
export function firstName(fullName: string): string
```

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/whatsapp/__tests__/whatsapp.test.ts` (and add `normalisePhone, parseStatuses` to its import from `whatsapp`):

```ts
describe('normalisePhone', () => {
  it.each([
    ['+44 7700 900123', '447700900123'],
    ['447700900123', '447700900123'],
    ['0044 7700 900123', '447700900123'],
    ['07700 900123', '447700900123'],
    ['+44 (0)7700 900123', '447700900123'],
    ['+1 (415) 555-0100', '14155550100'],
  ])('%s → %s', (raw, want) => expect(normalisePhone(raw)).toBe(want))
  it.each(['', '12345', 'abc', '+44 7700 900123 ext 4', '+4477009001234567'])('rejects %j', (raw) => expect(normalisePhone(raw)).toBeNull())
})

describe('parseInbound — shared contact', () => {
  const wrap = (m: unknown) => ({ entry: [{ changes: [{ value: { messages: [m] } }] }] })
  it('first contact with a number; wa_id preferred; name from formatted_name', () => {
    expect(parseInbound(wrap({ from: '447700900001', id: 'wamid.C1', type: 'contacts', contacts: [
      { name: { formatted_name: 'No Phone' }, phones: [] },
      { name: { formatted_name: 'Maria  Lopez', first_name: 'Maria' }, phones: [{ phone: '+44 7700 900777', wa_id: '447700900777', type: 'CELL' }] },
      { name: { formatted_name: 'Second' }, phones: [{ wa_id: '447700900888' }] },
    ] }))).toEqual([{ kind: 'contact', from: '447700900001', name: 'Maria Lopez', phone: '447700900777', id: 'wamid.C1' }])
  })
  it('falls back to the phone field and first/last name; no usable number → nothing', () => {
    expect(parseInbound(wrap({ from: '447700900001', id: 'wamid.C2', type: 'contacts', contacts: [
      { name: { first_name: 'Ben', last_name: 'Jones' }, phones: [{ phone: '07700 900456' }] },
    ] }))).toEqual([{ kind: 'contact', from: '447700900001', name: 'Ben Jones', phone: '447700900456', id: 'wamid.C2' }])
    expect(parseInbound(wrap({ from: '447700900001', id: 'wamid.C3', type: 'contacts', contacts: [{ name: { formatted_name: 'X' }, phones: [{ phone: 'n/a' }] }] }))).toEqual([])
  })
})

describe('parseStatuses', () => {
  it('reads delivery statuses with the first error code; junk is skipped', () => {
    const body = { entry: [{ changes: [{ value: { statuses: [
      { id: 'wamid.A', status: 'delivered', recipient_id: '447700900123' },
      { id: 'wamid.B', status: 'failed', recipient_id: '447700900456', errors: [{ code: 131026, title: 'Message undeliverable' }] },
      { id: 'wamid.C', status: 'failed', recipient_id: 'not-a-number' },
    ] } }] }] }
    expect(parseStatuses(body)).toEqual([
      { id: 'wamid.A', recipient: '447700900123', status: 'delivered', errorCode: null },
      { id: 'wamid.B', recipient: '447700900456', status: 'failed', errorCode: 131026 },
    ])
    expect(parseStatuses(status)).toEqual([{ id: 'wamid.X', recipient: '447700900123', status: 'delivered', errorCode: null }])
    expect(parseStatuses(null)).toEqual([])
    expect(parseStatuses({ entry: [{ changes: [{ value: { statuses: 5 } }] }] })).toEqual([])
  })
})

describe('makeSender — Meta error code', () => {
  it('returns error.code on failure (and no errorCode when Meta gives none)', async () => {
    const send = makeSender({ token: 'T', phoneNumberId: 'PN', fetchFn: (async () =>
      new Response(JSON.stringify({ error: { code: 132001, message: 'Template name does not exist in the translation' } }), { status: 404 })) as any })
    expect(await send(textMessage('44', 'x'))).toEqual({ id: null, ok: false, status: 404, errorCode: 132001 })
  })
})

describe('listMessage section', () => {
  it('defaults to "Open checks" and accepts another section title', () => {
    const base = { header: 'H', body: 'B', footer: 'F', button: 'Go', rows: [{ id: 'r', title: 'T', description: 'D' }] }
    expect((listMessage('44', base) as any).interactive.action.sections[0].title).toBe('Open checks')
    expect((listMessage('44', { ...base, section: 'Teams' }) as any).interactive.action.sections[0].title).toBe('Teams')
  })
})
```

Append to `src/lib/whatsapp/__tests__/due-menu.test.ts`:

```ts
describe('renderDueMenu — team menu', () => {
  it('done lines carry the first name; rows use the given id builder', () => {
    const m = renderDueMenu({ ...base, siteName: 'Kitchen · Ashfield Row',
      open: [{ templateId: 'h', name: 'Hot Holding Checks', deadlineUtc: '2026-10-14T10:00:00Z' }],
      done: [{ name: 'Daily Opening Checks', completedAt: '2026-10-14T07:47:00Z', by: 'Anna' }, { name: 'Probe check', completedAt: '2026-10-14T08:00:00Z', by: null }],
      rowId: (id) => `tfill:g1:${id}` })
    expect(m.header).toBe('📋 Kitchen · Ashfield Row — 2 of 3 done')
    expect(m.body).toBe(['🟠 Hot Holding Checks — due 11:00', '✅ Daily Opening Checks — 08:47 Anna', '✅ Probe check — 09:00'].join('\n'))
    expect(m.rows).toEqual([{ id: 'tfill:g1:h', title: 'Hot Holding Checks', description: '🟠 Due 11:00 · due soon' }])
  })
})
```

Create `src/lib/whatsapp/__tests__/team-text.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { TEAM_TEXT, firstName } from '../../../../supabase/functions/_shared/channels/team-text'
import { SERVICE_WINDOW_MS, isBillable } from '../../../../supabase/functions/_shared/channels/service-window'
import { isBillable as fromBot } from '../../../../supabase/functions/_shared/channels/bot'

describe('team copy (spec strings, verbatim)', () => {
  it('member side', () => {
    expect(TEAM_TEXT.notInTeam).toBe("You're not in a team yet — ask your manager to add you.")
    expect(TEAM_TEXT.noLongerIn('Kitchen')).toBe("You're no longer in Kitchen.")
    expect(TEAM_TEXT.alreadyDone('Anna', '08:47')).toBe('Already done ✓ by Anna 08:47')
    expect(TEAM_TEXT.alreadyDone(null, '08:47')).toBe('Already done ✓ 08:47')
    expect(TEAM_TEXT.allDone('Kitchen')).toBe('🎉 All Kitchen checks done today')
    expect(TEAM_TEXT.joined('Kitchen', 'Ashfield Row')).toBe("You're in Kitchen at Ashfield Row ✓")
    expect(TEAM_TEXT.managerJoined('Anna', 'Kitchen')).toBe('Anna joined Kitchen ✓')
    expect(TEAM_TEXT.inviteExpired).toBe('This invite has expired — ask your manager to add you again.')
    expect(TEAM_TEXT.summary('Kitchen', 'Ashfield Row', 2, 3, 'Fridge temps')).toBe('Kitchen at Ashfield Row today: 2 of 3 done. Missed: Fridge temps.')
  })
  it('manager side', () => {
    expect(TEAM_TEXT.onlyManagers).toBe('Only managers can add people to teams.')
    expect(TEAM_TEXT.noTeams).toBe('Create a team in Blueroll → Settings → Messaging first.')
    expect(TEAM_TEXT.whichTeam('Maria', '+44 7••• ••23')).toBe('Add Maria (+44 7••• ••23) to which team?')
    expect(TEAM_TEXT.inviteSent('Maria')).toBe('Invite sent to Maria ✓')
  })
  it('firstName', () => {
    expect(firstName('  Anna   Smith ')).toBe('Anna')
    expect(firstName('')).toBe('')
  })
  it('service window: free within 24 h of the last inbound; bot.ts re-exports the same function', () => {
    const now = new Date('2026-10-14T09:40:00Z')
    expect(SERVICE_WINDOW_MS).toBe(24 * 3600 * 1000)
    expect(isBillable('2026-10-14T01:00:00Z', now)).toBe(false)
    expect(isBillable('2026-10-13T09:00:00Z', now)).toBe(true)
    expect(isBillable(null, now)).toBe(true)
    expect(fromBot).toBe(isBillable)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/whatsapp.test.ts src/lib/whatsapp/__tests__/due-menu.test.ts src/lib/whatsapp/__tests__/team-text.test.ts`
Expected: FAIL — `normalisePhone is not a function` / `Failed to resolve import ".../team-text"`; the due-menu team test fails on the done line and row id.

- [ ] **Step 3: Implement**

`types.ts` — replace the file:

```ts
export type InboundEvent =
  | { kind: 'text'; from: string; text: string; id: string }
  | { kind: 'button'; from: string; payload: string; id: string }
  | { kind: 'flow'; from: string; token: string; response: Record<string, unknown>; id: string }
  /** A contact card shared with the bot: the first contact with a usable number (E.164 digits). */
  | { kind: 'contact'; from: string; name: string; phone: string; id: string }
export type OutboundMessage = Record<string, unknown>   // Cloud API /messages body
/** `errorCode`: Meta's `error.code` when the send failed (e.g. 131026 undeliverable, 132001 template missing). */
export interface SendResult { id: string | null; ok: boolean; status: number; errorCode?: number }
export type SendFn = (msg: OutboundMessage) => Promise<SendResult>
/** One entry of a webhook `statuses` array (sent / delivered / read / failed). */
export interface DeliveryStatus { id: string; recipient: string; status: string; errorCode: number | null }
```

`service-window.ts` — new file (moved out of `bot.ts` so team modules can use it without importing `bot.ts`):

```ts
// supabase/functions/_shared/channels/service-window.ts
// WhatsApp customer-service window: business-initiated messages are free (and free-form text is allowed) within 24 h
// of the person's last inbound message.
export const SERVICE_WINDOW_MS = 24 * 3600 * 1000
export const isBillable = (lastInboundAt: string | null | undefined, now: Date) =>
  !lastInboundAt || now.getTime() - new Date(lastInboundAt).getTime() >= SERVICE_WINDOW_MS
```

`bot.ts` — delete the local `SERVICE_WINDOW_MS` / `isBillable` definitions (lines 100–103) and add, right below the imports:

```ts
export { isBillable, SERVICE_WINDOW_MS } from './service-window.ts'
```

and, in `handleInbound`, directly above the `// flow reply` comment:

```ts
  // Shared contacts become manager commands in Task 8; until then they get the fallback.
  if (e.kind === 'contact') return out(d, ctx, reply(X.fallback), 'reply')
```

`alerts.ts` — change `import { isBillable } from './bot.ts'` to:

```ts
import { isBillable } from './service-window.ts'
```

`whatsapp.ts` — add `DeliveryStatus` to the type import (`import type { DeliveryStatus, InboundEvent, OutboundMessage, SendFn } from './types.ts'`), then add above `parseInbound`:

```ts
/**
 * Phone number → E.164 digits without '+' (10–15 digits), or null. '+' / '00' prefixes are international; a single
 * leading 0 is a national number in `defaultCountryCode` (Blueroll businesses are UK: '44'). "(0)" is dropped.
 */
export function normalisePhone(raw: string, defaultCountryCode = '44'): string | null {
  const s = String(raw ?? '').replace(/\(0\)/g, '').trim()
  if (!s || /[a-z]/i.test(s)) return null
  let d = s.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  else if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0')) d = defaultCountryCode + d.slice(1)
  return /^\d{10,15}$/.test(d) ? d : null
}
```

In `parseInbound`, extend the `if … else if` chain: directly after line 47 (the `    }` that closes the `nfm_reply` branch, right before the `  }` that closes the `for`), add:

```ts
    else if (m.type === 'contacts') {
      // Shared contact card: the first contact with a usable number (wa_id preferred — already E.164 digits).
      for (const c of arr(m.contacts)) {
        const phone = arr(c?.phones).map((p: Any) => normalisePhone(String(p?.wa_id || p?.phone || ''))).find((x): x is string => !!x)
        if (!phone) continue
        const n = c?.name ?? {}
        const name = String(n.formatted_name || [n.first_name, n.last_name].filter(Boolean).join(' ') || '').replace(/\s+/g, ' ').trim()
        out.push({ kind: 'contact', from, name, phone, id })
        break
      }
    }
```

Below `parseInbound` add:

```ts
// Never throws: anything malformed is skipped.
export function parseStatuses(body: unknown): DeliveryStatus[] {
  const out: DeliveryStatus[] = []
  for (const e of arr((body as Any)?.entry)) for (const c of arr(e?.changes)) for (const s of arr(c?.value?.statuses)) {
    const recipient = s?.recipient_id
    if (typeof recipient !== 'string' || !/^\d+$/.test(recipient)) continue
    const code = arr(s.errors)[0]?.code
    out.push({ id: String(s.id ?? ''), recipient, status: String(s.status ?? ''), errorCode: typeof code === 'number' ? code : null })
  }
  return out
}
```

Replace `listMessage`:

```ts
/** Interactive list: one button opens a menu of rows. Limits are applied by the caller (see due-menu.ts). */
export const listMessage = (to: string, m: { header: string; body: string; footer: string; button: string; rows: { id: string; title: string; description: string }[]; section?: string }): OutboundMessage => ({
  messaging_product: 'whatsapp', to, type: 'interactive',
  interactive: {
    type: 'list', header: { type: 'text', text: m.header }, body: { text: m.body }, footer: { text: m.footer },
    action: { button: m.button, sections: [{ title: m.section ?? 'Open checks', rows: m.rows }] },
  },
})
```

In `makeSender`, replace the `return { id: …, ok: r.ok, status: r.status }` line with:

```ts
      const code = r.ok ? undefined : j?.error?.code
      return { id: r.ok ? (j?.messages?.[0]?.id ?? null) : null, ok: r.ok, status: r.status, ...(typeof code === 'number' ? { errorCode: code } : {}) }
```

`due-menu.ts` — extend the two interfaces and use them:

```ts
export interface MenuDone { name: string; completedAt: string; by?: string | null }
export interface DueMenuInput {
  siteId: string; siteName: string; tz: string; now: Date; open: MenuOpen[]; done: MenuDone[]
  /** Menu row id per open checklist; default `fill:<template id>:<site id>`. WhatsApp teams use `tfill:<group id>:<template id>`. */
  rowId?: (templateId: string) => string
}
```

and in `renderDueMenu` change the done line and the row id:

```ts
    ...done.map((x) => `✅ ${x.name} — ${hhmm(x.completedAt, i.tz)}${x.by ? ` ${x.by}` : ''}`),
```
```ts
    return { id: i.rowId ? i.rowId(o.templateId) : `fill:${o.templateId}:${i.siteId}`, title, description: clip(desc, ROW_DESC_MAX) }
```

`team-text.ts` — new file:

```ts
// supabase/functions/_shared/channels/team-text.ts
// WhatsApp team copy (spec 2026-10-12 §3–§6). Plain text, English; tests pin the spec's strings verbatim.
export const TEAM_TEXT = {
  notInTeam: "You're not in a team yet — ask your manager to add you.",
  noLongerIn: (team: string) => `You're no longer in ${team}.`,
  alreadyDone: (by: string | null, time: string) => `Already done ✓${by ? ` by ${by}` : ''} ${time}`,
  allDone: (team: string) => `🎉 All ${team} checks done today`,
  joined: (team: string, site: string) => `You're in ${team} at ${site} ✓`,
  managerJoined: (name: string, team: string) => `${name} joined ${team} ✓`,
  inviteExpired: 'This invite has expired — ask your manager to add you again.',
  unavailable: "Blueroll checks aren't available for your team right now. Please use the Blueroll app.",
  onlyManagers: 'Only managers can add people to teams.',
  onlyManagersTeam: 'Only managers can manage teams.',
  noTeams: 'Create a team in Blueroll → Settings → Messaging first.',
  whichTeam: (name: string, masked: string) => `Add ${name} (${masked}) to which team?`,
  inviteSent: (name: string) => `Invite sent to ${name} ✓`,
  alreadyMember: (name: string, team: string) => `${name} is already in ${team}.`,
  inviteTooSoon: (name: string) => `An invite went to ${name} less than an hour ago — try again later.`,
  inviteFailed: (name: string) => `Couldn't send the invite to ${name}. Try again from Blueroll → Settings → Messaging.`,
  teamHeader: (team: string, site: string) => `${team} · ${site}`,
  noPeople: 'No people yet. Share a contact with me to add someone.',
  confirmRemove: (name: string, team: string) => `Remove ${name} from ${team}?`,
  removed: (name: string, team: string) => `${name} removed from ${team}.`,
  cancelled: 'Cancelled.',
  teamGone: 'This team no longer exists.',
  summary: (team: string, site: string, done: number, total: number, missed: string) =>
    `${team} at ${site} today: ${done} of ${total} done. Missed: ${missed}.`,
  joinedTitle: 'Joined WhatsApp team',
  missedTitle: (team: string) => `${team}: checks missed today`,
} as const

/** First word of a full name ('' when empty). */
export const firstName = (fullName: string): string => fullName.trim().split(/\s+/)[0] ?? ''
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/whatsapp/__tests__/whatsapp.test.ts src/lib/whatsapp/__tests__/due-menu.test.ts src/lib/whatsapp/__tests__/team-text.test.ts`
Expected: PASS.

- [ ] **Step 5: Full checks**

Run: `npm test` → all pass (617 + the new ones). `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `3`. `cd supabase/functions && deno check whatsapp-webhook/index.ts whatsapp-reminders/index.ts channel-form/index.ts telegram-webhook/index.ts whatsapp-sync-flows/index.ts team-create-channel-member/index.ts` → no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/channels/{types,whatsapp,service-window,team-text,due-menu,bot,alerts}.ts src/lib/whatsapp/__tests__/{whatsapp,due-menu,team-text}.test.ts
git commit -m "feat(whatsapp): contacts inbound, delivery statuses, phone numbers, team copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Team data layer — `TeamDeps`, Supabase implementation, in-memory fake

**Files:**
- Create: `supabase/functions/_shared/channels/teams-db.ts`
- Create: `src/lib/whatsapp/__tests__/fakes/team-deps.ts`
- Test: `src/lib/whatsapp/__tests__/teams-db.test.ts`

**Interfaces:**
- Consumes: `pageAll` from `db.ts`; `createChannelOnlyMember`, `defaultStaffRole` from `members.ts`; `CompletionWho` from `groups-db.ts`; `SiteInfo` (type) from `bot.ts`; `CoreDb` from `checklists-core/record.ts`; DB from Task 1.
- Produces (every later task uses exactly these names):

```ts
export type MemberStatus = 'invited' | 'active' | 'removed'
export interface Team { id: string; business_id: string; title: string; site_id: string }
export interface TeamMember {
  id: string; group_id: string; profile_id: string; phone: string; status: MemberStatus; full_name: string
  invited_by: string | null; invited_at: string; joined_at: string | null; removed_at: string | null
  last_invite_sent_at: string | null; unreachable_at: string | null
}
export interface TeamRecipient { member_id: string; profile_id: string; phone: string; first_name: string; last_inbound_at: string | null }
export interface ManagerContact { profile_id: string; phone: string; last_inbound_at: string | null }
export interface WaIdentity { id: string; business_id: string; profile_id: string; last_inbound_at: string | null }
export interface TakeKey { group_id: string; template_id: string; site_id: string; period_key: string }
export interface ChannelLog { business_id: string | null; site_id: string | null; profile_id: string | null; direction: 'in' | 'out'; kind: string; template_name?: string; billable: boolean; ref_id?: string; wa_message_id?: string | null }
export interface TeamDeps extends CoreDb {
  now(): Date
  ready(businessId: string): Promise<boolean>                                   // channel_ready(b, 'whatsapp')
  businessName(businessId: string): Promise<string>
  liveTeams(): Promise<Team[]>                                                  // every WhatsApp team not deleted (cron)
  teamsForBusiness(businessId: string): Promise<Team[]>                         // not deleted, by title
  teamById(groupId: string): Promise<Team | null>                               // WhatsApp, not deleted
  teamTemplates(team: Team): Promise<Template[]>                                // mapped, active, same business, site_id null or team.site_id
  site(siteId: string): Promise<SiteInfo | null>                                // not removed
  members(groupId: string): Promise<TeamMember[]>                               // every status, invited_at order
  memberById(memberId: string): Promise<TeamMember | null>
  memberFor(groupId: string, profileId: string): Promise<TeamMember | null>
  activeMemberships(profileId: string): Promise<TeamMember[]>                   // status 'active' in WhatsApp teams not deleted
  upsertInvited(a: { group_id: string; profile_id: string; phone: string; invited_by: string | null; now: Date }): Promise<TeamMember>   // → status 'invited' (keeps last_invite_sent_at)
  claimInviteSend(memberId: string, now: Date): Promise<boolean>                // atomic: last_invite_sent_at null or ≤ now − 1 h → now
  releaseInviteSend(memberId: string, claimedAtIso: string, previous: string | null): Promise<void>
  activateMember(memberId: string, now: Date): Promise<boolean>                 // invited → active (joined_at = now, unreachable cleared)
  removeMember(memberId: string, now: Date): Promise<boolean>                   // invited|active → removed
  setUnreachable(phone: string, at: Date | null): Promise<void>                 // every non-removed member row with this phone
  identityByPhone(phone: string): Promise<WaIdentity | null>                    // active WhatsApp identity of this number (any business)
  linkIdentity(a: { business_id: string; profile_id: string; phone: string; linked_by: string | null; now: Date }): Promise<void>   // consent_source 'team_invite'
  createStaffMember(a: { businessId: string; siteId: string; fullName: string }): Promise<string>   // channel-only profile id
  isManager(profileId: string, businessId: string): Promise<boolean>            // active owner/manager
  person(profileId: string): Promise<Person | null>
  firstNames(profileIds: string[]): Promise<Map<string, string>>
  recipients(team: Team): Promise<TeamRecipient[]>                              // active members with an active identity in the team's business
  managerContacts(businessId: string): Promise<ManagerContact[]>                // active owners/managers linked on WhatsApp
  completionsSince(businessId: string, since: Date): Promise<CompletionWho[]>
  claimEvent(groupId: string, kind: string, key: string): Promise<boolean>
  releaseEvent(groupId: string, kind: string, key: string): Promise<void>
  claimTake(k: TakeKey, profileId: string, now: Date): Promise<boolean>
  takeOwner(k: TakeKey): Promise<{ profile_id: string | null; taken_at: string } | null>
  releaseTake(k: TakeKey, profileId: string): Promise<void>
  log(e: ChannelLog): Promise<void>                                             // channel_messages_log, channel 'whatsapp'; never throws
}
export const MEMBER_PROFILE_FK = 'channel_group_members_profile_id_fkey'
export const INVITE_RESEND_MS = 3600_000
export function makeTeamDeps(admin: any): TeamDeps

// fakes/team-deps.ts (tests only)
export const NOW: Date                       // 2026-10-14T09:40:00Z = 10:40 Europe/London (BST)
export const SITE: SiteInfo                  // { id: 's1', name: 'Ashfield Row', timezone: 'Europe/London' }
export const TEAM: Team                      // { id: 'g1', business_id: 'b', title: 'Kitchen', site_id: 's1' }
export const ANNA, BEN, BOSS                 // { profile_id, phone, name }: p1/447700900123/'Anna Smith', p2/447700900456/'Ben Jones', m1/447700900001/'Kostya Boss'
export const TEMP_ITEM: TemplateItem
export function tpl(o: Partial<Template> & { id: string; name: string }): Template
export function member(o: Partial<TeamMember> & { id: string; profile_id: string; phone: string }): TeamMember
export interface FakeTeamState { … }         // see the file
export function fakeTeamDeps(init?: Partial<FakeTeamState>, over?: Partial<TeamDeps>): { d: TeamDeps; s: FakeTeamState }
export function fakeSend(respond?: (msg: any) => Partial<SendResult> | undefined): { send: SendFn; sent: any[] }
```

- [ ] **Step 1: Write the fake** (used by Tasks 3–8)

```ts
// src/lib/whatsapp/__tests__/fakes/team-deps.ts
// In-memory TeamDeps + WhatsApp send fake for the WhatsApp team tests (planner, membership, cron, bot, admin, API).
import type { ChannelLog, Team, TeamDeps, TeamMember } from '../../../../../supabase/functions/_shared/channels/teams-db'
import type { CompletionWho } from '../../../../../supabase/functions/_shared/channels/groups-db'
import type { SiteInfo } from '../../../../../supabase/functions/_shared/channels/bot'
import type { SendFn, SendResult } from '../../../../../supabase/functions/_shared/channels/types'
import type { Person, Template, TemplateItem } from '../../../../../supabase/functions/_shared/checklists-core/types'

export const NOW = new Date('2026-10-14T09:40:00Z')   // 10:40 Europe/London (BST)
export const SITE: SiteInfo = { id: 's1', name: 'Ashfield Row', timezone: 'Europe/London' }
export const TEAM: Team = { id: 'g1', business_id: 'b', title: 'Kitchen', site_id: 's1' }
export const ANNA = { profile_id: 'p1', phone: '447700900123', name: 'Anna Smith' }
export const BEN = { profile_id: 'p2', phone: '447700900456', name: 'Ben Jones' }
export const BOSS = { profile_id: 'm1', phone: '447700900001', name: 'Kostya Boss' }
export const TEMP_ITEM: TemplateItem = { id: 'i1', name: 'Walk-in fridge', item_type: 'temperature', required: true, min_value: 0, max_value: 5, unit: '°C', sort_order: 0 }
export const tpl = (o: Partial<Template> & { id: string; name: string }): Template => ({
  business_id: 'b', site_id: null, frequency: 'daily', deadline_time: null, multi_per_day: false, min_per_day: null,
  assigned_roles: [], assigned_role_ids: [], active: true, ...o,
})
export const member = (o: Partial<TeamMember> & { id: string; profile_id: string; phone: string }): TeamMember => ({
  group_id: 'g1', status: 'active', full_name: '', invited_by: 'm1', invited_at: '2026-10-01T09:00:00Z', joined_at: '2026-10-01T09:05:00Z',
  removed_at: null, last_invite_sent_at: '2026-10-01T09:00:00Z', unreachable_at: null, ...o,
})
const person = (p: { profile_id: string; name: string }, role = 'kitchen_staff'): Person & { removed?: boolean } =>
  ({ profile_id: p.profile_id, business_id: 'b', full_name: p.name, role, role_id: null })

export interface FakeIdentity { id: string; business_id: string; profile_id: string; phone: string; last_inbound_at: string | null; revoked: boolean; consent_source: string }
export interface FakeTeamState {
  now: Date
  teams: (Team & { deleted?: boolean })[]
  mappings: { group_id: string; template_id: string }[]
  templates: Template[]
  sites: SiteInfo[]
  members: TeamMember[]
  identities: FakeIdentity[]
  people: (Person & { removed?: boolean })[]
  managers: string[]
  completions: CompletionWho[]
  events: Set<string>                                       // `${group}|${kind}|${key}`
  takes: Map<string, { profile_id: string; taken_at: string }>   // `${group}|${template}|${site}|${period}`
  ready: Record<string, boolean>
  businessNames: Record<string, string>
  created: { businessId: string; siteId: string; fullName: string; profile_id: string }[]
  completionRows: any[]
  responses: any[]
  notifications: any[]
  logs: ChannelLog[]
}

/** Defaults: team Kitchen at Ashfield Row; Anna an active, linked member; Ben a person without a number; Kostya the owner, linked. */
export function fakeTeamDeps(init: Partial<FakeTeamState> = {}, over: Partial<TeamDeps> = {}) {
  const s: FakeTeamState = {
    now: NOW, teams: [{ ...TEAM }], mappings: [], templates: [], sites: [SITE],
    members: [member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone, full_name: ANNA.name })],
    identities: [
      { id: 'id1', business_id: 'b', profile_id: ANNA.profile_id, phone: ANNA.phone, last_inbound_at: null, revoked: false, consent_source: 'team_invite' },
      { id: 'idm', business_id: 'b', profile_id: BOSS.profile_id, phone: BOSS.phone, last_inbound_at: null, revoked: false, consent_source: 'qr_code' },
    ],
    people: [person(ANNA), person(BEN), person(BOSS, 'owner')], managers: [BOSS.profile_id], completions: [],
    events: new Set(), takes: new Map(), ready: { b: true }, businessNames: { b: 'Fern & Fig' },
    created: [], completionRows: [], responses: [], notifications: [], logs: [], ...init,
  }
  let n = 0
  const live = (id: string) => s.teams.find((t) => t.id === id && !t.deleted) ?? null
  const pub = (t: Team): Team => ({ id: t.id, business_id: t.business_id, title: t.title, site_id: t.site_id })
  const takeKey = (k: { group_id: string; template_id: string; site_id: string; period_key: string }) => `${k.group_id}|${k.template_id}|${k.site_id}|${k.period_key}`
  const activeIdentity = (phone: string) => s.identities.find((i) => i.phone === phone && !i.revoked) ?? null
  const alive = (pid: string) => s.people.find((p) => p.profile_id === pid && !p.removed) ?? null
  const d: TeamDeps = {
    now: () => s.now,
    ready: async (b) => !!s.ready[b],
    businessName: async (b) => s.businessNames[b] ?? 'your team',
    liveTeams: async () => s.teams.filter((t) => !t.deleted).map(pub),
    teamsForBusiness: async (b) => s.teams.filter((t) => t.business_id === b && !t.deleted).sort((x, y) => x.title.localeCompare(y.title)).map(pub),
    teamById: async (id) => { const t = live(id); return t ? pub(t) : null },
    teamTemplates: async (team) => s.templates.filter((t) => t.active && t.business_id === team.business_id && (t.site_id === null || t.site_id === team.site_id)
      && s.mappings.some((m) => m.group_id === team.id && m.template_id === t.id)),
    site: async (id) => s.sites.find((x) => x.id === id) ?? null,
    members: async (gid) => s.members.filter((m) => m.group_id === gid).map((m) => ({ ...m })),
    memberById: async (id) => { const m = s.members.find((x) => x.id === id); return m ? { ...m } : null },
    memberFor: async (gid, pid) => { const m = s.members.find((x) => x.group_id === gid && x.profile_id === pid); return m ? { ...m } : null },
    activeMemberships: async (pid) => s.members.filter((m) => m.profile_id === pid && m.status === 'active' && live(m.group_id)).map((m) => ({ ...m })),
    upsertInvited: async (a) => {
      const at = a.now.toISOString()
      let m = s.members.find((x) => x.group_id === a.group_id && x.profile_id === a.profile_id)
      const name = s.people.find((p) => p.profile_id === a.profile_id)?.full_name ?? ''
      if (m) Object.assign(m, { phone: a.phone, status: 'invited', invited_by: a.invited_by, invited_at: at, joined_at: null, removed_at: null, unreachable_at: null })
      else { m = member({ id: `gm${s.members.length + 1}`, group_id: a.group_id, profile_id: a.profile_id, phone: a.phone, status: 'invited', full_name: name, invited_by: a.invited_by, invited_at: at, joined_at: null, last_invite_sent_at: null }); s.members.push(m) }
      return { ...m }
    },
    claimInviteSend: async (id, now) => {
      const m = s.members.find((x) => x.id === id)
      if (!m || (m.last_invite_sent_at && now.getTime() - new Date(m.last_invite_sent_at).getTime() < 3600_000)) return false
      m.last_invite_sent_at = now.toISOString(); return true
    },
    releaseInviteSend: async (id, claimed, previous) => { const m = s.members.find((x) => x.id === id && x.last_invite_sent_at === claimed); if (m) m.last_invite_sent_at = previous },
    activateMember: async (id, now) => {
      const m = s.members.find((x) => x.id === id && x.status === 'invited')
      if (!m) return false
      Object.assign(m, { status: 'active', joined_at: now.toISOString(), unreachable_at: null }); return true
    },
    removeMember: async (id, now) => {
      const m = s.members.find((x) => x.id === id && x.status !== 'removed')
      if (!m) return false
      Object.assign(m, { status: 'removed', removed_at: now.toISOString() }); return true
    },
    setUnreachable: async (phone, at) => { for (const m of s.members) if (m.phone === phone && m.status !== 'removed') m.unreachable_at = at ? at.toISOString() : null },
    identityByPhone: async (phone) => { const i = activeIdentity(phone); return i ? { id: i.id, business_id: i.business_id, profile_id: i.profile_id, last_inbound_at: i.last_inbound_at } : null },
    linkIdentity: async (a) => {
      const cur = activeIdentity(a.phone)
      if (cur && cur.business_id === a.business_id && cur.profile_id === a.profile_id) { cur.last_inbound_at = a.now.toISOString(); return }
      for (const i of s.identities) if (!i.revoked && (i.phone === a.phone || i.profile_id === a.profile_id)) i.revoked = true
      s.identities.push({ id: `id${s.identities.length + 1}`, business_id: a.business_id, profile_id: a.profile_id, phone: a.phone, last_inbound_at: a.now.toISOString(), revoked: false, consent_source: 'team_invite' })
    },
    createStaffMember: async (a) => {
      const pid = `new${++n}`
      s.created.push({ ...a, profile_id: pid })
      s.people.push({ profile_id: pid, business_id: a.businessId, full_name: a.fullName, role: 'kitchen_staff', role_id: 'r-staff' })
      return pid
    },
    isManager: async (pid, b) => s.managers.includes(pid) && !!s.people.find((p) => p.profile_id === pid && p.business_id === b && !p.removed),
    person: async (pid) => { const p = alive(pid); return p ? { profile_id: p.profile_id, business_id: p.business_id, full_name: p.full_name, role: p.role, role_id: p.role_id } : null },
    firstNames: async (ids) => new Map(ids.flatMap((i) => { const p = s.people.find((x) => x.profile_id === i); return p ? [[i, p.full_name.split(' ')[0]] as [string, string]] : [] })),
    recipients: async (team) => s.members.filter((m) => m.group_id === team.id && m.status === 'active').flatMap((m) => {
      const i = s.identities.find((x) => x.profile_id === m.profile_id && x.business_id === team.business_id && !x.revoked)
      const p = alive(m.profile_id)
      return i && p ? [{ member_id: m.id, profile_id: m.profile_id, phone: i.phone, first_name: p.full_name.split(' ')[0], last_inbound_at: i.last_inbound_at }] : []
    }),
    managerContacts: async (b) => s.identities.filter((i) => i.business_id === b && !i.revoked && s.managers.includes(i.profile_id) && alive(i.profile_id))
      .map((i) => ({ profile_id: i.profile_id, phone: i.phone, last_inbound_at: i.last_inbound_at })),
    completionsSince: async (_b, since) => s.completions.filter((c) => new Date(c.completed_at) >= since),
    claimEvent: async (g, kind, key) => { const k = `${g}|${kind}|${key}`; if (s.events.has(k)) return false; s.events.add(k); return true },
    releaseEvent: async (g, kind, key) => { s.events.delete(`${g}|${kind}|${key}`) },
    claimTake: async (k, pid, now) => { const key = takeKey(k); if (s.takes.has(key)) return false; s.takes.set(key, { profile_id: pid, taken_at: now.toISOString() }); return true },
    takeOwner: async (k) => s.takes.get(takeKey(k)) ?? null,
    releaseTake: async (k, pid) => { const key = takeKey(k); if (s.takes.get(key)?.profile_id === pid) s.takes.delete(key) },
    log: async (e) => { s.logs.push(e) },
    insertCompletion: async (row) => {
      s.completionRows.push({ ...row })
      s.completions.push({ template_id: row.template_id, site_id: row.site_id, completed_at: row.completed_at, completed_by: row.completed_by })
      return { id: `c${s.completionRows.length}` }
    },
    insertResponses: async (rows) => {
      const start = s.responses.length
      s.responses.push(...rows)
      return rows.map((r, i) => ({ id: `resp${start + i}`, item_id: r.item_id }))
    },
    managerIds: async () => [...s.managers],
    insertNotifications: async (rows) => { s.notifications.push(...rows) },
    ...over,
  }
  return { d, s }
}

/** WhatsApp send fake: succeeds unless `respond` overrides; message ids w1, w2, … */
export function fakeSend(respond: (msg: any) => Partial<SendResult> | undefined = () => undefined) {
  const sent: any[] = []
  const send: SendFn = async (m) => { sent.push(m); return { id: `w${sent.length}`, ok: true, status: 200, ...respond(m) } }
  return { send, sent }
}
```

- [ ] **Step 2: Write the failing tests** for the Supabase implementation (query shapes that fakes can't catch)

```ts
// src/lib/whatsapp/__tests__/teams-db.test.ts
import { describe, it, expect } from 'vitest'
import { makeTeamDeps, MEMBER_PROFILE_FK } from '../../../../supabase/functions/_shared/channels/teams-db'

// Chainable PostgREST stand-in: records every builder call per query; `answer(q)` decides each query's result.
type Q = { table: string; ops: [string, ...any[]][] }
function proxyAdmin(answer: (q: Q) => { data: any; error: any }) {
  const queries: Q[] = []
  const admin = {
    from: (table: string) => {
      const q: Q = { table, ops: [] }
      queries.push(q)
      const b: any = new Proxy({}, {
        get: (_t, k: string) => k === 'then'
          ? (res: any, rej: any) => Promise.resolve(answer(q)).then(res, rej)
          : (...args: any[]) => { q.ops.push([k, ...args]); return b },
      })
      return b
    },
    rpc: async () => ({ data: true, error: null }),
  }
  return { admin, queries }
}
const op = (q: Q, name: string) => q.ops.find((o) => o[0] === name)

describe('makeTeamDeps', () => {
  it('claimEvent: insert wins once; a duplicate key (23505) is "already sent"; other errors throw', async () => {
    let code: string | null = null
    const { admin, queries } = proxyAdmin(() => ({ data: null, error: code ? { code, message: 'x' } : null }))
    const t = makeTeamDeps(admin)
    expect(await t.claimEvent('g1', 'day_end', '2026-10-14')).toBe(true)
    expect(op(queries[0], 'insert')![1]).toEqual({ group_id: 'g1', kind: 'day_end', key: '2026-10-14' })
    code = '23505'
    expect(await t.claimEvent('g1', 'day_end', '2026-10-14')).toBe(false)
    code = '42P01'
    await expect(t.claimEvent('g1', 'day_end', '2026-10-14')).rejects.toMatchObject({ code: '42P01' })
  })
  it('claimTake: same contract, row carries the taker', async () => {
    const { admin, queries } = proxyAdmin(() => ({ data: null, error: null }))
    const now = new Date('2026-10-14T09:40:00Z')
    expect(await makeTeamDeps(admin).claimTake({ group_id: 'g1', template_id: 't', site_id: 's1', period_key: '2026-10-14' }, 'p1', now)).toBe(true)
    expect(queries[0].table).toBe('channel_group_takes')
    expect(op(queries[0], 'insert')![1]).toEqual({ group_id: 'g1', template_id: 't', site_id: 's1', period_key: '2026-10-14', profile_id: 'p1', taken_at: now.toISOString() })
  })
  it('claimInviteSend: first send (null) or more than an hour since the last one', async () => {
    let calls = 0
    const { admin, queries } = proxyAdmin(() => ({ data: ++calls === 1 ? [] : [{ id: 'gm1' }], error: null }))
    const now = new Date('2026-10-14T09:40:00Z')
    expect(await makeTeamDeps(admin).claimInviteSend('gm1', now)).toBe(true)
    expect(op(queries[0], 'is')).toEqual(['is', 'last_invite_sent_at', null])
    expect(op(queries[1], 'lte')).toEqual(['lte', 'last_invite_sent_at', '2026-10-14T08:40:00.000Z'])
  })
  it('member reads disambiguate the profiles embed (two FKs point at profiles)', async () => {
    const { admin, queries } = proxyAdmin(() => ({ data: { id: 'gm1', group_id: 'g1', profile_id: 'p1', phone: '447700900123', status: 'active', profile: { full_name: 'Anna Smith' } }, error: null }))
    const m = await makeTeamDeps(admin).memberById('gm1')
    expect(String(op(queries[0], 'select')![1])).toContain(`profile:profiles!${MEMBER_PROFILE_FK}(full_name)`)
    expect(m).toMatchObject({ id: 'gm1', full_name: 'Anna Smith' })
    expect(m).not.toHaveProperty('profile')
  })
  it('teamTemplates keeps active templates of the team business at its site (or all sites)', async () => {
    const t = (o: any) => ({ id: 'x', business_id: 'b', site_id: null, name: 'n', frequency: 'daily', deadline_time: null, multi_per_day: false, min_per_day: null, assigned_roles: null, assigned_role_ids: null, active: true, ...o })
    const { admin } = proxyAdmin(() => ({ data: [
      { template: t({ id: 'all' }) }, { template: t({ id: 'here', site_id: 's1' }) }, { template: t({ id: 'there', site_id: 's2' }) },
      { template: t({ id: 'off', active: false }) }, { template: t({ id: 'foreign', business_id: 'zz' }) }, { template: null },
    ], error: null }))
    const out = await makeTeamDeps(admin).teamTemplates({ id: 'g1', business_id: 'b', title: 'Kitchen', site_id: 's1' })
    expect(out.map((x) => x.id)).toEqual(['all', 'here'])
    expect(out[0].assigned_roles).toEqual([])
  })
  it('linkIdentity: the number linked elsewhere → revoke by number and by profile, then insert a team_invite identity', async () => {
    const { admin, queries } = proxyAdmin((q) => (q.ops[0][0] === 'select' ? { data: { id: 'old', business_id: 'other', profile_id: 'x' }, error: null } : { data: null, error: null }))
    const now = new Date('2026-10-14T09:40:00Z')
    await makeTeamDeps(admin).linkIdentity({ business_id: 'b', profile_id: 'p1', phone: '447700900123', linked_by: 'm1', now })
    const kinds = queries.map((q) => [q.table, q.ops[0][0]])
    expect(kinds).toEqual([['channel_identities', 'select'], ['channel_identities', 'update'], ['channel_identities', 'update'], ['channel_identities', 'insert']])
    expect(op(queries[3], 'insert')![1]).toMatchObject({ business_id: 'b', profile_id: 'p1', channel: 'whatsapp', external_id: '447700900123', consent_source: 'team_invite', linked_by: 'm1' })
  })
  it('linkIdentity: already linked to this person here → only touch last_inbound_at', async () => {
    const { admin, queries } = proxyAdmin((q) => (q.ops[0][0] === 'select' ? { data: { id: 'id1', business_id: 'b', profile_id: 'p1' }, error: null } : { data: null, error: null }))
    await makeTeamDeps(admin).linkIdentity({ business_id: 'b', profile_id: 'p1', phone: '447700900123', linked_by: 'm1', now: new Date() })
    expect(queries.map((q) => q.ops[0][0])).toEqual(['select', 'update'])
    expect(Object.keys(op(queries[1], 'update')![1])).toEqual(['last_inbound_at'])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/teams-db.test.ts`
Expected: FAIL — `Failed to resolve import ".../channels/teams-db"`.

- [ ] **Step 4: Implement `teams-db.ts`**

```ts
// supabase/functions/_shared/channels/teams-db.ts
// WhatsApp teams (spec 2026-10-12 §7): the data contract (TeamDeps) for membership, the day planner cron, the bot and
// the Settings API, plus its Supabase-backed implementation. `admin` = service-role supabase-js client (typed loosely).
// Never log phone numbers from here (maskPhone).
import type { CoreDb } from '../checklists-core/record.ts'
import type { Person, Template } from '../checklists-core/types.ts'
import type { SiteInfo } from './bot.ts'
import type { CompletionWho } from './groups-db.ts'
import { pageAll } from './db.ts'
import { createChannelOnlyMember, defaultStaffRole } from './members.ts'

// deno-lint-ignore no-explicit-any
type Any = any

export type MemberStatus = 'invited' | 'active' | 'removed'
export interface Team { id: string; business_id: string; title: string; site_id: string }
export interface TeamMember {
  id: string; group_id: string; profile_id: string; phone: string; status: MemberStatus; full_name: string
  invited_by: string | null; invited_at: string; joined_at: string | null; removed_at: string | null
  last_invite_sent_at: string | null; unreachable_at: string | null
}
export interface TeamRecipient { member_id: string; profile_id: string; phone: string; first_name: string; last_inbound_at: string | null }
export interface ManagerContact { profile_id: string; phone: string; last_inbound_at: string | null }
export interface WaIdentity { id: string; business_id: string; profile_id: string; last_inbound_at: string | null }
export interface TakeKey { group_id: string; template_id: string; site_id: string; period_key: string }
export interface ChannelLog {
  business_id: string | null; site_id: string | null; profile_id: string | null; direction: 'in' | 'out'; kind: string
  template_name?: string; billable: boolean; ref_id?: string; wa_message_id?: string | null
}

export interface TeamDeps extends CoreDb {
  now(): Date
  ready(businessId: string): Promise<boolean>
  businessName(businessId: string): Promise<string>
  liveTeams(): Promise<Team[]>
  teamsForBusiness(businessId: string): Promise<Team[]>
  teamById(groupId: string): Promise<Team | null>
  teamTemplates(team: Team): Promise<Template[]>
  site(siteId: string): Promise<SiteInfo | null>
  members(groupId: string): Promise<TeamMember[]>
  memberById(memberId: string): Promise<TeamMember | null>
  memberFor(groupId: string, profileId: string): Promise<TeamMember | null>
  activeMemberships(profileId: string): Promise<TeamMember[]>
  upsertInvited(a: { group_id: string; profile_id: string; phone: string; invited_by: string | null; now: Date }): Promise<TeamMember>
  claimInviteSend(memberId: string, now: Date): Promise<boolean>
  releaseInviteSend(memberId: string, claimedAtIso: string, previous: string | null): Promise<void>
  activateMember(memberId: string, now: Date): Promise<boolean>
  removeMember(memberId: string, now: Date): Promise<boolean>
  setUnreachable(phone: string, at: Date | null): Promise<void>
  identityByPhone(phone: string): Promise<WaIdentity | null>
  linkIdentity(a: { business_id: string; profile_id: string; phone: string; linked_by: string | null; now: Date }): Promise<void>
  createStaffMember(a: { businessId: string; siteId: string; fullName: string }): Promise<string>
  isManager(profileId: string, businessId: string): Promise<boolean>
  person(profileId: string): Promise<Person | null>
  firstNames(profileIds: string[]): Promise<Map<string, string>>
  recipients(team: Team): Promise<TeamRecipient[]>
  managerContacts(businessId: string): Promise<ManagerContact[]>
  completionsSince(businessId: string, since: Date): Promise<CompletionWho[]>
  claimEvent(groupId: string, kind: string, key: string): Promise<boolean>
  releaseEvent(groupId: string, kind: string, key: string): Promise<void>
  claimTake(k: TakeKey, profileId: string, now: Date): Promise<boolean>
  takeOwner(k: TakeKey): Promise<{ profile_id: string | null; taken_at: string } | null>
  releaseTake(k: TakeKey, profileId: string): Promise<void>
  log(e: ChannelLog): Promise<void>
}

/** channel_group_members has two FKs to profiles (profile_id, invited_by): embeds must name this one. */
export const MEMBER_PROFILE_FK = 'channel_group_members_profile_id_fkey'
export const INVITE_RESEND_MS = 3600_000
const TEAM_COLS = 'id, business_id, title, site_id'
const MEMBER_COLS = `id, group_id, profile_id, phone, status, invited_by, invited_at, joined_at, removed_at, last_invite_sent_at, unreachable_at, profile:profiles!${MEMBER_PROFILE_FK}(full_name)`
const TEMPLATE_COLS = 'id, business_id, site_id, name, frequency, deadline_time, multi_per_day, min_per_day, assigned_roles, assigned_role_ids, active'
const firstWord = (s: unknown) => String(s ?? '').trim().split(/\s+/)[0] ?? ''

export function makeTeamDeps(admin: Any): TeamDeps {
  const one = async (q: Any) => { const { data, error } = await q; if (error) throw error; return data }
  const errMsg = (e: Any) => String(e?.message ?? e).slice(0, 200)
  const asMember = (r: Any): TeamMember => { const { profile, ...m } = r; return { ...m, full_name: String(profile?.full_name ?? '') } }
  const activeManagerIds = async (b: string): Promise<string[]> =>
    ((await one(admin.from('profiles').select('id').eq('business_id', b).in('role', ['owner', 'manager']).is('removed_at', null))) ?? []).map((p: Any) => p.id)
  /** Insert-as-claim: true = this caller claimed the key; a duplicate (23505) = someone already did. */
  const claimInsert = async (table: string, row: Record<string, unknown>) => {
    const { error } = await admin.from(table).insert(row)
    if (!error) return true
    if (error.code === '23505') return false
    throw error
  }

  return {
    now: () => new Date(),
    ready: async (b) => !!(await one(admin.rpc('channel_ready', { b, ch: 'whatsapp' }))),
    businessName: async (b) => (await one(admin.from('businesses').select('name').eq('id', b).maybeSingle()))?.name || 'your team',

    liveTeams: () => pageAll<Team>((from, to) => admin.from('channel_groups').select(TEAM_COLS)
      .eq('channel', 'whatsapp').is('unlinked_at', null).order('id').range(from, to)),
    teamsForBusiness: async (b) => (await one(admin.from('channel_groups').select(TEAM_COLS)
      .eq('channel', 'whatsapp').eq('business_id', b).is('unlinked_at', null).order('title'))) ?? [],
    teamById: async (id) => (await one(admin.from('channel_groups').select(TEAM_COLS)
      .eq('id', id).eq('channel', 'whatsapp').is('unlinked_at', null).maybeSingle())) ?? null,
    teamTemplates: async (team) => {
      const rows = await one(admin.from('channel_group_checklists').select(`template:checklist_templates(${TEMPLATE_COLS})`).eq('group_id', team.id))
      return ((rows ?? []) as Any[]).map((r) => r.template)
        .filter((t) => t && t.active && t.business_id === team.business_id && (t.site_id === null || t.site_id === team.site_id))
        .map((t) => ({ ...t, assigned_roles: t.assigned_roles ?? [], assigned_role_ids: t.assigned_role_ids ?? [] }))
    },
    site: async (id) => {
      const s = await one(admin.from('sites').select('id, name, timezone, status').eq('id', id).is('removed_at', null).maybeSingle())
      return s && s.status !== 'removed' ? { id: s.id, name: s.name ?? '', timezone: s.timezone ?? 'Europe/London' } : null
    },

    members: async (gid) => ((await one(admin.from('channel_group_members').select(MEMBER_COLS).eq('group_id', gid).order('invited_at'))) ?? []).map(asMember),
    memberById: async (id) => { const r = await one(admin.from('channel_group_members').select(MEMBER_COLS).eq('id', id).maybeSingle()); return r ? asMember(r) : null },
    memberFor: async (gid, pid) => {
      const r = await one(admin.from('channel_group_members').select(MEMBER_COLS).eq('group_id', gid).eq('profile_id', pid).maybeSingle())
      return r ? asMember(r) : null
    },
    activeMemberships: async (pid) => {
      const rows = await one(admin.from('channel_group_members').select(`${MEMBER_COLS}, team:channel_groups!inner(channel, unlinked_at)`)
        .eq('profile_id', pid).eq('status', 'active').eq('team.channel', 'whatsapp').is('team.unlinked_at', null))
      return ((rows ?? []) as Any[]).map(({ team: _team, ...r }) => asMember(r))
    },
    upsertInvited: async (a) => asMember(await one(admin.from('channel_group_members').upsert({
      group_id: a.group_id, profile_id: a.profile_id, phone: a.phone, status: 'invited', invited_by: a.invited_by,
      invited_at: a.now.toISOString(), joined_at: null, removed_at: null, unreachable_at: null,
    }, { onConflict: 'group_id,profile_id' }).select(MEMBER_COLS).single())),
    // Two UPDATEs = the OR (never sent / sent over an hour ago) without filter strings; the row lock makes it atomic.
    claimInviteSend: async (id, now) => {
      const at = now.toISOString()
      const first = await one(admin.from('channel_group_members').update({ last_invite_sent_at: at }).eq('id', id).is('last_invite_sent_at', null).select('id'))
      if (first?.length) return true
      const later = await one(admin.from('channel_group_members').update({ last_invite_sent_at: at }).eq('id', id)
        .lte('last_invite_sent_at', new Date(now.getTime() - INVITE_RESEND_MS).toISOString()).select('id'))
      return !!later?.length
    },
    releaseInviteSend: async (id, claimedAt, previous) => {
      await one(admin.from('channel_group_members').update({ last_invite_sent_at: previous }).eq('id', id).eq('last_invite_sent_at', claimedAt))
    },
    activateMember: async (id, now) => !!(await one(admin.from('channel_group_members')
      .update({ status: 'active', joined_at: now.toISOString(), unreachable_at: null }).eq('id', id).eq('status', 'invited').select('id')))?.length,
    removeMember: async (id, now) => !!(await one(admin.from('channel_group_members')
      .update({ status: 'removed', removed_at: now.toISOString() }).eq('id', id).in('status', ['invited', 'active']).select('id')))?.length,
    setUnreachable: async (phone, at) => {
      let q = admin.from('channel_group_members').update({ unreachable_at: at ? at.toISOString() : null }).eq('phone', phone).neq('status', 'removed')
      q = at ? q.is('unreachable_at', null) : q.not('unreachable_at', 'is', null)
      await one(q)
    },

    identityByPhone: async (phone) => (await one(admin.from('channel_identities').select('id, business_id, profile_id, last_inbound_at')
      .eq('channel', 'whatsapp').eq('external_id', phone).is('revoked_at', null).maybeSingle())) ?? null,
    linkIdentity: async (a) => {
      const at = a.now.toISOString()
      const cur = await one(admin.from('channel_identities').select('id, business_id, profile_id')
        .eq('channel', 'whatsapp').eq('external_id', a.phone).is('revoked_at', null).maybeSingle())
      if (cur && cur.business_id === a.business_id && cur.profile_id === a.profile_id) {
        await one(admin.from('channel_identities').update({ last_inbound_at: at }).eq('id', cur.id))
        return
      }
      // One active WhatsApp identity per number and per profile (uq indexes): revoke both, then link — as LINK used to.
      await one(admin.from('channel_identities').update({ revoked_at: at }).eq('channel', 'whatsapp').eq('external_id', a.phone).is('revoked_at', null))
      await one(admin.from('channel_identities').update({ revoked_at: at }).eq('channel', 'whatsapp').eq('profile_id', a.profile_id).is('revoked_at', null))
      await one(admin.from('channel_identities').insert({
        business_id: a.business_id, profile_id: a.profile_id, channel: 'whatsapp', external_id: a.phone,
        consent_source: 'team_invite', consent_text_version: 1, linked_by: a.linked_by, last_inbound_at: at,
      }))
    },
    createStaffMember: async (a) => {
      const role = await defaultStaffRole(admin, a.businessId)
      if (!role) throw new Error('no staff role to give a new team member')
      const m = await createChannelOnlyMember(admin, { businessId: a.businessId, siteId: a.siteId, roleId: role.id, roleTier: role.base_tier, fullName: a.fullName, emailPrefix: 'wa' })
      if (!m.ok) throw new Error(`whatsapp member: ${m.error}`)
      return m.profileId
    },
    isManager: async (pid, b) => !!(await one(admin.from('profiles').select('id')
      .eq('id', pid).eq('business_id', b).in('role', ['owner', 'manager']).is('removed_at', null).maybeSingle())),
    person: async (pid) => {
      const p = await one(admin.from('profiles').select('id, business_id, full_name, role, role_id').eq('id', pid).is('removed_at', null).maybeSingle())
      return p && p.business_id ? { profile_id: p.id, business_id: p.business_id, full_name: p.full_name ?? '', role: p.role, role_id: p.role_id ?? null } : null
    },
    firstNames: async (ids) => {
      if (!ids.length) return new Map()
      const rows = await one(admin.from('profiles').select('id, full_name').in('id', ids))
      return new Map(((rows ?? []) as Any[]).map((p) => [p.id as string, firstWord(p.full_name)]))
    },
    recipients: async (team) => {
      const ms: Any[] = (await one(admin.from('channel_group_members').select('id, profile_id').eq('group_id', team.id).eq('status', 'active'))) ?? []
      if (!ms.length) return []
      const pids = ms.map((m) => m.profile_id)
      const ids: Any[] = (await one(admin.from('channel_identities').select('profile_id, external_id, last_inbound_at')
        .eq('channel', 'whatsapp').eq('business_id', team.business_id).is('revoked_at', null).in('profile_id', pids))) ?? []
      const people: Any[] = (await one(admin.from('profiles').select('id, full_name').eq('business_id', team.business_id).is('removed_at', null).in('id', pids))) ?? []
      return ms.flatMap((m) => {
        const i = ids.find((x) => x.profile_id === m.profile_id)
        const p = people.find((x) => x.id === m.profile_id)
        return i && p ? [{ member_id: m.id, profile_id: m.profile_id, phone: i.external_id, first_name: firstWord(p.full_name), last_inbound_at: i.last_inbound_at ?? null }] : []
      })
    },
    managerContacts: async (b) => {
      const mgr = await activeManagerIds(b)
      if (!mgr.length) return []
      const ids: Any[] = (await one(admin.from('channel_identities').select('profile_id, external_id, last_inbound_at')
        .eq('channel', 'whatsapp').eq('business_id', b).is('revoked_at', null).in('profile_id', mgr))) ?? []
      return ids.map((i) => ({ profile_id: i.profile_id, phone: i.external_id, last_inbound_at: i.last_inbound_at ?? null }))
    },
    // Paged: a busy business easily has >1000 completions in a month (PostgREST row cap).
    completionsSince: (b, since) => pageAll<CompletionWho>((from, to) => admin.from('checklist_completions')
      .select('template_id, site_id, completed_at, completed_by').eq('business_id', b).gte('completed_at', since.toISOString())
      .order('completed_at', { ascending: false }).order('id', { ascending: false }).range(from, to)),

    claimEvent: (gid, kind, key) => claimInsert('channel_group_events', { group_id: gid, kind, key }),
    releaseEvent: async (gid, kind, key) => {
      const { error } = await admin.from('channel_group_events').delete().eq('group_id', gid).eq('kind', kind).eq('key', key)
      if (error) console.error('team event release failed', gid, kind, errMsg(error))
    },
    claimTake: (k, pid, now) => claimInsert('channel_group_takes', { ...k, profile_id: pid, taken_at: now.toISOString() }),
    takeOwner: async (k) => (await one(admin.from('channel_group_takes').select('profile_id, taken_at')
      .eq('group_id', k.group_id).eq('template_id', k.template_id).eq('site_id', k.site_id).eq('period_key', k.period_key).maybeSingle())) ?? null,
    releaseTake: async (k, pid) => {
      const { error } = await admin.from('channel_group_takes').delete()
        .eq('group_id', k.group_id).eq('template_id', k.template_id).eq('site_id', k.site_id).eq('period_key', k.period_key).eq('profile_id', pid)
      if (error) console.error('team take release failed', k.group_id, k.template_id, errMsg(error))
    },
    log: async (e) => {
      const { error } = await admin.from('channel_messages_log').insert({ ...e, channel: 'whatsapp' })
      if (error) console.error('channel_messages_log insert failed', e.kind, errMsg(error))
    },

    insertCompletion: async (row) => await one(admin.from('checklist_completions').insert(row).select('id').single()),
    insertResponses: async (rows) => rows.length ? ((await one(admin.from('checklist_responses').insert(rows).select('id, item_id'))) ?? []) : [],
    managerIds: activeManagerIds,
    insertNotifications: async (rows) => { if (rows.length) await one(admin.from('notifications').insert(rows)) },
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/whatsapp/__tests__/teams-db.test.ts`
Expected: PASS (7 tests). The fake has no test of its own; it is exercised from Task 4 on.

- [ ] **Step 6: Full checks** — `npm test` (all pass), `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `3`, the `deno check` line from Global Constraints → ok.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/channels/teams-db.ts src/lib/whatsapp/__tests__/teams-db.test.ts src/lib/whatsapp/__tests__/fakes/team-deps.ts
git commit -m "feat(whatsapp): team data layer (TeamDeps) + in-memory fake

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Day planner — open/done state, morning and summary times, overdue, take keys

**Files:**
- Create: `supabase/functions/_shared/channels/team-day.ts`
- Test: `src/lib/whatsapp/__tests__/team-day.test.ts`

**Interfaces:**
- Consumes: `dueAtSite` (`checklists-core/due.ts`), `deadlineUtc`, `periodStartUtc` (`checklists-core/time.ts`), `localDate` (`live-list.ts`), `CompletionWho` (`groups-db.ts`), `fakes/team-deps.ts` (`tpl`, `NOW`).
- Produces:

```ts
export const MORNING_LEAD_MS = 3600_000       // morning list = earliest deadline − 1 h
export const SUMMARY_DELAY_MS = 3600_000      // missed summary = latest deadline + 1 h
export const OVERDUE_WINDOW_MS = 3600_000     // overdue nudge goes out within an hour of the deadline
export const MORNING_FALLBACK = '08:00'       // no deadline among the team's checklists
export const SUMMARY_FALLBACK = '22:00'
export const SUMMARY_LATEST = '23:50'         // a late deadline must not push the summary into tomorrow
export interface DoneItem { template: Template; completedAt: string; by: string | null }   // by = profile id
export interface TeamDayState { open: DueChecklist[]; done: DoneItem[] }
export interface TeamDayPlan { date: string; state: TeamDayState; morning: boolean; overdue: DueChecklist[]; summary: boolean }
export function countsToday(t: Template): boolean                                     // daily / multi-per-day / has a deadline
export function todayOnly(s: TeamDayState): TeamDayState
export function teamDayState(a: { templates: Template[]; siteId: string; tz: string; now: Date; completions: CompletionWho[] }): TeamDayState
export function teamDayTimes(templates: Template[], tz: string, now: Date): { morningAt: Date; summaryAt: Date; date: string }
export function planTeamDay(a: { templates: Template[]; siteId: string; tz: string; now: Date; completions: CompletionWho[] }): TeamDayPlan
export function takePeriodKey(t: Pick<Template, 'multi_per_day'>, periodKey: string, doneInPeriod: number): string
export function doneInPeriod(t: Template, siteId: string, tz: string, now: Date, completions: CompletionWho[]): number
export function summaryParams(team: string, site: string, s: TeamDayState): [string, string, string, string, string]   // team_day_summary {{1}}…{{5}}
```

Ruling (spec silent): a weekly/monthly checklist *without* a deadline is listed in the morning list and the menu, but does not count as "missed" in the summary and does not block the 🎉 (otherwise a weekly deep clean would be "missed" every evening until Sunday). `countsToday` encodes this.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/whatsapp/__tests__/team-day.test.ts
import { describe, it, expect } from 'vitest'
import { planTeamDay, teamDayState, teamDayTimes, takePeriodKey, doneInPeriod, summaryParams, todayOnly } from '../../../../supabase/functions/_shared/channels/team-day'
import { tpl, NOW } from './fakes/team-deps'

const LON = 'Europe/London'
const FRIDGE = tpl({ id: 'tA', name: 'Fridge temps', deadline_time: '11:00' })      // 10:00Z (BST)
const HOT = tpl({ id: 'tB', name: 'Hot holding', deadline_time: '15:00' })          // 14:00Z
const CLEAN = tpl({ id: 'tC', name: 'Cleaning' })                                    // daily, no deadline
const DEEP = tpl({ id: 'tW', name: 'Deep clean', frequency: 'weekly' })             // weekly, no deadline
const at = (iso: string) => new Date(iso)
const plan = (now: Date, templates = [FRIDGE, HOT, CLEAN], completions: any[] = []) => planTeamDay({ templates, siteId: 's1', tz: LON, now, completions })

describe('teamDayTimes', () => {
  it('morning = earliest deadline − 1 h; summary = latest deadline + 1 h', () => {
    const t = teamDayTimes([FRIDGE, HOT, CLEAN], LON, NOW)
    expect(t.morningAt.toISOString()).toBe('2026-10-14T09:00:00.000Z')
    expect(t.summaryAt.toISOString()).toBe('2026-10-14T15:00:00.000Z')
    expect(t.date).toBe('2026-10-14')
  })
  it('no deadlines → 08:00 and 22:00 site time', () => {
    const t = teamDayTimes([CLEAN], LON, NOW)
    expect(t.morningAt.toISOString()).toBe('2026-10-14T07:00:00.000Z')
    expect(t.summaryAt.toISOString()).toBe('2026-10-14T21:00:00.000Z')
  })
  it('site timezone, not London', () => {
    const t = teamDayTimes([FRIDGE], 'America/New_York', at('2026-10-14T14:00:00Z'))
    expect(t.morningAt.toISOString()).toBe('2026-10-14T14:00:00.000Z')   // 11:00 EDT − 1 h = 10:00 EDT
  })
  it('a 23:30 deadline does not push the summary past 23:50 local', () => {
    const t = teamDayTimes([tpl({ id: 'late', name: 'Close down', deadline_time: '23:30' })], LON, NOW)
    expect(t.summaryAt.toISOString()).toBe('2026-10-14T22:50:00.000Z')
  })
  // Review Focus 1: the clocks go back in London at 02:00 on Sunday 25 Oct 2026.
  it('DST day: 1 h before a 09:00 deadline is 08:00 GMT on the 25th, 07:00Z the day before; fallback 08:00 likewise', () => {
    const nine = tpl({ id: 'n', name: 'Opening', deadline_time: '09:00' })
    expect(teamDayTimes([nine], LON, at('2026-10-24T12:00:00Z')).morningAt.toISOString()).toBe('2026-10-24T07:00:00.000Z')
    expect(teamDayTimes([nine], LON, at('2026-10-25T12:00:00Z')).morningAt.toISOString()).toBe('2026-10-25T08:00:00.000Z')
    expect(teamDayTimes([CLEAN], LON, at('2026-10-25T00:30:00Z')).morningAt.toISOString()).toBe('2026-10-25T08:00:00.000Z')
    expect(plan(at('2026-10-25T07:59:00Z'), [nine]).morning).toBe(false)
    expect(plan(at('2026-10-25T08:00:00Z'), [nine]).morning).toBe(true)
  })
})

describe('teamDayState', () => {
  it('open by assignment-free due logic; done = latest completion in the period with who did it', () => {
    const s = teamDayState({ templates: [FRIDGE, CLEAN], siteId: 's1', tz: LON, now: NOW, completions: [
      { template_id: 'tC', site_id: 's1', completed_at: '2026-10-14T07:00:00Z', completed_by: 'p2' },
      { template_id: 'tC', site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' },
      { template_id: 'tA', site_id: 's2', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' },   // other site
      { template_id: 'tA', site_id: 's1', completed_at: '2026-10-13T08:00:00Z', completed_by: 'p1' },   // yesterday
    ] })
    expect(s.open.map((x) => x.template.id)).toEqual(['tA'])
    expect(s.done).toEqual([{ template: CLEAN, completedAt: '2026-10-14T08:00:00Z', by: 'p1' }])
  })
})

describe('planTeamDay', () => {
  it('morning from earliest deadline − 1 h until the summary time, only with something open', () => {
    expect(plan(at('2026-10-14T08:59:00Z')).morning).toBe(false)
    expect(plan(at('2026-10-14T09:00:00Z')).morning).toBe(true)
    expect(plan(at('2026-10-14T14:59:00Z')).morning).toBe(true)
    expect(plan(at('2026-10-14T15:00:00Z')).morning).toBe(false)
    const allDone = ['tA', 'tB', 'tC'].map((id) => ({ template_id: id, site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' }))
    expect(plan(at('2026-10-14T09:30:00Z'), [FRIDGE, HOT, CLEAN], allDone).morning).toBe(false)
  })
  it('overdue: an open checklist from its deadline for an hour', () => {
    expect(plan(at('2026-10-14T09:59:00Z')).overdue).toEqual([])
    expect(plan(at('2026-10-14T10:00:00Z')).overdue.map((x) => x.template.id)).toEqual(['tA'])
    expect(plan(at('2026-10-14T10:59:00Z')).overdue.map((x) => x.template.id)).toEqual(['tA'])
    expect(plan(at('2026-10-14T11:00:00Z')).overdue).toEqual([])
    expect(plan(at('2026-10-14T10:10:00Z'), [FRIDGE], [{ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T10:05:00Z', completed_by: 'p1' }]).overdue).toEqual([])
  })
  it('summary from latest deadline + 1 h when something that counts today is open', () => {
    expect(plan(at('2026-10-14T14:59:00Z')).summary).toBe(false)
    expect(plan(at('2026-10-14T15:00:00Z')).summary).toBe(true)
    const doneToday = ['tA', 'tB', 'tC'].map((id) => ({ template_id: id, site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' }))
    expect(plan(at('2026-10-14T15:00:00Z'), [FRIDGE, HOT, CLEAN, DEEP], doneToday).summary).toBe(false)   // only the weekly is open
  })
})

describe('take keys, counts, summary params', () => {
  it('one take per period; multi-per-day: one per slot', () => {
    expect(takePeriodKey({ multi_per_day: false }, '2026-10-14', 0)).toBe('2026-10-14')
    expect(takePeriodKey({ multi_per_day: true }, '2026-10-14', 0)).toBe('2026-10-14#1')
    expect(takePeriodKey({ multi_per_day: true }, '2026-10-14', 2)).toBe('2026-10-14#3')
  })
  it('doneInPeriod counts this site and period only', () => {
    const t = tpl({ id: 'm', name: 'Probe', multi_per_day: true, min_per_day: 3 })
    expect(doneInPeriod(t, 's1', LON, NOW, [
      { template_id: 'm', site_id: 's1', completed_at: '2026-10-14T07:00:00Z', completed_by: 'p1' },
      { template_id: 'm', site_id: 's1', completed_at: '2026-10-13T21:00:00Z', completed_by: 'p1' },
      { template_id: 'm', site_id: 's2', completed_at: '2026-10-14T07:00:00Z', completed_by: 'p1' },
    ])).toBe(1)
  })
  it('summary params count today’s checklists; missed names in deadline order', () => {
    const s = teamDayState({ templates: [HOT, FRIDGE, CLEAN, DEEP], siteId: 's1', tz: LON, now: at('2026-10-14T15:00:00Z'),
      completions: [{ template_id: 'tC', site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' }] })
    expect(summaryParams('Kitchen', 'Ashfield Row', s)).toEqual(['Kitchen', 'Ashfield Row', '1', '3', 'Fridge temps, Hot holding'])
    expect(todayOnly(s).open.map((x) => x.template.id)).toEqual(['tB', 'tA'])   // template order; the weekly is left out
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/team-day.test.ts`
Expected: FAIL — `Failed to resolve import ".../channels/team-day"`.

- [ ] **Step 3: Implement**

```ts
// supabase/functions/_shared/channels/team-day.ts
// A WhatsApp team's day (spec 2026-10-12 §5), pure: what is open/done at the team's site, when the morning list and the
// missed summary are due, which checklists are overdue now, and the "first submit wins" take key.
import type { DueChecklist, Template } from '../checklists-core/types.ts'
import { dueAtSite } from '../checklists-core/due.ts'
import { deadlineUtc, periodStartUtc } from '../checklists-core/time.ts'
import { localDate } from './live-list.ts'
import type { CompletionWho } from './groups-db.ts'

export const MORNING_LEAD_MS = 3600_000
export const SUMMARY_DELAY_MS = 3600_000
export const OVERDUE_WINDOW_MS = 3600_000
export const MORNING_FALLBACK = '08:00'
export const SUMMARY_FALLBACK = '22:00'
export const SUMMARY_LATEST = '23:50'

export interface DoneItem { template: Template; completedAt: string; by: string | null }
export interface TeamDayState { open: DueChecklist[]; done: DoneItem[] }
export interface TeamDayPlan { date: string; state: TeamDayState; morning: boolean; overdue: DueChecklist[]; summary: boolean }
type DayArgs = { templates: Template[]; siteId: string; tz: string; now: Date; completions: CompletionWho[] }

const freqOf = (t: Template) => (t.multi_per_day ? 'daily' : t.frequency)

/** Counts towards "missed" and "all done": daily or several-a-day checklists, and anything with a deadline. */
export const countsToday = (t: Template): boolean => t.multi_per_day || t.frequency === 'daily' || !!t.deadline_time

export function todayOnly(s: TeamDayState): TeamDayState {
  return { open: s.open.filter((x) => countsToday(x.template)), done: s.done.filter((x) => countsToday(x.template)) }
}

export function teamDayState(a: DayArgs): TeamDayState {
  const open = dueAtSite({ templates: a.templates, siteId: a.siteId, tz: a.tz, now: a.now, completions: a.completions })
  const openIds = new Set(open.map((x) => x.template.id))
  const done = a.templates.filter((t) => t.active && (t.site_id === null || t.site_id === a.siteId) && !openIds.has(t.id)).flatMap((t) => {
    const start = periodStartUtc(freqOf(t), a.now, a.tz).getTime()
    const last = a.completions
      .filter((c) => c.template_id === t.id && c.site_id === a.siteId && new Date(c.completed_at).getTime() >= start)
      .sort((x, y) => new Date(y.completed_at).getTime() - new Date(x.completed_at).getTime())[0]
    return last ? [{ template: t, completedAt: last.completed_at, by: last.completed_by ?? null }] : []
  })
  return { open, done }
}

const atLocal = (hhmm: string, now: Date, tz: string): Date => deadlineUtc(hhmm, now, tz)!

export function teamDayTimes(templates: Template[], tz: string, now: Date): { morningAt: Date; summaryAt: Date; date: string } {
  const deadlines = templates.filter((t) => t.active && t.deadline_time)
    .map((t) => deadlineUtc(t.deadline_time, now, tz)).filter((x): x is Date => !!x).map((x) => x.getTime())
  const morningAt = deadlines.length ? new Date(Math.min(...deadlines) - MORNING_LEAD_MS) : atLocal(MORNING_FALLBACK, now, tz)
  const summaryAt = deadlines.length
    ? new Date(Math.min(Math.max(...deadlines) + SUMMARY_DELAY_MS, atLocal(SUMMARY_LATEST, now, tz).getTime()))
    : atLocal(SUMMARY_FALLBACK, now, tz)
  return { morningAt, summaryAt, date: localDate(now, tz) }
}

export function planTeamDay(a: DayArgs): TeamDayPlan {
  const state = teamDayState(a)
  const { morningAt, summaryAt, date } = teamDayTimes(a.templates, a.tz, a.now)
  const t = a.now.getTime()
  return {
    date, state,
    morning: state.open.length > 0 && t >= morningAt.getTime() && t < summaryAt.getTime(),
    overdue: state.open.filter((x) => {
      if (!x.deadline_utc) return false
      const dl = new Date(x.deadline_utc).getTime()
      return t >= dl && t < dl + OVERDUE_WINDOW_MS
    }),
    summary: todayOnly(state).open.length > 0 && t >= summaryAt.getTime(),
  }
}

/** One take per (team, checklist, site, period); a several-a-day checklist has one take per slot (#1, #2, …). */
export function takePeriodKey(t: Pick<Template, 'multi_per_day'>, periodKey: string, done: number): string {
  return t.multi_per_day ? `${periodKey}#${done + 1}` : periodKey
}

export function doneInPeriod(t: Template, siteId: string, tz: string, now: Date, completions: CompletionWho[]): number {
  const start = periodStartUtc(freqOf(t), now, tz).getTime()
  return completions.filter((c) => c.template_id === t.id && c.site_id === siteId && new Date(c.completed_at).getTime() >= start).length
}

const byDeadline = (a: DueChecklist, b: DueChecklist) =>
  (a.deadline_utc ?? '9').localeCompare(b.deadline_utc ?? '9') || a.template.name.localeCompare(b.template.name)

/** team_day_summary {{1}} team, {{2}} site, {{3}} done, {{4}} total, {{5}} missed names — today's checklists only. */
export function summaryParams(team: string, site: string, s: TeamDayState): [string, string, string, string, string] {
  const t = todayOnly(s)
  return [team, site, String(t.done.length), String(t.open.length + t.done.length), [...t.open].sort(byDeadline).map((x) => x.template.name).join(', ')]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/whatsapp/__tests__/team-day.test.ts`
Expected: PASS.

- [ ] **Step 5: Full checks** — `npm test`, tsc count `3`, `deno check` line → ok.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/channels/team-day.ts src/lib/whatsapp/__tests__/team-day.test.ts
git commit -m "feat(whatsapp): team day planner (morning, overdue, summary, take keys)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Membership — add, invite, resend, Join, unreachable

**Files:**
- Create: `supabase/functions/_shared/channels/team-members.ts`
- Test: `src/lib/whatsapp/__tests__/team-members.test.ts`

**Interfaces:**
- Consumes: `TeamDeps`, `Team`, `TeamMember` (Task 3); `templateMessage`, `textMessage` (`whatsapp.ts`); `isBillable` (`service-window.ts`); `TEAM_TEXT`, `firstName` (`team-text.ts`); `maskPhone`; `SendFn`, `SendResult`, `OutboundMessage`, `DeliveryStatus` (`types.ts`); fakes from Task 3.
- Produces:

```ts
export const INVITE_TTL_MS: number                     // 14 days
export const UNREACHABLE_CODES: Set<number>            // 131026, 131047, 131051
export const TEMPLATE_MISSING_CODES: Set<number>       // 132001 (template not approved / not found)
export type InviteOutcome = 'invited' | 'already_member' | 'too_soon' | 'failed' | 'template_missing'
export interface TrackedSend { to: string; msg: OutboundMessage; business_id: string | null; site_id: string | null; profile_id: string | null; kind: string; template_name?: string; lastInboundAt: string | null }
export async function sendTracked(t: TeamDeps, send: SendFn, a: TrackedSend): Promise<SendResult>   // send + log (billable) + unreachable flag
export const inviteMessage: (to: string, a: { business: string; team: string; site: string; memberId: string }) => OutboundMessage   // team_invite, quick reply payload join:<member id>
export interface AddPerson { team: Team; phone: string; name: string; profileId?: string | null; invitedBy: string }
export async function addPersonToTeam(t: TeamDeps, send: SendFn, a: AddPerson): Promise<{ outcome: InviteOutcome; member: TeamMember | null }>
export async function resendInvite(t: TeamDeps, send: SendFn, memberId: string): Promise<{ outcome: InviteOutcome | 'not_invited'; member: TeamMember | null }>
export async function handleJoin(t: TeamDeps, send: SendFn, a: { from: string; memberId: string }): Promise<void>
export async function applyDeliveryStatuses(t: TeamDeps, list: DeliveryStatus[]): Promise<void>
```

Rulings (spec silent): an invite's age for the 14 days counts from the **last send** (`last_invite_sent_at`, else `invited_at`), so "Resend invite" renews it. A failed send releases the hourly resend slot. On Join, a number linked to another business moves here (the person's own tap is the consent, as LINK did); Review Focus 4.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/whatsapp/__tests__/team-members.test.ts
import { describe, it, expect } from 'vitest'
import { addPersonToTeam, resendInvite, handleJoin, applyDeliveryStatuses, sendTracked, INVITE_TTL_MS } from '../../../../supabase/functions/_shared/channels/team-members'
import { TEAM_TEXT } from '../../../../supabase/functions/_shared/channels/team-text'
import { textMessage } from '../../../../supabase/functions/_shared/channels/whatsapp'
import { fakeTeamDeps, fakeSend, member, TEAM, ANNA, BEN, BOSS, NOW } from './fakes/team-deps'

const MARIA = '447700900777'
const textOf = (m: any) => m?.text?.body
const invitedMaria = (o: Partial<Parameters<typeof member>[0]> = {}) =>
  member({ id: 'gm9', profile_id: 'p9', phone: MARIA, status: 'invited', full_name: 'Maria Lopez', joined_at: null, last_invite_sent_at: '2026-10-14T09:00:00Z', invited_at: '2026-10-14T09:00:00Z', ...o })

describe('addPersonToTeam', () => {
  it('a new number → chat-only member at the team site, invited, team_invite with Join payload', async () => {
    const { d, s } = fakeTeamDeps()
    const w = fakeSend()
    const r = await addPersonToTeam(d, w.send, { team: TEAM, phone: MARIA, name: 'Maria Lopez', invitedBy: BOSS.profile_id })
    expect(r.outcome).toBe('invited')
    expect(s.created).toEqual([{ businessId: 'b', siteId: 's1', fullName: 'Maria Lopez', profile_id: 'new1' }])
    expect(s.members.find((m) => m.profile_id === 'new1')).toMatchObject({ status: 'invited', phone: MARIA, invited_by: 'm1', last_invite_sent_at: NOW.toISOString() })
    expect(w.sent).toHaveLength(1)
    expect(w.sent[0]).toMatchObject({ to: MARIA, template: { name: 'team_invite', language: { code: 'en_GB' } } })
    expect(w.sent[0].template.components[0].parameters.map((p: any) => p.text)).toEqual(['Fern & Fig', 'Kitchen', 'Ashfield Row'])
    expect(w.sent[0].template.components[1].parameters[0].payload).toBe(`join:${r.member!.id}`)
    expect(s.logs).toMatchObject([{ kind: 'team_invite', template_name: 'team_invite', billable: true, direction: 'out' }])
  })
  it('a number linked in this business → that profile is reused', async () => {
    const { d, s } = fakeTeamDeps({ members: [] })
    const r = await addPersonToTeam(d, fakeSend().send, { team: TEAM, phone: ANNA.phone, name: 'Whatever', invitedBy: 'm1' })
    expect(r.member).toMatchObject({ profile_id: ANNA.profile_id, status: 'invited' })
    expect(s.created).toEqual([])
  })
  it('a picked Team member with a phone → that profile', async () => {
    const { d, s } = fakeTeamDeps()
    const r = await addPersonToTeam(d, fakeSend().send, { team: TEAM, phone: BEN.phone, name: 'Ben Jones', profileId: BEN.profile_id, invitedBy: 'm1' })
    expect(r.member).toMatchObject({ profile_id: BEN.profile_id, phone: BEN.phone })
    expect(s.created).toEqual([])
  })
  it('an active, connected member → already_member, nothing sent', async () => {
    const { d } = fakeTeamDeps()
    const w = fakeSend()
    expect((await addPersonToTeam(d, w.send, { team: TEAM, phone: ANNA.phone, name: 'Anna', invitedBy: 'm1' })).outcome).toBe('already_member')
    expect(w.sent).toEqual([])
  })
  it('a removed member added again → same profile, invited again (the earlier send was > 1 h ago)', async () => {
    const { d, s } = fakeTeamDeps({ members: [member({ id: 'gm1', profile_id: 'p7', phone: MARIA, status: 'removed', removed_at: '2026-10-10T09:00:00Z' })] })
    const r = await addPersonToTeam(d, fakeSend().send, { team: TEAM, phone: MARIA, name: 'Maria', invitedBy: 'm1' })
    expect(r).toMatchObject({ outcome: 'invited', member: { id: 'gm1', profile_id: 'p7' } })
    expect(s.members[0].status).toBe('invited')
    expect(s.created).toEqual([])
  })
  it('a member who sent STOP (identity revoked) is invited again, not "already in"', async () => {
    const { d, s } = fakeTeamDeps()
    s.identities[0].revoked = true
    expect((await addPersonToTeam(d, fakeSend().send, { team: TEAM, phone: ANNA.phone, name: 'Anna', invitedBy: 'm1' })).outcome).toBe('invited')
  })
  it('Meta error 131026 → member flagged unreachable, outcome failed, resend slot given back', async () => {
    const { d, s } = fakeTeamDeps()
    const w = fakeSend(() => ({ ok: false, status: 400, id: null, errorCode: 131026 }))
    const r = await addPersonToTeam(d, w.send, { team: TEAM, phone: MARIA, name: 'Maria', invitedBy: 'm1' })
    expect(r.outcome).toBe('failed')
    expect(s.members.find((m) => m.phone === MARIA)).toMatchObject({ unreachable_at: NOW.toISOString(), last_invite_sent_at: null })
  })
  // Review Focus 5: the template is not approved yet.
  it('template not approved (132001) → template_missing; not unreachable; resend possible right away', async () => {
    const { d, s } = fakeTeamDeps()
    const down = fakeSend(() => ({ ok: false, status: 404, id: null, errorCode: 132001 }))
    const r = await addPersonToTeam(d, down.send, { team: TEAM, phone: MARIA, name: 'Maria', invitedBy: 'm1' })
    expect(r.outcome).toBe('template_missing')
    expect(s.members.find((m) => m.phone === MARIA)).toMatchObject({ unreachable_at: null, last_invite_sent_at: null })
    expect((await resendInvite(d, fakeSend().send, r.member!.id)).outcome).toBe('invited')
  })
})

describe('resendInvite', () => {
  it('at most once per hour; only for invited members', async () => {
    const { d, s } = fakeTeamDeps({ members: [invitedMaria()] })
    const w = fakeSend()
    expect((await resendInvite(d, w.send, 'gm9')).outcome).toBe('too_soon')        // sent 40 min ago
    s.now = new Date('2026-10-14T10:00:00Z')
    expect((await resendInvite(d, w.send, 'gm9')).outcome).toBe('invited')
    expect(w.sent).toHaveLength(1)
    const active = fakeTeamDeps()
    expect((await resendInvite(active.d, w.send, 'gm1')).outcome).toBe('not_invited')
  })
})

describe('handleJoin', () => {
  it('from the invited phone → identity (team_invite), active, reply, inviter told in the app', async () => {
    const { d, s } = fakeTeamDeps({ members: [invitedMaria()], people: [{ profile_id: 'p9', business_id: 'b', full_name: 'Maria Lopez', role: 'kitchen_staff', role_id: null }, { profile_id: 'm1', business_id: 'b', full_name: 'Kostya Boss', role: 'owner', role_id: null }] })
    const w = fakeSend()
    await handleJoin(d, w.send, { from: MARIA, memberId: 'gm9' })
    expect(s.members[0]).toMatchObject({ status: 'active', joined_at: NOW.toISOString() })
    expect(s.identities.find((i) => i.phone === MARIA && !i.revoked)).toMatchObject({ business_id: 'b', profile_id: 'p9', consent_source: 'team_invite' })
    expect(textOf(w.sent[0])).toBe(TEAM_TEXT.joined('Kitchen', 'Ashfield Row'))
    expect(w.sent).toHaveLength(1)                                      // Kostya's window is closed → app notification instead
    expect(s.notifications).toEqual([{ user_id: 'm1', type: 'team', title: 'Joined WhatsApp team', message: 'Maria joined Kitchen ✓', link: '/settings' }])
  })
  it('the inviter with an open window gets it in WhatsApp', async () => {
    const { d, s } = fakeTeamDeps({ members: [invitedMaria()] })
    s.identities[1].last_inbound_at = '2026-10-14T08:00:00Z'
    const w = fakeSend()
    await handleJoin(d, w.send, { from: MARIA, memberId: 'gm9' })
    expect(w.sent.map((m) => [m.to, textOf(m)])).toEqual([[MARIA, TEAM_TEXT.joined('Kitchen', 'Ashfield Row')], [BOSS.phone, 'Maria joined Kitchen ✓']])
    expect(s.notifications).toEqual([])
  })
  it('a join payload from any other phone is ignored', async () => {
    const { d, s } = fakeTeamDeps({ members: [invitedMaria()] })
    const w = fakeSend()
    await handleJoin(d, w.send, { from: BEN.phone, memberId: 'gm9' })
    expect(w.sent).toEqual([])
    expect(s.members[0].status).toBe('invited')
  })
  it('older than 14 days → expired; removed → expired', async () => {
    const old = new Date(NOW.getTime() - INVITE_TTL_MS - 60_000).toISOString()
    const a = fakeTeamDeps({ members: [invitedMaria({ last_invite_sent_at: old, invited_at: old })] })
    const w = fakeSend()
    await handleJoin(a.d, w.send, { from: MARIA, memberId: 'gm9' })
    expect(textOf(w.sent[0])).toBe(TEAM_TEXT.inviteExpired)
    expect(a.s.members[0].status).toBe('invited')
    const b = fakeTeamDeps({ members: [invitedMaria({ status: 'removed' })] })
    await handleJoin(b.d, w.send, { from: MARIA, memberId: 'gm9' })
    expect(textOf(w.sent[1])).toBe(TEAM_TEXT.inviteExpired)
  })
  it('business cannot use WhatsApp now → unavailable, still invited', async () => {
    const { d, s } = fakeTeamDeps({ members: [invitedMaria()], ready: { b: false } })
    const w = fakeSend()
    await handleJoin(d, w.send, { from: MARIA, memberId: 'gm9' })
    expect(textOf(w.sent[0])).toBe(TEAM_TEXT.unavailable)
    expect(s.members[0].status).toBe('invited')
  })
  // Review Focus 4: the number is linked in another business.
  it('a number linked in another business: the invite goes out; Join moves the number here', async () => {
    const { d, s } = fakeTeamDeps({ members: [] })
    s.identities.push({ id: 'idX', business_id: 'other', profile_id: 'px', phone: MARIA, last_inbound_at: null, revoked: false, consent_source: 'qr_code' })
    const w = fakeSend()
    const r = await addPersonToTeam(d, w.send, { team: TEAM, phone: MARIA, name: 'Maria', invitedBy: 'm1' })
    expect(r.outcome).toBe('invited')
    expect(s.created.map((c) => c.businessId)).toEqual(['b'])           // a profile in THIS business, not the other one's
    await handleJoin(d, w.send, { from: MARIA, memberId: r.member!.id })
    expect(s.identities.find((i) => i.id === 'idX')!.revoked).toBe(true)
    expect(s.identities.filter((i) => i.phone === MARIA && !i.revoked)).toMatchObject([{ business_id: 'b', profile_id: 'new1', consent_source: 'team_invite' }])
  })
})

describe('delivery statuses and tracked sends', () => {
  it('131047 / 131051 failures flag the number; delivered or read clears it', async () => {
    const { d, s } = fakeTeamDeps({ members: [invitedMaria(), member({ id: 'gm2', profile_id: 'p2', phone: BEN.phone })] })
    await applyDeliveryStatuses(d, [{ id: 'w1', recipient: MARIA, status: 'failed', errorCode: 131047 }, { id: 'w2', recipient: BEN.phone, status: 'failed', errorCode: 131051 }])
    expect(s.members.map((m) => m.unreachable_at)).toEqual([NOW.toISOString(), NOW.toISOString()])
    await applyDeliveryStatuses(d, [{ id: 'w3', recipient: MARIA, status: 'delivered', errorCode: null }, { id: 'w4', recipient: BEN.phone, status: 'failed', errorCode: 130472 }])
    expect(s.members.map((m) => m.unreachable_at)).toEqual([null, NOW.toISOString()])
  })
  it('sendTracked logs billable only for a template outside the window', async () => {
    const { d, s } = fakeTeamDeps()
    await sendTracked(d, fakeSend().send, { to: ANNA.phone, msg: textMessage(ANNA.phone, 'hi'), business_id: 'b', site_id: null, profile_id: 'p1', kind: 'reply', lastInboundAt: null })
    expect(s.logs[0]).toMatchObject({ kind: 'reply', billable: false, wa_message_id: 'w1' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/team-members.test.ts`
Expected: FAIL — `Failed to resolve import ".../channels/team-members"`.

- [ ] **Step 3: Implement**

```ts
// supabase/functions/_shared/channels/team-members.ts
// WhatsApp team membership (spec 2026-10-12 §4): add a person (reuse a linked profile or create a chat-only one),
// send / resend the team_invite template, Join = consent, delivery statuses → "Not reachable".
// Pure over TeamDeps + SendFn (unit-tested with fakes). Never logs raw phone numbers.
import type { DeliveryStatus, OutboundMessage, SendFn, SendResult } from './types.ts'
import { templateMessage, textMessage } from './whatsapp.ts'
import { isBillable } from './service-window.ts'
import { maskPhone } from './mask.ts'
import { TEAM_TEXT, firstName } from './team-text.ts'
import type { Team, TeamDeps, TeamMember } from './teams-db.ts'

export const INVITE_TTL_MS = 14 * 86400_000
export const UNREACHABLE_CODES = new Set([131026, 131047, 131051])
export const TEMPLATE_MISSING_CODES = new Set([132001])
export type InviteOutcome = 'invited' | 'already_member' | 'too_soon' | 'failed' | 'template_missing'

export interface TrackedSend {
  to: string; msg: OutboundMessage; business_id: string | null; site_id: string | null; profile_id: string | null
  kind: string; template_name?: string; lastInboundAt: string | null
}

/** Send, log (billable = a template outside the 24 h window), flag the number on Meta's "can't reach" errors. */
export async function sendTracked(t: TeamDeps, send: SendFn, a: TrackedSend): Promise<SendResult> {
  const r = await send(a.msg)
  const now = t.now()
  if (!r.ok) {
    console.error('whatsapp team send failed', a.kind, maskPhone(a.to), r.status, r.errorCode ?? '')
    if (r.errorCode != null && UNREACHABLE_CODES.has(r.errorCode)) await t.setUnreachable(a.to, now)
  }
  await t.log({ business_id: a.business_id, site_id: a.site_id, profile_id: a.profile_id, direction: 'out', kind: a.kind,
    template_name: a.template_name, billable: r.ok && !!a.template_name && isBillable(a.lastInboundAt, now), wa_message_id: r.id })
  return r
}

export const inviteMessage = (to: string, a: { business: string; team: string; site: string; memberId: string }): OutboundMessage =>
  templateMessage(to, 'team_invite', [a.business, a.team, a.site], [`join:${a.memberId}`])

async function sendInvite(t: TeamDeps, send: SendFn, team: Team, m: TeamMember): Promise<InviteOutcome> {
  const now = t.now()
  if (!(await t.claimInviteSend(m.id, now))) return 'too_soon'
  const [business, site, ident] = await Promise.all([t.businessName(team.business_id), t.site(team.site_id), t.identityByPhone(m.phone)])
  const r = await sendTracked(t, send, {
    to: m.phone, msg: inviteMessage(m.phone, { business, team: team.title, site: site?.name ?? '', memberId: m.id }),
    business_id: team.business_id, site_id: team.site_id, profile_id: m.profile_id, kind: 'team_invite', template_name: 'team_invite',
    lastInboundAt: ident?.last_inbound_at ?? null,
  })
  if (r.ok) return 'invited'
  await t.releaseInviteSend(m.id, now.toISOString(), m.last_invite_sent_at)   // a failed send doesn't use up the hourly resend
  return r.errorCode != null && TEMPLATE_MISSING_CODES.has(r.errorCode) ? 'template_missing' : 'failed'
}

export interface AddPerson { team: Team; phone: string; name: string; profileId?: string | null; invitedBy: string }

/**
 * Spec §4 Add: a number linked in this business reuses that profile; a number already in this team's member list
 * (e.g. removed earlier) reuses its profile; otherwise a chat-only member is created at the team's site.
 */
export async function addPersonToTeam(t: TeamDeps, send: SendFn, a: AddPerson): Promise<{ outcome: InviteOutcome; member: TeamMember | null }> {
  const ident = await t.identityByPhone(a.phone)
  const linkedHere = ident && ident.business_id === a.team.business_id ? ident : null
  let profileId = a.profileId ?? linkedHere?.profile_id ?? null
  if (!profileId) {
    const prior = (await t.members(a.team.id)).find((m) => m.phone === a.phone)
    profileId = prior?.profile_id ?? await t.createStaffMember({ businessId: a.team.business_id, siteId: a.team.site_id, fullName: a.name })
  }
  const existing = await t.memberFor(a.team.id, profileId)
  const connected = !!linkedHere && linkedHere.profile_id === profileId
  if (existing?.status === 'active' && existing.phone === a.phone && connected) return { outcome: 'already_member', member: existing }
  const m = await t.upsertInvited({ group_id: a.team.id, profile_id: profileId, phone: a.phone, invited_by: a.invitedBy, now: t.now() })
  return { outcome: await sendInvite(t, send, a.team, m), member: m }
}

/** Settings "Resend invite": invited members only, at most once per hour. */
export async function resendInvite(t: TeamDeps, send: SendFn, memberId: string): Promise<{ outcome: InviteOutcome | 'not_invited'; member: TeamMember | null }> {
  const m = await t.memberById(memberId)
  const team = m ? await t.teamById(m.group_id) : null
  if (!m || !team || m.status !== 'invited') return { outcome: 'not_invited', member: m }
  return { outcome: await sendInvite(t, send, team, m), member: m }
}

/** Inbound quick reply `join:<member id>`. Only the invited phone may use it; anything else is ignored silently. */
export async function handleJoin(t: TeamDeps, send: SendFn, a: { from: string; memberId: string }): Promise<void> {
  const now = t.now()
  const m = await t.memberById(a.memberId)
  if (!m || m.phone !== a.from) return
  const team = await t.teamById(m.group_id)
  // The person just wrote to us: their window is open, so these replies are free.
  const reply = (body: string) => sendTracked(t, send, { to: a.from, msg: textMessage(a.from, body), business_id: team?.business_id ?? null,
    site_id: team?.site_id ?? null, profile_id: m.profile_id, kind: 'reply', lastInboundAt: now.toISOString() })
  if (!team || m.status === 'removed') { await reply(TEAM_TEXT.inviteExpired); return }
  const site = await t.site(team.site_id)
  const joined = TEAM_TEXT.joined(team.title, site?.name ?? '')
  if (m.status === 'active') { await reply(joined); return }
  if (now.getTime() - new Date(m.last_invite_sent_at ?? m.invited_at).getTime() > INVITE_TTL_MS) { await reply(TEAM_TEXT.inviteExpired); return }
  if (!(await t.ready(team.business_id))) { await reply(TEAM_TEXT.unavailable); return }
  await t.linkIdentity({ business_id: team.business_id, profile_id: m.profile_id, phone: m.phone, linked_by: m.invited_by, now })
  await t.activateMember(m.id, now)
  await t.setUnreachable(m.phone, null)
  console.log('whatsapp team joined', team.id, maskPhone(m.phone))
  await reply(joined)
  await tellInviter(t, send, team, m, now)
}

/** "<first name> joined <team> ✓" to whoever added them: WhatsApp if linked and inside their window, else the app. */
async function tellInviter(t: TeamDeps, send: SendFn, team: Team, m: TeamMember, now: Date): Promise<void> {
  if (!m.invited_by) return
  const body = TEAM_TEXT.managerJoined(firstName(m.full_name) || 'Someone', team.title)
  const mc = (await t.managerContacts(team.business_id)).find((x) => x.profile_id === m.invited_by)
  if (mc && !isBillable(mc.last_inbound_at, now)) {
    const r = await sendTracked(t, send, { to: mc.phone, msg: textMessage(mc.phone, body), business_id: team.business_id, site_id: team.site_id,
      profile_id: mc.profile_id, kind: 'team_joined', lastInboundAt: mc.last_inbound_at })
    if (r.ok) return
  }
  await t.insertNotifications([{ user_id: m.invited_by, type: 'team', title: TEAM_TEXT.joinedTitle, message: body, link: '/settings' }])
}

/** Webhook `statuses`: Meta's "can't reach this number" errors flag it; a delivered/read message clears the flag. */
export async function applyDeliveryStatuses(t: TeamDeps, list: DeliveryStatus[]): Promise<void> {
  const now = t.now()
  for (const s of list) {
    if (s.status === 'failed' && s.errorCode != null && UNREACHABLE_CODES.has(s.errorCode)) await t.setUnreachable(s.recipient, now)
    else if (s.status === 'delivered' || s.status === 'read') await t.setUnreachable(s.recipient, null)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/whatsapp/__tests__/team-members.test.ts`
Expected: PASS.

- [ ] **Step 5: Full checks** — `npm test`, tsc count `3`, `deno check` line → ok.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/channels/team-members.ts src/lib/whatsapp/__tests__/team-members.test.ts
git commit -m "feat(whatsapp): team membership — invite, resend, Join, unreachable

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Cron — morning list, overdue, missed summary, 🎉; role-based WhatsApp reminders removed

**Files:**
- Create: `supabase/functions/_shared/channels/team-cron.ts`
- Modify: `supabase/functions/whatsapp-reminders/index.ts`
- Modify: `supabase/functions/_shared/checklists-core/reminders.ts` (delete `planReminders`, `reminderKey`, `Recipient`, `ReminderJob`, `MAX_PER_MESSAGE`)
- Modify: `src/lib/whatsapp/__tests__/reminders.test.ts` (delete the `planReminders` and `planReminders flow filter` describe blocks and their imports)
- Test: `src/lib/whatsapp/__tests__/team-cron.test.ts`

**Interfaces:**
- Consumes: `planTeamDay`, `summaryParams` (Task 4); `sendTracked` (Task 5); `TeamDeps`, `Team`, `TeamRecipient` (Task 3); `notifyManagers` (`groups-db.ts`); `templateMessage`, `textMessage`; `hhmm` (`live-list.ts`); `isBillable`; `completionsWindowStart`; `UNREACHABLE_CODES`.
- Produces:

```ts
export interface TeamRunResult { morning: number; overdue: number; summaries: number; failed: number }
export const teamLabel: (team: Team, site: SiteInfo) => string                  // "Kitchen (Ashfield Row)" — {{2}}/{{3}} of the reused templates
export function morningMessage(to: string, team: Team, site: SiteInfo, open: DueChecklist[]): { msg: OutboundMessage; template: 'checklist_reminder' | 'checklist_reminder_list' }
export async function runWhatsAppTeams(t: TeamDeps, send: SendFn, now: Date): Promise<TeamRunResult>
export async function celebrateTeam(t: TeamDeps, send: SendFn, team: Team, date: string, now: Date): Promise<number>   // 🎉 to members inside their window; claims day_end
```

Messages (reused, already approved templates — their texts can't change): morning with several open → `checklist_reminder_list` `{{1}} checks are due soon at {{2}}: {{3}}.` = `[count, "Kitchen (Ashfield Row)", "Fridge temps (11:00), Cleaning"]`, quick reply payload `checks:<group id>` (the approved button label stays "Show checks"); exactly one open with a deadline → `checklist_reminder` `{{1}} is due at {{2}} at {{3}}.`, payload `tfill:<group id>:<template id>`. Overdue → `checklist_reminder` with `tfill:…`. Summary → `team_day_summary` with `summaryParams`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/whatsapp/__tests__/team-cron.test.ts
import { describe, it, expect } from 'vitest'
import { runWhatsAppTeams, celebrateTeam } from '../../../../supabase/functions/_shared/channels/team-cron'
import { fakeTeamDeps, fakeSend, member, tpl, TEAM, ANNA, BEN, BOSS } from './fakes/team-deps'

const FRIDGE = tpl({ id: 'tA', name: 'Fridge temps', deadline_time: '11:00' })   // 10:00Z
const CLEAN = tpl({ id: 'tB', name: 'Cleaning' })
const MAP = [{ group_id: 'g1', template_id: 'tA' }, { group_id: 'g1', template_id: 'tB' }]
const at = (iso: string) => new Date(iso)
const params = (m: any) => m.template.components[0].parameters.map((p: any) => p.text)
const payloads = (m: any) => m.template.components.slice(1).map((c: any) => c.parameters[0].payload)
// Anna active+linked (default); Ben active but never linked; Carl invited; Dee removed.
const crowd = () => fakeTeamDeps({
  templates: [FRIDGE, CLEAN], mappings: MAP,
  members: [
    member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone }),
    member({ id: 'gm2', profile_id: BEN.profile_id, phone: BEN.phone }),
    member({ id: 'gm3', profile_id: 'p3', phone: '447700900333', status: 'invited' }),
    member({ id: 'gm4', profile_id: 'p4', phone: '447700900444', status: 'removed' }),
  ],
})

describe('runWhatsAppTeams — morning list', () => {
  it('nothing before earliest deadline − 1 h; then once per member per day, active+linked only', async () => {
    const { d, s } = crowd()
    const w = fakeSend()
    expect(await runWhatsAppTeams(d, w.send, at('2026-10-14T08:59:00Z'))).toMatchObject({ morning: 0 })
    expect(w.sent).toEqual([])
    s.now = at('2026-10-14T09:00:00Z')
    expect(await runWhatsAppTeams(d, w.send, s.now)).toMatchObject({ morning: 1, failed: 0 })
    expect(w.sent.map((m) => m.to)).toEqual([ANNA.phone])
    expect(w.sent[0].template.name).toBe('checklist_reminder_list')
    expect(params(w.sent[0])).toEqual(['2', 'Kitchen (Ashfield Row)', 'Fridge temps (11:00), Cleaning'])
    expect(payloads(w.sent[0])).toEqual(['checks:g1'])
    expect(s.events.has('g1|morning:gm1|2026-10-14')).toBe(true)
    expect(await runWhatsAppTeams(d, w.send, at('2026-10-14T09:10:00Z'))).toMatchObject({ morning: 0 })
    expect(w.sent).toHaveLength(1)
  })
  it('one open checklist with a deadline → checklist_reminder with a Fill in payload', async () => {
    const { d } = fakeTeamDeps({ templates: [FRIDGE], mappings: [MAP[0]] })
    const w = fakeSend()
    await runWhatsAppTeams(d, w.send, at('2026-10-14T09:00:00Z'))
    expect(w.sent[0].template.name).toBe('checklist_reminder')
    expect(params(w.sent[0])).toEqual(['Fridge temps', '11:00', 'Kitchen (Ashfield Row)'])
    expect(payloads(w.sent[0])).toEqual(['tfill:g1:tA'])
  })
  it('no deadlines → 08:00 site time', async () => {
    const { d } = fakeTeamDeps({ templates: [CLEAN], mappings: [MAP[1]] })
    const w = fakeSend()
    await runWhatsAppTeams(d, w.send, at('2026-10-14T06:59:00Z'))
    expect(w.sent).toEqual([])
    await runWhatsAppTeams(d, w.send, at('2026-10-14T07:00:00Z'))
    expect(w.sent).toHaveLength(1)
  })
  it('nothing open → nothing sent and nothing claimed', async () => {
    const { d, s } = fakeTeamDeps({ templates: [CLEAN], mappings: [MAP[1]],
      completions: [{ template_id: 'tB', site_id: 's1', completed_at: '2026-10-14T06:30:00Z', completed_by: 'p1' }] })
    const w = fakeSend()
    await runWhatsAppTeams(d, w.send, at('2026-10-14T07:00:00Z'))
    expect(w.sent).toEqual([])
    expect(s.events.size).toBe(0)
  })
  it('a failed send releases the claim (next run retries); an unreachable number does not', async () => {
    const { d, s } = fakeTeamDeps({ templates: [CLEAN], mappings: [MAP[1]] })
    const down = fakeSend(() => ({ ok: false, status: 500, id: null }))
    expect(await runWhatsAppTeams(d, down.send, at('2026-10-14T07:00:00Z'))).toMatchObject({ morning: 0, failed: 1 })
    expect(s.events.size).toBe(0)
    const gone = fakeSend(() => ({ ok: false, status: 400, id: null, errorCode: 131026 }))
    await runWhatsAppTeams(d, gone.send, at('2026-10-14T07:10:00Z'))
    expect(s.events.has('g1|morning:gm1|2026-10-14')).toBe(true)
    expect(s.members[0].unreachable_at).not.toBeNull()
  })
  it('business not ready → nothing', async () => {
    const { d } = fakeTeamDeps({ templates: [CLEAN], mappings: [MAP[1]], ready: { b: false } })
    const w = fakeSend()
    await runWhatsAppTeams(d, w.send, at('2026-10-14T07:00:00Z'))
    expect(w.sent).toEqual([])
  })
})

describe('runWhatsAppTeams — overdue', () => {
  it('at the deadline, still open → once per (team, checklist, period) to every active member', async () => {
    const { d, s } = crowd()
    s.identities.push({ id: 'idb', business_id: 'b', profile_id: BEN.profile_id, phone: BEN.phone, last_inbound_at: null, revoked: false, consent_source: 'team_invite' })
    s.events.add('g1|morning:gm1|2026-10-14'); s.events.add('g1|morning:gm2|2026-10-14')
    const w = fakeSend()
    expect(await runWhatsAppTeams(d, w.send, at('2026-10-14T10:00:00Z'))).toMatchObject({ overdue: 1 })
    expect(w.sent.map((m) => [m.to, m.template.name, payloads(m)[0]])).toEqual([
      [ANNA.phone, 'checklist_reminder', 'tfill:g1:tA'], [BEN.phone, 'checklist_reminder', 'tfill:g1:tA']])
    expect(params(w.sent[0])).toEqual(['Fridge temps', '11:00', 'Kitchen (Ashfield Row)'])
    expect(await runWhatsAppTeams(d, w.send, at('2026-10-14T10:10:00Z'))).toMatchObject({ overdue: 0 })
    expect(w.sent).toHaveLength(2)
  })
})

describe('runWhatsAppTeams — missed summary', () => {
  it('1 h after the latest deadline: to members and managers, once; plus one app notification', async () => {
    const { d, s } = fakeTeamDeps({ templates: [FRIDGE, CLEAN], mappings: MAP,
      completions: [{ template_id: 'tB', site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' }] })
    s.events.add('g1|morning:gm1|2026-10-14'); s.events.add('g1|overdue|tA:2026-10-14')
    const w = fakeSend()
    expect(await runWhatsAppTeams(d, w.send, at('2026-10-14T10:59:00Z'))).toMatchObject({ summaries: 0 })
    expect(await runWhatsAppTeams(d, w.send, at('2026-10-14T11:00:00Z'))).toMatchObject({ summaries: 1 })
    expect(w.sent.map((m) => [m.to, m.template.name])).toEqual([[ANNA.phone, 'team_day_summary'], [BOSS.phone, 'team_day_summary']])
    expect(params(w.sent[0])).toEqual(['Kitchen', 'Ashfield Row', '1', '2', 'Fridge temps'])
    expect(s.notifications).toEqual([{ user_id: 'm1', type: 'team', title: 'Kitchen: checks missed today',
      message: 'Kitchen at Ashfield Row today: 1 of 2 done. Missed: Fridge temps.', link: '/checklists' }])
    await runWhatsAppTeams(d, w.send, at('2026-10-14T11:10:00Z'))
    expect(w.sent).toHaveLength(2)
    expect(s.notifications).toHaveLength(1)
  })
  it('all done → no summary', async () => {
    const done = ['tA', 'tB'].map((id) => ({ template_id: id, site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' }))
    const { d, s } = fakeTeamDeps({ templates: [FRIDGE, CLEAN], mappings: MAP, completions: done })
    const w = fakeSend()
    await runWhatsAppTeams(d, w.send, at('2026-10-14T11:00:00Z'))
    expect(w.sent).toEqual([])
    expect(s.notifications).toEqual([])
  })
  // Review Focus 3: the manager is also a member of the team.
  it('a manager who is also a member gets one summary, not two', async () => {
    const { d, s } = fakeTeamDeps({ templates: [FRIDGE], mappings: [MAP[0]],
      members: [member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone }), member({ id: 'gm5', profile_id: BOSS.profile_id, phone: BOSS.phone })] })
    s.events.add('g1|morning:gm1|2026-10-14'); s.events.add('g1|morning:gm5|2026-10-14'); s.events.add('g1|overdue|tA:2026-10-14')
    const w = fakeSend()
    await runWhatsAppTeams(d, w.send, at('2026-10-14T11:00:00Z'))
    expect(w.sent.map((m) => m.to)).toEqual([ANNA.phone, BOSS.phone])
    expect(s.notifications).toHaveLength(1)
  })
  // Review Focus 5: team_day_summary not approved yet.
  it('template not approved → claim released, no notifications; the next run retries', async () => {
    const { d, s } = fakeTeamDeps({ templates: [FRIDGE], mappings: [MAP[0]] })
    s.events.add('g1|morning:gm1|2026-10-14'); s.events.add('g1|overdue|tA:2026-10-14')
    const down = fakeSend(() => ({ ok: false, status: 404, id: null, errorCode: 132001 }))
    await runWhatsAppTeams(d, down.send, at('2026-10-14T11:00:00Z'))
    expect(s.events.has('g1|day_end|2026-10-14')).toBe(false)
    expect(s.notifications).toEqual([])
    const up = fakeSend()
    expect(await runWhatsAppTeams(d, up.send, at('2026-10-14T11:10:00Z'))).toMatchObject({ summaries: 1 })
  })
})

describe('celebrateTeam', () => {
  it('🎉 only to members whose 24 h window is open; once per team per day; blocks the summary', async () => {
    const { d, s } = crowd()
    s.identities.push({ id: 'idb', business_id: 'b', profile_id: BEN.profile_id, phone: BEN.phone, last_inbound_at: '2026-10-13T08:00:00Z', revoked: false, consent_source: 'team_invite' })
    s.identities[0].last_inbound_at = '2026-10-14T09:39:00Z'
    const w = fakeSend()
    const now = at('2026-10-14T09:40:00Z')
    expect(await celebrateTeam(d, w.send, TEAM, '2026-10-14', now)).toBe(1)
    expect(w.sent.map((m) => [m.to, m.text.body])).toEqual([[ANNA.phone, '🎉 All Kitchen checks done today']])
    expect(await celebrateTeam(d, w.send, TEAM, '2026-10-14', now)).toBe(0)
    expect(s.events.has('g1|day_end|2026-10-14')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/team-cron.test.ts`
Expected: FAIL — `Failed to resolve import ".../channels/team-cron"`.

- [ ] **Step 3: Implement `team-cron.ts`**

```ts
// supabase/functions/_shared/channels/team-cron.ts
// WhatsApp teams step of the 10-minute cron (spec 2026-10-12 §5): per team, the morning list (once per member per day),
// one nudge per overdue checklist, and the missed summary; plus the 🎉 the bot sends when a submit closes the day.
// Every message is claim-then-send on channel_group_events, released on failure (except "can't reach this number").
import type { DueChecklist } from '../checklists-core/types.ts'
import { completionsWindowStart } from '../checklists-core/due.ts'
import type { OutboundMessage, SendFn, SendResult } from './types.ts'
import type { SiteInfo } from './bot.ts'
import type { Team, TeamDeps } from './teams-db.ts'
import { planTeamDay, summaryParams } from './team-day.ts'
import { sendTracked, UNREACHABLE_CODES } from './team-members.ts'
import { templateMessage, textMessage } from './whatsapp.ts'
import { hhmm } from './live-list.ts'
import { isBillable } from './service-window.ts'
import { notifyManagers } from './groups-db.ts'
import { TEAM_TEXT } from './team-text.ts'

export interface TeamRunResult { morning: number; overdue: number; summaries: number; failed: number }

const errMsg = (e: unknown) => String((e as { message?: string })?.message ?? e).slice(0, 200)
/** Worth retrying next run: anything but Meta's "can't reach this number". */
const retryable = (r: SendResult) => !(r.errorCode != null && UNREACHABLE_CODES.has(r.errorCode))

export const teamLabel = (team: Team, site: SiteInfo) => `${team.title} (${site.name})`

export function morningMessage(to: string, team: Team, site: SiteInfo, open: DueChecklist[]): { msg: OutboundMessage; template: 'checklist_reminder' | 'checklist_reminder_list' } {
  if (open.length === 1 && open[0].deadline_utc) {
    const x = open[0]
    return { msg: templateMessage(to, 'checklist_reminder', [x.template.name, hhmm(x.deadline_utc!, site.timezone), teamLabel(team, site)], [`tfill:${team.id}:${x.template.id}`]), template: 'checklist_reminder' }
  }
  const list = open.map((x) => (x.deadline_utc ? `${x.template.name} (${hhmm(x.deadline_utc, site.timezone)})` : x.template.name)).join(', ')
  return { msg: templateMessage(to, 'checklist_reminder_list', [String(open.length), teamLabel(team, site), list], [`checks:${team.id}`]), template: 'checklist_reminder_list' }
}

export async function runWhatsAppTeams(t: TeamDeps, send: SendFn, now: Date): Promise<TeamRunResult> {
  const res: TeamRunResult = { morning: 0, overdue: 0, summaries: 0, failed: 0 }
  const ready = new Map<string, boolean>()
  for (const team of await t.liveTeams()) {
    try {
      if (!ready.has(team.business_id)) ready.set(team.business_id, await t.ready(team.business_id))
      if (!ready.get(team.business_id)) continue
      const site = await t.site(team.site_id)
      if (!site) continue
      const templates = await t.teamTemplates(team)
      if (!templates.length) continue
      const completions = await t.completionsSince(team.business_id, completionsWindowStart(templates, [site.timezone], now))
      const plan = planTeamDay({ templates, siteId: site.id, tz: site.timezone, now, completions })
      if (!plan.morning && !plan.overdue.length && !plan.summary) continue
      const recipients = await t.recipients(team)
      const base = { business_id: team.business_id, site_id: site.id }

      if (plan.morning) {
        for (const r of recipients) {
          const kind = `morning:${r.member_id}`
          if (!(await t.claimEvent(team.id, kind, plan.date))) continue
          const m = morningMessage(r.phone, team, site, plan.state.open)
          const s = await sendTracked(t, send, { ...base, to: r.phone, msg: m.msg, profile_id: r.profile_id, kind: 'team_morning', template_name: m.template, lastInboundAt: r.last_inbound_at })
          if (s.ok) res.morning++
          else { res.failed++; if (retryable(s)) await t.releaseEvent(team.id, kind, plan.date) }
        }
      }

      for (const item of plan.overdue) {
        const key = `${item.template.id}:${item.period_key}`
        if (!(await t.claimEvent(team.id, 'overdue', key))) continue
        let ok = 0
        let retry = false
        for (const r of recipients) {
          const msg = templateMessage(r.phone, 'checklist_reminder', [item.template.name, hhmm(item.deadline_utc!, site.timezone), teamLabel(team, site)], [`tfill:${team.id}:${item.template.id}`])
          const s = await sendTracked(t, send, { ...base, to: r.phone, msg, profile_id: r.profile_id, kind: 'team_overdue', template_name: 'checklist_reminder', lastInboundAt: r.last_inbound_at })
          if (s.ok) ok++
          else { res.failed++; retry ||= retryable(s) }
        }
        if (ok) res.overdue++
        else if (retry) await t.releaseEvent(team.id, 'overdue', key)
      }

      if (plan.summary && (await t.claimEvent(team.id, 'day_end', plan.date))) {
        const p = summaryParams(team.title, site.name, plan.state)
        // Members first, then managers linked on WhatsApp; one message per number (a manager may also be a member).
        const targets = new Map<string, { profile_id: string; last_inbound_at: string | null }>()
        for (const r of recipients) targets.set(r.phone, r)
        for (const m of await t.managerContacts(team.business_id)) if (!targets.has(m.phone)) targets.set(m.phone, m)
        let ok = 0
        let retry = false
        for (const [phone, x] of targets) {
          const s = await sendTracked(t, send, { ...base, to: phone, msg: templateMessage(phone, 'team_day_summary', p, []), profile_id: x.profile_id, kind: 'team_summary', template_name: 'team_day_summary', lastInboundAt: x.last_inbound_at })
          if (s.ok) ok++
          else { res.failed++; retry ||= retryable(s) }
        }
        if (!ok && retry) { await t.releaseEvent(team.id, 'day_end', plan.date); continue }   // e.g. template not approved yet
        res.summaries++
        await notifyManagers(t, team.business_id, { title: TEAM_TEXT.missedTitle(team.title), message: TEAM_TEXT.summary(p[0], p[1], Number(p[2]), Number(p[3]), p[4]), link: '/checklists' })
      }
    } catch (err) {
      res.failed++
      console.error('whatsapp team run failed', team.id, errMsg(err))
    }
  }
  return res
}

/** A submit closed the team's last open checklist today: 🎉 (free-form, so only inside each member's 24 h window). */
export async function celebrateTeam(t: TeamDeps, send: SendFn, team: Team, date: string, now: Date): Promise<number> {
  if (!(await t.claimEvent(team.id, 'day_end', date))) return 0
  let n = 0
  for (const r of await t.recipients(team)) {
    if (isBillable(r.last_inbound_at, now)) continue
    const s = await sendTracked(t, send, { to: r.phone, msg: textMessage(r.phone, TEAM_TEXT.allDone(team.title)), business_id: team.business_id,
      site_id: team.site_id, profile_id: r.profile_id, kind: 'team_all_done', lastInboundAt: r.last_inbound_at })
    if (s.ok) n++
  }
  return n
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/whatsapp/__tests__/team-cron.test.ts`
Expected: PASS.

- [ ] **Step 5: Remove role-based reminder planning**

In `supabase/functions/_shared/checklists-core/reminders.ts` delete `MAX_PER_MESSAGE`, `Recipient`, `ReminderJob`, `reminderKey` and `planReminders`, and drop `dueChecklists` and `Person` from its imports (keep `LEAD_MINUTES`, `NeededCorrective`, `CorrectiveAction`, `planCorrective`, `GroupReminderJob`, `planGroupReminders`). The file's import line becomes:

```ts
import type { CompletionLite, DueChecklist, Template } from './types.ts'
import { dueAtSite } from './due.ts'
```

In `src/lib/whatsapp/__tests__/reminders.test.ts` delete the `describe('planReminders', …)` and `describe('planReminders flow filter', …)` blocks, the `person` and `rec` constants, and change the import to:

```ts
import { planCorrective, planGroupReminders } from '../../../../supabase/functions/_shared/checklists-core/reminders'
import type { Template } from '../../../../supabase/functions/_shared/checklists-core/types'
```

- [ ] **Step 6: Wire the cron** — `supabase/functions/whatsapp-reminders/index.ts`

Replace the header comment's WhatsApp bullet with:

```ts
//  - WhatsApp: TEAMS (team-cron.ts: morning list, overdue, missed summary) + corrective follow-ups
//    (needs WA_TOKEN + WA_PHONE_NUMBER_ID). Role assignments no longer drive WhatsApp (spec 2026-10-12 §9);
//    channel_reminders_sent is kept for history only.
```

Imports and constants: remove `planReminders`, `reminderKey`, `type Recipient`, `type ReminderJob` (keep `planCorrective`); remove `completionsWindowStart`, `type BotDeps`, the `whatsappUI` import, the `CORRECTIVE_FLOW_ID` constant with its `console.error` line, and the `waDeps` constant (the cron no longer needs the bot deps); change `import { makeDeps, pageAll } from "../_shared/channels/db.ts";` to `import { pageAll } from "../_shared/channels/db.ts";`; add:

```ts
import { makeTeamDeps } from "../_shared/channels/teams-db.ts";
import { runWhatsAppTeams, type TeamRunResult } from "../_shared/channels/team-cron.ts";
```
and the `isBillable, withUnit` import from `bot.ts` stays. Below `const groupDeps = …` add `const teamDeps = makeTeamDeps(admin);`. Delete `REMINDER_KEY_COLS`, `releaseKeys` and `remindBusiness`. Replace `runWhatsApp` with:

```ts
/** `fatal`: the identities query failed — the handler answers 500 (as before) so the cron failure is visible. */
async function runWhatsApp(now: Date): Promise<{ teams: TeamRunResult | null; failed: number; fatal?: boolean }> {
  if (!waSend) return { teams: null, failed: 0 };
  let teams: TeamRunResult | null = null;
  try { teams = await runWhatsAppTeams(teamDeps, waSend, now); }
  catch (err) { console.error("whatsapp teams run failed", errMsg(err)); }
  let idents: Ident[];
  try {
    // Corrective follow-ups go to the person who recorded the out-of-range answer: WhatsApp identities ONLY.
    idents = await pageAll<Ident>((from, to) => admin.from("channel_identities")
      .select("id, business_id, profile_id, external_id, last_inbound_at").eq("channel", "whatsapp").is("revoked_at", null)
      .order("id").range(from, to));
  } catch (error) {
    console.error("whatsapp reminders: identities query failed", errMsg(error));
    return { teams, failed: 1, fatal: true };
  }
  const byBiz = new Map<string, Ident[]>();
  for (const i of idents) byBiz.set(i.business_id, [...(byBiz.get(i.business_id) ?? []), i]);
  let failed = 0;
  for (const [biz, list] of byBiz) {
    try {
      if (!(await teamDeps.ready(biz))) continue;
      const { data: siteRows, error: siteErr } = await admin.from("sites").select("id, name, timezone").eq("business_id", biz).is("removed_at", null);
      if (siteErr) throw siteErr;
      const sites = new Map<string, SiteRow>((siteRows ?? []).map((s: Any) => [s.id, { name: s.name ?? "", timezone: s.timezone ?? "Europe/London" }]));
      await correctiveBusiness(biz, list, sites, now);
    } catch (err) {
      failed++;
      console.error("whatsapp corrective run failed", biz, errMsg(err));
    }
  }
  return { teams, failed };
}
```

In `housekeeping` add (and add `te, tt` to the error loop):

```ts
  const te = await admin.from("channel_group_events").delete().lt("sent_at", sixtyDaysAgo);
  const tt = await admin.from("channel_group_takes").delete().lt("taken_at", sixtyDaysAgo);
  for (const r of [a, b, ga, gb, c, d, gd, te, tt, e]) if (r.error) console.error("channel housekeeping failed", errMsg(r.error));
```

In the handler, replace the final success response with:

```ts
  return new Response(JSON.stringify({ ok: true, teams: wa.teams, failed: wa.failed, groups }), { headers: { "Content-Type": "application/json" } });
```

- [ ] **Step 7: Full checks**

Run: `npm test` → all pass (the deleted `planReminders` tests are the only removals). `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `3`. `cd supabase/functions && deno check whatsapp-reminders/index.ts whatsapp-webhook/index.ts channel-form/index.ts telegram-webhook/index.ts whatsapp-sync-flows/index.ts team-create-channel-member/index.ts` → ok. `grep -n "planReminders\|channel_reminders_sent\").upsert" supabase/functions -r` → no matches.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/channels/team-cron.ts supabase/functions/whatsapp-reminders/index.ts supabase/functions/_shared/checklists-core/reminders.ts src/lib/whatsapp/__tests__/team-cron.test.ts src/lib/whatsapp/__tests__/reminders.test.ts
git commit -m "feat(whatsapp): team cron (morning list, overdue, missed summary, 🎉); role-based reminders removed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Member bot — team menus, forms, first submit wins, Join route; LINK codes and role-based paths removed

**Files:**
- Rewrite: `supabase/functions/_shared/channels/bot.ts`
- Modify: `supabase/functions/_shared/channels/db.ts` (BotDeps impl: link codes, `sitesFor`, `templates`, `completionsSince` out; `teams` in; `group_id` in `TOKEN_COLS`)
- Modify: `supabase/functions/whatsapp-webhook/index.ts` (team deps, delivery statuses)
- Create: `src/lib/whatsapp/__tests__/fakes/team-bot-deps.ts`
- Rewrite: `src/lib/whatsapp/__tests__/bot.test.ts` (keeps only the channel-level tests that still apply)
- Modify: `src/lib/whatsapp/__tests__/alerts.test.ts` (the two `makeDeps(...)` calls pass `teams`)
- Test: `src/lib/whatsapp/__tests__/team-bot.test.ts`

**Interfaces:**
- Consumes: `TeamDeps`, `Team` (Task 3); `teamDayState`, `todayOnly`, `takePeriodKey`, `doneInPeriod`, `TeamDayState` (Task 4); `handleJoin` (Task 5); `celebrateTeam` (Task 6); `TEAM_TEXT`; `renderDueMenu` with `rowId` and done `by` (Task 2); `hhmm`, `localDate` (`live-list.ts`); fakes from Task 3.
- Produces:

```ts
// bot.ts (exports kept: Identity, SiteInfo, FormToken, BotDeps, PendingCorrective, textsFor, TEXT, saveChecklistToken,
// telegramFormItemIds, isBillable, SERVICE_WINDOW_MS, withUnit, handleInbound)
export interface FormToken { /* as before */ group_id?: string | null }   // WhatsApp team the form was opened from
export interface BotDeps extends CoreDb {
  channel: Channel; ui: ChannelUI; now(): Date; send: SendFn; newToken(): string
  findIdentity(externalId: string): Promise<Identity | null>; touchIdentity(id: string, at: Date): Promise<void>; revokeIdentity(id: string): Promise<void>
  ready(businessId: string): Promise<boolean>; person(profileId: string): Promise<Person | null>; items(templateId: string): Promise<TemplateItem[]>
  flowFor(templateId: string, siteId: string): Promise<{ flow_id: string; item_ids: string[]; items_hash: string } | null>; correctiveFlowId(): string
  saveToken(t: FormToken): Promise<void>; takeToken(token: string, now: Date, profileId: string): Promise<FormToken | null>
  setCorrective(…): …; alertManagers(…): …; log(…): Promise<boolean>; pendingCorrective(profileId: string): Promise<PendingCorrective[]>
  teams: TeamDeps                                                     // NEW
}                                                                     // REMOVED: consumeLinkCode, linkFailures, recordLinkFailure, sitesFor, templates, completionsSince
export function saveChecklistToken(d, a: { business_id; profile_id; site_id; template_id; group_id?: string | null }, itemIds: string[]): Promise<string>
// db.ts
export interface DepsConfig { …as before; teams: TeamDeps }
// fakes/team-bot-deps.ts (tests only)
export function fakeTeamBot(init?: Partial<FakeTeamState>, over?: Partial<BotDeps>): { d: BotDeps; s: FakeTeamState; sent: any[]; tokens: Map<string, FormToken>; items: Record<string, TemplateItem[]>; flows: Record<string, { flow_id: string; item_ids: string[]; items_hash: string } | null>; pending: PendingCorrective[]; corrective: { rid: string; notes: string }[] }
export const textOf: (m: any) => string | undefined
```

Inbound routing (WhatsApp): `join:<member id>` → `handleJoin` (works before the number is linked); text `checks` / button `checks` / button `fill:…` (an old role-based reminder) → one menu per team; button `checks:<group id>` (morning list) → that team's menu; button `tfill:<group id>:<template id>` → that checklist's Flow; Flow submit with a team token → the team submit path. A bare `LINK 123456` is no longer special.

Rulings (spec silent): copy for numbers that aren't linked becomes `Ask your manager to add you to a Blueroll team.`; after STOP `You're disconnected from Blueroll. You won't get any more messages. Ask your manager to add you again to reconnect.` A checklist form token without `group_id` (sent before this deploy by the role-based flow) is answered with the existing "form expired" text. When no team has anything open, `checks` answers `Nothing is due right now 👍` (a WhatsApp list needs at least one row).

- [ ] **Step 1: Write the bot fake**

```ts
// src/lib/whatsapp/__tests__/fakes/team-bot-deps.ts
// BotDeps for the WhatsApp team bot tests, built over the in-memory TeamDeps fake (identities, people, completions shared).
import type { BotDeps, FormToken, PendingCorrective } from '../../../../../supabase/functions/_shared/channels/bot'
import type { TemplateItem } from '../../../../../supabase/functions/_shared/checklists-core/types'
import { whatsappUI } from '../../../../../supabase/functions/_shared/channels/ui'
import { itemsHash } from '../../../../../supabase/functions/_shared/channels/whatsapp-flows'
import { fakeTeamDeps, fakeSend, TEMP_ITEM, type FakeTeamState } from './team-deps'

export const textOf = (m: any): string | undefined => m?.text?.body ?? m?.interactive?.body?.text

export function fakeTeamBot(init: Partial<FakeTeamState> = {}, over: Partial<BotDeps> = {}) {
  const { d: teams, s } = fakeTeamDeps(init)
  const { send, sent } = fakeSend()
  const tokens = new Map<string, FormToken>()
  const items: Record<string, TemplateItem[]> = {}
  /** Published flow per template; undefined = published for the template's CURRENT items; null = no flow. */
  const flows: Record<string, { flow_id: string; item_ids: string[]; items_hash: string } | null> = {}
  const pending: PendingCorrective[] = []
  const corrective: { rid: string; notes: string }[] = []
  const inbound = new Set<string>()
  let n = 0
  const itemsOf = (tid: string) => items[tid] ?? [TEMP_ITEM]
  const d: BotDeps = {
    channel: 'whatsapp', ui: whatsappUI(), now: () => s.now, send, newToken: () => `tok${++n}`,
    findIdentity: async (x) => {
      const i = s.identities.find((y) => y.phone === x && !y.revoked)
      return i ? { id: i.id, business_id: i.business_id, profile_id: i.profile_id, external_id: x } : null
    },
    touchIdentity: async (id, at) => { const i = s.identities.find((y) => y.id === id); if (i) i.last_inbound_at = at.toISOString() },
    revokeIdentity: async (id) => { const i = s.identities.find((y) => y.id === id); if (i) i.revoked = true },
    ready: teams.ready,
    person: teams.person,
    items: async (tid) => itemsOf(tid),
    flowFor: async (tid) => {
      if (flows[tid] !== undefined) return flows[tid]
      const t = s.templates.find((x) => x.id === tid)!
      return { flow_id: 'F1', item_ids: itemsOf(tid).filter((i) => i.item_type !== 'photo').map((i) => i.id), items_hash: await itemsHash(t.name, itemsOf(tid)) }
    },
    correctiveFlowId: () => 'FC',
    saveToken: async (t) => { tokens.set(t.token, { ...t }) },
    takeToken: async (tok, now, pid) => {
      const t = tokens.get(tok)
      if (!t || t.used_at || t.profile_id !== pid || new Date(t.expires_at) <= now) return null
      t.used_at = now.toISOString(); return { ...t }
    },
    setCorrective: async (rid, notes) => { corrective.push({ rid, notes }); return { templateName: 'Fridge temps', itemName: 'Walk-in fridge', value: '9', unit: '°C', siteName: 'Ashfield Row', byName: 'Anna Smith', businessId: 'b' } },
    alertManagers: async () => {},
    log: async (e) => {
      if (e.direction === 'in' && e.wa_message_id) { if (inbound.has(e.wa_message_id)) return false; inbound.add(e.wa_message_id) }
      return true
    },
    pendingCorrective: async () => pending,
    insertCompletion: teams.insertCompletion, insertResponses: teams.insertResponses, managerIds: teams.managerIds, insertNotifications: teams.insertNotifications,
    teams,
    ...over,
  }
  return { d, s, sent, tokens, items, flows, pending, corrective }
}
```

- [ ] **Step 2: Write the failing team bot tests**

```ts
// src/lib/whatsapp/__tests__/team-bot.test.ts
import { describe, it, expect } from 'vitest'
import { handleInbound, TEXT } from '../../../../supabase/functions/_shared/channels/bot'
import { TEAM_TEXT } from '../../../../supabase/functions/_shared/channels/team-text'
import type { TemplateItem } from '../../../../supabase/functions/_shared/checklists-core/types'
import { fakeTeamBot, textOf } from './fakes/team-bot-deps'
import { itemsHash } from '../../../../supabase/functions/_shared/channels/whatsapp-flows'
import { member, tpl, ANNA, BEN, TEMP_ITEM, NOW } from './fakes/team-deps'

const FRIDGE = tpl({ id: 'tA', name: 'Fridge temps', deadline_time: '11:00' })
const CLEAN = tpl({ id: 'tB', name: 'Cleaning' })
const FREEZER: TemplateItem = { id: 'i2', name: 'Freezer', item_type: 'temperature', required: true, min_value: -30, max_value: -18, unit: '°C', sort_order: 1 }
const MAP = [{ group_id: 'g1', template_id: 'tA' }, { group_id: 'g1', template_id: 'tB' }]
const benLinked = { id: 'idb', business_id: 'b', profile_id: BEN.profile_id, phone: BEN.phone, last_inbound_at: null, revoked: false, consent_source: 'team_invite' }
const kitchen = (o: Parameters<typeof fakeTeamBot>[0] = {}) => fakeTeamBot({ templates: [FRIDGE, CLEAN], mappings: MAP, ...o })
const say = (from: string, text: string, id = `t${Math.random()}`) => ({ kind: 'text' as const, from, text, id })
const tap = (from: string, payload: string, id = `b${Math.random()}`) => ({ kind: 'button' as const, from, payload, id })
const submit = (from: string, token: string, response: Record<string, unknown>, id = `f${Math.random()}`) => ({ kind: 'flow' as const, from, token, response, id })

describe('checks → one menu per team', () => {
  it('menu in the shipped format: team · site header, done lines with first names, tfill rows', async () => {
    const f = kitchen({ completions: [{ template_id: 'tB', site_id: 's1', completed_at: '2026-10-14T07:47:00Z', completed_by: BEN.profile_id }] })
    await handleInbound(say(ANNA.phone, 'CHECKS'), f.d)
    const m = f.sent[0].interactive
    expect(m.type).toBe('list')
    expect(m.header.text).toBe('📋 Kitchen · Ashfield Row — 1 of 2 done')
    expect(m.body.text).toBe('🟠 Fridge temps — due 11:00\n✅ Cleaning — 08:47 Ben')
    expect(m.footer.text).toBe('Forms open on your phone')
    expect(m.action.button).toBe('Choose a check')
    expect(m.action.sections[0].rows).toEqual([{ id: 'tfill:g1:tA', title: 'Fridge temps', description: '🟠 Due 11:00 · due soon' }])
  })
  it('a linked person in no team → not in a team yet; nothing open → nothing due', async () => {
    const a = kitchen({ members: [] })
    await handleInbound(say(ANNA.phone, 'checks'), a.d)
    expect(textOf(a.sent[0])).toBe(TEAM_TEXT.notInTeam)
    const b = kitchen({ completions: ['tA', 'tB'].map((id) => ({ template_id: id, site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' })) })
    await handleInbound(say(ANNA.phone, 'checks'), b.d)
    expect(textOf(b.sent[0])).toBe(TEXT.nothingDue)
  })
  it('morning-list button checks:<team> → that team only; an old role-based fill: button → all teams', async () => {
    const f = kitchen()
    f.s.teams.push({ id: 'g2', business_id: 'b', title: 'Bar', site_id: 's1' })
    f.s.mappings.push({ group_id: 'g2', template_id: 'tB' })
    f.s.members.push(member({ id: 'gm7', group_id: 'g2', profile_id: ANNA.profile_id, phone: ANNA.phone }))
    await handleInbound(tap(ANNA.phone, 'checks:g2'), f.d)
    expect(f.sent.map((m) => m.interactive.header.text)).toEqual(['📋 Bar · Ashfield Row — 0 of 1 done'])
    await handleInbound(tap(ANNA.phone, 'fill:tA:s1'), f.d)
    expect(f.sent.slice(1).map((m) => m.interactive.header.text)).toEqual(['📋 Kitchen · Ashfield Row — 0 of 2 done', '📋 Bar · Ashfield Row — 0 of 1 done'])
  })
  it('pending out-of-range answers get their corrective form before the menus', async () => {
    const f = kitchen()
    f.pending.push({ response_id: 'r9', item: TEMP_ITEM, value: '9', site_id: 's1', template_id: 'tA' }, { response_id: 'r8', item: TEMP_ITEM, value: '9', site_id: 'elsewhere', template_id: 'tA' })
    await handleInbound(say(ANNA.phone, 'checks'), f.d)
    expect(f.sent[0].interactive.action.parameters.flow_id).toBe('FC')
    expect(f.tokens.get('tok1')).toMatchObject({ kind: 'corrective', response_id: 'r9' })
    expect(f.sent[1].interactive.type).toBe('list')
    expect(f.sent).toHaveLength(2)
  })
  it('a bare LINK code is no longer special', async () => {
    const f = kitchen()
    await handleInbound(say('447000000001', 'LINK 482913'), f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.unknown)
  })
})

describe('tfill → the checklist Flow', () => {
  it('sends the Flow with a token bound to the member and the team', async () => {
    const f = kitchen()
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    expect(f.sent[0].interactive.action.parameters).toMatchObject({ flow_id: 'F1', flow_token: 'tok1' })
    expect(f.tokens.get('tok1')).toMatchObject({ kind: 'checklist', profile_id: 'p1', site_id: 's1', template_id: 'tA', group_id: 'g1', item_ids: ['i1'] })
  })
  it('removed from the team → "no longer in"; a template not mapped → form expired', async () => {
    const f = kitchen()
    f.s.members[0].status = 'removed'
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    expect(textOf(f.sent[0])).toBe(TEAM_TEXT.noLongerIn('Kitchen'))
    const g = kitchen({ mappings: [MAP[1]] })
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), g.d)
    expect(textOf(g.sent[0])).toBe(TEXT.formExpired)
  })
  it('an old button on a closed checklist → "Already done ✓ by Ben 10:30" and the fresh menu', async () => {
    const f = kitchen({ completions: [{ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:30:00Z', completed_by: BEN.profile_id }] })
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    expect(textOf(f.sent[0])).toBe('Already done ✓ by Ben 10:30')
    expect(f.sent[1].interactive.header.text).toBe('📋 Kitchen · Ashfield Row — 1 of 2 done')
    expect(f.tokens.size).toBe(0)
  })
  it('item ids churned by an editor save (same shape) → current ids; shape changed → app only', async () => {
    const f = kitchen()
    f.flows.tA = { flow_id: 'F1', item_ids: ['old'], items_hash: await itemsHash('Fridge temps', [TEMP_ITEM]) }
    f.items.tA = [{ ...TEMP_ITEM, id: 'n1' }]
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    expect(f.tokens.get('tok1')!.item_ids).toEqual(['n1'])
    f.items.tA = [{ ...TEMP_ITEM, id: 'n1' }, FREEZER]
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    expect(textOf(f.sent[1])).toBe(TEXT.appOnly('Fridge temps'))
  })
})

describe('submit — first submit wins', () => {
  it('records with source whatsapp; out-of-range → corrective form', async () => {
    const f = kitchen()
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '9' }), f.d)
    expect(f.s.completionRows).toEqual([{ template_id: 'tA', business_id: 'b', site_id: 's1', completed_by: 'p1', completed_at: NOW.toISOString(), source: 'whatsapp' }])
    expect(f.s.responses.map((r: any) => r.corrective_status)).toEqual(['needed'])
    expect(f.sent[1].interactive.action.parameters.flow_id).toBe('FC')
    expect([...f.s.takes.keys()]).toEqual(['g1|tA|s1|2026-10-14'])
  })
  it('two people submit at once → one completion; the other gets "Already done ✓ by Anna 10:40" and the menu', async () => {
    const f = kitchen({ members: [member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone }), member({ id: 'gm2', profile_id: BEN.profile_id, phone: BEN.phone })] })
    f.s.identities.push({ ...benLinked })
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)   // tok1
    await handleInbound(tap(BEN.phone, 'tfill:g1:tA'), f.d)    // tok2
    await Promise.all([
      handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d),
      handleInbound(submit(BEN.phone, 'tok2', { f0: '4' }), f.d),
    ])
    expect(f.s.completionRows).toHaveLength(1)
    const loser = f.s.completionRows[0].completed_by === 'p1' ? BEN.phone : ANNA.phone
    const winner = loser === BEN.phone ? 'Anna' : 'Ben'
    const toLoser = f.sent.filter((m) => m.to === loser).slice(1)   // after their Flow
    expect(textOf(toLoser[0])).toBe(`Already done ✓ by ${winner} 10:40`)
    expect(toLoser[1].interactive.header.text).toBe('📋 Kitchen · Ashfield Row — 1 of 2 done')
  })
  it('a completion from the app counts as done: nothing recorded', async () => {
    const f = kitchen()
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    f.s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:35:00Z', completed_by: BEN.profile_id })
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d)
    expect(f.s.completionRows).toEqual([])
    expect(textOf(f.sent[1])).toBe('Already done ✓ by Ben 10:35')
  })
  it('removed between opening and submitting → "You\'re no longer in Kitchen.", nothing recorded', async () => {
    const f = kitchen()
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    f.s.members[0].status = 'removed'
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d)
    expect(f.s.completionRows).toEqual([])
    expect(textOf(f.sent[1])).toBe("You're no longer in Kitchen.")
  })
  it('unmapped after the form was sent → form expired', async () => {
    const f = kitchen()
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    f.s.mappings = [MAP[1]]
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d)
    expect(f.s.completionRows).toEqual([])
    expect(textOf(f.sent[1])).toBe(TEXT.formExpired)
  })
  it('a token from the retired role-based flow (no team) → form expired', async () => {
    const f = kitchen()
    await f.d.saveToken({ token: 'old', kind: 'checklist', business_id: 'b', profile_id: 'p1', site_id: 's1', template_id: 'tA', item_ids: ['i1'], response_id: null, expires_at: '2099-01-01', used_at: null })
    await handleInbound(submit(ANNA.phone, 'old', { f0: '3' }), f.d)
    expect(f.s.completionRows).toEqual([])
    expect(textOf(f.sent[0])).toBe(TEXT.formExpired)
  })
  it('missing required answers / items re-created → nothing recorded, message and a fresh form', async () => {
    const f = kitchen()
    f.items.tA = [TEMP_ITEM, FREEZER]
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d)
    expect(textOf(f.sent[1])).toBe(TEXT.missing(['Freezer']))
    expect(f.sent[2].interactive.action.parameters.flow_token).toBe('tok2')
    f.items.tA = [{ ...TEMP_ITEM, id: 'n1' }, { ...FREEZER, id: 'n2' }]
    await handleInbound(submit(ANNA.phone, 'tok2', { f0: '3', f1: '-20' }), f.d)
    expect(textOf(f.sent[3])).toBe(TEXT.checklistChanged)
    expect(f.tokens.get('tok3')!.item_ids).toEqual(['n1', 'n2'])
    expect(f.s.completionRows).toEqual([])
    expect(f.s.takes.size).toBe(0)
  })
  it('several a day: the first submit leaves it open and the next person gets the second slot', async () => {
    const PROBE = tpl({ id: 'tP', name: 'Probe', multi_per_day: true, min_per_day: 2 })
    const f = fakeTeamBot({ templates: [PROBE], mappings: [{ group_id: 'g1', template_id: 'tP' }],
      members: [member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone }), member({ id: 'gm2', profile_id: BEN.profile_id, phone: BEN.phone })] })
    f.s.identities.push({ ...benLinked })
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tP'), f.d)
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d)
    await handleInbound(tap(BEN.phone, 'tfill:g1:tP'), f.d)
    await handleInbound(submit(BEN.phone, 'tok2', { f0: '4' }), f.d)
    expect(f.s.completionRows.map((r: any) => r.completed_by)).toEqual(['p1', 'p2'])
    expect([...f.s.takes.keys()]).toEqual(['g1|tP|s1|2026-10-14#1', 'g1|tP|s1|2026-10-14#2'])
  })
  it('a duplicate delivery of the same submit records once', async () => {
    const f = kitchen()
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }, 'wamid.F'), f.d)
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }, 'wamid.F'), f.d)
    expect(f.s.completionRows).toHaveLength(1)
  })
})

describe('🎉 when a submit closes the day', () => {
  it('only members with an open window; the day_end event is claimed once', async () => {
    const f = kitchen({ members: [member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone }), member({ id: 'gm2', profile_id: BEN.profile_id, phone: BEN.phone })],
      completions: [{ template_id: 'tB', site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p2' }] })
    f.s.identities.push({ ...benLinked, last_inbound_at: '2026-10-12T08:00:00Z' })   // window closed
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d)
    expect(f.sent.slice(1).map((m) => [m.to, textOf(m)])).toEqual([[ANNA.phone, '🎉 All Kitchen checks done today']])
    expect(f.s.events.has('g1|day_end|2026-10-14')).toBe(true)
  })
  it('a weekly checklist still open does not block it', async () => {
    const f = fakeTeamBot({ templates: [FRIDGE, tpl({ id: 'tW', name: 'Deep clean', frequency: 'weekly' })], mappings: [MAP[0], { group_id: 'g1', template_id: 'tW' }] })
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d)
    expect(textOf(f.sent[1])).toBe('🎉 All Kitchen checks done today')
  })
})

// Review Focus 2: one person in two teams at the same site, same checklist mapped to both.
describe('two teams at the same site', () => {
  it('two menus; once either team records it, the other team answers "Already done" and records nothing', async () => {
    const f = kitchen({ members: [member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone }), member({ id: 'gm2', group_id: 'g2', profile_id: BEN.profile_id, phone: BEN.phone }), member({ id: 'gm3', group_id: 'g2', profile_id: ANNA.profile_id, phone: ANNA.phone })] })
    f.s.teams.push({ id: 'g2', business_id: 'b', title: 'Bar', site_id: 's1' })
    f.s.mappings.push({ group_id: 'g2', template_id: 'tA' })
    f.s.identities.push({ ...benLinked })
    await handleInbound(say(ANNA.phone, 'checks'), f.d)
    expect(f.sent.map((m) => m.interactive.header.text)).toEqual(['📋 Kitchen · Ashfield Row — 0 of 2 done', '📋 Bar · Ashfield Row — 0 of 1 done'])
    await handleInbound(tap(BEN.phone, 'tfill:g2:tA'), f.d)
    const benToken = [...f.tokens.values()].find((t) => t.profile_id === 'p2')!.token
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    await handleInbound(submit(ANNA.phone, [...f.tokens.values()].find((t) => t.profile_id === 'p1')!.token, { f0: '3' }), f.d)
    await handleInbound(submit(BEN.phone, benToken, { f0: '3' }), f.d)
    expect(f.s.completionRows).toHaveLength(1)
    expect(textOf(f.sent.filter((m) => m.to === BEN.phone)[1])).toBe('Already done ✓ by Anna 10:40')
  })
})

describe('join route', () => {
  it('an unlinked number taps Join on its invite → linked and answered', async () => {
    const MARIA = '447700900777'
    const f = kitchen({ members: [member({ id: 'gm9', profile_id: 'p9', phone: MARIA, status: 'invited', full_name: 'Maria Lopez', last_invite_sent_at: '2026-10-14T09:00:00Z' })] })
    await handleInbound(tap(MARIA, 'join:gm9'), f.d)
    expect(textOf(f.sent[0])).toBe("You're in Kitchen at Ashfield Row ✓")
    expect(f.s.members[0].status).toBe('active')
    await handleInbound(tap('447700900555', 'join:gm9'), f.d)    // someone else's phone: ignored
    expect(f.sent).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Rewrite `bot.test.ts`** to the channel-level tests that still apply (the LINK, role-assignment and personal-form tests are replaced by `team-bot.test.ts` above):

```ts
// src/lib/whatsapp/__tests__/bot.test.ts
// Channel-level bot behaviour that doesn't depend on teams: identity, STOP/HELP, tokens, corrective replies, alerts.
import { describe, it, expect } from 'vitest'
import { handleInbound, TEXT } from '../../../../supabase/functions/_shared/channels/bot'
import { alertManagers, type AlertRecipient } from '../../../../supabase/functions/_shared/channels/alerts'
import { fakeTeamBot, textOf } from './fakes/team-bot-deps'
import { ANNA } from './fakes/team-deps'

type Recipients = () => Promise<(Omit<AlertRecipient, 'channel'> & { channel?: AlertRecipient['channel'] })[]>
function fake(recipients: Recipients = async () => [{ external_id: '447700900999', last_inbound_at: null }], init: Parameters<typeof fakeTeamBot>[0] = {}) {
  const logs: any[] = []
  const f = fakeTeamBot(init)
  // Cross-channel alert path with fake AlertDeps; every channel sends via d.send.
  f.d.alertManagers = (b, a) => alertManagers({
    managerRecipients: async () => (await recipients()).map((r) => ({ channel: 'whatsapp' as const, ...r })),
    ready: async () => true,
    log: async (e) => { logs.push(e) },
  }, { whatsapp: (m) => f.d.send(m), telegram: (m) => f.d.send(m) }, b, a, f.d.now())
  return { ...f, logs }
}
const from = ANNA.phone
const corrective = (f: ReturnType<typeof fake>) => f.d.saveToken({ token: 'ct', kind: 'corrective', business_id: 'b', profile_id: 'p1', site_id: 's1', template_id: 't1', item_ids: null, response_id: 'resp0', expires_at: '2099-01-01', used_at: null })

describe('bot', () => {
  it('unknown number and unavailable business', async () => {
    const f = fake()
    await handleInbound({ kind: 'text', from: '440000', text: 'hi', id: 'x' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.unknown)
    expect(TEXT.unknown).toBe('Ask your manager to add you to a Blueroll team.')
    const g = fake(undefined, { ready: { b: false } })
    await handleInbound({ kind: 'text', from, text: 'checks', id: 'x' }, g.d)
    expect(textOf(g.sent[0])).toBe(TEXT.unavailable)
  })
  it('STOP revokes; STOP and HELP work even when the business is not ready', async () => {
    const f = fake(undefined, { ready: { b: false } })
    await handleInbound({ kind: 'text', from, text: 'help', id: 'x' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.help)
    await handleInbound({ kind: 'text', from, text: ' Stop ', id: 'x2' }, f.d)
    expect(f.s.identities[0].revoked).toBe(true)
    expect(textOf(f.sent[1])).toBe(TEXT.stopped)
    expect(TEXT.stopped).toBe("You're disconnected from Blueroll. You won't get any more messages. Ask your manager to add you again to reconnect.")
  })
  it('a used or unknown token is refused', async () => {
    const f = fake()
    await handleInbound({ kind: 'flow', from, token: 'nope', response: {}, id: 'y' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.formExpired)
  })
  it('a token of another person is ignored and not burnt', async () => {
    const f = fake()
    await f.d.saveToken({ token: 'ot', kind: 'checklist', business_id: 'b', profile_id: 'someone-else', site_id: 's1', template_id: 't1', item_ids: ['i1'], response_id: null, expires_at: '2099-01-01', used_at: null, group_id: 'g1' })
    await handleInbound({ kind: 'flow', from, token: 'ot', response: { f0: '3' }, id: 'z' }, f.d)
    expect(f.s.completionRows).toHaveLength(0)
    expect(f.tokens.get('ot')!.used_at).toBeNull()
  })
  it('corrective reply closes the response and alerts managers', async () => {
    const f = fake()
    await corrective(f)
    await handleInbound({ kind: 'flow', from, token: 'ct', response: { action: 'moved', details: 'to fridge 2' }, id: 'z' }, f.d)
    expect(f.corrective).toEqual([{ rid: 'resp0', notes: 'Moved food to another fridge: to fridge 2' }])
    expect(f.sent[0].template.name).toBe('manager_alert')
    expect(f.sent[0].template.components[0].parameters[2].text).toBe('9 °C')
    expect(f.sent[0].template.components[0].parameters[3].text).toBe('10:40')
    expect(textOf(f.sent[1])).toBe(TEXT.correctiveThanks)
  })
  it('manager alerts are billable only outside the manager 24h window', async () => {
    const f = fake(async () => [
      { external_id: '447700900901', last_inbound_at: '2026-10-14T01:00:00Z' },
      { external_id: '447700900902', last_inbound_at: '2026-10-13T09:00:00Z' },
      { external_id: '447700900903', last_inbound_at: null },
    ])
    await corrective(f)
    await handleInbound({ kind: 'flow', from, token: 'ct', response: { action: 'moved' }, id: 'z' }, f.d)
    expect(f.logs.filter((l) => l.kind === 'alert').map((l) => l.billable)).toEqual([false, true, true])
  })
  it('corrective alert reaches a Telegram manager as text and a WhatsApp manager as the template', async () => {
    const f = fake(async () => [
      { channel: 'telegram', external_id: '555', last_inbound_at: null },
      { channel: 'whatsapp', external_id: '447700900999', last_inbound_at: null },
    ])
    await corrective(f)
    await handleInbound({ kind: 'flow', from, token: 'ct', response: { action: 'moved' }, id: 'z' }, f.d)
    expect(f.sent[0]).toEqual({ chat_id: '555', text: '⚠ Ashfield Row · Walk-in fridge 9 °C at 10:40 (Anna Smith). Action: Moved food to another fridge. — via Blueroll' })
    expect(f.sent[1]).toMatchObject({ to: '447700900999', template: { name: 'manager_alert' } })
  })
  it('the same inbound message delivered twice is handled once', async () => {
    const f = fake()
    await handleInbound({ kind: 'text', from, text: 'help', id: 'wamid.DUP' }, f.d)
    await handleInbound({ kind: 'text', from, text: 'help', id: 'wamid.DUP' }, f.d)
    expect(f.sent).toHaveLength(1)
  })
})
```

The corrective alert time `10:40` needs the token's site timezone: in the rewritten `bot.ts` the corrective branch reads the site from `d.teams.site(tok.site_id)` (fake site `s1` = Europe/London).

In `src/lib/whatsapp/__tests__/alerts.test.ts`, add `import { fakeTeamDeps } from './fakes/team-deps'` and add `teams: fakeTeamDeps().d` to both `makeDeps(fakeAdmin(…), { … })` config objects.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/team-bot.test.ts src/lib/whatsapp/__tests__/bot.test.ts`
Expected: FAIL — menus are still role-based (`notInTeam`/`tfill` not handled), `TEXT.unknown` still mentions a QR code, `BotDeps` has no `teams`.

- [ ] **Step 5: Rewrite `bot.ts`**

```ts
// supabase/functions/_shared/channels/bot.ts
// WhatsApp conversation logic over injected dependencies (pure; unit-tested with fakes). Checks reach WhatsApp only
// through teams (spec 2026-10-12): one menu per team, any active member fills in, the first submit wins. LINK codes and
// role-assignment reminders are retired; existing identities keep working.
import type { InboundEvent, SendFn, OutboundMessage } from './types.ts'
import type { Person, Template, TemplateItem } from '../checklists-core/types.ts'
import type { CoreDb } from '../checklists-core/record.ts'
import { recordCompletion } from '../checklists-core/record.ts'
import { completionsWindowStart } from '../checklists-core/due.ts'
import { formItems, parseFormAnswers } from '../checklists-core/answers.ts'
import { CORRECTIVE_ACTIONS, itemsHash } from './whatsapp-flows.ts'
import { whatsappUI, type Channel, type ChannelUI, type ManagerAlert } from './ui.ts'
import { renderDueMenu } from './due-menu.ts'
import { hhmm, localDate } from './live-list.ts'
import { doneInPeriod, takePeriodKey, teamDayState, todayOnly, type TeamDayState } from './team-day.ts'
import { handleJoin } from './team-members.ts'
import { celebrateTeam } from './team-cron.ts'
import { TEAM_TEXT } from './team-text.ts'
import type { Team, TeamDeps } from './teams-db.ts'
import type { CompletionWho } from './groups-db.ts'
export { isBillable, SERVICE_WINDOW_MS } from './service-window.ts'

export interface Identity { id: string; business_id: string; profile_id: string; external_id: string }
export interface SiteInfo { id: string; name: string; timezone: string }
export interface FormToken {
  token: string; kind: 'checklist' | 'corrective'; business_id: string; profile_id: string; site_id: string
  template_id: string | null; item_ids: string[] | null; response_id: string | null; expires_at: string; used_at: string | null
  /** WhatsApp team the checklist form was opened from. Absent/null: a corrective form, or a retired role-based form. */
  group_id?: string | null
}
export interface BotDeps extends CoreDb {
  /** Channel this bot instance serves; replies go out on it via `ui` + `send`. */
  channel: Channel
  ui: ChannelUI
  now(): Date
  send: SendFn
  newToken(): string
  findIdentity(externalId: string): Promise<Identity | null>
  touchIdentity(id: string, at: Date): Promise<void>
  revokeIdentity(id: string): Promise<void>
  ready(businessId: string): Promise<boolean>
  person(profileId: string): Promise<Person | null>
  items(templateId: string): Promise<TemplateItem[]>
  /** Published flow for (template, site); item_ids may be stale (editors re-create items on save) — compare items_hash. */
  flowFor(templateId: string, siteId: string): Promise<{ flow_id: string; item_ids: string[]; items_hash: string } | null>
  correctiveFlowId(): string
  saveToken(t: FormToken): Promise<void>
  takeToken(token: string, now: Date, profileId: string): Promise<FormToken | null>   // marks used only if owned by profileId; null if unknown/foreign/used/expired
  setCorrective(responseId: string, notes: string): Promise<{ templateName: string; itemName: string; value: string; unit: string | null; siteName: string; byName: string; businessId: string } | null>
  /** Alert every active owner/manager on each channel they are linked on (see alerts.ts alertManagers). */
  alertManagers(businessId: string, a: ManagerAlert): Promise<void>
  /**
   * Message-log row. Returns false only for an inbound row whose wa_message_id was already logged
   * (unique index uq_channel_inbound_msg → duplicate webhook delivery); true otherwise, including on other log errors.
   */
  log(e: { business_id: string | null; site_id: string | null; profile_id: string | null; direction: 'in' | 'out'; kind: string; template_name?: string; billable: boolean; ref_id?: string; wa_message_id?: string | null }): Promise<boolean>
  /** This person's WhatsApp-recorded answers still awaiting a corrective action (last 2 days), oldest first. */
  pendingCorrective(profileId: string): Promise<PendingCorrective[]>
  /** WhatsApp teams: membership, team checklists, takes, events (teams-db.ts). */
  teams: TeamDeps
}
export interface PendingCorrective { response_id: string; item: TemplateItem; value: string; site_id: string; template_id: string }

/** Bot copy for a channel: identical everywhere except how commands are spelled ('CHECKS' vs '/checks'). */
export function textsFor(ui: Pick<ChannelUI, 'channel' | 'commandWord'>) {
  const w = ui.commandWord
  return {
    unknown: 'Ask your manager to add you to a Blueroll team.',
    unavailable: "Blueroll checks aren't available for your team right now. Please use the Blueroll app.",
    stopped: "You're disconnected from Blueroll. You won't get any more messages. Ask your manager to add you again to reconnect.",
    help: `Blueroll checks: tap Fill in on a reminder, or type ${w('checks')} to see what is due. Type ${w('stop')} to disconnect.`,
    fallback: `I can help with your checks — tap Fill in or type ${w('checks')}.`,
    nothingDue: 'Nothing is due right now 👍',
    appOnly: (name: string) => `${name} can only be completed in the Blueroll app.`,
    missing: (names: string[]) => `Some required answers were missing: ${names.join(', ')}. Please fill in the form again.`,
    formExpired: `This form has expired — type ${w('checks')} to get a new one.`,
    checklistChanged: 'This checklist was updated — here is the new form.',
    correctiveBody: (item: string) => `${item} is out of range. Tell us what you did.`,
    correctiveThanks: 'Thanks — your manager has been told.',
  }
}
/** WhatsApp copy (the plan's exact strings). */
export const TEXT = textsFor(whatsappUI())

const TOKEN_TTL_MS = 24 * 3600 * 1000
const MAX_PENDING_CORRECTIVE = 3

/** Save a one-off `checklist` form token for (person, site, template[, team]) covering `itemIds`; returns the token. */
export async function saveChecklistToken(d: Pick<BotDeps, 'newToken' | 'saveToken' | 'now'>,
  a: { business_id: string; profile_id: string; site_id: string; template_id: string; group_id?: string | null }, itemIds: string[]): Promise<string> {
  const token = d.newToken()
  await d.saveToken({ token, kind: 'checklist', business_id: a.business_id, profile_id: a.profile_id, site_id: a.site_id,
    template_id: a.template_id, item_ids: itemIds, response_id: null, expires_at: new Date(d.now().getTime() + TOKEN_TTL_MS).toISOString(),
    used_at: null, group_id: a.group_id ?? null })
  return token
}

/** Item ids the Telegram Mini App form covers, or null when the checklist can only be completed in the app (required photo / nothing fillable). */
export function telegramFormItemIds(items: TemplateItem[]): string[] | null {
  const fi = formItems(items)
  return fi.unsupportedRequired.length || !fi.supported.length ? null : fi.supported.map((i) => i.id)
}

type Ctx = { business_id: string | null; profile_id: string | null; site_id?: string | null }
async function out(d: BotDeps, ctx: Ctx, msg: OutboundMessage, kind: string) {
  const r = await d.send(msg)
  await d.log({ business_id: ctx.business_id, site_id: ctx.site_id ?? null, profile_id: ctx.profile_id, direction: 'out', kind, billable: false, wa_message_id: r.id })
}

/** Value with its unit for alerts ('9 °C'); values without a unit are returned as-is. */
export const withUnit = (value: string, unit: string | null | undefined) => (unit ? `${value} ${unit}` : value)

function valueText(item: TemplateItem, value: string): string {
  if (item.item_type === 'yes_no') return 'Answered: No'
  const u = item.unit ?? '°C'
  const lim = item.min_value != null && item.max_value != null ? `limit ${item.min_value}–${item.max_value} ${u}`
    : item.min_value != null ? `limit ${item.min_value} ${u} or above` : `limit ${item.max_value} ${u} or below`
  return `${value} ${u} (${lim})`
}

async function sendCorrectiveForm(d: BotDeps, from: string, person: Person, c: { site_id: string; template_id: string; response_id: string; item: TemplateItem; value: string }) {
  if (d.ui.channel !== 'whatsapp') return
  const flowId = d.correctiveFlowId()
  if (!flowId) {
    // Not configured yet (WA_CORRECTIVE_FLOW_ID): the answer stays corrective_status='needed' and managers were notified in-app.
    console.error('whatsapp: WA_CORRECTIVE_FLOW_ID is not set — corrective form not sent for response', c.response_id)
    return
  }
  const token = d.newToken()
  const msg = d.ui.corrective(from, { token, flowId, itemName: c.item.name, valueText: valueText(c.item, c.value) })
  if (!msg) return
  await d.saveToken({ token, kind: 'corrective', business_id: person.business_id, profile_id: person.profile_id, site_id: c.site_id,
    template_id: c.template_id, item_ids: null, response_id: c.response_id, expires_at: new Date(d.now().getTime() + TOKEN_TTL_MS).toISOString(), used_at: null })
  await out(d, { business_id: person.business_id, profile_id: person.profile_id, site_id: c.site_id }, msg, 'corrective_flow')
}

// ---- Teams -------------------------------------------------------------------------------------------------------

type Membership = { kind: 'ok'; team: Team; site: SiteInfo } | { kind: 'not_member'; team: Team } | { kind: 'gone' }

/** The person's standing in a team of their business (checked on every form open and submit, spec §5). */
async function membership(d: BotDeps, person: Person, groupId: string): Promise<Membership> {
  const team = await d.teams.teamById(groupId)
  if (!team || team.business_id !== person.business_id) return { kind: 'gone' }
  const m = await d.teams.memberFor(team.id, person.profile_id)
  if (!m || m.status !== 'active') return { kind: 'not_member', team }
  const site = await d.teams.site(team.site_id)
  return site ? { kind: 'ok', team, site } : { kind: 'gone' }
}

interface TeamView { templates: Template[]; completions: CompletionWho[]; state: TeamDayState; names: Map<string, string> }
async function teamView(d: BotDeps, team: Team, site: SiteInfo, now: Date): Promise<TeamView> {
  const templates = await d.teams.teamTemplates(team)
  const completions = templates.length ? await d.teams.completionsSince(team.business_id, completionsWindowStart(templates, [site.timezone], now)) : []
  const state = teamDayState({ templates, siteId: site.id, tz: site.timezone, now, completions })
  const names = await d.teams.firstNames([...new Set(state.done.map((x) => x.by).filter((x): x is string => !!x))])
  return { templates, completions, state, names }
}

/** One team's menu (shipped due-menu format, rows `tfill:<team>:<template>`); false when nothing is open there. */
async function sendTeamMenu(d: BotDeps, from: string, person: Person, team: Team, site: SiteInfo): Promise<boolean> {
  const now = d.now()
  const v = await teamView(d, team, site, now)
  if (!v.state.open.length) return false
  const menu = renderDueMenu({
    siteId: site.id, siteName: TEAM_TEXT.teamHeader(team.title, site.name), tz: site.timezone, now,
    open: v.state.open.map((x) => ({ templateId: x.template.id, name: x.template.name, deadlineUtc: x.deadline_utc })),
    done: v.state.done.map((x) => ({ name: x.template.name, completedAt: x.completedAt, by: (x.by && v.names.get(x.by)) || null })),
    rowId: (templateId) => `tfill:${team.id}:${templateId}`,
  })
  await out(d, { business_id: person.business_id, profile_id: person.profile_id, site_id: site.id }, d.ui.dueMenu(from, menu), 'reply')
  return true
}

/** `checks`: pending corrective forms first, then one menu per team (or only `onlyGroupId` when the person is in it). */
async function sendTeamMenus(d: BotDeps, from: string, person: Person, onlyGroupId: string | null) {
  const ctx = { business_id: person.business_id, profile_id: person.profile_id }
  const all = await d.teams.activeMemberships(person.profile_id)
  if (!all.length) return out(d, ctx, d.ui.text(from, TEAM_TEXT.notInTeam), 'reply')
  const mine = onlyGroupId && all.some((m) => m.group_id === onlyGroupId) ? all.filter((m) => m.group_id === onlyGroupId) : all
  const teams: { team: Team; site: SiteInfo }[] = []
  for (const m of mine) {
    const team = await d.teams.teamById(m.group_id)
    const site = team ? await d.teams.site(team.site_id) : null
    if (team && site) teams.push({ team, site })
  }
  const siteIds = new Set(teams.map((x) => x.site.id))
  const pending = (await d.pendingCorrective(person.profile_id)).filter((p) => siteIds.has(p.site_id))
  for (const p of pending.slice(0, MAX_PENDING_CORRECTIVE)) await sendCorrectiveForm(d, from, person, p)
  let any = false
  for (const x of teams) if (await sendTeamMenu(d, from, person, x.team, x.site)) any = true
  if (!any) await out(d, ctx, d.ui.text(from, TEXT.nothingDue), 'reply')
}

/** "Already done ✓ by <first name> <HH:MM>" and the fresh menu (spec §3 "Others' completions"). */
async function alreadyDone(d: BotDeps, from: string, person: Person, team: Team, site: SiteInfo, by: string | null, atIso: string) {
  await out(d, { business_id: person.business_id, profile_id: person.profile_id, site_id: site.id }, d.ui.text(from, TEAM_TEXT.alreadyDone(by, hhmm(atIso, site.timezone))), 'reply')
  await sendTeamMenu(d, from, person, team, site)
}

/** Flow for one checklist at the team's site (published Flow of the current shape); token bound to person + team. */
async function sendTeamForm(d: BotDeps, from: string, person: Person, t: Template, team: Team) {
  const X = textsFor(d.ui)
  const ctx = { business_id: person.business_id, profile_id: person.profile_id, site_id: team.site_id }
  const appOnly = () => out(d, ctx, d.ui.text(from, X.appOnly(t.name)), 'reply')
  const flow = await d.flowFor(t.id, team.site_id)
  if (!flow) return appOnly()
  // The flow's stored item_ids go stale whenever an editor saves (items are deleted and re-inserted). If the current
  // items still have the published form's shape, the token carries the CURRENT ids by position; otherwise the published
  // form no longer matches the checklist and we don't send it (the next sync republishes).
  const items = await d.items(t.id)
  const current = formItems(items).supported
  if (current.length !== flow.item_ids.length || (await itemsHash(t.name, items)) !== flow.items_hash) return appOnly()
  const token = await saveChecklistToken(d, { business_id: person.business_id, profile_id: person.profile_id, site_id: team.site_id, template_id: t.id, group_id: team.id }, current.map((i) => i.id))
  const msg = d.ui.form(from, { templateName: t.name, token, flowId: flow.flow_id })
  if (!msg) return appOnly()
  await out(d, ctx, msg, 'flow')
}

/** Button `tfill:<team>:<template>`: membership + mapping checked; a closed checklist answers "Already done". */
async function openTeamForm(d: BotDeps, from: string, person: Person, groupId: string, templateId: string) {
  const X = textsFor(d.ui)
  const ctx = { business_id: person.business_id, profile_id: person.profile_id }
  const ms = await membership(d, person, groupId)
  if (ms.kind === 'gone') return out(d, ctx, d.ui.text(from, X.formExpired), 'reply')
  if (ms.kind === 'not_member') return out(d, ctx, d.ui.text(from, TEAM_TEXT.noLongerIn(ms.team.title)), 'reply')
  const v = await teamView(d, ms.team, ms.site, d.now())
  const template = v.templates.find((t) => t.id === templateId)
  if (!template) return out(d, ctx, d.ui.text(from, X.formExpired), 'reply')
  if (!v.state.open.some((x) => x.template.id === templateId)) {
    const last = v.state.done.find((x) => x.template.id === templateId)
    if (!last) return out(d, ctx, d.ui.text(from, X.formExpired), 'reply')
    return alreadyDone(d, from, person, ms.team, ms.site, (last.by && v.names.get(last.by)) || null, last.completedAt)
  }
  return sendTeamForm(d, from, person, template, ms.team)
}

/** Flow submit with a team token (spec §5 steps 1–4). */
async function submitTeamForm(d: BotDeps, from: string, person: Person, tok: FormToken, response: Record<string, unknown>) {
  const X = textsFor(d.ui)
  const now = d.now()
  const ctx = { business_id: person.business_id, profile_id: person.profile_id, site_id: tok.site_id }
  const reply = (body: string) => out(d, ctx, d.ui.text(from, body), 'reply')
  // 1. Still an active member of the token's team, checklist still mapped, same site. (A token without a team was
  //    sent by the retired role-based flow.)
  if (!tok.group_id) return reply(X.formExpired)
  const ms = await membership(d, person, tok.group_id)
  if (ms.kind === 'gone') return reply(X.formExpired)
  if (ms.kind === 'not_member') return reply(TEAM_TEXT.noLongerIn(ms.team.title))
  const { team, site } = ms
  if (site.id !== tok.site_id) return reply(X.formExpired)
  const v = await teamView(d, team, site, now)
  const template = v.templates.find((t) => t.id === tok.template_id)
  if (!template) return reply(X.formExpired)
  const items = await d.items(template.id)
  const ids = tok.item_ids ?? []
  // Items re-created since the form was sent (editor save) — answers can't be mapped safely: record nothing, resend.
  const known = new Set(items.map((i) => i.id))
  if (ids.some((x) => !known.has(x))) { await reply(X.checklistChanged); return sendTeamForm(d, from, person, template, team) }
  const parsed = parseFormAnswers(ids, items, response)
  if (parsed.missingRequired.length) { await reply(X.missing(parsed.missingRequired)); return sendTeamForm(d, from, person, template, team) }
  // 2. A completion from any source already closed it, or someone else's submit takes it first.
  const open = v.state.open.find((x) => x.template.id === template.id)
  if (!open) {
    const last = v.state.done.find((x) => x.template.id === template.id)
    return alreadyDone(d, from, person, team, site, (last?.by && v.names.get(last.by)) || null, last?.completedAt ?? now.toISOString())
  }
  const done = doneInPeriod(template, site.id, site.timezone, now, v.completions)
  const key = { group_id: team.id, template_id: template.id, site_id: site.id, period_key: takePeriodKey(template, open.period_key, done) }
  if (!(await d.teams.claimTake(key, person.profile_id, now))) {
    const owner = await d.teams.takeOwner(key)
    const name = owner?.profile_id ? (await d.teams.firstNames([owner.profile_id])).get(owner.profile_id) ?? null : null
    return alreadyDone(d, from, person, team, site, name, owner?.taken_at ?? now.toISOString())
  }
  // 3. Record (out-of-range → corrective form → manager alert, unchanged).
  let rec: Awaited<ReturnType<typeof recordCompletion>>
  try {
    rec = await recordCompletion(d, { person, siteId: site.id, template, items, answers: parsed.answers, source: 'whatsapp', now })
  } catch (err) {
    await d.teams.releaseTake(key, person.profile_id)   // the same form can be submitted again
    throw err
  }
  for (const fl of rec.flagged) {
    await sendCorrectiveForm(d, from, person, { site_id: site.id, template_id: template.id, response_id: fl.responseId, item: fl.item, value: fl.value })
  }
  // 4. That closed the team's last open checklist today → 🎉 (once per team per day, open windows only).
  const before = todayOnly(v.state).open
  const after = todayOnly(teamDayState({ templates: v.templates, siteId: site.id, tz: site.timezone, now,
    completions: [...v.completions, { template_id: template.id, site_id: site.id, completed_at: now.toISOString(), completed_by: person.profile_id }] })).open
  if (before.some((x) => x.template.id === template.id) && !after.length) await celebrateTeam(d.teams, d.send, team, localDate(now, site.timezone), now)
}

// ---- Entry point -------------------------------------------------------------------------------------------------

export async function handleInbound(e: InboundEvent, d: BotDeps): Promise<void> {
  const X = textsFor(d.ui)
  const reply = (body: string) => d.ui.text(e.from, body)
  const now = d.now()
  const waId = e.id || null
  const id = await d.findIdentity(e.from)
  // Every inbound row is logged FIRST: uq_channel_inbound_msg turns a duplicate webhook delivery into a no-op
  // before anything is consumed, recorded or sent.
  if (!(await d.log({ business_id: id?.business_id ?? null, site_id: null, profile_id: id?.profile_id ?? null, direction: 'in', kind: e.kind, billable: false, wa_message_id: waId }))) return
  // Join comes from a number that is not linked yet (or linked to another business): before the identity checks.
  if (e.kind === 'button' && e.payload.startsWith('join:')) return handleJoin(d.teams, d.send, { from: e.from, memberId: e.payload.slice(5) })
  if (!id) return out(d, { business_id: null, profile_id: null }, reply(X.unknown), 'reply')
  await d.touchIdentity(id.id, now)
  const ctx = { business_id: id.business_id, profile_id: id.profile_id }
  // STOP / HELP work regardless of whether the business can use WhatsApp right now.
  if (e.kind === 'text') {
    const cmd = e.text.trim().toLowerCase()
    if (cmd === 'stop') { await d.revokeIdentity(id.id); return out(d, ctx, reply(X.stopped), 'reply') }
    if (cmd === 'help') return out(d, ctx, reply(X.help), 'reply')
  }
  if (!(await d.ready(id.business_id))) return out(d, ctx, reply(X.unavailable), 'reply')
  const person = await d.person(id.profile_id)
  if (!person) return out(d, ctx, reply(X.unknown), 'reply')

  if (e.kind === 'contact') return out(d, ctx, reply(X.fallback), 'reply')   // manager commands: Task 8
  if (e.kind === 'text') {
    if (e.text.trim().toLowerCase() === 'checks') return sendTeamMenus(d, e.from, person, null)
    return out(d, ctx, reply(X.fallback), 'reply')
  }
  if (e.kind === 'button') {
    // `fill:` = the button of a reminder from the retired role-based flow: show the team menus instead.
    if (e.payload === 'checks' || e.payload.startsWith('fill:')) return sendTeamMenus(d, e.from, person, null)
    const c = e.payload.match(/^checks:([0-9a-zA-Z-]+)$/)
    if (c) return sendTeamMenus(d, e.from, person, c[1])
    const f = e.payload.match(/^tfill:([0-9a-zA-Z-]+):([0-9a-zA-Z-]+)$/)
    if (f) return openTeamForm(d, e.from, person, f[1], f[2])
    return out(d, ctx, reply(X.fallback), 'reply')
  }

  // flow reply
  const tok = await d.takeToken(e.token, now, id.profile_id)
  if (!tok) return out(d, ctx, reply(X.formExpired), 'reply')
  if (tok.profile_id !== id.profile_id) return
  if (tok.kind === 'checklist') return submitTeamForm(d, e.from, person, tok, e.response)
  // corrective
  const action = CORRECTIVE_ACTIONS.find((a) => a.id === e.response.action)?.title ?? 'Other'
  const details = typeof e.response.details === 'string' && e.response.details.trim() ? `: ${e.response.details.trim()}` : ''
  const info = tok.response_id ? await d.setCorrective(tok.response_id, `${action}${details}`) : null
  if (info) {
    const site = await d.teams.site(tok.site_id)
    const time = hhmm(now.toISOString(), site?.timezone ?? 'Europe/London')
    await d.alertManagers(info.businessId, { siteName: info.siteName, itemName: info.itemName, value: withUnit(info.value, info.unit), time, byName: info.byName, action: `${action}${details}` })
  }
  await out(d, ctx, reply(X.correctiveThanks), 'reply')
}
```

- [ ] **Step 6: Update `db.ts`**

- Imports: `import type { BotDeps, FormToken } from './bot.ts'`, `import type { TeamDeps } from './teams-db.ts'`; drop the `maskId` and `Identity` imports.
- `const TOKEN_COLS = 'token, kind, business_id, profile_id, site_id, template_id, item_ids, response_id, expires_at, used_at, group_id'`
- `DepsConfig` gets `/** WhatsApp teams (teams-db.ts makeTeamDeps). */ teams: TeamDeps`.
- In `makeDeps`, delete `consumeLinkCode`, `sitesFor`, `templates`, `completionsSince`, `linkFailures`, `recordLinkFailure`, and add `teams: cfg.teams,` after `correctiveFlowId`. Keep `hashExternalId`, `pageAll`, `peekToken`, `releaseToken` (used by Telegram code).

- [ ] **Step 7: Wire the webhook** — `supabase/functions/whatsapp-webhook/index.ts`

```ts
import { verifySignature, parseInbound, parseStatuses, makeSender } from "../_shared/channels/whatsapp.ts";
import { makeTeamDeps } from "../_shared/channels/teams-db.ts";
import { applyDeliveryStatuses } from "../_shared/channels/team-members.ts";
// …
const teams = makeTeamDeps(admin);
const deps = makeDeps(admin, { channel: "whatsapp", ui: whatsappUI(), send, correctiveFlowId: CORRECTIVE_FLOW_ID, telegramAlertGroups, teams });
```
and in the handler, right after the inbound-events loop:

```ts
  // Delivery statuses: Meta's "can't reach this number" errors mark team members "Not reachable"; a delivery clears it.
  try { await applyDeliveryStatuses(teams, parseStatuses(body)); }
  catch (err) { console.error("whatsapp statuses failed", (err as Error)?.message?.slice(0, 200)); }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/lib/whatsapp/__tests__/team-bot.test.ts src/lib/whatsapp/__tests__/bot.test.ts src/lib/whatsapp/__tests__/alerts.test.ts`
Expected: PASS.

- [ ] **Step 9: Full checks**

Run: `npm test` → all pass (removed: the LINK / role-assignment tests of the old `bot.test.ts`; added: `team-bot.test.ts`). `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `3`. The `deno check` line → ok. `grep -rnE "consumeLinkCode|linkExpired|TEXT\.linked" supabase src` → no matches.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/_shared/channels/bot.ts supabase/functions/_shared/channels/db.ts supabase/functions/whatsapp-webhook/index.ts src/lib/whatsapp/__tests__/fakes/team-bot-deps.ts src/lib/whatsapp/__tests__/team-bot.test.ts src/lib/whatsapp/__tests__/bot.test.ts src/lib/whatsapp/__tests__/alerts.test.ts
git commit -m "feat(whatsapp): member bot over teams — menus, first submit wins, Join; LINK and role-based paths removed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Manager in WhatsApp — shared contact, team picker, `team`, Remove with confirm

**Files:**
- Create: `supabase/functions/_shared/channels/team-admin.ts`
- Modify: `supabase/functions/_shared/channels/bot.ts` (route contacts, `team`, admin buttons)
- Test: `src/lib/whatsapp/__tests__/team-admin.test.ts`

**Interfaces:**
- Consumes: `addPersonToTeam`, `sendTracked`, `InviteOutcome` (Task 5); `TeamDeps`, `Team`, `TeamMember` (Task 3); `buttonsMessage`, `listMessage` (with `section`), `textMessage`; `TEAM_TEXT` (incl. `teamGone`), `firstName`; `maskPhone`; `clip` (`live-list.ts`); `fakeTeamBot`, `textOf` (Task 7).
- Produces:

```ts
export const TEAM_BUTTONS_MAX = 3     // reply buttons for ≤ 3 teams
export const TEAM_LIST_MAX = 10       // list for 4–10 teams
export const MEMBER_ROWS_MAX = 10     // "Remove <name>" rows per message
export function memberStatusText(m: Pick<TeamMember, 'status' | 'unreachable_at'>): 'Not reachable' | 'Active' | 'Invited'
export async function handleContactShare(t: TeamDeps, send: SendFn, from: string, person: Person, contact: { name: string; phone: string }): Promise<void>
export async function sendTeamOverview(t: TeamDeps, send: SendFn, from: string, person: Person): Promise<void>
export async function handleAdminButton(t: TeamDeps, send: SendFn, from: string, person: Person, payload: string): Promise<boolean>   // true = handled
```

Payloads: team pick `add:<group id>:<phone>:<name>` (stateless: the contact travels in the button id — ≤ 256 for buttons, ≤ 200 for list rows; name ≤ 60), `rm:<member id>`, `rmyes:<member id>`, `rmno`. Rulings (spec silent): staff typing `team` get `Only managers can manage teams.`; a contact with no name is added as `New person`; a pick for a deleted team answers `This team no longer exists.`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/whatsapp/__tests__/team-admin.test.ts
import { describe, it, expect } from 'vitest'
import { handleInbound } from '../../../../supabase/functions/_shared/channels/bot'
import { TEAM_TEXT } from '../../../../supabase/functions/_shared/channels/team-text'
import { fakeTeamBot, textOf } from './fakes/team-bot-deps'
import { member, ANNA, BOSS } from './fakes/team-deps'

const MARIA = '447700900777'
const share = (from: string, name = 'Maria Lopez', phone = MARIA) => ({ kind: 'contact' as const, from, name, phone, id: `c${Math.random()}` })
const tap = (from: string, payload: string) => ({ kind: 'button' as const, from, payload, id: `b${Math.random()}` })
const say = (from: string, text: string) => ({ kind: 'text' as const, from, text, id: `t${Math.random()}` })
const extraTeams = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `g${i + 2}`, business_id: 'b', title: `Team ${i + 2}`, site_id: 's1' }))

describe('shared contact', () => {
  it('a manager with one team: no question, invite sent, "Invite sent to <name> ✓"', async () => {
    const f = fakeTeamBot()
    await handleInbound(share(BOSS.phone), f.d)
    expect(f.sent.map((m) => [m.to, m.type === 'template' ? m.template.name : textOf(m)])).toEqual([[MARIA, 'team_invite'], [BOSS.phone, 'Invite sent to Maria Lopez ✓']])
    expect(f.s.members.find((m) => m.phone === MARIA)).toMatchObject({ status: 'invited', invited_by: 'm1' })
  })
  it('staff share → only managers; no teams → create one first', async () => {
    const a = fakeTeamBot()
    await handleInbound(share(ANNA.phone), a.d)
    expect(textOf(a.sent[0])).toBe(TEAM_TEXT.onlyManagers)
    expect(a.s.members).toHaveLength(1)
    const b = fakeTeamBot({ teams: [] })
    await handleInbound(share(BOSS.phone), b.d)
    expect(textOf(b.sent[0])).toBe(TEAM_TEXT.noTeams)
  })
  it('3 teams → reply buttons with the contact in the id', async () => {
    const f = fakeTeamBot()
    f.s.teams.push(...extraTeams(2))
    await handleInbound(share(BOSS.phone), f.d)
    const m = f.sent[0].interactive
    expect(m.type).toBe('button')
    expect(m.body.text).toBe('Add Maria Lopez (+44 7••• ••77) to which team?')
    expect(m.action.buttons.map((b: any) => [b.reply.id, b.reply.title])).toEqual([
      [`add:g1:${MARIA}:Maria Lopez`, 'Kitchen'], [`add:g2:${MARIA}:Maria Lopez`, 'Team 2'], [`add:g3:${MARIA}:Maria Lopez`, 'Team 3']])
    expect(f.s.members).toHaveLength(1)                                   // nothing added before the pick
  })
  it('5 teams → a list with one row per team (site in the description)', async () => {
    const f = fakeTeamBot()
    f.s.teams.push(...extraTeams(4))
    await handleInbound(share(BOSS.phone), f.d)
    const m = f.sent[0].interactive
    expect(m.type).toBe('list')
    expect(m.action.button).toBe('Choose a team')
    expect(m.action.sections[0].title).toBe('Teams')
    expect(m.action.sections[0].rows).toHaveLength(5)
    expect(m.action.sections[0].rows[0]).toEqual({ id: `add:g1:${MARIA}:Maria Lopez`, title: 'Kitchen', description: 'Ashfield Row' })
  })
  it('the pick adds and invites; a deleted team answers "no longer exists"', async () => {
    const f = fakeTeamBot()
    f.s.teams.push(...extraTeams(2))
    await handleInbound(tap(BOSS.phone, `add:g2:${MARIA}:Maria Lopez`), f.d)
    expect(f.s.members.find((m) => m.phone === MARIA)).toMatchObject({ group_id: 'g2', status: 'invited' })
    expect(textOf(f.sent[1])).toBe('Invite sent to Maria Lopez ✓')
    f.s.teams[2].deleted = true
    await handleInbound(tap(BOSS.phone, `add:g3:${MARIA}:Maria Lopez`), f.d)
    expect(textOf(f.sent[2])).toBe(TEAM_TEXT.teamGone)
  })
  it('a staff member cannot use a pick payload', async () => {
    const f = fakeTeamBot()
    await handleInbound(tap(ANNA.phone, `add:g1:${MARIA}:Maria`), f.d)
    expect(textOf(f.sent[0])).toBe(TEAM_TEXT.onlyManagers)
    expect(f.s.members).toHaveLength(1)
  })
})

describe('`team` command and Remove', () => {
  it('one message per team: members with status; rows "Remove <name>"', async () => {
    const f = fakeTeamBot({ members: [
      member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone, full_name: 'Anna Smith' }),
      member({ id: 'gm2', profile_id: 'p9', phone: MARIA, full_name: 'Maria Lopez', status: 'invited' }),
      member({ id: 'gm3', profile_id: 'p8', phone: '447700900888', full_name: 'Dan Cole', status: 'invited', unreachable_at: '2026-10-14T08:00:00Z' }),
      member({ id: 'gm4', profile_id: 'p7', phone: '447700900999', full_name: 'Gone Person', status: 'removed' }),
    ] })
    f.s.teams.push({ id: 'g2', business_id: 'b', title: 'Bar', site_id: 's1' })
    await handleInbound(say(BOSS.phone, 'TEAM'), f.d)
    expect(textOf(f.sent[0])).toBe(`Bar · Ashfield Row\n${TEAM_TEXT.noPeople}`)   // teams by title
    const kitchen = f.sent[1].interactive
    expect(kitchen.header.text).toBe('Kitchen · Ashfield Row')
    expect(kitchen.body.text).toBe('Anna Smith — Active\nMaria Lopez — Invited\nDan Cole — Not reachable')
    expect(kitchen.action.sections[0].rows.map((r: any) => [r.id, r.title])).toEqual([['rm:gm1', 'Remove Anna'], ['rm:gm2', 'Remove Maria'], ['rm:gm3', 'Remove Dan']])
  })
  it('more than 10 people → several messages of at most 10 rows', async () => {
    const f = fakeTeamBot({ members: Array.from({ length: 12 }, (_, i) => member({ id: `gm${i}`, profile_id: `q${i}`, phone: `4477009010${String(i).padStart(2, '0')}`, full_name: `Person ${i}` })) })
    await handleInbound(say(BOSS.phone, 'team'), f.d)
    expect(f.sent.map((m) => m.interactive.action.sections[0].rows.length)).toEqual([10, 2])
  })
  it('rm → confirm buttons; rmyes → removed; rmno → cancelled', async () => {
    const f = fakeTeamBot()
    await handleInbound(tap(BOSS.phone, 'rm:gm1'), f.d)
    expect(f.sent[0].interactive.body.text).toBe('Remove Anna Smith from Kitchen?')
    expect(f.sent[0].interactive.action.buttons.map((b: any) => [b.reply.id, b.reply.title])).toEqual([['rmyes:gm1', 'Remove'], ['rmno', 'Cancel']])
    await handleInbound(tap(BOSS.phone, 'rmno'), f.d)
    expect(textOf(f.sent[1])).toBe('Cancelled.')
    expect(f.s.members[0].status).toBe('active')
    await handleInbound(tap(BOSS.phone, 'rmyes:gm1'), f.d)
    expect(textOf(f.sent[2])).toBe('Anna Smith removed from Kitchen.')
    expect(f.s.members[0]).toMatchObject({ status: 'removed', removed_at: '2026-10-14T09:40:00.000Z' })
  })
  it('staff: `team` → only managers; a forged rmyes does nothing', async () => {
    const f = fakeTeamBot()
    await handleInbound(say(ANNA.phone, 'team'), f.d)
    expect(textOf(f.sent[0])).toBe(TEAM_TEXT.onlyManagersTeam)
    await handleInbound(tap(ANNA.phone, 'rmyes:gm1'), f.d)
    expect(f.s.members[0].status).toBe('active')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/team-admin.test.ts`
Expected: FAIL — contacts get the fallback text; `team` gets the fallback.

- [ ] **Step 3: Implement `team-admin.ts`**

```ts
// supabase/functions/_shared/channels/team-admin.ts
// Manager commands in WhatsApp (spec 2026-10-12 §6): share a contact → pick a team → invite; `team` → members with
// "Remove <name>" → confirm. Only numbers linked to an active owner/manager of the business. Pure over TeamDeps + SendFn;
// the contact travels inside the pick button's id, so there is no pending state.
import type { Person } from '../checklists-core/types.ts'
import type { OutboundMessage, SendFn } from './types.ts'
import type { Team, TeamDeps, TeamMember } from './teams-db.ts'
import { addPersonToTeam, sendTracked, type InviteOutcome } from './team-members.ts'
import { buttonsMessage, listMessage, textMessage } from './whatsapp.ts'
import { TEAM_TEXT, firstName } from './team-text.ts'
import { maskPhone } from './mask.ts'
import { clip } from './live-list.ts'

export const TEAM_BUTTONS_MAX = 3
export const TEAM_LIST_MAX = 10
export const MEMBER_ROWS_MAX = 10
const NAME_MAX = 60
const ADD_RE = /^add:([0-9a-zA-Z-]+):(\d{10,15}):(.*)$/

interface Who { t: TeamDeps; send: SendFn; from: string; person: Person }
// The manager just wrote to us, so their window is open: these replies are free.
const post = (w: Who, msg: OutboundMessage) => sendTracked(w.t, w.send, { to: w.from, msg, business_id: w.person.business_id, site_id: null,
  profile_id: w.person.profile_id, kind: 'reply', lastInboundAt: w.t.now().toISOString() })
const say = (w: Who, body: string) => post(w, textMessage(w.from, body))

const cleanName = (raw: string) => [...raw.replace(/\s+/g, ' ').trim()].slice(0, NAME_MAX).join('')
const memberName = (m: TeamMember) => m.full_name || maskPhone(m.phone)
export const memberStatusText = (m: Pick<TeamMember, 'status' | 'unreachable_at'>): 'Not reachable' | 'Active' | 'Invited' =>
  m.unreachable_at ? 'Not reachable' : m.status === 'active' ? 'Active' : 'Invited'
const outcomeText = (o: InviteOutcome, name: string, team: string) =>
  o === 'invited' ? TEAM_TEXT.inviteSent(name)
    : o === 'already_member' ? TEAM_TEXT.alreadyMember(name, team)
      : o === 'too_soon' ? TEAM_TEXT.inviteTooSoon(name)
        : TEAM_TEXT.inviteFailed(name)

const isManager = (w: Who) => w.t.isManager(w.person.profile_id, w.person.business_id)

async function addAndReport(w: Who, team: Team, phone: string, name: string) {
  const r = await addPersonToTeam(w.t, w.send, { team, phone, name, invitedBy: w.person.profile_id })
  await say(w, outcomeText(r.outcome, name, team.title))
}

/** A team of the manager's business; answers itself (not a manager / team gone) and returns null otherwise. */
async function managedTeam(w: Who, groupId: string): Promise<Team | null> {
  if (!(await isManager(w))) { await say(w, TEAM_TEXT.onlyManagers); return null }
  const team = await w.t.teamById(groupId)
  if (!team || team.business_id !== w.person.business_id) { await say(w, TEAM_TEXT.teamGone); return null }
  return team
}

export async function handleContactShare(t: TeamDeps, send: SendFn, from: string, person: Person, contact: { name: string; phone: string }): Promise<void> {
  const w: Who = { t, send, from, person }
  if (!(await isManager(w))) { await say(w, TEAM_TEXT.onlyManagers); return }
  const teams = (await t.teamsForBusiness(person.business_id)).slice(0, TEAM_LIST_MAX)
  if (!teams.length) { await say(w, TEAM_TEXT.noTeams); return }
  const name = cleanName(contact.name) || 'New person'
  if (teams.length === 1) return addAndReport(w, teams[0], contact.phone, name)
  const body = TEAM_TEXT.whichTeam(name, maskPhone(contact.phone))
  const id = (team: Team) => `add:${team.id}:${contact.phone}:${name}`
  if (teams.length <= TEAM_BUTTONS_MAX) {
    await post(w, buttonsMessage(from, body, teams.map((x) => ({ id: id(x), title: x.title }))))
    return
  }
  const rows: { id: string; title: string; description: string }[] = []
  for (const x of teams) rows.push({ id: id(x), title: clip(x.title, 24), description: clip((await t.site(x.site_id))?.name ?? '', 72) })
  await post(w, listMessage(from, { header: 'Add to a team', body, footer: 'Blueroll', button: 'Choose a team', section: 'Teams', rows }))
}

export async function sendTeamOverview(t: TeamDeps, send: SendFn, from: string, person: Person): Promise<void> {
  const w: Who = { t, send, from, person }
  if (!(await isManager(w))) { await say(w, TEAM_TEXT.onlyManagersTeam); return }
  const teams = await t.teamsForBusiness(person.business_id)
  if (!teams.length) { await say(w, TEAM_TEXT.noTeams); return }
  for (const team of teams) {
    const head = TEAM_TEXT.teamHeader(team.title, (await t.site(team.site_id))?.name ?? '')
    const people = (await t.members(team.id)).filter((m) => m.status !== 'removed')
    if (!people.length) { await say(w, `${head}\n${TEAM_TEXT.noPeople}`); continue }
    for (let i = 0; i < people.length; i += MEMBER_ROWS_MAX) {
      const chunk = people.slice(i, i + MEMBER_ROWS_MAX)
      await post(w, listMessage(from, {
        header: clip(head, 60), body: chunk.map((m) => `${memberName(m)} — ${memberStatusText(m)}`).join('\n'),
        footer: 'Blueroll', button: 'Remove someone', section: 'People',
        rows: chunk.map((m) => ({ id: `rm:${m.id}`, title: clip(`Remove ${m.full_name ? firstName(m.full_name) : maskPhone(m.phone)}`, 24), description: clip(memberName(m), 72) })),
      }))
    }
  }
}

async function memberOfManagedTeam(w: Who, memberId: string): Promise<{ m: TeamMember; team: Team } | null> {
  if (!(await isManager(w))) { await say(w, TEAM_TEXT.onlyManagers); return null }
  const m = await w.t.memberById(memberId)
  const team = m ? await w.t.teamById(m.group_id) : null
  if (!m || !team || team.business_id !== w.person.business_id) { await say(w, TEAM_TEXT.teamGone); return null }
  return { m, team }
}

/** Buttons and list rows of the manager flows; false = not an admin payload. */
export async function handleAdminButton(t: TeamDeps, send: SendFn, from: string, person: Person, payload: string): Promise<boolean> {
  const w: Who = { t, send, from, person }
  const add = payload.match(ADD_RE)
  if (add) {
    const team = await managedTeam(w, add[1])
    if (team) await addAndReport(w, team, add[2], cleanName(add[3]) || 'New person')
    return true
  }
  const rm = payload.match(/^rm:([0-9a-zA-Z-]+)$/)
  if (rm) {
    const x = await memberOfManagedTeam(w, rm[1])
    if (!x) return true
    if (x.m.status === 'removed') { await say(w, TEAM_TEXT.removed(memberName(x.m), x.team.title)); return true }
    await post(w, buttonsMessage(from, TEAM_TEXT.confirmRemove(memberName(x.m), x.team.title), [{ id: `rmyes:${x.m.id}`, title: 'Remove' }, { id: 'rmno', title: 'Cancel' }]))
    return true
  }
  const yes = payload.match(/^rmyes:([0-9a-zA-Z-]+)$/)
  if (yes) {
    const x = await memberOfManagedTeam(w, yes[1])
    if (!x) return true
    await t.removeMember(x.m.id, t.now())
    await say(w, TEAM_TEXT.removed(memberName(x.m), x.team.title))
    return true
  }
  if (payload === 'rmno') { await say(w, TEAM_TEXT.cancelled); return true }
  return false
}
```

- [ ] **Step 4: Route them in `bot.ts`**

Add the import:

```ts
import { handleAdminButton, handleContactShare, sendTeamOverview } from './team-admin.ts'
```

In `handleInbound` replace the contact / text / button blocks with:

```ts
  if (e.kind === 'contact') return handleContactShare(d.teams, d.send, e.from, person, { name: e.name, phone: e.phone })
  if (e.kind === 'text') {
    const cmd = e.text.trim().toLowerCase()
    if (cmd === 'checks') return sendTeamMenus(d, e.from, person, null)
    if (cmd === 'team') return sendTeamOverview(d.teams, d.send, e.from, person)
    return out(d, ctx, reply(X.fallback), 'reply')
  }
  if (e.kind === 'button') {
    if (await handleAdminButton(d.teams, d.send, e.from, person, e.payload)) return
    // `fill:` = the button of a reminder from the retired role-based flow: show the team menus instead.
    if (e.payload === 'checks' || e.payload.startsWith('fill:')) return sendTeamMenus(d, e.from, person, null)
    const c = e.payload.match(/^checks:([0-9a-zA-Z-]+)$/)
    if (c) return sendTeamMenus(d, e.from, person, c[1])
    const f = e.payload.match(/^tfill:([0-9a-zA-Z-]+):([0-9a-zA-Z-]+)$/)
    if (f) return openTeamForm(d, e.from, person, f[1], f[2])
    return out(d, ctx, reply(X.fallback), 'reply')
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/whatsapp/__tests__/team-admin.test.ts src/lib/whatsapp/__tests__/team-bot.test.ts src/lib/whatsapp/__tests__/bot.test.ts`
Expected: PASS.

- [ ] **Step 6: Full checks** — `npm test`, tsc count `3`, `deno check` line → ok.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/channels/team-admin.ts supabase/functions/_shared/channels/bot.ts src/lib/whatsapp/__tests__/team-admin.test.ts
git commit -m "feat(whatsapp): managers add people by sharing a contact; team command with Remove

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Settings API — `whatsapp-team-member` function, web client for teams, Team page column

**Files:**
- Create: `supabase/functions/_shared/channels/team-api.ts`
- Create: `supabase/functions/whatsapp-team-member/index.ts`
- Create: `src/lib/whatsapp/teams.ts`
- Modify: `src/lib/whatsapp/client.ts` (export `callFn`; delete `waLink`, `LinkChannel`, `CHANNELS`, `issueLinkCode`, `revokeIdentity`, `createWhatsAppMember`)
- Modify: `src/lib/whatsapp/__tests__/client.test.ts` (drop the `waLink` / `CHANNELS` tests)
- Modify: `src/app/(dashboard)/team/page.tsx` (channel column "WhatsApp · <team>" / "Invited"; QR connect and "Add staff without app login" removed)
- Delete: `src/app/(dashboard)/team/whatsapp-connect.tsx`, `src/app/(dashboard)/team/add-whatsapp-member.tsx`
- Test: `src/lib/whatsapp/__tests__/team-api.test.ts`, `src/lib/whatsapp/__tests__/teams.test.ts`

**Interfaces:**
- Consumes: `addPersonToTeam`, `resendInvite`, `InviteOutcome` (Task 5); `normalisePhone` (Task 2); `TeamDeps` (Task 3); fakes.
- Produces:

```ts
// team-api.ts
export interface ApiCaller { profile_id: string; business_id: string }
export interface ApiRes { status: number; body: Record<string, unknown> }
export async function handleTeamMemberRequest(t: TeamDeps, send: SendFn, me: ApiCaller, body: unknown): Promise<ApiRes>
//   { action: 'add', group_id, phone, full_name? , profile_id? } → 200 { outcome: 'invited' | 'already_member', member_id }
//   { action: 'resend', member_id }                               → 200 { outcome: 'invited', member_id }
//   errors: 400 body|action|phone|name|profile · 403 forbidden · 404 team|member · 409 whatsapp_off|not_invited · 429 too_soon · 502 template|send

// src/lib/whatsapp/client.ts
export async function callFn(name: string, body: unknown): Promise<any>        // throws Error(<error code>)

// src/lib/whatsapp/teams.ts
export type MemberStatus = 'invited' | 'active' | 'removed'
export interface TeamMemberRow { id: string; profile_id: string; name: string; phone: string; status: MemberStatus; unreachable: boolean; last_invite_sent_at: string | null }
export interface WhatsAppTeam { id: string; title: string; site_id: string; template_ids: string[]; members: TeamMemberRow[] }
export interface Person { id: string; full_name: string }
export const TEAM_SHARE_HINT: string        // 'Managers can also add people from WhatsApp — share a contact with the Blueroll bot.'
export const RESEND_AFTER_MS: number        // 1 h
export function memberStatusLabel(m: Pick<TeamMemberRow, 'status' | 'unreachable'>): 'Not reachable' | 'Active' | 'Invited'
export function canResend(m: Pick<TeamMemberRow, 'status' | 'last_invite_sent_at'>, now?: number): boolean
export function teamChannelLabel(rows: { title: string; status: MemberStatus }[]): string | null   // 'WhatsApp · Kitchen, Bar' | 'Invited' | null
export function teamApiError(code: string): string
export async function listTeams(businessId: string): Promise<WhatsAppTeam[]>
export async function listPeople(businessId: string): Promise<Person[]>
export async function listMemberTeams(businessId: string): Promise<Map<string, { title: string; status: MemberStatus }[]>>
export async function createTeam(a: { businessId: string; title: string; siteId: string }): Promise<void>
export async function deleteTeam(groupId: string): Promise<void>
export async function removeTeamMember(memberId: string): Promise<void>
export async function addTeamPerson(a: { groupId: string; phone: string; fullName?: string; profileId?: string }): Promise<'invited' | 'already_member'>
export async function resendTeamInvite(memberId: string): Promise<void>
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/whatsapp/__tests__/team-api.test.ts
import { describe, it, expect } from 'vitest'
import { handleTeamMemberRequest } from '../../../../supabase/functions/_shared/channels/team-api'
import { fakeTeamDeps, fakeSend, member, ANNA, BEN, BOSS } from './fakes/team-deps'

const boss = { profile_id: BOSS.profile_id, business_id: 'b' }

describe('handleTeamMemberRequest', () => {
  it('add: a new person by name and phone → 200 invited', async () => {
    const { d, s } = fakeTeamDeps()
    const w = fakeSend()
    const r = await handleTeamMemberRequest(d, w.send, boss, { action: 'add', group_id: 'g1', full_name: '  Maria  Lopez ', phone: '07700 900777' })
    expect(r).toEqual({ status: 200, body: { outcome: 'invited', member_id: 'gm2' } })
    expect(s.created[0]).toMatchObject({ fullName: 'Maria Lopez' })
    expect(w.sent[0].to).toBe('447700900777')
  })
  it('add: an existing Team member picked + phone', async () => {
    const { d, s } = fakeTeamDeps()
    const r = await handleTeamMemberRequest(d, fakeSend().send, boss, { action: 'add', group_id: 'g1', profile_id: BEN.profile_id, phone: '+44 7700 900456' })
    expect(r.status).toBe(200)
    expect(s.members.find((m) => m.id === r.body.member_id)).toMatchObject({ profile_id: BEN.profile_id, phone: BEN.phone })
  })
  it('validation and permissions', async () => {
    const { d } = fakeTeamDeps()
    const send = fakeSend().send
    expect((await handleTeamMemberRequest(d, send, { profile_id: ANNA.profile_id, business_id: 'b' }, { action: 'add', group_id: 'g1', full_name: 'X', phone: '07700900777' })).status).toBe(403)
    expect(await handleTeamMemberRequest(d, send, boss, null)).toEqual({ status: 400, body: { error: 'body' } })
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'nope' })).toEqual({ status: 400, body: { error: 'action' } })
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'add', group_id: 'zz', full_name: 'X', phone: '07700900777' })).toEqual({ status: 404, body: { error: 'team' } })
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'add', group_id: 'g1', full_name: 'X', phone: '12' })).toEqual({ status: 400, body: { error: 'phone' } })
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'add', group_id: 'g1', full_name: ' ', phone: '07700900777' })).toEqual({ status: 400, body: { error: 'name' } })
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'add', group_id: 'g1', profile_id: 'nobody', phone: '07700900777' })).toEqual({ status: 400, body: { error: 'profile' } })
  })
  it('WhatsApp off → 409; template not approved → 502 template; send failure → 502 send', async () => {
    const off = fakeTeamDeps({ ready: { b: false } })
    expect(await handleTeamMemberRequest(off.d, fakeSend().send, boss, { action: 'add', group_id: 'g1', full_name: 'Maria', phone: '07700900777' })).toEqual({ status: 409, body: { error: 'whatsapp_off' } })
    const a = fakeTeamDeps()
    expect(await handleTeamMemberRequest(a.d, fakeSend(() => ({ ok: false, status: 404, id: null, errorCode: 132001 })).send, boss, { action: 'add', group_id: 'g1', full_name: 'Maria', phone: '07700900777' }))
      .toEqual({ status: 502, body: { error: 'template' } })
    const b = fakeTeamDeps()
    expect(await handleTeamMemberRequest(b.d, fakeSend(() => ({ ok: false, status: 500, id: null })).send, boss, { action: 'add', group_id: 'g1', full_name: 'Maria', phone: '07700900777' }))
      .toEqual({ status: 502, body: { error: 'send' } })
  })
  it('resend: once per hour; only invited members of the caller’s business', async () => {
    const { d, s } = fakeTeamDeps({ members: [member({ id: 'gm9', profile_id: 'p9', phone: '447700900777', status: 'invited', last_invite_sent_at: '2026-10-14T09:00:00Z' }), member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone })] })
    const send = fakeSend().send
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'resend', member_id: 'gm9' })).toEqual({ status: 429, body: { error: 'too_soon' } })
    s.now = new Date('2026-10-14T10:00:00Z')
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'resend', member_id: 'gm9' })).toEqual({ status: 200, body: { outcome: 'invited', member_id: 'gm9' } })
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'resend', member_id: 'gm1' })).toEqual({ status: 409, body: { error: 'not_invited' } })
    expect(await handleTeamMemberRequest(d, send, { profile_id: 'm1', business_id: 'other' }, { action: 'resend', member_id: 'gm9' })).toMatchObject({ status: 403 })
  })
})
```

```ts
// src/lib/whatsapp/__tests__/teams.test.ts
import { describe, it, expect } from 'vitest'
import { memberStatusLabel, canResend, teamChannelLabel, teamApiError, TEAM_SHARE_HINT } from '../teams'

describe('WhatsApp teams web helpers', () => {
  it('status labels: Not reachable wins, then Active / Invited', () => {
    expect(memberStatusLabel({ status: 'active', unreachable: false })).toBe('Active')
    expect(memberStatusLabel({ status: 'invited', unreachable: false })).toBe('Invited')
    expect(memberStatusLabel({ status: 'invited', unreachable: true })).toBe('Not reachable')
  })
  it('resend: invited members, at most once per hour', () => {
    const now = Date.parse('2026-10-14T10:00:00Z')
    expect(canResend({ status: 'invited', last_invite_sent_at: '2026-10-14T09:00:00Z' }, now)).toBe(true)
    expect(canResend({ status: 'invited', last_invite_sent_at: '2026-10-14T09:30:00Z' }, now)).toBe(false)
    expect(canResend({ status: 'invited', last_invite_sent_at: null }, now)).toBe(true)
    expect(canResend({ status: 'active', last_invite_sent_at: null }, now)).toBe(false)
  })
  it('Team page channel column: "WhatsApp · <team>", else "Invited", else nothing', () => {
    expect(teamChannelLabel([{ title: 'Kitchen', status: 'active' }, { title: 'Bar', status: 'active' }])).toBe('WhatsApp · Kitchen, Bar')
    expect(teamChannelLabel([{ title: 'Kitchen', status: 'invited' }])).toBe('Invited')
    expect(teamChannelLabel([{ title: 'Kitchen', status: 'invited' }, { title: 'Bar', status: 'active' }])).toBe('WhatsApp · Bar')
    expect(teamChannelLabel([])).toBeNull()
  })
  it('error codes become sentences; unknown messages pass through', () => {
    expect(teamApiError('too_soon')).toBe('An invite went out less than an hour ago — try again later.')
    expect(teamApiError('template')).toBe("WhatsApp hasn't approved the invite message yet — try again later.")
    expect(teamApiError('new row violates row-level security policy')).toBe('new row violates row-level security policy')
    expect(TEAM_SHARE_HINT).toBe('Managers can also add people from WhatsApp — share a contact with the Blueroll bot.')
  })
})
```

In `src/lib/whatsapp/__tests__/client.test.ts` change the import to `import { maskNumber, channelAvailable } from '../client'` and delete the tests `wa.me link pre-fills LINK code`, `whatsapp channel config builds the wa.me link` and `only WhatsApp has a personal connect flow (Telegram works through groups)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/team-api.test.ts src/lib/whatsapp/__tests__/teams.test.ts`
Expected: FAIL — `Failed to resolve import` for `team-api` and `../teams`.

- [ ] **Step 3: Implement `team-api.ts`**

```ts
// supabase/functions/_shared/channels/team-api.ts
// Settings → Messaging → WhatsApp teams, server side (spec 2026-10-12 §4, §8): add a person, resend an invite.
// Pure over TeamDeps + SendFn; whatsapp-team-member/index.ts does the auth and wiring.
import type { SendFn } from './types.ts'
import type { TeamDeps } from './teams-db.ts'
import { normalisePhone } from './whatsapp.ts'
import { addPersonToTeam, resendInvite, type InviteOutcome } from './team-members.ts'

export interface ApiCaller { profile_id: string; business_id: string }
export interface ApiRes { status: number; body: Record<string, unknown> }
const res = (status: number, body: Record<string, unknown>): ApiRes => ({ status, body })
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const NAME_MAX = 80

function outcomeRes(o: InviteOutcome, memberId: string | null): ApiRes {
  if (o === 'invited' || o === 'already_member') return res(200, { outcome: o, member_id: memberId })
  if (o === 'too_soon') return res(429, { error: 'too_soon' })
  if (o === 'template_missing') return res(502, { error: 'template' })
  return res(502, { error: 'send' })
}

export async function handleTeamMemberRequest(t: TeamDeps, send: SendFn, me: ApiCaller, body: unknown): Promise<ApiRes> {
  if (!isObj(body)) return res(400, { error: 'body' })
  if (!(await t.isManager(me.profile_id, me.business_id))) return res(403, { error: 'forbidden' })
  if (body.action === 'add') {
    const team = typeof body.group_id === 'string' ? await t.teamById(body.group_id) : null
    if (!team || team.business_id !== me.business_id) return res(404, { error: 'team' })
    const phone = typeof body.phone === 'string' ? normalisePhone(body.phone) : null
    if (!phone) return res(400, { error: 'phone' })
    let name = typeof body.full_name === 'string' ? body.full_name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : ''
    let profileId: string | null = null
    if (typeof body.profile_id === 'string') {
      const p = await t.person(body.profile_id)
      if (!p || p.business_id !== me.business_id) return res(400, { error: 'profile' })
      profileId = p.profile_id
      name = p.full_name || name
    }
    if (!name) return res(400, { error: 'name' })
    if (!(await t.ready(me.business_id))) return res(409, { error: 'whatsapp_off' })
    const r = await addPersonToTeam(t, send, { team, phone, name, profileId, invitedBy: me.profile_id })
    return outcomeRes(r.outcome, r.member?.id ?? null)
  }
  if (body.action === 'resend') {
    const m = typeof body.member_id === 'string' ? await t.memberById(body.member_id) : null
    const team = m ? await t.teamById(m.group_id) : null
    if (!m || !team || team.business_id !== me.business_id) return res(404, { error: 'member' })
    if (!(await t.ready(me.business_id))) return res(409, { error: 'whatsapp_off' })
    const r = await resendInvite(t, send, m.id)
    if (r.outcome === 'not_invited') return res(409, { error: 'not_invited' })
    return outcomeRes(r.outcome, m.id)
  }
  return res(400, { error: 'action' })
}
```

(The last case of the resend test — a caller from business `other` — is refused by `isManager` → 403 before any lookup.)

- [ ] **Step 4: Implement the edge function**

```ts
// supabase/functions/whatsapp-team-member/index.ts
// Settings → Messaging → WhatsApp teams: add a person to a team (sends the team_invite template) or resend an invite.
// Owners/managers only. Sending a template needs the server-side WhatsApp token, so this can't run in the browser.
// Deployed with --no-verify-jwt like team-create-channel-member; the caller's JWT is checked here. Never logs phone numbers.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeSender } from "../_shared/channels/whatsapp.ts";
import { makeTeamDeps } from "../_shared/channels/teams-db.ts";
import { handleTeamMemberRequest } from "../_shared/channels/team-api.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const send = makeSender({ token: Deno.env.get("WA_TOKEN") ?? "", phoneNumberId: Deno.env.get("WA_PHONE_NUMBER_ID") ?? "" });
const teams = makeTeamDeps(admin);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method" });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json(401, { error: "auth" });
  const { data: me } = await admin.from("profiles").select("business_id").eq("id", u.user.id).is("removed_at", null).maybeSingle();
  if (!me?.business_id) return json(403, { error: "forbidden" });
  const body = await req.json().catch(() => null);
  try {
    const r = await handleTeamMemberRequest(teams, send, { profile_id: u.user.id, business_id: me.business_id }, body);
    return json(r.status, r.body);
  } catch (err) {
    console.error("whatsapp-team-member failed", String((err as Error)?.message ?? err).slice(0, 200));
    return json(500, { error: "server" });
  }
});
```

- [ ] **Step 5: Implement the web client**

In `src/lib/whatsapp/client.ts`: delete `waLink`, `LinkChannel`, `CHANNELS`, `issueLinkCode`, `revokeIdentity` and `createWhatsAppMember`, and export `callFn` (change `async function callFn` to `export async function callFn`). Keep `Channel`, `WA_NUMBER`, `channelAvailable`, `maskNumber`, `listIdentities`, `syncTemplateFlows`, `syncAllFlows`.

```ts
// src/lib/whatsapp/teams.ts
// Web client for WhatsApp teams (Settings → Messaging). Teams, checklist mappings and removals go through RLS (managers
// only; a DB trigger allows only "remove" on members). Adding a person and resending an invite go through the
// whatsapp-team-member function, because they send the team_invite template.
import { supabase } from '@/lib/supabase'
import { callFn } from './client'

export type MemberStatus = 'invited' | 'active' | 'removed'
export interface TeamMemberRow { id: string; profile_id: string; name: string; phone: string; status: MemberStatus; unreachable: boolean; last_invite_sent_at: string | null }
export interface WhatsAppTeam { id: string; title: string; site_id: string; template_ids: string[]; members: TeamMemberRow[] }
export interface Person { id: string; full_name: string }

export const TEAM_SHARE_HINT = 'Managers can also add people from WhatsApp — share a contact with the Blueroll bot.'
export const RESEND_AFTER_MS = 3600_000

export const memberStatusLabel = (m: Pick<TeamMemberRow, 'status' | 'unreachable'>): 'Not reachable' | 'Active' | 'Invited' =>
  m.unreachable ? 'Not reachable' : m.status === 'active' ? 'Active' : 'Invited'

export const canResend = (m: Pick<TeamMemberRow, 'status' | 'last_invite_sent_at'>, now: number = Date.now()) =>
  m.status === 'invited' && (!m.last_invite_sent_at || now - Date.parse(m.last_invite_sent_at) >= RESEND_AFTER_MS)

/** Team page channel column: active teams by name, else "Invited", else nothing. */
export function teamChannelLabel(rows: { title: string; status: MemberStatus }[]): string | null {
  const active = rows.filter((r) => r.status === 'active').map((r) => r.title)
  if (active.length) return `WhatsApp · ${active.join(', ')}`
  return rows.some((r) => r.status === 'invited') ? 'Invited' : null
}

const API_ERRORS: Record<string, string> = {
  phone: 'Enter a mobile number with the country code, e.g. +44 7700 900123.',
  name: 'Enter their name.',
  profile: 'Pick someone from your team.',
  too_soon: 'An invite went out less than an hour ago — try again later.',
  template: "WhatsApp hasn't approved the invite message yet — try again later.",
  send: "Couldn't send the invite on WhatsApp — check the number and try again.",
  whatsapp_off: 'Turn on WhatsApp checks first.',
  team: 'This team no longer exists.',
  member: 'This person is no longer in the team.',
  not_invited: 'This person has already joined.',
  forbidden: 'Only owners and managers can do this.',
}
/** Sentence for an error code from whatsapp-team-member; any other message (e.g. from the database) passes through. */
export const teamApiError = (code: string) => API_ERRORS[code] ?? code

type MemberSel = { id: string; profile_id: string; phone: string; status: MemberStatus; unreachable_at: string | null; last_invite_sent_at: string | null; profile: { full_name: string | null } | null }
type TeamSel = { id: string; title: string; site_id: string; channel_group_checklists: { template_id: string }[] | null; channel_group_members: MemberSel[] | null }

export async function listTeams(businessId: string): Promise<WhatsAppTeam[]> {
  const { data, error } = await supabase.from('channel_groups')
    .select('id, title, site_id, channel_group_checklists(template_id), channel_group_members(id, profile_id, phone, status, unreachable_at, last_invite_sent_at, profile:profiles!channel_group_members_profile_id_fkey(full_name))')
    .eq('business_id', businessId).eq('channel', 'whatsapp').is('unlinked_at', null).order('title')
  if (error) throw error
  return ((data ?? []) as unknown as TeamSel[]).map((t) => ({
    id: t.id, title: t.title, site_id: t.site_id,
    template_ids: (t.channel_group_checklists ?? []).map((m) => m.template_id),
    members: (t.channel_group_members ?? []).filter((m) => m.status !== 'removed')
      .map((m) => ({ id: m.id, profile_id: m.profile_id, name: m.profile?.full_name || 'Unnamed', phone: m.phone, status: m.status, unreachable: !!m.unreachable_at, last_invite_sent_at: m.last_invite_sent_at }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }))
}

export async function listPeople(businessId: string): Promise<Person[]> {
  const { data, error } = await supabase.from('profiles').select('id, full_name').eq('business_id', businessId).is('removed_at', null).order('full_name')
  if (error) throw error
  return ((data ?? []) as { id: string; full_name: string | null }[]).map((p) => ({ id: p.id, full_name: p.full_name || 'Unnamed' }))
}

/** profile id → their WhatsApp teams (not removed) for the Team page. */
export async function listMemberTeams(businessId: string): Promise<Map<string, { title: string; status: MemberStatus }[]>> {
  const { data, error } = await supabase.from('channel_group_members')
    .select('profile_id, status, team:channel_groups!inner(title, channel, business_id, unlinked_at)')
    .eq('team.business_id', businessId).eq('team.channel', 'whatsapp').is('team.unlinked_at', null).neq('status', 'removed')
  if (error) throw error
  const out = new Map<string, { title: string; status: MemberStatus }[]>()
  for (const r of (data ?? []) as unknown as { profile_id: string; status: MemberStatus; team: { title: string } }[]) {
    out.set(r.profile_id, [...(out.get(r.profile_id) ?? []), { title: r.team.title, status: r.status }])
  }
  return out
}

export async function createTeam(a: { businessId: string; title: string; siteId: string }): Promise<void> {
  // linked_by / linked_at are stamped by the DB trigger.
  const { error } = await supabase.from('channel_groups').insert({ business_id: a.businessId, channel: 'whatsapp', title: a.title.trim(), site_id: a.siteId })
  if (error) throw error
}

export async function deleteTeam(groupId: string): Promise<void> {
  // The DB trigger stamps the real time; the value sent only needs to be non-null.
  const { error } = await supabase.from('channel_groups').update({ unlinked_at: new Date().toISOString() }).eq('id', groupId)
  if (error) throw error
}

export async function removeTeamMember(memberId: string): Promise<void> {
  const { error } = await supabase.from('channel_group_members').update({ status: 'removed' }).eq('id', memberId)
  if (error) throw error
}

export async function addTeamPerson(a: { groupId: string; phone: string; fullName?: string; profileId?: string }): Promise<'invited' | 'already_member'> {
  const r = await callFn('whatsapp-team-member', { action: 'add', group_id: a.groupId, phone: a.phone, full_name: a.fullName, profile_id: a.profileId })
  return r.outcome
}

export async function resendTeamInvite(memberId: string): Promise<void> {
  await callFn('whatsapp-team-member', { action: 'resend', member_id: memberId })
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/whatsapp/__tests__/team-api.test.ts src/lib/whatsapp/__tests__/teams.test.ts src/lib/whatsapp/__tests__/client.test.ts`
Expected: PASS.

- [ ] **Step 7: Team page — the per-person QR / link code goes; the WhatsApp column shows teams** (`src/app/(dashboard)/team/page.tsx`)

Delete `src/app/(dashboard)/team/whatsapp-connect.tsx` and `src/app/(dashboard)/team/add-whatsapp-member.tsx` (`git rm`). Then edit the page:

1. Imports — replace

```tsx
import { channelAvailable, listIdentities, type LinkChannel } from '@/lib/whatsapp/client'
import { ChannelStatus, ChannelConnectDialog } from './whatsapp-connect'
import { AddWhatsAppMemberDialog } from './add-whatsapp-member'
```
with
```tsx
import { channelAvailable, listIdentities } from '@/lib/whatsapp/client'
import { listMemberTeams, teamChannelLabel } from '@/lib/whatsapp/teams'
```
2. Delete the two state lines `const [connecting, setConnecting] = …` and `const [addingWa, setAddingWa] = useState(false)`.
3. Replace the WhatsApp identities query block (comment + `waOn` + `useQuery` for `['wa-identities', …]`) with:

```tsx
  // WhatsApp column once the WhatsApp number is configured. People join WhatsApp through teams (Settings → Messaging).
  const waOn = isManager && !!business?.whatsapp_enabled && channelAvailable('whatsapp')
  const { data: waTeams } = useQuery({
    queryKey: ['wa-member-teams', business?.id],
    enabled: !!business?.id && waOn,
    queryFn: () => listMemberTeams(business!.id),
  })
```
4. Delete the header button line `{waOn && <Button variant="outline" onClick={() => setAddingWa(true)}>Add staff without app login</Button>}`; if `grep -c "<Button" "src/app/(dashboard)/team/page.tsx"` is now `0`, also delete the `import { Button } from '@/components/ui/button'` line.
5. Replace the WhatsApp cell (`<ChannelStatus channel="whatsapp" … />` inside `{waOn && (<td …>…</td>)}`) with:

```tsx
                      {waOn && (
                        <td className="px-3 py-3">
                          {(() => {
                            const label = teamChannelLabel(waTeams?.get(m.id) ?? [])
                            return label
                              ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-700">{label}</span>
                              : <span className="text-[12px] text-[#b0b5bc]">—</span>
                          })()}
                        </td>
                      )}
```
6. Delete the two dialogs at the end of the page (`{connecting && business && (<ChannelConnectDialog … />)}` and `{addingWa && (<AddWhatsAppMemberDialog … />)}`).

Check: `grep -rnE "whatsapp-connect|add-whatsapp-member|issueLinkCode|CHANNELS|createWhatsAppMember|revokeIdentity" src` → no matches.

- [ ] **Step 8: Full checks** — `npm test` → all pass. `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `3`. `cd supabase/functions && deno check whatsapp-team-member/index.ts whatsapp-webhook/index.ts whatsapp-reminders/index.ts channel-form/index.ts telegram-webhook/index.ts whatsapp-sync-flows/index.ts team-create-channel-member/index.ts` → ok. `npx eslint "src/app/(dashboard)/team/page.tsx" src/lib/whatsapp/teams.ts src/lib/whatsapp/client.ts` → no errors.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/_shared/channels/team-api.ts supabase/functions/whatsapp-team-member/index.ts src/lib/whatsapp/teams.ts src/lib/whatsapp/client.ts src/lib/whatsapp/__tests__/team-api.test.ts src/lib/whatsapp/__tests__/teams.test.ts src/lib/whatsapp/__tests__/client.test.ts "src/app/(dashboard)/team"
git commit -m "feat(whatsapp): Settings API for team members + web client; per-person QR connect removed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Web — Settings → Messaging → WhatsApp teams

**Files:**
- Create: `src/app/(dashboard)/settings/whatsapp-teams.tsx`
- Modify: `src/app/(dashboard)/settings/whatsapp-settings.tsx`

**Interfaces:**
- Consumes: everything from `src/lib/whatsapp/teams.ts` (Task 9); `listChecklistOptions`, `mappingDiff`, `saveGroupChecklists`, `ChecklistOption` from `src/lib/telegram/groups.ts` (channel-neutral: they work on any `channel_groups` row); `maskNumber`, `channelAvailable` from `src/lib/whatsapp/client.ts`; `useAuthStore` (`business`, `sites`).
- Produces: `export function WhatsAppTeams(): JSX.Element | null` mounted by `MessagingSettings` below the WhatsApp toggle while WhatsApp is on.

UI (spec §8): "New team" (name + site); one card per team: checklists of that site (tick to map, Save/Cancel), people (name, masked phone, Invited / Active / Not reachable), "Add person" (name + phone, or pick from Team + phone), "Resend invite" (invited, ≥ 1 h since the last), "Remove", "Delete team"; the hint `Managers can also add people from WhatsApp — share a contact with the Blueroll bot.`

- [ ] **Step 1: Read the guide** — skim `node_modules/next/dist/docs/01-app/` for client components (this page is a `'use client'` component with React state and TanStack Query only; no new Next APIs).

- [ ] **Step 2: Write the component**

```tsx
// src/app/(dashboard)/settings/whatsapp-teams.tsx
'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/auth-store'
import { listChecklistOptions, mappingDiff, saveGroupChecklists, type ChecklistOption } from '@/lib/telegram/groups'
import { maskNumber } from '@/lib/whatsapp/client'
import {
  TEAM_SHARE_HINT, addTeamPerson, canResend, createTeam, deleteTeam, listPeople, listTeams, memberStatusLabel,
  removeTeamMember, resendTeamInvite, teamApiError, type Person, type TeamMemberRow, type WhatsAppTeam,
} from '@/lib/whatsapp/teams'

const errText = (e: unknown) => teamApiError(e instanceof Error ? e.message : String(e))
const STATUS_STYLE: Record<string, string> = {
  Active: 'bg-emerald-50 text-emerald-700',
  Invited: 'bg-amber-50 text-amber-700',
  'Not reachable': 'bg-red-50 text-red-700',
}

/** Settings → Messaging → WhatsApp teams (spec 2026-10-12 §8): one team per site, its checklists and its people. */
export function WhatsAppTeams() {
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const teamsKey = ['whatsapp-teams', business?.id]
  const { data: teams = [], isLoading } = useQuery({ queryKey: teamsKey, enabled: !!business?.id, queryFn: () => listTeams(business!.id) })
  const { data: options = [] } = useQuery({
    queryKey: ['telegram-checklist-options', business?.id], enabled: !!business?.id, queryFn: () => listChecklistOptions(business!.id),
  })
  const { data: people = [] } = useQuery({ queryKey: ['whatsapp-team-people', business?.id], enabled: !!business?.id, queryFn: () => listPeople(business!.id) })
  const siteNames = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites])
  if (!business) return null
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: teamsKey })
    void queryClient.invalidateQueries({ queryKey: ['whatsapp-team-people', business.id] })
    void queryClient.invalidateQueries({ queryKey: ['wa-member-teams', business.id] })
    void queryClient.invalidateQueries({ queryKey: ['team', business.id] })
  }

  return (
    <section className="rounded-xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">WhatsApp teams</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Anyone in a team can fill in its checks; the first to submit closes a check for everyone. Each person gets one list of checks in the morning.</p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={creating}>New team</Button>
      </div>
      {creating && <NewTeamForm businessId={business.id} sites={sites} onClose={(created) => { setCreating(false); if (created) refresh() }} />}
      {isLoading ? (
        <p className="mt-4 text-[13px] text-muted-foreground">Loading…</p>
      ) : teams.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted-foreground">No teams yet.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {teams.map((t) => (
            // Remount when the saved mapping changes so the checkbox state starts from it.
            <TeamCard key={`${t.id}:${t.template_ids.join(',')}`} team={t} siteName={siteNames.get(t.site_id) ?? 'Site'}
              options={options.filter((o) => o.site_id === null || o.site_id === t.site_id)} people={people} onChanged={refresh} />
          ))}
        </div>
      )}
      <p className="mt-4 text-[12.5px] text-muted-foreground">{TEAM_SHARE_HINT}</p>
    </section>
  )
}

function NewTeamForm({ businessId, sites, onClose }: { businessId: string; sites: { id: string; name: string }[]; onClose: (created: boolean) => void }) {
  const [title, setTitle] = useState('')
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try { await createTeam({ businessId, title, siteId }); toast.success('Team created'); onClose(true) }
    catch (e) { toast.error(errText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border p-4">
      <Input aria-label="Team name" placeholder="Team name, e.g. Kitchen" value={title} onChange={(e) => setTitle(e.target.value)} className="max-w-[260px]" />
      {sites.length > 1 && (
        <select aria-label="Site" className="h-10 rounded-md border px-2 text-[14px]" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
      <Button disabled={!title.trim() || !siteId || busy} onClick={create}>{busy ? 'Creating…' : 'Create'}</Button>
    </div>
  )
}

function TeamCard({ team, siteName, options, people, onChanged }: {
  team: WhatsAppTeam; siteName: string; options: ChecklistOption[]; people: Person[]; onChanged: () => void
}) {
  const [selected, setSelected] = useState<string[]>(team.template_ids)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const diff = mappingDiff(team.template_ids, selected)
  const dirty = diff.add.length + diff.remove.length > 0
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const save = async () => {
    setBusy(true)
    try { await saveGroupChecklists(team.id, team.template_ids, selected); toast.success('Checks saved'); onChanged() }
    catch (e) { toast.error(errText(e)) } finally { setBusy(false) }
  }
  const remove = async (m: TeamMemberRow) => {
    if (!window.confirm(`Remove ${m.name} from ${team.title}? They stop getting this team's checks at once.`)) return
    try { await removeTeamMember(m.id); toast.success(`${m.name} removed`); onChanged() } catch (e) { toast.error(errText(e)) }
  }
  const resend = async (m: TeamMemberRow) => {
    try { await resendTeamInvite(m.id); toast.success(`Invite sent to ${m.name}`); onChanged() } catch (e) { toast.error(errText(e)) }
  }
  const del = async () => {
    if (!window.confirm(`Delete “${team.title}”? Its people stop getting WhatsApp checks for it.`)) return
    try { await deleteTeam(team.id); toast.success('Team deleted'); onChanged() } catch (e) { toast.error(errText(e)) }
  }
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{team.title} <span className="font-normal text-muted-foreground">· {siteName}</span></p>
        <Button variant="outline" size="sm" onClick={del}>Delete team</Button>
      </div>
      <fieldset className="mt-3">
        <legend className="text-[12.5px] font-semibold text-muted-foreground">Checks this team does</legend>
        {options.length === 0 ? (
          <p className="mt-1 text-[13px] text-muted-foreground">No active checklists at this site yet.</p>
        ) : (
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {options.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" className="size-4 accent-[#1f9d63]" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
                <span>{o.name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setSelected(team.template_ids)}>Cancel</Button>
          <Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      )}
      <div className="mt-4">
        <p className="text-[12.5px] font-semibold text-muted-foreground">People</p>
        {team.members.length === 0 ? (
          <p className="mt-1 text-[13px] text-muted-foreground">No people yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {team.members.map((m) => {
              const status = memberStatusLabel(m)
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-muted-foreground">{maskNumber(m.phone)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${STATUS_STYLE[status]}`}>{status}</span>
                  <span className="ml-auto flex gap-2">
                    {canResend(m) && <button className="text-[12px] font-medium text-primary underline" onClick={() => resend(m)}>Resend invite</button>}
                    <button className="text-[12px] text-muted-foreground underline" onClick={() => remove(m)}>Remove</button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {adding
          ? <AddPersonForm team={team} people={people} onClose={(added) => { setAdding(false); if (added) onChanged() }} />
          : <Button className="mt-3" variant="outline" size="sm" onClick={() => setAdding(true)}>Add person</Button>}
      </div>
    </div>
  )
}

function AddPersonForm({ team, people, onClose }: { team: WhatsAppTeam; people: Person[]; onClose: (added: boolean) => void }) {
  const [mode, setMode] = useState<'new' | 'team'>('new')
  const [name, setName] = useState('')
  const [profileId, setProfileId] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const inTeam = new Set(team.members.map((m) => m.profile_id))
  const pickable = people.filter((p) => !inTeam.has(p.id))
  const who = mode === 'new' ? name.trim() : pickable.find((p) => p.id === profileId)?.full_name ?? ''
  const ok = !!phone.trim() && !!who
  const submit = async () => {
    setBusy(true)
    try {
      const outcome = await addTeamPerson({ groupId: team.id, phone, ...(mode === 'new' ? { fullName: name } : { profileId }) })
      toast.success(outcome === 'invited' ? `Invite sent to ${who}` : `${who} is already in ${team.title}`)
      onClose(true)
    } catch (e) { toast.error(errText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex gap-3 text-[13px]">
        <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> New person</label>
        <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'team'} onChange={() => setMode('team')} disabled={!pickable.length} /> From your team</label>
      </div>
      {mode === 'new'
        ? <Input aria-label="Name" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
        : (
          <select aria-label="Team member" className="h-10 rounded-md border px-2 text-[14px]" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            <option value="">Choose a person…</option>
            {pickable.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        )}
      <Input aria-label="WhatsApp number" placeholder="WhatsApp number, e.g. +44 7700 900123" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <p className="text-[12px] text-muted-foreground">They get a WhatsApp invite and join with one tap. Nothing else is sent until they tap Join.</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
        <Button disabled={!ok || busy} onClick={submit}>{busy ? 'Sending…' : 'Send invite'}</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Mount it** — `src/app/(dashboard)/settings/whatsapp-settings.tsx`

Add `import { WhatsAppTeams } from './whatsapp-teams'`. In `MessagingSettings` add `const whatsappOn = useAuthStore((s) => !!s.business?.whatsapp_enabled)`, change the WhatsApp toggle's description to `"Staff in a WhatsApp team get one list of checks each morning and fill them in in WhatsApp. Set up teams below."`, and right after the WhatsApp `ChannelToggle` element add:

```tsx
      {channelAvailable('whatsapp') && whatsappOn && <WhatsAppTeams />}
```

- [ ] **Step 4: Checks**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `3`; `npm test` → all pass; `npx eslint "src/app/(dashboard)/settings/whatsapp-teams.tsx" "src/app/(dashboard)/settings/whatsapp-settings.tsx"` → no errors.
Optional visual check (needs a logged-in owner; skip if not possible): `npx next dev --webpack`, open `/settings` → Messaging with WhatsApp on: "WhatsApp teams" card under the WhatsApp toggle; no layout overflow at phone width.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/settings/whatsapp-teams.tsx" "src/app/(dashboard)/settings/whatsapp-settings.tsx"
git commit -m "feat(web): Settings → Messaging → WhatsApp teams

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Meta templates `team_invite` and `team_day_summary` (CONTROLLER ONLY — needs Kostya's explicit "yes")

**Files:** none in the repo. Implementer subagents do **not** run this task.

Template content (category UTILITY, language `en_GB`, production WABA 1452892610306685; the approved templates `checklist_reminder_list`, `checklist_reminder`, `manager_alert`, `corrective_nudge` are reused unchanged):

```json
{ "name": "team_invite", "language": "en_GB", "category": "UTILITY",
  "components": [
    { "type": "BODY",
      "text": "{{1}} added you to the {{2}} team at {{3}} in Blueroll. Tap Join to get your food safety checks here in WhatsApp.",
      "example": { "body_text": [["Fern & Fig", "Kitchen", "Ashfield Row"]] } },
    { "type": "BUTTONS", "buttons": [{ "type": "QUICK_REPLY", "text": "Join" }] } ] }
```

```json
{ "name": "team_day_summary", "language": "en_GB", "category": "UTILITY",
  "components": [
    { "type": "BODY",
      "text": "{{1}} at {{2}} today: {{3}} of {{4}} done. Missed: {{5}}.",
      "example": { "body_text": [["Kitchen", "Ashfield Row", "2", "3", "Fridge temps"]] } } ] }
```

Parameter order is fixed by the code: `team_invite` = [business, team, site] + quick reply payload `join:<member id>` (`inviteMessage`, Task 5); `team_day_summary` = `summaryParams` (Task 4).

- [ ] **Step 1: STOP — ask Kostya:** «Отправляю на модерацию Meta два шаблона (team_invite, team_day_summary — тексты выше)?» Continue only after «да».
- [ ] **Step 2: Submit** to the **production** WABA (`WA_PROD_WABA_ID` = 1452892610306685; system-user token `WA_ACCESS_TOKEN`; both in `~/Secrets/blueroll/whatsapp.env`; never echo the token):

```bash
set -a; . ~/Secrets/blueroll/whatsapp.env; set +a
for f in team_invite team_day_summary; do
  curl -sS -X POST "https://graph.facebook.com/v26.0/${WA_PROD_WABA_ID}/message_templates" \
    -H "Authorization: Bearer ${WA_ACCESS_TOKEN}" -H "Content-Type: application/json" --data @"$TMPDIR/$f.json"; echo
done
```
(write the two JSON bodies above to `$TMPDIR/team_invite.json` and `$TMPDIR/team_day_summary.json` first). Expected: `{"id":"…","status":"PENDING","category":"UTILITY"}` for each.
- [ ] **Step 3: Poll** until both are `APPROVED`:

```bash
curl -sS "https://graph.facebook.com/v26.0/${WA_PROD_WABA_ID}/message_templates?fields=name,status,rejected_reason&name=team_invite" -H "Authorization: Bearer ${WA_ACCESS_TOKEN}"
curl -sS "https://graph.facebook.com/v26.0/${WA_PROD_WABA_ID}/message_templates?fields=name,status,rejected_reason&name=team_day_summary" -H "Authorization: Bearer ${WA_ACCESS_TOKEN}"
```
If Meta rejects `team_day_summary` (e.g. too many variables for its length), propose to Kostya the wording `Checks today for {{1}} at {{2}}: {{3}} of {{4}} done. Missed: {{5}}.` — same parameters, so no code change — and resubmit only after his «да». Until a template is approved the code degrades safely (Review Focus 5): invites answer "WhatsApp hasn't approved the invite message yet", summaries retry every 10 minutes.

---

### Task 12: Launch (CONTROLLER ONLY — every step needs Kostya's explicit "yes")

**Files:** none (operations). Record every result in the report. Project ref `rszrggreuarvodcqeqrj`; Management API token `~/Secrets/blueroll/supabase-access-token.txt`.

- [ ] **Step 1: Read-only pre-checks** (Management API `POST /v1/projects/rszrggreuarvodcqeqrj/database/query`, SELECTs only):
  - `select i.business_id, b.name, count(*) from channel_identities i join businesses b on b.id = i.business_id where i.channel = 'whatsapp' and i.revoked_at is null group by 1, 2;` — after deploy these people get nothing until they are in a team. Expect Fern & Fig only; **STOP otherwise** and show Kostya the list (they would silently lose their role-based reminders).
  - `select count(*) from channel_groups where channel = 'whatsapp';` → `0`.
  - Both templates `APPROVED` (Task 11 Step 3). If not, **STOP** — deploying first would make every invite fail.
- [ ] **Step 2: STOP — migration.** Ask: «Накатываю миграцию WhatsApp-команд (20261012140000_whatsapp_teams.sql) на прод?» After «да»: apply the file, then run `supabase/tests/whatsapp_teams_verify.sql` and paste `VERIFY_RESULT` (must match Task 1's expected values).
- [ ] **Step 3: Read-only smoke of the new queries** (after the migration, before deploy) — `deno eval` with the service role (URL `https://rszrggreuarvodcqeqrj.supabase.co`; service-role key fetched into an env var from `GET https://api.supabase.com/v1/projects/rszrggreuarvodcqeqrj/api-keys` with the Management token — never printed), calling only read methods of `makeTeamDeps(admin)`: `liveTeams()`, `teamsForBusiness('2693f7de-c0ba-4d52-bbe9-602106eac784')`, `memberById('00000000-0000-0000-0000-000000000000')` (the `profiles!channel_group_members_profile_id_fkey` embed), `activeMemberships('981197ca-3648-4c6c-9f18-ff7b6ae68786')` (the `channel_groups!inner` embed with filters), `recipients({ id: '00000000-0000-0000-0000-000000000000', business_id: '2693f7de-c0ba-4d52-bbe9-602106eac784', title: 'x', site_id: '00000000-0000-0000-0000-000000000000' })`, `identityByPhone('440000000000')`. Each must return without a PostgREST error (empty/null is fine). Also run the web `listTeams` select string once through supabase-js. **STOP** on any error.
- [ ] **Step 4: STOP — deploy functions.** Ask: «Деплою whatsapp-webhook, whatsapp-reminders, whatsapp-team-member (новая), channel-form, telegram-webhook, whatsapp-sync-flows?» (`channel-form`, `telegram-webhook`, `whatsapp-sync-flows` only because their import graph changed: `db.ts`, `alerts.ts`, `whatsapp.ts`.) Keep each existing function's `verify_jwt` setting — read it first with `GET https://api.supabase.com/v1/projects/rszrggreuarvodcqeqrj/functions` — and deploy the new `whatsapp-team-member` with `--no-verify-jwt` (it checks the caller's JWT itself, like `team-create-channel-member`):

```bash
export SUPABASE_ACCESS_TOKEN=$(cat ~/Secrets/blueroll/supabase-access-token.txt)
supabase functions deploy whatsapp-team-member --project-ref rszrggreuarvodcqeqrj --no-verify-jwt
# then each of: whatsapp-webhook whatsapp-reminders channel-form telegram-webhook whatsapp-sync-flows
# with --no-verify-jwt exactly when its current verify_jwt is false
```
No new secrets: `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_CRON_SECRET`, `WA_CORRECTIVE_FLOW_ID` already exist. The next cron run must answer `{ ok: true, teams: { … }, … }` (check the function logs).
- [ ] **Step 5: STOP — web.** Open a PR from `KNS/whatsapp-teams` (do not merge). Merge only on Kostya's «да»; Vercel auto-deploys `main` — confirm the merge commit's deploy status with `gh api repos/KNSTNTN24/blueroll-web/commits/<sha>/status`.
- [ ] **Step 6: Pilot on Fern & Fig** (spec §11; with Kostya and Maria; record each result):
  1. Settings → Messaging: WhatsApp on → New team "Kitchen — Ashfield Row" (site Ashfield Row), tick 3 checklists.
  2. Kostya shares Maria's contact with the bot → one team → "Invite sent to Maria ✓"; Maria gets `team_invite`, taps Join → "You're in Kitchen — Ashfield Row at Ashfield Row ✓"; Kostya gets "Maria joined … ✓" (WhatsApp or bell).
  3. Morning list arrives 1 h before the earliest deadline (one per person); "Show checks" → menu `📋 Kitchen — Ashfield Row · Ashfield Row — 0 of 3 done`.
  4. Kostya (also added) and Maria open the same check; Maria submits first → recorded; Kostya's submit → "Already done ✓ by Maria HH:MM" + menu; nothing recorded twice.
  5. Leave one check open past its deadline → one overdue nudge each.
  6. Out-of-range temperature → corrective form → manager alert.
  7. Either 🎉 (all done, open windows only) or the missed summary 1 h after the latest deadline (members + Kostya, plus a bell notification).
  8. Remove Maria (Settings or `team` → Remove → Remove) → her open form answers "You're no longer in Kitchen — Ashfield Row."; she gets nothing more.

---

## Self-Review Notes

- **Spec coverage:** §1 (no groups) → nothing to build, Telegram untouched (Global Constraints); §2 goal/success criteria → Tasks 5–8 + pilot (Task 12); §3 decisions: teams only → Tasks 6/7 (role-based reminders and `fill:`/assignment paths removed), one site per team → Task 1 checks + Task 3 `teamTemplates`, adding people → Tasks 5/8/9/10, Join = consent → Task 5, morning/overdue/end-of-day → Tasks 4/6/7, others' completions silent + "Already done" → Task 7, alerts unchanged → Task 7 (corrective path kept), who manages → Tasks 8/9; §4 add/join/remove/resend/unreachable → Tasks 5, 7 (webhook statuses), 8, 9, 10; §5 member's day incl. menu format and submit steps 1–4 → Tasks 2, 4, 6, 7; §6 manager in WhatsApp → Task 8; §7 data → Task 1 (+ Task 3 contract); §8 web → Tasks 9 (Team page) and 10 (Settings); §9 removing the role-based flow → Tasks 6, 7, 9; §10 templates → Task 11; §11 testing → tests in Tasks 2–9 + pilot in Task 12; §12 out of scope → not built.
- **Names used across tasks:** `TeamDeps`, `Team`, `TeamMember`, `TeamRecipient`, `ManagerContact`, `TakeKey`, `ChannelLog`, `makeTeamDeps`, `MEMBER_PROFILE_FK`; `teamDayState`, `teamDayTimes`, `planTeamDay`, `todayOnly`, `countsToday`, `takePeriodKey`, `doneInPeriod`, `summaryParams`; `sendTracked`, `inviteMessage`, `addPersonToTeam`, `resendInvite`, `handleJoin`, `applyDeliveryStatuses`, `InviteOutcome`, `UNREACHABLE_CODES`, `TEMPLATE_MISSING_CODES`, `INVITE_TTL_MS`; `runWhatsAppTeams`, `celebrateTeam`, `morningMessage`, `teamLabel`; `handleContactShare`, `sendTeamOverview`, `handleAdminButton`, `memberStatusText`; `handleTeamMemberRequest`; web `listTeams`, `listPeople`, `listMemberTeams`, `createTeam`, `deleteTeam`, `removeTeamMember`, `addTeamPerson`, `resendTeamInvite`, `teamChannelLabel`, `memberStatusLabel`, `canResend`, `teamApiError`, `TEAM_SHARE_HINT`; fakes `fakeTeamDeps`, `fakeSend`, `fakeTeamBot`, `textOf`.
- **Placeholders:** none — every code step carries the code; the two operational tasks carry exact commands and STOP points.
- **Review Focus:** DST → Task 4; two teams at one site → Task 7; manager also a member → Task 6; number linked in another business → Task 5; template not approved → Tasks 5 and 6.
