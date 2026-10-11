# Telegram Groups + Live List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telegram works only through groups: a manager links a group with `/link <code>`, picks its checklists in Settings → Messaging, and the bot keeps one silent, self-updating live list per (group, site) whose URL buttons open the Mini App; anyone currently in the group can fill in, first submit wins, every record names the person.

**Architecture:** New pure modules over injected deps (unit-tested with in-memory fakes): a group-aware Telegram adapter, a live-list renderer, a live-list service (repost / refresh with Telegram error mapping), a group bot (link / checks / help / unlink / migrate / permission check), a group cron run, and a group-only form API. One Supabase-backed `GroupDeps` implementation. The personal Telegram flow is removed; WhatsApp is untouched apart from the shared `members.ts` extraction and the reminders function losing its Telegram branch.

**Tech Stack:** Telegram Bot API (`sendMessage`/`editMessageText`/`deleteMessage` with HTML parse mode and URL buttons, `getChatMember`, `getChat`, `my_chat_member` updates, Mini App direct links `t.me/<bot>/<app>?startapp=`), Supabase Edge Functions (Deno), Postgres + RLS, Next.js 16 App Router, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-telegram-groups-design.md` (binding). Builds on the code from `docs/superpowers/plans/2026-10-10-telegram-checklists.md`.

## Global Constraints

- Spec rules quoted here are binding verbatim. Copy strings exactly:
  - private chat reply: `Blueroll checks happen in your team's Telegram group. Ask your manager to add you.`
  - link reply: `Linked to <business>. A manager will choose which checks this group does.`
  - `/checks` with nothing open: `Nothing is due right now 👍`
  - permission warning: `Anyone in this group can add people. To keep checks safe, an admin should turn off 'Add members' for members in group settings.`
  - form: `You're no longer in this group.` (403), `This check was moved — open the list again.` (410), `Already submitted ✓ by <first name>`, consent `Your name will be recorded with checks in <business>'s food safety records.`
- Live list: header `📋 <b>site</b> — <done> of <total> done`; HTML parse mode, all dynamic text escaped; 🔴 deadline passed · 🟠 deadline within 30 min · ⚪ later or no deadline; time as clock `due 10:00`, never a countdown; app-only `· app only`, no button; done `✅ <name> · <HH:MM> <first name>`; button `<icon> <name>` clipped to 64 characters.
- Link codes: 6 digits, 15 min, one use; at most 5 failed attempts per chat per hour. Group tokens: 24 h TTL, not bound to a person. Reminders: 30 min before a mapped checklist's deadline, once per (group, template, site, period).
- Shared modules under `supabase/functions/_shared/**` import siblings with explicit `.ts` and must not touch `Deno` at import time (read env via `globalThis.Deno?.env` at call time, as `flowsDraftMode` in `whatsapp.ts`); Vitest imports them directly.
- Tests: `npm test` must be green after every task. Baseline 376; the only tests allowed to be deleted are the personal-Telegram ones named in Tasks 6 and 7 (`parseUpdate`, `answerCallback`, `bot on Telegram`, `tg-reminder`, personal form-api cases replaced in Task 8). WhatsApp tests must pass **unmodified**.
- Typecheck: `npx tsc --noEmit 2>&1 | grep -c "error TS"` must stay **4** (pre-existing: `.next/dev` types, `reports/page.tsx` ×2, `dropdown-menu.tsx`). Test files are type-checked too (root tsconfig includes `src/**`).
- Deno: `cd supabase/functions && deno check <fn>/index.ts` must pass for every function whose import graph a task touches (always run it for `telegram-webhook`, `channel-form`, `whatsapp-reminders`, `whatsapp-webhook`, `team-create-channel-member`).
- Bot username constant `BluerollChecksBot`; Mini App short name constant `TG_MINI_APP_SHORT_NAME = 'form'` (Kostya registers it in BotFather; changing the name = change only this constant).
- Never log the bot token, Telegram user ids or phone numbers. Group chat ids may be logged.
- English UI/bot copy. Code comments in English.
- Prod changes (migration, deploy, `setupBot`, BotFather) only after Kostya's explicit "yes" — STOP points in Task 1 and Task 11. Do not push; do not switch branches (`KNS/telegram-live-list`).
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before writing web code read the relevant guide under `node_modules/next/dist/docs/` (AGENTS.md). Relevant here: `01-app/03-api-reference/02-components/script.md`.

## Review Focus

1. **Removed from the group between opening and submitting the form** — submit must be refused (403 `not_member`), nothing recorded. Test in Task 8.
2. **Multi-per-day checklist (e.g. 3 a day) after the first submit** — it is still open, but its button must carry a fresh token, not the used one (otherwise the next person sees "Already submitted"). Test in Task 5.
3. **Group admin posting anonymously ("Remain anonymous") sends `/link`** — Telegram sends it from `GroupAnonymousBot` (`is_bot: true`, `sender_chat.id === chat.id`); it must still link. Test in Task 2.
4. **Auto-created group members get Telegram identities** — they must never receive personal manager alerts (alerts' recipient query must be WhatsApp-only) nor personal reminders (cron loads WhatsApp identities only). Test in Task 8 (alerts query) and Task 7 (cron reads only `channel = 'whatsapp'` — checked by reading the code in review).
5. **Old personal Telegram reminder button pressed after deploy** (a `kind = 'checklist'` token) — the form must answer 410 `expired`, not 500. Test in Task 8.

---

## File Structure

```
supabase/migrations/20261011130000_channel_groups.sql      tables, RLS, RPC, token/identity changes, revoke personal TG
supabase/tests/channel_groups_verify.sql                   rolled-back verify DO block
supabase/functions/_shared/channels/telegram.ts             (modify) parseGroupUpdate, TgApi, builders, outcome/member helpers, setupBot
supabase/functions/_shared/channels/live-list.ts            pure renderer, icons, refresh decision, localDate, sitesForGroup
supabase/functions/_shared/checklists-core/due.ts           (modify) dueAtSite (no assignment filter)
supabase/functions/_shared/channels/members.ts              channel-only member creation (shared by WhatsApp + Telegram), display name
supabase/functions/_shared/channels/groups-db.ts         GroupDeps types + Supabase implementation, notifyManagers
supabase/functions/_shared/channels/tg-live.ts              live-list service: buildList, repostList, refreshList, unlinkGroup …
supabase/functions/_shared/channels/tg-group-bot.ts         group bot: handleGroupEvent, checkGroupPermissions, GROUP_TEXT
supabase/functions/_shared/checklists-core/reminders.ts     (modify) planGroupReminders
supabase/functions/_shared/channels/tg-cron.ts              runTelegramGroups (cron step for groups)
supabase/functions/_shared/channels/alerts.ts               (modify) alertGroups, WhatsApp-only manager recipients
supabase/functions/_shared/channels/form-api.ts             (rewrite) group-only Mini App form API
supabase/functions/_shared/channels/bot.ts, ui.ts           (modify) drop personal Telegram branches
supabase/functions/_shared/channels/tg-reminder.ts          (delete)
supabase/functions/telegram-webhook/index.ts                (rewrite) groups only
supabase/functions/channel-form/index.ts                    (rewrite deps) group form
supabase/functions/whatsapp-reminders/index.ts              (rewrite) WhatsApp personal + Telegram groups run
supabase/functions/team-create-channel-member/index.ts      (modify) use members.ts
src/lib/whatsapp/tg-form.ts, src/app/tg/form/form.tsx       (modify) start_param, consent, new messages
src/lib/telegram/groups.ts                                  web client for groups (list, link code, mapping, alerts, unlink)
src/app/(dashboard)/settings/whatsapp-settings.tsx          (modify) MessagingSettings
src/app/(dashboard)/settings/telegram-groups.tsx            Telegram groups section
src/app/(dashboard)/settings/page.tsx                       (modify) Messaging tab
src/app/(dashboard)/team/{page.tsx,add-whatsapp-member.tsx,whatsapp-connect.tsx}, src/lib/whatsapp/client.ts   (modify) WhatsApp-only connect
src/lib/whatsapp/__tests__/fakes/group-deps.ts              in-memory GroupDeps + Bot API fakes (shared by Tasks 5–8)
src/lib/whatsapp/__tests__/{live-list,groups-db,tg-live,tg-group-bot,tg-cron}.test.ts, src/lib/telegram/__tests__/groups.test.ts
```

---

### Task 1: Migration — groups, mappings, codes, live lists, group tokens, identities

**Files:**
- Create: `supabase/migrations/20261011130000_channel_groups.sql`
- Create: `supabase/tests/channel_groups_verify.sql`

**Interfaces:**
- Consumes: existing `public.is_active_business_manager(uuid)`, tables `businesses`, `profiles`, `sites`, `checklist_templates`, `channel_form_tokens`, `channel_identities` (see `20261010120000_whatsapp_channel.sql`).
- Produces (DB contract used by every later task):
  - `channel_groups(id uuid pk, business_id, channel text ('telegram'; 'whatsapp' later), chat_id text, unique (channel, chat_id), title text, alerts bool, linked_by, linked_at, last_permission_check_at, last_permission_warning_at, unlinked_at, created_at)`
  - `channel_group_checklists(group_id, template_id)` pk both, cascade both
  - `channel_group_link_codes(code, business_id, channel, issued_by, expires_at, used_at, created_at)` + RPC `issue_group_link_code(p_channel text default 'telegram') returns text` (callable as `issue_group_link_code()`)
  - `channel_group_reminders_sent(group_id, template_id, site_id, period_key, sent_at)` pk (group_id, template_id, site_id, period_key)
  - `channel_live_lists(id, group_id, site_id, list_date date, message_id text, tokens jsonb, rendered_hash text, created_at, updated_at)` unique (group_id, site_id)
  - `channel_form_tokens`: new `group_id uuid null`, new `used_by_name text null`, `profile_id` nullable, kind `'group_checklist'`
  - `channel_identities`: `uq_channel_identity_active` is now `(business_id, channel, external_id) where revoked_at is null`; all personal Telegram identities revoked.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20261011130000_channel_groups.sql
-- Telegram = group checklists with a live list (spec docs/superpowers/specs/2026-10-11-telegram-groups-design.md §9).
set search_path = public;

-- 1. Linked Telegram groups ----------------------------------------------------------------------------------------
create table if not exists public.channel_groups (
  id                         uuid primary key default gen_random_uuid(),
  business_id                uuid not null references public.businesses(id) on delete cascade,
  -- Channel-neutral (spec §9): WhatsApp groups move to this model later; only 'telegram' is implemented now.
  channel                    text not null default 'telegram' check (channel in ('telegram','whatsapp')),
  chat_id                    text not null,
  title                      text not null default '',
  alerts                     boolean not null default false,
  linked_by                  uuid references public.profiles(id) on delete set null,
  linked_at                  timestamptz not null default now(),
  last_permission_check_at   timestamptz,
  last_permission_warning_at timestamptz,
  unlinked_at                timestamptz,
  created_at                 timestamptz not null default now(),
  unique (channel, chat_id)
);
create index if not exists idx_channel_groups_business on public.channel_groups(business_id) where unlinked_at is null;
alter table public.channel_groups enable row level security;
drop policy if exists "managers read telegram groups" on public.channel_groups;
create policy "managers read telegram groups" on public.channel_groups
  for select using (public.is_active_business_manager(business_id));
drop policy if exists "managers update telegram groups" on public.channel_groups;
create policy "managers update telegram groups" on public.channel_groups
  for update using (public.is_active_business_manager(business_id)) with check (public.is_active_business_manager(business_id));
-- No client INSERT/DELETE: the bot (service role) links groups; managers unlink by setting unlinked_at.

-- Clients may only flip `alerts` and unlink (unlinked_at null → now()). Column grants are inert under our RLS setup,
-- so this is a trigger. Security INVOKER on purpose: current_user is the caller's role; service_role/postgres skip it.
create or replace function public.guard_channel_groups_update()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('authenticated','anon') then
    if new.business_id is distinct from old.business_id or new.chat_id is distinct from old.chat_id
       or new.channel is distinct from old.channel
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
create trigger trg_guard_channel_groups_update before update on public.channel_groups
  for each row execute function public.guard_channel_groups_update();

-- 2. Which checklists each group does (separate from checklist assignments) --------------------------------------
create table if not exists public.channel_group_checklists (
  group_id    uuid not null references public.channel_groups(id) on delete cascade,
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (group_id, template_id)
);
create index if not exists idx_channel_group_checklists_template on public.channel_group_checklists(template_id);
alter table public.channel_group_checklists enable row level security;
drop policy if exists "managers read group checklists" on public.channel_group_checklists;
create policy "managers read group checklists" on public.channel_group_checklists for select using (
  exists (select 1 from public.channel_groups g
           where g.id = channel_group_checklists.group_id and public.is_active_business_manager(g.business_id)));
drop policy if exists "managers add group checklists" on public.channel_group_checklists;
create policy "managers add group checklists" on public.channel_group_checklists for insert with check (
  exists (select 1 from public.channel_groups g
            join public.checklist_templates t on t.id = channel_group_checklists.template_id and t.business_id = g.business_id
           where g.id = channel_group_checklists.group_id and g.unlinked_at is null
             and public.is_active_business_manager(g.business_id)));
drop policy if exists "managers remove group checklists" on public.channel_group_checklists;
create policy "managers remove group checklists" on public.channel_group_checklists for delete using (
  exists (select 1 from public.channel_groups g
           where g.id = channel_group_checklists.group_id and public.is_active_business_manager(g.business_id)));

-- 3. Group link codes: 6 digits, 15 minutes, one use --------------------------------------------------------------
create table if not exists public.channel_group_link_codes (
  code        text primary key check (code ~ '^[0-9]{6}$'),
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel     text not null default 'telegram' check (channel in ('telegram','whatsapp')),
  issued_by   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  expires_at  timestamptz not null default now() + interval '15 minutes',
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.channel_group_link_codes enable row level security;
drop policy if exists "managers read group link codes" on public.channel_group_link_codes;
create policy "managers read group link codes" on public.channel_group_link_codes
  for select using (public.is_active_business_manager(business_id));
-- No client INSERT policy: codes are issued only by issue_group_link_code().

create or replace function public.issue_group_link_code(p_channel text default 'telegram')
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_biz  uuid;
  v_code text;
begin
  select p.business_id into v_biz from profiles p
   where p.id = auth.uid() and p.removed_at is null and p.business_id is not null;
  if v_biz is null or not public.is_active_business_manager(v_biz) then
    raise exception 'only owners and managers can link groups' using errcode = 'insufficient_privilege';
  end if;
  if p_channel is distinct from 'telegram' then   -- only Telegram groups exist so far
    raise exception 'unsupported channel' using errcode = 'invalid_parameter_value';
  end if;

  -- Opportunistic cleanup so the 6-digit space does not fill with dead codes.
  delete from channel_group_link_codes
   where business_id = v_biz and (used_at is not null or expires_at < now()) and created_at < now() - interval '1 day';

  for i in 1..5 loop
    -- gen_random_uuid() is backed by a CSPRNG (unlike random()); take 32 bits, reduce to 6 digits (as issue_link_code).
    v_code := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0');
    begin
      insert into channel_group_link_codes (code, business_id, channel, issued_by) values (v_code, v_biz, p_channel, auth.uid());
      return v_code;
    exception when unique_violation then
      v_code := null;
    end;
  end loop;
  raise exception 'could not allocate a link code, try again';
end $$;
revoke execute on function public.issue_group_link_code(text) from public, anon;
grant execute on function public.issue_group_link_code(text) to authenticated;

-- 4. Group reminders: once per (group, template, site, period) ---------------------------------------------------
create table if not exists public.channel_group_reminders_sent (
  group_id    uuid not null references public.channel_groups(id) on delete cascade,
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  site_id     uuid not null references public.sites(id) on delete cascade,
  period_key  text not null,
  sent_at     timestamptz not null default now(),
  primary key (group_id, template_id, site_id, period_key)
);
alter table public.channel_group_reminders_sent enable row level security;  -- service role only

-- 5. Live list: one message per (group, site) --------------------------------------------------------------------
create table if not exists public.channel_live_lists (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.channel_groups(id) on delete cascade,
  site_id       uuid not null references public.sites(id) on delete cascade,
  list_date     date not null,
  message_id    text not null,
  tokens        jsonb not null default '{}'::jsonb,
  rendered_hash text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (group_id, site_id)
);
alter table public.channel_live_lists enable row level security;  -- service role only

-- 6. Group form tokens: owned by a group, not a person ------------------------------------------------------------
alter table public.channel_form_tokens add column if not exists group_id uuid references public.channel_groups(id) on delete cascade;
-- First submit wins: the winner's Telegram first name, written by the same atomic UPDATE that takes the token.
alter table public.channel_form_tokens add column if not exists used_by_name text;
alter table public.channel_form_tokens alter column profile_id drop not null;
alter table public.channel_form_tokens drop constraint if exists channel_form_tokens_kind_check;
alter table public.channel_form_tokens add constraint channel_form_tokens_kind_check
  check (kind in ('checklist','corrective','group_checklist'));
alter table public.channel_form_tokens drop constraint if exists channel_form_tokens_owner_check;
alter table public.channel_form_tokens add constraint channel_form_tokens_owner_check
  check ((profile_id is not null) <> (group_id is not null));
alter table public.channel_form_tokens drop constraint if exists channel_form_tokens_group_kind_check;
alter table public.channel_form_tokens add constraint channel_form_tokens_group_kind_check
  check ((kind = 'group_checklist') = (group_id is not null));

-- 7. Identities: one active identity per (business, channel, external id) ----------------------------------------
-- Personal Telegram chats are dropped (spec §7): revoke them (pilot only: Fern & Fig). WhatsApp keeps "one business per
-- number" in code (db.ts consumeLinkCode revokes the number's other identities before linking).
update public.channel_identities set revoked_at = now() where channel = 'telegram' and revoked_at is null;
drop index if exists public.uq_channel_identity_active;
create unique index if not exists uq_channel_identity_active
  on public.channel_identities(business_id, channel, external_id) where revoked_at is null;
-- WhatsApp inbound lookups are by (channel, external_id) only.
create index if not exists idx_channel_identity_external
  on public.channel_identities(channel, external_id) where revoked_at is null;
```

- [ ] **Step 2: Write the verify DO block** (always raises at the end → everything rolls back; demo business «Fern & Fig», never a client)

```sql
-- supabase/tests/channel_groups_verify.sql
-- Run via the Management API as ONE DO block after the migration; it always raises so everything rolls back.
-- Demo business «Fern & Fig» (owner 981197ca-…), never a client.
do $v$
declare
  biz uuid := '2693f7de-c0ba-4d52-bbe9-602106eac784';
  owner uuid := '981197ca-3648-4c6c-9f18-ff7b6ae68786';
  non_manager uuid;
  v_tpl uuid;
  v_site uuid;
  v_grp uuid;
  v_code text;
  res jsonb := '{}';
begin
  select id into non_manager from profiles
   where business_id = biz and role not in ('owner','manager') and removed_at is null limit 1;
  select id into v_tpl from checklist_templates where business_id = biz limit 1;
  select id into v_site from sites where business_id = biz and removed_at is null limit 1;

  -- 1. the owner issues a 6-digit group link code
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_code := issue_group_link_code();
  res := res || jsonb_build_object('code_ok', v_code ~ '^[0-9]{6}$',
    'code_visible_to_owner', (select count(*) from channel_group_link_codes c where c.code = v_code and c.channel = 'telegram'));
  begin
    perform issue_group_link_code('whatsapp');
    res := res || '{"whatsapp_code":"ALLOWED (BAD)"}';
  exception when invalid_parameter_value then res := res || '{"whatsapp_code":"rejected"}'; end;
  execute 'reset role';

  -- 2. a non-manager cannot issue one
  if non_manager is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', non_manager, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform issue_group_link_code();
      res := res || '{"non_manager_code":"ALLOWED (BAD)"}';
    exception when insufficient_privilege then res := res || '{"non_manager_code":"rejected"}'; end;
    execute 'reset role';
  end if;

  -- 3. the bot (service role) links a group; the owner maps a checklist, flips alerts, can't move it, unlinks it
  insert into channel_groups (business_id, channel, chat_id, title, linked_by)
  values (biz, 'telegram', '-100999000111', 'Verify group', owner) returning id into v_grp;
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into channel_group_checklists (group_id, template_id) values (v_grp, v_tpl);
  update channel_groups set alerts = true where id = v_grp;
  res := res || jsonb_build_object(
    'owner_mapping', (select count(*) from channel_group_checklists where group_id = v_grp),
    'owner_alerts', (select alerts from channel_groups where id = v_grp));
  begin
    update channel_groups set chat_id = '-1' where id = v_grp;
    res := res || '{"owner_chat_id":"ALLOWED (BAD)"}';
  exception when insufficient_privilege then res := res || '{"owner_chat_id":"rejected"}'; end;
  begin
    update channel_groups set channel = 'whatsapp' where id = v_grp;
    res := res || '{"owner_channel":"ALLOWED (BAD)"}';
  exception when insufficient_privilege then res := res || '{"owner_channel":"rejected"}'; end;
  update channel_groups set unlinked_at = now() where id = v_grp;
  res := res || jsonb_build_object('owner_unlink', (select unlinked_at is not null from channel_groups where id = v_grp));
  execute 'reset role';

  -- 4. form tokens: a group token is valid; both owners, or a group kind without a group, are rejected
  insert into channel_form_tokens (token, kind, business_id, group_id, site_id, template_id, item_ids)
  values ('verify-g', 'group_checklist', biz, v_grp, v_site, v_tpl, '{}');
  res := res || '{"group_token":"ok"}';
  begin
    insert into channel_form_tokens (token, kind, business_id, profile_id, group_id, site_id, template_id)
    values ('verify-bad', 'group_checklist', biz, owner, v_grp, v_site, v_tpl);
    res := res || '{"both_owners":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"both_owners":"rejected"}'; end;
  begin
    insert into channel_form_tokens (token, kind, business_id, profile_id, site_id, template_id)
    values ('verify-bad2', 'group_checklist', biz, owner, v_site, v_tpl);
    res := res || '{"group_kind_without_group":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"group_kind_without_group":"rejected"}'; end;

  -- 5. one live list per (group, site)
  insert into channel_live_lists (group_id, site_id, list_date, message_id) values (v_grp, v_site, current_date, '1');
  begin
    insert into channel_live_lists (group_id, site_id, list_date, message_id) values (v_grp, v_site, current_date, '2');
    res := res || '{"live_list_dupe":"ALLOWED (BAD)"}';
  exception when unique_violation then res := res || '{"live_list_dupe":"rejected"}'; end;

  -- 6. identities: no active personal Telegram identity left; uniqueness is per business
  res := res || jsonb_build_object(
    'active_personal_telegram', (select count(*) from channel_identities
                                   where channel = 'telegram' and revoked_at is null and consent_source <> 'group_form'),
    'identity_index_has_business', (select indexdef like '%business_id, channel, external_id%' from pg_indexes
                                      where indexname = 'uq_channel_identity_active'));
  insert into channel_identities (business_id, profile_id, channel, external_id, consent_source)
  values (biz, owner, 'telegram', '999000111', 'group_form');
  if non_manager is not null then
    begin
      insert into channel_identities (business_id, profile_id, channel, external_id, consent_source)
      values (biz, non_manager, 'telegram', '999000111', 'group_form');
      res := res || '{"identity_dupe_same_business":"ALLOWED (BAD)"}';
    exception when unique_violation then res := res || '{"identity_dupe_same_business":"rejected"}'; end;
  end if;

  raise exception 'VERIFY_RESULT %', res;
end
$v$;
```

Expected result (record it in the report): `code_ok: true`, `code_visible_to_owner: 1`, `whatsapp_code: "rejected"`, `owner_channel: "rejected"`, `non_manager_code: "rejected"`, `owner_mapping: 1`, `owner_alerts: true`, `owner_chat_id: "rejected"`, `owner_unlink: true`, `group_token: "ok"`, `both_owners: "rejected"`, `group_kind_without_group: "rejected"`, `live_list_dupe: "rejected"`, `active_personal_telegram: 0`, `identity_index_has_business: true`, `identity_dupe_same_business: "rejected"`.

- [ ] **Step 3: Parse-check both files with pglast** (venv in the scratchpad):

```bash
python3 -m venv "$TMPDIR/pg" && "$TMPDIR/pg/bin/pip" -q install pglast
"$TMPDIR/pg/bin/python" - <<'PY'
import pglast
for f in ['supabase/migrations/20261011130000_channel_groups.sql', 'supabase/tests/channel_groups_verify.sql']:
    pglast.parse_sql(open(f).read()); print('ok', f)
src = open('supabase/migrations/20261011130000_channel_groups.sql').read()
for body in src.split('$$')[1::2]:
    pglast.parse_plpgsql('create function f() returns void language plpgsql as $$' + body + '$$'); print('ok plpgsql body')
v = open('supabase/tests/channel_groups_verify.sql').read()
pglast.parse_plpgsql('create function f() returns void language plpgsql as $$' + v.split('$v$')[1] + '$$'); print('ok verify body')
PY
```
Expected: four/five `ok` lines, no exception.

- [ ] **Step 4: STOP — ask Kostya before applying to prod**

Post in chat: «Миграция Telegram-групп готова (новые таблицы channel_groups / channel_group_checklists / channel_group_link_codes / channel_group_reminders_sent / channel_live_lists, групповые токены, уникальность личностей per business; личные Telegram-привязки отзываются — только пилот Fern & Fig). Накатываю на прод?» Apply only after «да» — via the Management API (`POST /v1/projects/rszrggreuarvodcqeqrj/database/query`, token `~/Secrets/blueroll/supabase-access-token.txt`), then run the verify DO block and record the `VERIFY_RESULT` json. If the controller applies migrations itself, hand both files over and wait.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261011130000_channel_groups.sql supabase/tests/channel_groups_verify.sql
git commit -m "feat(db): Telegram groups, live lists, group tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 2: Telegram adapter — group updates, Bot API client, builders, helpers

**Files:**
- Modify: `supabase/functions/_shared/channels/telegram.ts`
- Test: `src/lib/whatsapp/__tests__/telegram.test.ts` (add describes; update the `verifyInitData` "valid" case and the two `setupBot` cases)

**Interfaces:**
- Consumes: nothing new.
- Produces (all exported from `supabase/functions/_shared/channels/telegram.ts`; later tasks rely on these exact names):

```ts
export const TG_MINI_APP_SHORT_NAME = 'form'
export const miniAppLink: (token: string) => string          // https://t.me/BluerollChecksBot/form?startapp=<token>
export type TgEvent =
  | { kind: 'private'; chatId: string; id: string }
  | { kind: 'command'; chatId: string; chatTitle: string; userId: string; command: 'link' | 'checks' | 'help'; arg: string; id: string }
  | { kind: 'bot_removed'; chatId: string; id: string }
  | { kind: 'migrated'; chatId: string; newChatId: string; id: string }
export function parseGroupUpdate(update: unknown): TgEvent[]  // never throws; id = String(update_id)
export interface TgApiResult { ok: boolean; status: number; description: string; result: any; migrateTo: string | null }
export type TgApi = (method: string, body: Record<string, unknown>) => Promise<TgApiResult>   // never throws
export function makeTelegramApi(cfg: { token: string; fetchFn?: typeof fetch }): TgApi
export const escapeHtml: (s: string) => string
export type TgKeyboard = { text: string; url: string }[][]
export function tgHtml(chatId: string, html: string, keyboard?: TgKeyboard): OutboundMessage           // sendMessage body
export function tgEditHtml(chatId: string, messageId: string, html: string, keyboard: TgKeyboard): OutboundMessage   // editMessageText body
export type TgOutcome = 'ok' | 'not_modified' | 'gone' | 'kicked' | 'migrated' | 'retry'
export function tgOutcome(r: TgApiResult): TgOutcome
export function memberStatus(r: TgApiResult): 'member' | 'not_member' | 'unknown'   // getChatMember result
export function membersCanInvite(r: TgApiResult): boolean | null                      // getChat result; null = unknown
export interface TgUser { userId: string; firstName: string; lastName: string }
export async function verifyInitData(initData: string, botToken: string, now: Date, maxAgeSec?: number): Promise<TgUser | null>  // was { userId }
export async function setupBot(cfg): Promise<{ ok: boolean; errors: string[] }>   // allowed_updates ['message','my_chat_member']; group + private commands
```

Keep `parseUpdate`, `answerCallback`, `tgText`, `tgButtons`, `tgWebAppButton`, `makeTelegramSender`, `verifyWebhookSecret`, `TG_API`, `BOT_USERNAME`, `TG_MINI_APP_URL` unchanged in this task (Task 6 removes `parseUpdate` and `answerCallback`).

- [ ] **Step 1: Write the failing tests** — append to `src/lib/whatsapp/__tests__/telegram.test.ts` and extend its import line to:

```ts
import { verifyWebhookSecret, parseUpdate, tgText, tgButtons, tgWebAppButton, verifyInitData, makeTelegramSender, answerCallback, setupBot, BOT_USERNAME,
  parseGroupUpdate, makeTelegramApi, tgHtml, tgEditHtml, escapeHtml, tgOutcome, memberStatus, membersCanInvite, miniAppLink, TG_MINI_APP_SHORT_NAME, type TgApiResult } from '../../../../supabase/functions/_shared/channels/telegram'
```

Replace the existing `it('valid → userId', …)` in `describe('verifyInitData')` with:

```ts
  it('valid → user id and names', async () => expect(await verifyInitData(build(nowSec - 60).toString(), token, now)).toEqual({ userId: '777', firstName: 'Ann', lastName: '' }))
  it('last name is returned when present', async () => {
    expect(await verifyInitData(build(nowSec - 60, '{"id":778,"first_name":"Ben","last_name":"Smith"}').toString(), token, now))
      .toEqual({ userId: '778', firstName: 'Ben', lastName: 'Smith' })
  })
```

Replace the whole `describe('setupBot', …)` with:

```ts
describe('setupBot', () => {
  it('sets the webhook (messages + my_chat_member) and private + group commands', async () => {
    const calls: { m: string; b: any }[] = []
    const f = (async (url: string, init: any) => { calls.push({ m: url.split('/').pop()!, b: JSON.parse(init.body) }); return new Response(JSON.stringify({ ok: true })) }) as unknown as typeof fetch
    const r = await setupBot({ token: 'T', webhookUrl: 'https://h/x', secret: 'S', fetchFn: f })
    expect(r).toEqual({ ok: true, errors: [] })
    expect(calls[0]).toEqual({ m: 'setWebhook', b: { url: 'https://h/x', secret_token: 'S', allowed_updates: ['message', 'my_chat_member'] } })
    expect(calls[1]).toEqual({ m: 'setMyCommands', b: { commands: [{ command: 'help', description: 'How Blueroll checks work' }] } })
    expect(calls[2]).toEqual({ m: 'setMyCommands', b: { scope: { type: 'all_group_chats' }, commands: [
      { command: 'checks', description: "Show today's checks" },
      { command: 'link', description: 'Link this group to Blueroll' },
      { command: 'help', description: 'How Blueroll checks work' },
    ] } })
  })
  it('collects errors without leaking token', async () => {
    const f = (async () => new Response(JSON.stringify({ ok: false, description: 'bad TOKEN123' }), { status: 401 })) as unknown as typeof fetch
    const r = await setupBot({ token: 'TOKEN123', webhookUrl: 'u', secret: 's', fetchFn: f })
    expect(r.ok).toBe(false); expect(r.errors).toHaveLength(3)
    expect(JSON.stringify(r.errors)).not.toContain('TOKEN123')
  })
})
```

Append:

```ts
const grp = (text: unknown, extra: Record<string, unknown> = {}) => ({
  update_id: 5, message: { message_id: 1, from: { id: 42, is_bot: false, first_name: 'Ann' }, chat: { id: -100123, type: 'supergroup', title: 'Kitchen' }, text, ...extra },
})

describe('parseGroupUpdate', () => {
  it('/link <code> in a group → link command with the chat title', () => {
    expect(parseGroupUpdate(grp('/link 482913'))).toEqual([{ kind: 'command', chatId: '-100123', chatTitle: 'Kitchen', userId: '42', command: 'link', arg: '482913', id: '5' }])
  })
  it('/checks (fixture, no title) and /checks@BluerollChecksBot → checks; other bot → nothing', () => {
    expect(parseGroupUpdate(group)).toEqual([{ kind: 'command', chatId: '-100123', chatTitle: '', userId: '123456789', command: 'checks', arg: '', id: '1004' }])
    expect(parseGroupUpdate(grp('/checks@BluerollChecksBot'))[0]).toMatchObject({ command: 'checks' })
    expect(parseGroupUpdate(grp('/checks@OtherBot'))).toEqual([])
  })
  it('/help and /start → help', () => {
    expect(parseGroupUpdate(grp('/help'))[0]).toMatchObject({ command: 'help' })
    expect(parseGroupUpdate(grp('/start'))[0]).toMatchObject({ command: 'help' })
  })
  it('chatter, unknown commands, stickers and bot senders are ignored', () => {
    expect(parseGroupUpdate(grp('hello all'))).toEqual([])
    expect(parseGroupUpdate(grp('/stop'))).toEqual([])
    expect(parseGroupUpdate(grp('/constructor'))).toEqual([])
    expect(parseGroupUpdate(grp(undefined, { sticker: { file_id: 'f' } }))).toEqual([])
    expect(parseGroupUpdate(grp('/checks', { from: { id: 7, is_bot: true } }))).toEqual([])
  })
  it('an anonymous group admin (GroupAnonymousBot, sender_chat = the group) can still /link', () => {
    const u = grp('/link 111111', { from: { id: 1087968824, is_bot: true, first_name: 'Group' }, sender_chat: { id: -100123, type: 'supergroup' } })
    expect(parseGroupUpdate(u)).toEqual([{ kind: 'command', chatId: '-100123', chatTitle: 'Kitchen', userId: '', command: 'link', arg: '111111', id: '5' }])
  })
  it('any private message (incl. an old /start <code> and stickers) → private', () => {
    expect(parseGroupUpdate({ update_id: 6, message: { from: { id: 42, is_bot: false }, chat: { id: 42, type: 'private' }, text: '/start 482913' } }))
      .toEqual([{ kind: 'private', chatId: '42', id: '6' }])
    expect(parseGroupUpdate({ update_id: 7, message: { from: { id: 42, is_bot: false }, chat: { id: 42, type: 'private' }, sticker: {} } }))
      .toEqual([{ kind: 'private', chatId: '42', id: '7' }])
  })
  it('my_chat_member left/kicked in a group → bot_removed; added or private → nothing', () => {
    const mcm = (status: string, type = 'supergroup') => ({ update_id: 8, my_chat_member: { chat: { id: -100123, type }, from: { id: 42 }, new_chat_member: { status, user: { id: 1 } } } })
    expect(parseGroupUpdate(mcm('left'))).toEqual([{ kind: 'bot_removed', chatId: '-100123', id: '8' }])
    expect(parseGroupUpdate(mcm('kicked'))).toEqual([{ kind: 'bot_removed', chatId: '-100123', id: '8' }])
    expect(parseGroupUpdate(mcm('member'))).toEqual([])
    expect(parseGroupUpdate(mcm('kicked', 'private'))).toEqual([])
  })
  it('group → supergroup migration', () => {
    const u = { update_id: 9, message: { from: { id: 42, is_bot: false }, chat: { id: -5, type: 'group' }, migrate_to_chat_id: -1009 } }
    expect(parseGroupUpdate(u)).toEqual([{ kind: 'migrated', chatId: '-5', newChatId: '-1009', id: '9' }])
  })
  it('channel posts, edits and malformed input never produce events or throw', () => {
    expect(parseGroupUpdate({ update_id: 1, channel_post: { chat: { id: -1, type: 'channel' }, text: '/checks' } })).toEqual([])
    expect(parseGroupUpdate({ update_id: 1, edited_message: grp('/checks').message })).toEqual([])
    for (const v of [null, undefined, 5, 'x', [], {}, { message: 5 }, { message: { chat: null } }, { my_chat_member: 'x' }]) expect(parseGroupUpdate(v)).toEqual([])
  })
})

describe('Mini App direct link', () => {
  it('uses the BotFather short name', () => {
    expect(TG_MINI_APP_SHORT_NAME).toBe('form')
    expect(miniAppLink('abc_DEF-1')).toBe('https://t.me/BluerollChecksBot/form?startapp=abc_DEF-1')
  })
})

describe('HTML builders', () => {
  it('escapeHtml escapes &, < and >', () => expect(escapeHtml('Fish & Chips <Bar>')).toBe('Fish &amp; Chips &lt;Bar&gt;'))
  it('tgHtml: HTML parse mode, no link previews, URL buttons', () => {
    expect(tgHtml('-1', '<b>x</b>', [[{ text: 'A', url: 'https://t.me/a' }]])).toEqual({
      chat_id: '-1', text: '<b>x</b>', parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: 'A', url: 'https://t.me/a' }]] },
    })
    expect(tgHtml('-1', 'x')).toEqual({ chat_id: '-1', text: 'x', parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
  })
  it('tgEditHtml always sends reply_markup (an empty keyboard clears old buttons)', () => {
    expect(tgEditHtml('-1', '55', 'x', [])).toEqual({
      chat_id: '-1', message_id: 55, text: 'x', parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [] },
    })
  })
})

describe('makeTelegramApi', () => {
  it('posts the method and returns the result', async () => {
    const calls: { url: string; body: any }[] = []
    const f = (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ ok: true, result: { message_id: 9 } })) }) as unknown as typeof fetch
    const r = await makeTelegramApi({ token: 'T0K', fetchFn: f })('sendMessage', { chat_id: '-1', text: 'x' })
    expect(r).toEqual({ ok: true, status: 200, description: '', result: { message_id: 9 }, migrateTo: null })
    expect(calls).toEqual([{ url: 'https://api.telegram.org/botT0K/sendMessage', body: { chat_id: '-1', text: 'x' } }])
  })
  it('errors: description without the token, migrate_to_chat_id surfaced, never throws', async () => {
    const f = (async () => new Response(JSON.stringify({ ok: false, description: 'Bad Request: group chat was upgraded T0K', parameters: { migrate_to_chat_id: -1009 } }), { status: 400 })) as unknown as typeof fetch
    const r = await makeTelegramApi({ token: 'T0K', fetchFn: f })('sendMessage', {})
    expect(r).toEqual({ ok: false, status: 400, description: 'Bad Request: group chat was upgraded ***', result: null, migrateTo: '-1009' })
    const boom = (async () => { throw new Error('net') }) as unknown as typeof fetch
    expect(await makeTelegramApi({ token: 'T', fetchFn: boom })('getChat', {})).toEqual({ ok: false, status: 0, description: 'network', result: null, migrateTo: null })
  })
})

const R = (o: Partial<TgApiResult>): TgApiResult => ({ ok: false, status: 400, description: '', result: null, migrateTo: null, ...o })

describe('tgOutcome', () => {
  it.each([
    [R({ ok: true, status: 200 }), 'ok'],
    [R({ description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same' }), 'not_modified'],
    [R({ description: 'Bad Request: message to edit not found' }), 'gone'],
    [R({ description: 'Bad Request: message to delete not found' }), 'gone'],
    [R({ description: "Bad Request: message can't be deleted for everyone" }), 'gone'],
    [R({ description: "Bad Request: message can't be edited" }), 'gone'],
    [R({ status: 403, description: 'Forbidden: bot was kicked from the supergroup chat' }), 'kicked'],
    [R({ status: 403, description: 'Forbidden: bot is not a member of the group chat' }), 'kicked'],
    [R({ description: 'Bad Request: chat not found' }), 'kicked'],
    [R({ description: 'Bad Request: group chat was upgraded to a supergroup chat', migrateTo: '-1009' }), 'migrated'],
    [R({ status: 429, description: 'Too Many Requests: retry after 5' }), 'retry'],
    [R({ status: 0, description: 'network' }), 'retry'],
  ])('%#', (r, want) => expect(tgOutcome(r)).toBe(want))
})

describe('memberStatus / membersCanInvite', () => {
  it('member statuses', () => {
    for (const s of ['creator', 'administrator', 'member']) expect(memberStatus(R({ ok: true, status: 200, result: { status: s } }))).toBe('member')
    expect(memberStatus(R({ ok: true, status: 200, result: { status: 'restricted', is_member: true } }))).toBe('member')
    expect(memberStatus(R({ ok: true, status: 200, result: { status: 'restricted', is_member: false } }))).toBe('not_member')
    expect(memberStatus(R({ ok: true, status: 200, result: { status: 'left' } }))).toBe('not_member')
    expect(memberStatus(R({ ok: true, status: 200, result: { status: 'kicked' } }))).toBe('not_member')
    expect(memberStatus(R({ description: 'Bad Request: user not found' }))).toBe('not_member')
    expect(memberStatus(R({ description: 'Bad Request: PARTICIPANT_ID_INVALID' }))).toBe('not_member')
    expect(memberStatus(R({ status: 0, description: 'network' }))).toBe('unknown')
    expect(memberStatus(R({ status: 429 }))).toBe('unknown')
  })
  it('can members invite?', () => {
    expect(membersCanInvite(R({ ok: true, status: 200, result: { permissions: { can_invite_users: true } } }))).toBe(true)
    expect(membersCanInvite(R({ ok: true, status: 200, result: { permissions: { can_invite_users: false } } }))).toBe(false)
    expect(membersCanInvite(R({ ok: true, status: 200, result: {} }))).toBe(false)
    expect(membersCanInvite(R({ status: 0 }))).toBeNull()
  })
})
```

Note `group` is the existing fixture import `./fixtures/tg-group.json` (`{"update_id":1004,"message":{…"from":{"id":123456789…},"chat":{"id":-100123,"type":"supergroup"},…"text":"/checks"}}`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/telegram.test.ts`
Expected: FAIL — `parseGroupUpdate is not a function` (and friends), `verifyInitData` returns `{ userId }` only, `setupBot` sends old `allowed_updates`.

- [ ] **Step 3: Implement** — in `supabase/functions/_shared/channels/telegram.ts`:

(a) Below `TG_MINI_APP_URL` add:

```ts
/**
 * Mini App short name registered in BotFather (/newapp, URL https://app.blueroll.app/tg/form). Kostya picks it in
 * BotFather; if he chooses another name, change only this constant. Groups can't use web_app buttons (private chats
 * only), so the live list opens the Mini App through this direct link.
 */
export const TG_MINI_APP_SHORT_NAME = 'form'
export const miniAppLink = (token: string) => `https://t.me/${BOT_USERNAME}/${TG_MINI_APP_SHORT_NAME}?startapp=${encodeURIComponent(token)}`
```

(b) After the existing `parseUpdate` add:

```ts
export type TgEvent =
  | { kind: 'private'; chatId: string; id: string }
  | { kind: 'command'; chatId: string; chatTitle: string; userId: string; command: 'link' | 'checks' | 'help'; arg: string; id: string }
  | { kind: 'bot_removed'; chatId: string; id: string }
  | { kind: 'migrated'; chatId: string; newChatId: string; id: string }

const GROUP_COMMANDS: Record<string, 'link' | 'checks' | 'help'> = { link: 'link', checks: 'checks', help: 'help', start: 'help' }
const isGroupChat = (t: unknown) => t === 'group' || t === 'supergroup'
const isChatId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v !== 0

/**
 * Groups-only bot (spec §3, §7). Privacy mode stays on, so in groups we only see commands and service messages.
 * Any private message → 'private' (the caller answers "use your team's group"). Never throws.
 */
export function parseGroupUpdate(update: unknown): TgEvent[] {
  try {
    const u = update as Any
    const id = String(u?.update_id ?? '')
    const mcm = u?.my_chat_member
    if (mcm && typeof mcm === 'object') {
      if (!isGroupChat(mcm.chat?.type) || !isChatId(mcm.chat?.id)) return []
      const st = mcm.new_chat_member?.status
      return st === 'left' || st === 'kicked' ? [{ kind: 'bot_removed', chatId: String(mcm.chat.id), id }] : []
    }
    const m = u?.message
    if (!m || typeof m !== 'object' || !isChatId(m.chat?.id)) return []
    const chatId = String(m.chat.id)
    if (m.chat.type === 'private') {
      return m.from?.is_bot === true || !isUserId(m.from?.id) ? [] : [{ kind: 'private', chatId, id }]
    }
    if (!isGroupChat(m.chat.type)) return []
    if (isChatId(m.migrate_to_chat_id)) return [{ kind: 'migrated', chatId, newChatId: String(m.migrate_to_chat_id), id }]
    // Anonymous group admins post as GroupAnonymousBot (is_bot) with sender_chat = the group itself.
    const anonymousAdmin = m.from?.is_bot === true && m.sender_chat?.id === m.chat.id
    if (!anonymousAdmin && (m.from?.is_bot === true || !isUserId(m.from?.id))) return []
    if (typeof m.text !== 'string') return []
    const cmd = /^\/([A-Za-z_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/.exec(m.text.trim())
    if (!cmd) return []
    const [, name, target, arg] = cmd
    if (target && target.toLowerCase() !== BOT_USERNAME.toLowerCase()) return []
    const key = name.toLowerCase()
    const command = Object.prototype.hasOwnProperty.call(GROUP_COMMANDS, key) ? GROUP_COMMANDS[key] : undefined
    if (!command) return []
    return [{
      kind: 'command', chatId, chatTitle: typeof m.chat.title === 'string' ? m.chat.title : '',
      userId: anonymousAdmin ? '' : String(m.from.id), command, arg: (arg ?? '').trim(), id,
    }]
  } catch { /* malformed: ignore */ }
  return []
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export type TgKeyboard = { text: string; url: string }[][]

/** sendMessage body: HTML parse mode, no link previews, optional URL buttons (one per row as given). */
export const tgHtml = (chatId: string, html: string, keyboard: TgKeyboard = []): OutboundMessage => ({
  chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
  ...(keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
})

/** editMessageText body. reply_markup is always sent: an empty keyboard removes buttons left from the previous state. */
export const tgEditHtml = (chatId: string, messageId: string, html: string, keyboard: TgKeyboard): OutboundMessage => ({
  chat_id: chatId, message_id: Number(messageId), text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
  reply_markup: { inline_keyboard: keyboard },
})

export interface TgApiResult { ok: boolean; status: number; description: string; result: Any; migrateTo: string | null }
/** One Bot API call. Never throws; never returns the token in `description`. */
export type TgApi = (method: string, body: Record<string, unknown>) => Promise<TgApiResult>

export function makeTelegramApi(cfg: { token: string; fetchFn?: typeof fetch }): TgApi {
  const f = cfg.fetchFn ?? fetch
  const scrub = (s: string) => (cfg.token ? s.replaceAll(cfg.token, '***') : s)
  return async (method, body) => {
    try {
      const r = await f(`${TG_API}/bot${cfg.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      const mig = j?.parameters?.migrate_to_chat_id
      return {
        ok: r.ok && j?.ok !== false, status: r.status, description: scrub(String(j?.description ?? '')),
        result: j?.result ?? null, migrateTo: typeof mig === 'number' ? String(mig) : null,
      }
    } catch {
      return { ok: false, status: 0, description: 'network', result: null, migrateTo: null }
    }
  }
}

export type TgOutcome = 'ok' | 'not_modified' | 'gone' | 'kicked' | 'migrated' | 'retry'

/** Live-list error mapping (spec §4). */
export function tgOutcome(r: TgApiResult): TgOutcome {
  if (r.ok) return 'ok'
  const d = r.description.toLowerCase()
  if (d.includes('message is not modified')) return 'not_modified'
  if (r.migrateTo) return 'migrated'
  if (r.status === 403 || d.includes('bot was kicked') || d.includes('bot is not a member') || d.includes('chat not found')) return 'kicked'
  if (d.includes('message to edit not found') || d.includes('message to delete not found')
    || d.includes("message can't be deleted") || d.includes("message can't be edited") || d.includes('message_id_invalid')) return 'gone'
  return 'retry'
}

/** getChatMember → may this user fill in this group's checks? (spec §5: creator, administrator, member, restricted+is_member). */
export function memberStatus(r: TgApiResult): 'member' | 'not_member' | 'unknown' {
  if (r.ok) {
    const s = r.result?.status
    if (s === 'creator' || s === 'administrator' || s === 'member') return 'member'
    if (s === 'restricted') return r.result?.is_member === true ? 'member' : 'not_member'
    return 'not_member'
  }
  if (r.status === 400 && /user not found|participant_id_invalid|member not found/i.test(r.description)) return 'not_member'
  return 'unknown'
}

/** getChat → can ordinary members add people? null when Telegram didn't answer. */
export function membersCanInvite(r: TgApiResult): boolean | null {
  if (!r.ok) return null
  return r.result?.permissions?.can_invite_users === true
}
```

(c) Replace `verifyInitData` with:

```ts
export interface TgUser { userId: string; firstName: string; lastName: string }

export async function verifyInitData(initData: string, botToken: string, now: Date, maxAgeSec = 86400): Promise<TgUser | null> {
  try {
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')
    if (!hash) return null
    params.delete('hash')
    const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n')
    const secret = await hmac(enc.encode('WebAppData'), botToken)
    const expected = hex(await hmac(secret, dcs))
    if (!constEq(expected, hash.toLowerCase())) return null
    const authDate = Number(params.get('auth_date'))
    if (!Number.isFinite(authDate) || authDate <= 0) return null
    const age = now.getTime() / 1000 - authDate
    if (age > maxAgeSec || age < -300) return null
    const user = JSON.parse(params.get('user') ?? '')
    if (!isUserId(user?.id)) return null
    return {
      userId: String(user.id),
      firstName: typeof user.first_name === 'string' ? user.first_name : '',
      lastName: typeof user.last_name === 'string' ? user.last_name : '',
    }
  } catch {
    return null
  }
}
```

(d) In `setupBot` replace the two `call(...)` lines with:

```ts
  await call('setWebhook', { url: cfg.webhookUrl, secret_token: cfg.secret, allowed_updates: ['message', 'my_chat_member'] })
  // Private chats: only /help (the bot answers every private message with "use your team's group").
  await call('setMyCommands', { commands: [{ command: 'help', description: 'How Blueroll checks work' }] })
  await call('setMyCommands', { scope: { type: 'all_group_chats' }, commands: [
    { command: 'checks', description: "Show today's checks" },
    { command: 'link', description: 'Link this group to Blueroll' },
    { command: 'help', description: 'How Blueroll checks work' },
  ] })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/whatsapp/__tests__/telegram.test.ts && npm test`
Expected: PASS (whole suite green; `form-api.test.ts` still passes — its fake returns `{ userId }`, only `.userId` is read).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `4`; `cd supabase/functions && deno check telegram-webhook/index.ts channel-form/index.ts whatsapp-reminders/index.ts` → no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/channels/telegram.ts src/lib/whatsapp/__tests__/telegram.test.ts
git commit -m "feat(telegram): group update parsing, Bot API client, HTML builders, membership helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pure live list — `dueAtSite`, renderer, refresh decision

**Files:**
- Modify: `supabase/functions/_shared/checklists-core/due.ts`
- Create: `supabase/functions/_shared/channels/live-list.ts`
- Test: `src/lib/whatsapp/__tests__/live-list.test.ts`

**Interfaces:**
- Consumes: `escapeHtml`, `TgKeyboard` from `telegram.ts` (Task 2); `localParts` from `checklists-core/time.ts`; types `Template`, `CompletionLite`, `DueChecklist` from `checklists-core/types.ts`.
- Produces:

```ts
// checklists-core/due.ts
export function dueAtSite(args: { templates: Template[]; siteId: string; tz: string; now: Date; completions: CompletionLite[] }): DueChecklist[]
// (dueChecklists keeps its signature and now = dueAtSite over availableChecklists(templates, person, siteId))

// channels/live-list.ts
export interface OpenLine { templateId: string; name: string; deadlineUtc: string | null; url: string | null }   // url null = app only
export interface DoneLine { templateId: string; name: string; completedAt: string; by: string | null }
export interface LiveListInput { siteName: string; tz: string; now: Date; open: OpenLine[]; done: DoneLine[] }
export interface RenderedList { text: string; keyboard: TgKeyboard; hash: string; openCount: number; doneCount: number }
export const DUE_SOON_MS: number      // 30 min
export const BUTTON_MAX: number       // 64
export const TEXT_MAX: number         // 4000
export function listIcon(deadlineUtc: string | null, now: Date): '🔴' | '🟠' | '⚪'
export function clip(s: string, max: number): string
export function hhmm(iso: string, tz: string): string
export function localDate(now: Date, tz: string): string                          // 'YYYY-MM-DD' in tz
export async function renderLiveList(i: LiveListInput): Promise<RenderedList>
export type RefreshDecision = 'delete_stale' | 'delete_done' | 'unchanged' | 'edit'
export function refreshDecision(a: { listDate: string; today: string; openCount: number; storedHash: string | null; newHash: string }): RefreshDecision
export function sitesForGroup<S extends { id: string }>(templates: Pick<Template, 'site_id' | 'active'>[], sites: S[]): S[]
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/whatsapp/__tests__/live-list.test.ts
import { describe, it, expect } from 'vitest'
import { renderLiveList, listIcon, refreshDecision, localDate, sitesForGroup, clip, type LiveListInput } from '../../../../supabase/functions/_shared/channels/live-list'
import { dueAtSite, dueChecklists } from '../../../../supabase/functions/_shared/checklists-core/due'
import type { Template } from '../../../../supabase/functions/_shared/checklists-core/types'

const NOW = new Date('2026-10-14T09:40:00Z')   // 10:40 Europe/London (BST)
const L = 'Europe/London'
const link = (t: string) => `https://t.me/BluerollChecksBot/form?startapp=${t}`

const INPUT: LiveListInput = {
  siteName: 'Wharf Side', tz: L, now: NOW,
  open: [
    { templateId: 'c', name: 'Cleaning Schedule', deadlineUtc: '2026-10-14T22:00:00.000Z', url: link('tc') },
    { templateId: 'w', name: 'Weekly Deep Clean', deadlineUtc: null, url: link('tw') },
    { templateId: 'h', name: 'Hot Holding Checks', deadlineUtc: '2026-10-14T10:00:00.000Z', url: link('th') },
    { templateId: 'p', name: 'Probe Calibration', deadlineUtc: null, url: null },
    { templateId: 'f', name: 'Fridge & Freezer Temperatures', deadlineUtc: '2026-10-14T09:00:00.000Z', url: link('tf') },
  ],
  done: [
    { templateId: 'd', name: 'Delivery Check', completedAt: '2026-10-14T08:05:00+00:00', by: 'Alex' },
    { templateId: 'o', name: 'Daily Opening Checks', completedAt: '2026-10-14T07:47:00+00:00', by: 'Anna' },
  ],
}

describe('renderLiveList', () => {
  it('renders the spec example: order, icons, clock times, app-only, done lines, counts, escaping', async () => {
    const r = await renderLiveList(INPUT)
    expect(r.text).toBe([
      '📋 <b>Wharf Side</b> — 2 of 7 done',
      '🔴 Fridge &amp; Freezer Temperatures · due 10:00',
      '🟠 Hot Holding Checks · due 11:00',
      '⚪ Cleaning Schedule · due 23:00',
      '⚪ Probe Calibration · app only',
      '⚪ Weekly Deep Clean',
      '✅ Daily Opening Checks · 08:47 Anna',
      '✅ Delivery Check · 09:05 Alex',
    ].join('\n'))
    expect(r.keyboard).toEqual([
      [{ text: '🔴 Fridge & Freezer Temperatures', url: link('tf') }],
      [{ text: '🟠 Hot Holding Checks', url: link('th') }],
      [{ text: '⚪ Cleaning Schedule', url: link('tc') }],
      [{ text: '⚪ Weekly Deep Clean', url: link('tw') }],
    ])
    expect(r.openCount).toBe(5)
    expect(r.doneCount).toBe(2)
  })
  it('escapes the site name and person names', async () => {
    const r = await renderLiveList({ ...INPUT, siteName: 'Fish & Chips <Bar>', open: [], done: [{ templateId: 'x', name: 'A<b>', completedAt: '2026-10-14T08:00:00Z', by: 'Jo & Co' }] })
    expect(r.text).toBe('📋 <b>Fish &amp; Chips &lt;Bar&gt;</b> — 1 of 1 done\n✅ A&lt;b&gt; · 09:00 Jo &amp; Co')
  })
  it('a done line without a known person has no name', async () => {
    const r = await renderLiveList({ ...INPUT, open: [], done: [{ templateId: 'x', name: 'Probe', completedAt: '2026-10-14T08:00:00Z', by: null }] })
    expect(r.text.split('\n')[1]).toBe('✅ Probe · 09:00')
  })
  it('button labels are clipped to 64 characters', async () => {
    const r = await renderLiveList({ ...INPUT, open: [{ templateId: 'l', name: 'X'.repeat(80), deadlineUtc: null, url: link('tl') }], done: [] })
    const label = r.keyboard[0][0].text
    expect([...label]).toHaveLength(64)
    expect(label.startsWith('⚪ X')).toBe(true)
    expect(label.endsWith('…')).toBe(true)
  })
  it('very long lists collapse the done lines to a count', async () => {
    const done = Array.from({ length: 120 }, (_, i) => ({ templateId: `d${i}`, name: `Done checklist number ${i} with a long name`, completedAt: '2026-10-14T08:00:00Z', by: 'Anna' }))
    const r = await renderLiveList({ ...INPUT, done })
    expect(r.text.length).toBeLessThanOrEqual(4000)
    expect(r.text.endsWith('✅ 120 done')).toBe(true)
  })
  it('hash is stable while nothing visible changes and changes with the state', async () => {
    const a = await renderLiveList(INPUT)
    const b = await renderLiveList({ ...INPUT, now: new Date('2026-10-14T09:41:00Z') })
    expect(b.hash).toBe(a.hash)
    expect(b.hash).toMatch(/^[0-9a-f]{64}$/)
    const c = await renderLiveList({ ...INPUT, now: new Date('2026-10-14T10:01:00Z') })   // Hot Holding turns 🔴
    expect(c.hash).not.toBe(a.hash)
    const d = await renderLiveList({ ...INPUT, open: INPUT.open.slice(1) })
    expect(d.hash).not.toBe(a.hash)
  })
})

describe('listIcon', () => {
  const dl = '2026-10-14T10:00:00.000Z'
  it('🔴 after the deadline, 🟠 within 30 min (inclusive), ⚪ otherwise', () => {
    expect(listIcon(dl, new Date('2026-10-14T10:00:00.001Z'))).toBe('🔴')
    expect(listIcon(dl, new Date('2026-10-14T10:00:00.000Z'))).toBe('🟠')
    expect(listIcon(dl, new Date('2026-10-14T09:30:00.000Z'))).toBe('🟠')
    expect(listIcon(dl, new Date('2026-10-14T09:29:00.000Z'))).toBe('⚪')
    expect(listIcon(null, NOW)).toBe('⚪')
  })
})

describe('refreshDecision', () => {
  const base = { listDate: '2026-10-14', today: '2026-10-14', openCount: 2, storedHash: 'h1', newHash: 'h1' }
  it('previous local day → delete, then nothing open → delete, same hash → nothing, else edit', () => {
    expect(refreshDecision({ ...base, listDate: '2026-10-13', openCount: 0 })).toBe('delete_stale')
    expect(refreshDecision({ ...base, openCount: 0 })).toBe('delete_done')
    expect(refreshDecision(base)).toBe('unchanged')
    expect(refreshDecision({ ...base, newHash: 'h2' })).toBe('edit')
    expect(refreshDecision({ ...base, storedHash: null })).toBe('edit')
  })
})

describe('helpers', () => {
  it('localDate is the site-local calendar day', () => {
    expect(localDate(new Date('2026-10-14T23:30:00Z'), L)).toBe('2026-10-15')
    expect(localDate(new Date('2026-10-14T22:30:00Z'), L)).toBe('2026-10-14')
  })
  it('clip keeps short strings', () => expect(clip('abc', 64)).toBe('abc'))
  it('sitesForGroup: sites where at least one active mapped checklist applies', () => {
    const sites = [{ id: 's1' }, { id: 's2' }, { id: 's3' }]
    expect(sitesForGroup([{ site_id: 's2', active: true }], sites)).toEqual([{ id: 's2' }])
    expect(sitesForGroup([{ site_id: null, active: true }], sites)).toEqual(sites)
    expect(sitesForGroup([{ site_id: null, active: false }], sites)).toEqual([])
    expect(sitesForGroup([], sites)).toEqual([])
  })
})

const tpl = (o: Partial<Template>): Template => ({
  id: 't1', business_id: 'b', site_id: null, name: 'Fridge temps', frequency: 'daily', deadline_time: '11:00',
  multi_per_day: false, min_per_day: null, assigned_roles: ['chef'], assigned_role_ids: ['r-chef'], active: true, ...o,
})

describe('dueAtSite', () => {
  it('ignores assignment; respects site, active and completions', () => {
    const due = dueAtSite({ templates: [tpl({}), tpl({ id: 't2', site_id: 's2' }), tpl({ id: 't3', active: false })], siteId: 's1', tz: L, now: NOW, completions: [] })
    expect(due.map((d) => d.template.id)).toEqual(['t1'])
    expect(due[0]).toMatchObject({ site_id: 's1', deadline_utc: '2026-10-14T10:00:00.000Z', period_key: '2026-10-14', overdue: false })
    expect(dueAtSite({ templates: [tpl({})], siteId: 's1', tz: L, now: NOW, completions: [{ template_id: 't1', site_id: 's1', completed_at: '2026-10-14T08:00:00Z' }] })).toEqual([])
  })
  it('multi-per-day stays due until min_per_day completions', () => {
    const t = tpl({ multi_per_day: true, min_per_day: 3 })
    const one = [{ template_id: 't1', site_id: 's1', completed_at: '2026-10-14T08:00:00Z' }]
    expect(dueAtSite({ templates: [t], siteId: 's1', tz: L, now: NOW, completions: one })).toHaveLength(1)
  })
  it('dueChecklists still filters by assignment', () => {
    const anna = { profile_id: 'p1', business_id: 'b', full_name: 'Anna', role: 'kitchen_staff', role_id: 'r-ks' }
    expect(dueChecklists({ templates: [tpl({})], person: anna, siteId: 's1', tz: L, now: NOW, completions: [] })).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/live-list.test.ts`
Expected: FAIL — cannot resolve `live-list` / `dueAtSite` is not a function.

- [ ] **Step 3: Implement `dueAtSite`** — in `supabase/functions/_shared/checklists-core/due.ts` replace `dueChecklists` with:

```ts
/** What is still due at a site for these templates, regardless of who they are assigned to (Telegram groups). */
export function dueAtSite(args: { templates: Template[]; siteId: string; tz: string; now: Date; completions: CompletionLite[] }): DueChecklist[] {
  const { templates, siteId, tz, now, completions } = args
  const out: DueChecklist[] = []
  for (const t of templates) {
    if (!t.active || (t.site_id !== null && t.site_id !== siteId)) continue
    const need = t.multi_per_day ? (t.min_per_day ?? 0) : 1
    if (need === 0) continue
    const freq = t.multi_per_day ? 'daily' : t.frequency
    const start = periodStartUtc(freq, now, tz).getTime()
    const done = completions.filter((c) =>
      c.template_id === t.id && c.site_id === siteId && new Date(c.completed_at).getTime() >= start).length
    if (done >= need) continue
    const dl = deadlineUtc(t.deadline_time, now, tz)
    out.push({
      template: t, site_id: siteId, deadline_utc: dl ? dl.toISOString() : null,
      period_key: periodKey(freq, now, tz), overdue: !!dl && now.getTime() > dl.getTime(),
    })
  }
  return out
}

export function dueChecklists(args: {
  templates: Template[]; person: Person; siteId: string; tz: string; now: Date; completions: CompletionLite[]
}): DueChecklist[] {
  return dueAtSite({ ...args, templates: availableChecklists(args.templates, args.person, args.siteId) })
}
```

- [ ] **Step 4: Implement `live-list.ts`**

```ts
// supabase/functions/_shared/channels/live-list.ts
// Telegram live list (spec §4), pure: what one (group, site) list message says and when to edit or delete it.
import type { Template } from '../checklists-core/types.ts'
import { localParts } from '../checklists-core/time.ts'
import { escapeHtml, type TgKeyboard } from './telegram.ts'

export interface OpenLine { templateId: string; name: string; deadlineUtc: string | null; url: string | null }   // url null = app only
export interface DoneLine { templateId: string; name: string; completedAt: string; by: string | null }
export interface LiveListInput { siteName: string; tz: string; now: Date; open: OpenLine[]; done: DoneLine[] }
export interface RenderedList { text: string; keyboard: TgKeyboard; hash: string; openCount: number; doneCount: number }

export const DUE_SOON_MS = 30 * 60_000
export const BUTTON_MAX = 64
/** Telegram's limit is 4096 characters; keep a margin. */
export const TEXT_MAX = 4000

export function listIcon(deadlineUtc: string | null, now: Date): '🔴' | '🟠' | '⚪' {
  if (!deadlineUtc) return '⚪'
  const left = new Date(deadlineUtc).getTime() - now.getTime()
  if (left < 0) return '🔴'
  return left <= DUE_SOON_MS ? '🟠' : '⚪'
}

/** At most `max` characters (code points), with an ellipsis when cut. */
export function clip(s: string, max: number): string {
  const cps = [...s]
  return cps.length <= max ? s : cps.slice(0, max - 1).join('') + '…'
}

export const hhmm = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))

export function localDate(now: Date, tz: string): string {
  const p = localParts(now, tz)
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const byOpenOrder = (a: OpenLine, b: OpenLine) => {
  // Overdue → due soon → later (all by deadline), then no deadline by name.
  if (a.deadlineUtc && b.deadlineUtc) return new Date(a.deadlineUtc).getTime() - new Date(b.deadlineUtc).getTime() || a.name.localeCompare(b.name)
  if (a.deadlineUtc) return -1
  if (b.deadlineUtc) return 1
  return a.name.localeCompare(b.name)
}

export async function renderLiveList(i: LiveListInput): Promise<RenderedList> {
  const open = [...i.open].sort(byOpenOrder)
  const done = [...i.done].sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime())
  const header = `📋 <b>${escapeHtml(i.siteName)}</b> — ${done.length} of ${open.length + done.length} done`
  const openLines = open.map((o) => {
    const parts = [`${listIcon(o.deadlineUtc, i.now)} ${escapeHtml(o.name)}`]
    if (o.deadlineUtc) parts.push(`due ${hhmm(o.deadlineUtc, i.tz)}`)
    if (!o.url) parts.push('app only')
    return parts.join(' · ')
  })
  const doneLines = done.map((x) => `✅ ${escapeHtml(x.name)} · ${hhmm(x.completedAt, i.tz)}${x.by ? ` ${escapeHtml(x.by)}` : ''}`)
  let text = [header, ...openLines, ...doneLines].join('\n')
  if (text.length > TEXT_MAX && done.length) text = [header, ...openLines, `✅ ${done.length} done`].join('\n')
  const keyboard: TgKeyboard = open.filter((o) => o.url).map((o) => [{ text: clip(`${listIcon(o.deadlineUtc, i.now)} ${o.name}`, BUTTON_MAX), url: o.url! }])
  return { text, keyboard, hash: await sha256Hex(JSON.stringify({ text, keyboard })), openCount: open.length, doneCount: done.length }
}

export type RefreshDecision = 'delete_stale' | 'delete_done' | 'unchanged' | 'edit'

/** Spec §4 refresh steps 1–4, in order. */
export function refreshDecision(a: { listDate: string; today: string; openCount: number; storedHash: string | null; newHash: string }): RefreshDecision {
  if (a.listDate !== a.today) return 'delete_stale'
  if (a.openCount === 0) return 'delete_done'
  if (a.storedHash === a.newHash) return 'unchanged'
  return 'edit'
}

/** Sites that get a list for a group: at least one active mapped checklist applies there. */
export function sitesForGroup<S extends { id: string }>(templates: Pick<Template, 'site_id' | 'active'>[], sites: S[]): S[] {
  return sites.filter((s) => templates.some((t) => t.active && (t.site_id === null || t.site_id === s.id)))
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/whatsapp/__tests__/live-list.test.ts src/lib/whatsapp/__tests__/due.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Typecheck** — `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `4`; `cd supabase/functions && deno check whatsapp-reminders/index.ts telegram-webhook/index.ts` → ok.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/checklists-core/due.ts supabase/functions/_shared/channels/live-list.ts src/lib/whatsapp/__tests__/live-list.test.ts
git commit -m "feat(telegram): pure live-list renderer and refresh decision

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Group data layer — `GroupDeps`, Supabase implementation, shared channel-only members

**Files:**
- Create: `supabase/functions/_shared/channels/members.ts`
- Create: `supabase/functions/_shared/channels/groups-db.ts`
- Modify: `supabase/functions/team-create-channel-member/index.ts`
- Test: `src/lib/whatsapp/__tests__/groups-db.test.ts`

**Interfaces:**
- Consumes: `pageAll`, `hashExternalId` from `db.ts`; `SiteInfo` from `bot.ts`; `CoreDb` from `checklists-core/record.ts`; types from `checklists-core/types.ts`; DB from Task 1.
- Produces:

```ts
// members.ts
export function telegramDisplayName(first: string, last: string): string                 // "Anna S." | "Anna" | "Smith" | "Telegram user", ≤ 80 chars
export function pickStaffRole(roles: { id: string; base_tier: string; is_system: boolean }[]): { id: string; base_tier: string } | null
export async function defaultStaffRole(admin: any, businessId: string): Promise<{ id: string; base_tier: string } | null>
export async function createChannelOnlyMember(admin: any, a: { businessId: string; siteId: string; roleId: string; roleTier: string; fullName: string; emailPrefix: 'wa' | 'tg' }): Promise<{ ok: true; profileId: string } | { ok: false; error: 'create' | 'profile' | 'membership' }>
export async function rollbackMember(admin: any, pid: string, deleteProfile: boolean): Promise<void>

// groups-db.ts
export type GroupChannel = 'telegram' | 'whatsapp'   // channel-neutral model (spec §9); only 'telegram' is implemented
export interface ChannelGroup { id: string; business_id: string; channel: GroupChannel; chat_id: string; title: string; alerts: boolean }
export interface LiveListRow { id: string; group_id: string; site_id: string; list_date: string; message_id: string; tokens: Record<string, string>; rendered_hash: string | null }
export interface GroupFormToken {
  token: string; kind: 'group_checklist'; business_id: string; group_id: string; site_id: string; template_id: string
  item_ids: string[]; expires_at: string; used_at: string | null; used_by_name: string | null
}
export interface CompletionWho extends CompletionLite { completed_by: string | null }
export type ReminderKey = { template_id: string; period_key: string }
export interface GroupDeps extends CoreDb {
  now(): Date
  newToken(): string
  claimInbound(updateId: string): Promise<boolean>                              // false = duplicate webhook delivery
  ready(businessId: string): Promise<boolean>                                   // channel_ready(b, 'telegram')
  businessName(businessId: string): Promise<string>
  groupByChat(chatId: string): Promise<ChannelGroup | null>                          // linked groups only
  groupById(groupId: string): Promise<ChannelGroup | null>                           // linked groups only
  linkedGroups(): Promise<ChannelGroup[]>
  alertGroups(businessId: string): Promise<ChannelGroup[]>                           // linked, alerts = true
  claimGroupLinkCode(code: string, now: Date): Promise<{ business_id: string; issued_by: string } | null>   // atomic; sets used_at = now
  releaseGroupLinkCode(code: string, usedAtIso: string): Promise<void>
  linkFailures(chatId: string, since: Date): Promise<number>
  recordLinkFailure(chatId: string, at: Date): Promise<void>
  linkGroup(a: { business_id: string; chat_id: string; title: string; linked_by: string; now: Date }): Promise<ChannelGroup>   // insert or relink; new business → mappings cleared, alerts off
  markGroupUnlinked(groupId: string, now: Date): Promise<void>
  migrateGroupChat(oldChatId: string, newChatId: string): Promise<void>
  claimPermissionCheck(groupId: string, now: Date): Promise<boolean>            // true at most once per 24 h
  claimPermissionWarning(groupId: string, now: Date): Promise<boolean>          // true at most once per 24 h
  mappedTemplates(groupId: string): Promise<Template[]>                         // active templates mapped to the group
  sites(businessId: string): Promise<SiteInfo[]>                                // non-removed sites
  completionsSince(businessId: string, since: Date): Promise<CompletionWho[]>
  firstNames(profileIds: string[]): Promise<Map<string, string>>
  items(templateId: string): Promise<TemplateItem[]>
  liveLists(groupId: string): Promise<LiveListRow[]>
  orphanLiveLists(): Promise<{ row: LiveListRow; chat_id: string }[]>           // lists of unlinked groups
  saveLiveList(r: Omit<LiveListRow, 'id'>): Promise<void>                       // upsert on (group_id, site_id)
  updateLiveList(id: string, patch: { tokens: Record<string, string>; rendered_hash: string }): Promise<void>
  deleteLiveList(id: string): Promise<void>
  saveGroupToken(t: GroupFormToken): Promise<void>
  peekGroupToken(token: string): Promise<GroupFormToken | null>                 // kind 'group_checklist' only, any state
  takeGroupToken(token: string, now: Date, byName: string): Promise<GroupFormToken | null>   // atomic first-submit-wins
  releaseGroupToken(token: string, usedAtIso: string): Promise<void>
  claimGroupReminders(groupId: string, siteId: string, keys: ReminderKey[]): Promise<Set<string>>   // newly claimed `${template_id}:${period_key}`
  releaseGroupReminders(groupId: string, siteId: string, keys: ReminderKey[]): Promise<void>
  person(profileId: string): Promise<Person | null>
  telegramIdentity(businessId: string, tgUserId: string): Promise<{ profile_id: string } | null>   // active identity of an active profile
  createTelegramPerson(a: { businessId: string; siteId: string; tgUserId: string; displayName: string }): Promise<{ profile_id: string; created: boolean }>
}
export function makeGroupDeps(admin: any, channel?: GroupChannel): GroupDeps   // bound to one channel (default 'telegram'); every group query filters on it
export async function notifyManagers(d: Pick<CoreDb, 'managerIds' | 'insertNotifications'>, businessId: string, n: { title: string; message: string; link: string }): Promise<void>   // type 'team'
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/whatsapp/__tests__/groups-db.test.ts
import { describe, it, expect } from 'vitest'
import { telegramDisplayName, pickStaffRole, createChannelOnlyMember } from '../../../../supabase/functions/_shared/channels/members'
import { notifyManagers } from '../../../../supabase/functions/_shared/channels/groups-db'

describe('telegramDisplayName', () => {
  it.each([
    ['Anna', 'Smith', 'Anna S.'],
    ['  Anna  ', '', 'Anna'],
    ['', 'Smith', 'Smith'],
    ['', '', 'Telegram user'],
    ['Ána', 'élan', 'Ána É.'],
    ['Mary  Jane', 'Watson', 'Mary Jane W.'],
  ])('%s / %s → %s', (f, l, want) => expect(telegramDisplayName(f, l)).toBe(want))
  it('is at most 80 characters', () => expect([...telegramDisplayName('A'.repeat(100), 'B')]).toHaveLength(80))
})

describe('pickStaffRole', () => {
  it('prefers the system kitchen_staff role, then any kitchen_staff, then any non-manager role', () => {
    expect(pickStaffRole([{ id: 'm', base_tier: 'manager', is_system: true }, { id: 'k2', base_tier: 'kitchen_staff', is_system: false }, { id: 'k', base_tier: 'kitchen_staff', is_system: true }]))
      .toEqual({ id: 'k', base_tier: 'kitchen_staff' })
    expect(pickStaffRole([{ id: 'k2', base_tier: 'kitchen_staff', is_system: false }])).toEqual({ id: 'k2', base_tier: 'kitchen_staff' })
    expect(pickStaffRole([{ id: 'm', base_tier: 'manager', is_system: true }, { id: 'f', base_tier: 'front_of_house', is_system: true }])).toEqual({ id: 'f', base_tier: 'front_of_house' })
    expect(pickStaffRole([{ id: 'm', base_tier: 'manager', is_system: true }])).toBeNull()
  })
})

function fakeAdmin(fail: { create?: boolean; profile?: boolean; membership?: boolean } = {}) {
  const calls: string[] = []
  const admin = {
    auth: { admin: {
      createUser: async (a: any) => {
        calls.push(`createUser ${a.email.split('+')[0]} ${a.user_metadata.full_name} ${a.ban_duration} ${a.app_metadata.channel_only}`)
        return fail.create ? { data: { user: null }, error: { message: 'x' } } : { data: { user: { id: 'u1' } }, error: null }
      },
      deleteUser: async (id: string) => { calls.push(`deleteUser ${id}`); return { error: null } },
    } },
    from: (t: string) => ({
      insert: async (row: any) => { calls.push(`insert ${t} ${row.full_name} ${row.role} ${row.role_id} ${row.business_id} ${row.site_id}`); return { error: fail.profile ? { message: 'x' } : null } },
      upsert: async (row: any) => { calls.push(`upsert ${t} ${row.profile_id} ${row.site_id}`); return { error: fail.membership ? { message: 'x' } : null } },
      delete: () => ({ eq: async (_c: string, v: string) => { calls.push(`delete ${t} ${v}`); return { error: null } } }),
    }),
  }
  return { admin, calls }
}
const ARGS = { businessId: 'b', siteId: 's1', roleId: 'r-ks', roleTier: 'kitchen_staff', fullName: 'Anna S.', emailPrefix: 'tg' as const }

describe('createChannelOnlyMember', () => {
  it('creates a banned, password-less auth user, a profile and the site membership', async () => {
    const f = fakeAdmin()
    expect(await createChannelOnlyMember(f.admin, ARGS)).toEqual({ ok: true, profileId: 'u1' })
    expect(f.calls).toEqual([
      'createUser tg Anna S. 876000h true',
      'insert profiles Anna S. kitchen_staff r-ks b s1',
      'upsert member_sites u1 s1',
    ])
  })
  it('rolls back on failure', async () => {
    expect(await createChannelOnlyMember(fakeAdmin({ create: true }).admin, ARGS)).toEqual({ ok: false, error: 'create' })
    const p = fakeAdmin({ profile: true })
    expect(await createChannelOnlyMember(p.admin, ARGS)).toEqual({ ok: false, error: 'profile' })
    expect(p.calls.slice(-1)).toEqual(['deleteUser u1'])
    const m = fakeAdmin({ membership: true })
    expect(await createChannelOnlyMember(m.admin, ARGS)).toEqual({ ok: false, error: 'membership' })
    expect(m.calls.slice(-2)).toEqual(['delete profiles u1', 'deleteUser u1'])
  })
})

describe('notifyManagers', () => {
  it('one team notification per active manager', async () => {
    const rows: any[] = []
    await notifyManagers({ managerIds: async () => ['m1', 'm2'], insertNotifications: async (r) => { rows.push(...r) } }, 'b', { title: 'T', message: 'M', link: '/team' })
    expect(rows).toEqual([
      { user_id: 'm1', type: 'team', title: 'T', message: 'M', link: '/team' },
      { user_id: 'm2', type: 'team', title: 'T', message: 'M', link: '/team' },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/groups-db.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `members.ts`**

```ts
// supabase/functions/_shared/channels/members.ts
// Channel-only team members: no email login, no password (banned auth user + profile + site membership).
// Used by team-create-channel-member (WhatsApp, created by a manager) and the Telegram group form (created on a
// person's first submit). `admin` = service-role supabase-js client, typed loosely. Never logs the synthetic email.
// deno-lint-ignore no-explicit-any
type Any = any

/** Telegram first name + last-name initial: "Anna S."; first name alone; last name alone; else "Telegram user". */
export function telegramDisplayName(first: string, last: string): string {
  const f = first.replace(/\s+/g, ' ').trim()
  const l = last.replace(/\s+/g, ' ').trim()
  const name = f ? (l ? `${f} ${[...l][0].toUpperCase()}.` : f) : (l || 'Telegram user')
  return [...name].slice(0, 80).join('')
}

export function pickStaffRole(roles: { id: string; base_tier: string; is_system: boolean }[]): { id: string; base_tier: string } | null {
  const r = roles.find((x) => x.base_tier === 'kitchen_staff' && x.is_system)
    ?? roles.find((x) => x.base_tier === 'kitchen_staff')
    ?? roles.find((x) => x.base_tier !== 'manager' && x.base_tier !== 'owner')
  return r ? { id: r.id, base_tier: r.base_tier } : null
}

export async function defaultStaffRole(admin: Any, businessId: string): Promise<{ id: string; base_tier: string } | null> {
  const { data, error } = await admin.from('roles').select('id, base_tier, is_system').eq('business_id', businessId).neq('base_tier', 'owner')
  if (error) throw error
  return pickStaffRole((data ?? []) as { id: string; base_tier: string; is_system: boolean }[])
}

/** Undo a half-created member. Logs the user id only when a step fails. */
export async function rollbackMember(admin: Any, pid: string, deleteProfile: boolean): Promise<void> {
  try {
    if (deleteProfile) {
      const { error } = await admin.from('profiles').delete().eq('id', pid)
      if (error) console.error('rollback: profile delete failed', pid)
    }
    const { error } = await admin.auth.admin.deleteUser(pid)
    if (error) console.error('rollback: deleteUser failed', pid)
  } catch (_e) {
    console.error('rollback: exception', pid)
  }
}

export async function createChannelOnlyMember(admin: Any, a: {
  businessId: string; siteId: string; roleId: string; roleTier: string; fullName: string; emailPrefix: 'wa' | 'tg'
}): Promise<{ ok: true; profileId: string } | { ok: false; error: 'create' | 'profile' | 'membership' }> {
  // Synthetic address: never logged, never used for login (no password set). The Team page shows "Chat only" for it.
  const email = `${a.emailPrefix}+${crypto.randomUUID()}@noreply.blueroll.app`
  const { data: created, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, ban_duration: '876000h', app_metadata: { channel_only: true }, user_metadata: { full_name: a.fullName },
  })
  if (error || !created?.user) return { ok: false, error: 'create' }
  const pid = created.user.id as string
  // No trigger on auth.users creates a profile (only the ntfy notifier), so INSERT, as join_with_invite does.
  const { error: pErr } = await admin.from('profiles').insert({
    id: pid, email, full_name: a.fullName, role: a.roleTier, role_id: a.roleId, business_id: a.businessId, site_id: a.siteId,
  })
  if (pErr) { await rollbackMember(admin, pid, false); return { ok: false, error: 'profile' } }
  const { error: mErr } = await admin.from('member_sites').upsert({ profile_id: pid, site_id: a.siteId }, { onConflict: 'profile_id,site_id', ignoreDuplicates: true })
  if (mErr) { await rollbackMember(admin, pid, true); return { ok: false, error: 'membership' } }
  return { ok: true, profileId: pid }
}
```

- [ ] **Step 4: Refactor `team-create-channel-member/index.ts` onto `members.ts`** — replace the whole file with (validation unchanged, error codes unchanged):

```ts
// Owner/manager creates a WhatsApp-only team member: no email login, no password.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createChannelOnlyMember } from "../_shared/channels/members.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json(401, { error: "auth" });
  const { data: me } = await admin.from("profiles").select("business_id, role").eq("id", u.user.id).is("removed_at", null).maybeSingle();
  if (!me || !me.business_id || !["owner", "manager"].includes(me.role)) return json(403, { error: "forbidden" });
  const body = (await req.json().catch(() => null)) ?? {};
  if (typeof body !== "object" || Array.isArray(body)) return json(400, { error: "body" });
  if (typeof body.role_id !== "string" || typeof body.site_id !== "string") return json(400, { error: "ids" });
  const name = typeof body.full_name === "string" ? body.full_name.trim().slice(0, 80) : "";
  if (!name) return json(400, { error: "name" });
  const { data: role } = await admin.from("roles").select("id, base_tier").eq("id", body.role_id).eq("business_id", me.business_id).maybeSingle();
  if (!role || role.base_tier === "owner") return json(400, { error: "role" });
  const { data: site } = await admin.from("sites").select("id").eq("id", body.site_id).eq("business_id", me.business_id).is("removed_at", null).maybeSingle();
  if (!site) return json(400, { error: "site" });

  const m = await createChannelOnlyMember(admin, {
    businessId: me.business_id, siteId: site.id, roleId: role.id, roleTier: role.base_tier, fullName: name, emailPrefix: "wa",
  });
  if (!m.ok) return json(500, { error: m.error });
  return json(200, { profile_id: m.profileId });
});
```

- [ ] **Step 5: Implement `groups-db.ts`**

```ts
// supabase/functions/_shared/channels/groups-db.ts
// Chat groups (channel-neutral tables, spec §9; only Telegram is implemented): the data contract (GroupDeps) for the
// group bot, live lists, cron and form API, plus its Supabase-backed implementation bound to one channel. `admin` = service-role supabase-js client (typed loosely to keep this import-free).
// Never log Telegram user ids; group chat ids are fine.
import type { CompletionLite, Person, Template, TemplateItem } from '../checklists-core/types.ts'
import type { CoreDb } from '../checklists-core/record.ts'
import type { SiteInfo } from './bot.ts'
import { hashExternalId, pageAll } from './db.ts'
import { createChannelOnlyMember, defaultStaffRole, rollbackMember } from './members.ts'

// deno-lint-ignore no-explicit-any
type Any = any

export type GroupChannel = 'telegram' | 'whatsapp'   // channel-neutral model (spec §9); only 'telegram' is implemented
export interface ChannelGroup { id: string; business_id: string; channel: GroupChannel; chat_id: string; title: string; alerts: boolean }
export interface LiveListRow {
  id: string; group_id: string; site_id: string; list_date: string; message_id: string
  tokens: Record<string, string>; rendered_hash: string | null
}
export interface GroupFormToken {
  token: string; kind: 'group_checklist'; business_id: string; group_id: string; site_id: string; template_id: string
  item_ids: string[]; expires_at: string; used_at: string | null; used_by_name: string | null
}
export interface CompletionWho extends CompletionLite { completed_by: string | null }
export type ReminderKey = { template_id: string; period_key: string }

export interface GroupDeps extends CoreDb {
  now(): Date
  newToken(): string
  claimInbound(updateId: string): Promise<boolean>
  ready(businessId: string): Promise<boolean>
  businessName(businessId: string): Promise<string>
  groupByChat(chatId: string): Promise<ChannelGroup | null>
  groupById(groupId: string): Promise<ChannelGroup | null>
  linkedGroups(): Promise<ChannelGroup[]>
  alertGroups(businessId: string): Promise<ChannelGroup[]>
  claimGroupLinkCode(code: string, now: Date): Promise<{ business_id: string; issued_by: string } | null>
  releaseGroupLinkCode(code: string, usedAtIso: string): Promise<void>
  linkFailures(chatId: string, since: Date): Promise<number>
  recordLinkFailure(chatId: string, at: Date): Promise<void>
  linkGroup(a: { business_id: string; chat_id: string; title: string; linked_by: string; now: Date }): Promise<ChannelGroup>
  markGroupUnlinked(groupId: string, now: Date): Promise<void>
  migrateGroupChat(oldChatId: string, newChatId: string): Promise<void>
  claimPermissionCheck(groupId: string, now: Date): Promise<boolean>
  claimPermissionWarning(groupId: string, now: Date): Promise<boolean>
  mappedTemplates(groupId: string): Promise<Template[]>
  sites(businessId: string): Promise<SiteInfo[]>
  completionsSince(businessId: string, since: Date): Promise<CompletionWho[]>
  firstNames(profileIds: string[]): Promise<Map<string, string>>
  items(templateId: string): Promise<TemplateItem[]>
  liveLists(groupId: string): Promise<LiveListRow[]>
  orphanLiveLists(): Promise<{ row: LiveListRow; chat_id: string }[]>
  saveLiveList(r: Omit<LiveListRow, 'id'>): Promise<void>
  updateLiveList(id: string, patch: { tokens: Record<string, string>; rendered_hash: string }): Promise<void>
  deleteLiveList(id: string): Promise<void>
  saveGroupToken(t: GroupFormToken): Promise<void>
  peekGroupToken(token: string): Promise<GroupFormToken | null>
  takeGroupToken(token: string, now: Date, byName: string): Promise<GroupFormToken | null>
  releaseGroupToken(token: string, usedAtIso: string): Promise<void>
  claimGroupReminders(groupId: string, siteId: string, keys: ReminderKey[]): Promise<Set<string>>
  releaseGroupReminders(groupId: string, siteId: string, keys: ReminderKey[]): Promise<void>
  person(profileId: string): Promise<Person | null>
  telegramIdentity(businessId: string, tgUserId: string): Promise<{ profile_id: string } | null>
  createTelegramPerson(a: { businessId: string; siteId: string; tgUserId: string; displayName: string }): Promise<{ profile_id: string; created: boolean }>
}

/** App notification (bell) to every active owner/manager. */
export async function notifyManagers(d: Pick<CoreDb, 'managerIds' | 'insertNotifications'>, businessId: string, n: { title: string; message: string; link: string }): Promise<void> {
  const ids = await d.managerIds(businessId)
  await d.insertNotifications(ids.map((user_id) => ({ user_id, type: 'team', title: n.title, message: n.message, link: n.link })))
}

const DAY_MS = 86400_000
const GROUP_COLS = 'id, business_id, channel, chat_id, title, alerts'
const LIST_COLS = 'id, group_id, site_id, list_date, message_id, tokens, rendered_hash'
const TOKEN_COLS = 'token, kind, business_id, group_id, site_id, template_id, item_ids, expires_at, used_at, used_by_name'
const TEMPLATE_COLS = 'id, business_id, site_id, name, frequency, deadline_time, multi_per_day, min_per_day, assigned_roles, assigned_role_ids, active'

export function makeGroupDeps(admin: Any, channel: GroupChannel = 'telegram'): GroupDeps {
  const one = async (q: Any) => { const { data, error } = await q; if (error) throw error; return data }
  const errMsg = (e: Any) => String(e?.message ?? e).slice(0, 200)
  const asList = (r: Any): LiveListRow => ({ ...r, tokens: r.tokens ?? {} })

  /** Atomic "at most once per 24 h" claim on a timestamp column (two UPDATEs = the OR, no filter strings). */
  const claimDaily = async (id: string, col: 'last_permission_check_at' | 'last_permission_warning_at', now: Date) => {
    const at = now.toISOString()
    const first = await one(admin.from('channel_groups').update({ [col]: at }).eq('id', id).is(col, null).select('id'))
    if (first?.length) return true
    const later = await one(admin.from('channel_groups').update({ [col]: at }).eq('id', id)
      .lt(col, new Date(now.getTime() - DAY_MS).toISOString()).select('id'))
    return !!later?.length
  }

  const telegramIdentity = async (b: string, uid: string) => {
    const id = await one(admin.from('channel_identities').select('profile_id')
      .eq('business_id', b).eq('channel', channel).eq('external_id', uid).is('revoked_at', null).maybeSingle())
    if (!id) return null
    const p = await one(admin.from('profiles').select('id').eq('id', id.profile_id).eq('business_id', b).is('removed_at', null).maybeSingle())
    return p ? { profile_id: id.profile_id as string } : null
  }

  return {
    now: () => new Date(),
    newToken: () => crypto.randomUUID().replace(/-/g, ''),

    claimInbound: async (updateId) => {
      const { error } = await admin.from('channel_messages_log').insert({
        business_id: null, site_id: null, profile_id: null, channel, direction: 'in', kind: 'group_update',
        billable: false, wa_message_id: `grp:${updateId}`,
      })
      if (!error) return true
      if (error.code === '23505') return false   // uq_channel_inbound_msg: already handled
      console.error('telegram inbound log failed', errMsg(error))
      return true
    },
    ready: async (b) => !!(await one(admin.rpc('channel_ready', { b, ch: channel }))),
    businessName: async (b) => (await one(admin.from('businesses').select('name').eq('id', b).maybeSingle()))?.name || 'your team',

    groupByChat: async (c) => (await one(admin.from('channel_groups').select(GROUP_COLS).eq('channel', channel).eq('chat_id', c).is('unlinked_at', null).maybeSingle())) ?? null,
    groupById: async (id) => (await one(admin.from('channel_groups').select(GROUP_COLS).eq('id', id).is('unlinked_at', null).maybeSingle())) ?? null,
    linkedGroups: () => pageAll<ChannelGroup>((from, to) => admin.from('channel_groups').select(GROUP_COLS).eq('channel', channel).is('unlinked_at', null).order('id').range(from, to)),
    alertGroups: async (b) => (await one(admin.from('channel_groups').select(GROUP_COLS).eq('channel', channel).eq('business_id', b).eq('alerts', true).is('unlinked_at', null))) ?? [],

    claimGroupLinkCode: async (code, now) => {
      const nowIso = now.toISOString()
      const rows = await one(admin.from('channel_group_link_codes').update({ used_at: nowIso })
        .eq('channel', channel).eq('code', code).is('used_at', null).gt('expires_at', nowIso).select('business_id, issued_by'))
      return rows?.[0] ?? null
    },
    releaseGroupLinkCode: async (code, at) => {
      await one(admin.from('channel_group_link_codes').update({ used_at: null }).eq('code', code).eq('used_at', at))
    },
    linkFailures: async (chatId, since) => {
      const { count, error } = await admin.from('channel_messages_log').select('id', { count: 'exact', head: true })
        .eq('kind', 'group_link_fail').eq('ref_id', await hashExternalId(chatId)).gte('created_at', since.toISOString())
      if (error) throw error
      return count ?? 0
    },
    recordLinkFailure: async (chatId, at) => {
      await one(admin.from('channel_messages_log').insert({
        business_id: null, site_id: null, profile_id: null, channel, direction: 'in', kind: 'group_link_fail',
        billable: false, ref_id: await hashExternalId(chatId), created_at: at.toISOString(),
      }))
    },
    linkGroup: async (a) => {
      const at = a.now.toISOString()
      const existing = await one(admin.from('channel_groups').select('id, business_id').eq('channel', channel).eq('chat_id', a.chat_id).maybeSingle())
      if (!existing) {
        return await one(admin.from('channel_groups').insert({
          business_id: a.business_id, channel, chat_id: a.chat_id, title: a.title, linked_by: a.linked_by, linked_at: at,
        }).select(GROUP_COLS).single())
      }
      const moved = existing.business_id !== a.business_id
      // Relinked to another business: the old business's checklist choices and alerts flag don't carry over.
      if (moved) await one(admin.from('channel_group_checklists').delete().eq('group_id', existing.id))
      return await one(admin.from('channel_groups').update({
        business_id: a.business_id, title: a.title, linked_by: a.linked_by, linked_at: at, unlinked_at: null,
        ...(moved ? { alerts: false } : {}),
      }).eq('id', existing.id).select(GROUP_COLS).single())
    },
    markGroupUnlinked: async (id, now) => {
      await one(admin.from('channel_groups').update({ unlinked_at: now.toISOString() }).eq('id', id).is('unlinked_at', null))
    },
    migrateGroupChat: async (oldId, newId) => {
      const { error } = await admin.from('channel_groups').update({ chat_id: newId }).eq('channel', channel).eq('chat_id', oldId)
      if (error) console.error('telegram group migrate failed', oldId, errMsg(error))
    },
    claimPermissionCheck: (id, now) => claimDaily(id, 'last_permission_check_at', now),
    claimPermissionWarning: (id, now) => claimDaily(id, 'last_permission_warning_at', now),

    mappedTemplates: async (gid) => {
      const rows = await one(admin.from('channel_group_checklists').select(`template:checklist_templates(${TEMPLATE_COLS})`).eq('group_id', gid))
      return ((rows ?? []) as Any[]).map((r) => r.template).filter((t) => t && t.active)
        .map((t) => ({ ...t, assigned_roles: t.assigned_roles ?? [], assigned_role_ids: t.assigned_role_ids ?? [] }))
    },
    sites: async (b) => ((await one(admin.from('sites').select('id, name, timezone, status').eq('business_id', b).is('removed_at', null))) ?? [])
      .filter((s: Any) => s.status !== 'removed')
      .map((s: Any) => ({ id: s.id, name: s.name ?? '', timezone: s.timezone ?? 'Europe/London' })),
    // Paged: a busy business easily has >1000 completions in a month (PostgREST row cap).
    completionsSince: (b, since) => pageAll<CompletionWho>((from, to) => admin.from('checklist_completions')
      .select('template_id, site_id, completed_at, completed_by').eq('business_id', b).gte('completed_at', since.toISOString())
      .order('completed_at', { ascending: false }).order('id', { ascending: false }).range(from, to)),
    firstNames: async (ids) => {
      if (!ids.length) return new Map()
      const rows = await one(admin.from('profiles').select('id, full_name').in('id', ids))
      return new Map(((rows ?? []) as Any[]).map((p) => [p.id as string, String(p.full_name ?? '').trim().split(/\s+/)[0] ?? '']))
    },
    items: async (tid) => (await one(admin.from('checklist_template_items')
      .select('id, name, item_type, required, min_value, max_value, unit, sort_order').eq('template_id', tid))) ?? [],

    liveLists: async (gid) => ((await one(admin.from('channel_live_lists').select(LIST_COLS).eq('group_id', gid))) ?? []).map(asList),
    orphanLiveLists: async () => {
      const rows = await one(admin.from('channel_live_lists').select(`${LIST_COLS}, group:channel_groups!inner(channel, chat_id, unlinked_at)`)
        .eq('group.channel', channel).not('group.unlinked_at', 'is', null))
      return ((rows ?? []) as Any[]).map(({ group, ...row }) => ({ row: asList(row), chat_id: group.chat_id as string }))
    },
    saveLiveList: async (r) => {
      await one(admin.from('channel_live_lists').upsert({ ...r, updated_at: new Date().toISOString() }, { onConflict: 'group_id,site_id' }))
    },
    updateLiveList: async (id, p) => {
      await one(admin.from('channel_live_lists').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id))
    },
    deleteLiveList: async (id) => { await one(admin.from('channel_live_lists').delete().eq('id', id)) },

    saveGroupToken: async (t) => { await one(admin.from('channel_form_tokens').insert({ ...t, profile_id: null, response_id: null })) },
    peekGroupToken: async (tok) => {
      const r = await one(admin.from('channel_form_tokens').select(TOKEN_COLS).eq('token', tok).maybeSingle())
      return r && r.kind === 'group_checklist' ? { ...r, item_ids: r.item_ids ?? [] } : null
    },
    // One atomic UPDATE: the first submit takes the token and records the winner's first name.
    takeGroupToken: async (tok, now, byName) => {
      const nowIso = now.toISOString()
      const rows = await one(admin.from('channel_form_tokens').update({ used_at: nowIso, used_by_name: byName })
        .eq('token', tok).eq('kind', 'group_checklist').is('used_at', null).gt('expires_at', nowIso).select(TOKEN_COLS))
      const r = rows?.[0]
      return r ? { ...r, item_ids: r.item_ids ?? [] } : null
    },
    releaseGroupToken: async (tok, at) => {
      await one(admin.from('channel_form_tokens').update({ used_at: null, used_by_name: null }).eq('token', tok).eq('used_at', at))
    },

    claimGroupReminders: async (gid, sid, keys) => {
      if (!keys.length) return new Set<string>()
      const rows = await one(admin.from('channel_group_reminders_sent')
        .upsert(keys.map((k) => ({ group_id: gid, site_id: sid, template_id: k.template_id, period_key: k.period_key })),
          { onConflict: 'group_id,template_id,site_id,period_key', ignoreDuplicates: true })
        .select('template_id, period_key'))
      return new Set(((rows ?? []) as Any[]).map((r) => `${r.template_id}:${r.period_key}`))
    },
    releaseGroupReminders: async (gid, sid, keys) => {
      for (const k of keys) {
        const { error } = await admin.from('channel_group_reminders_sent').delete()
          .eq('group_id', gid).eq('site_id', sid).eq('template_id', k.template_id).eq('period_key', k.period_key)
        if (error) console.error('group reminder key release failed', gid, k.template_id, errMsg(error))
      }
    },

    person: async (pid) => {
      const p = await one(admin.from('profiles').select('id, business_id, full_name, role, role_id').eq('id', pid).is('removed_at', null).maybeSingle())
      return p && p.business_id
        ? { profile_id: p.id, business_id: p.business_id, full_name: p.full_name ?? '', role: p.role, role_id: p.role_id ?? null }
        : null
    },
    telegramIdentity,
    createTelegramPerson: async (a) => {
      const role = await defaultStaffRole(admin, a.businessId)
      if (!role) throw new Error('no staff role to give a new group member')
      const m = await createChannelOnlyMember(admin, {
        businessId: a.businessId, siteId: a.siteId, roleId: role.id, roleTier: role.base_tier, fullName: a.displayName, emailPrefix: 'tg',
      })
      if (!m.ok) throw new Error(`${channel} member: ${m.error}`)
      const { error } = await admin.from('channel_identities').insert({
        business_id: a.businessId, profile_id: m.profileId, channel, external_id: a.tgUserId,
        consent_source: 'group_form', consent_text_version: 1, last_inbound_at: new Date().toISOString(),
      })
      if (!error) return { profile_id: m.profileId, created: true }
      await rollbackMember(admin, m.profileId, true)
      if (error.code === '23505') {
        // The same person submitted two checks at once: the other request created them first.
        const other = await telegramIdentity(a.businessId, a.tgUserId)
        if (other) return { profile_id: other.profile_id, created: false }
      }
      throw error
    },

    insertCompletion: async (row) => await one(admin.from('checklist_completions').insert(row).select('id').single()),
    insertResponses: async (rows) => rows.length ? ((await one(admin.from('checklist_responses').insert(rows).select('id, item_id'))) ?? []) : [],
    managerIds: async (b) => ((await one(admin.from('profiles').select('id').eq('business_id', b).in('role', ['owner', 'manager']).is('removed_at', null))) ?? [])
      .map((p: Any) => p.id),
    insertNotifications: async (rows) => { if (rows.length) await one(admin.from('notifications').insert(rows)) },
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/whatsapp/__tests__/groups-db.test.ts && npm test`
Expected: PASS.

- [ ] **Step 7: Typecheck** — `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `4`; `cd supabase/functions && deno check team-create-channel-member/index.ts && deno check _shared/channels/groups-db.ts` → ok.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/channels/members.ts supabase/functions/_shared/channels/groups-db.ts supabase/functions/team-create-channel-member/index.ts src/lib/whatsapp/__tests__/groups-db.test.ts
git commit -m "feat(telegram): group data layer and shared channel-only member creation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Live-list service — build, repost, refresh, unlink (+ shared test fakes)

**Files:**
- Create: `supabase/functions/_shared/channels/tg-live.ts`
- Create: `src/lib/whatsapp/__tests__/fakes/group-deps.ts` (in-memory `GroupDeps` + Bot API fake; reused by Tasks 6–8)
- Test: `src/lib/whatsapp/__tests__/tg-live.test.ts`

**Interfaces:**
- Consumes: `GroupDeps`, `ChannelGroup`, `LiveListRow`, `GroupFormToken` from `groups-db.ts` (Task 4); `TgApi`, `TgApiResult`, `miniAppLink`, `tgHtml`, `tgEditHtml`, `tgOutcome` from `telegram.ts` (Task 2); `renderLiveList`, `refreshDecision`, `localDate`, `sitesForGroup`, `OpenLine`, `DoneLine`, `RenderedList` from `live-list.ts` and `dueAtSite` from `due.ts` (Task 3); `telegramFormItemIds`, `SiteInfo` from `bot.ts`; `completionsWindowStart` from `due.ts`; `periodStartUtc` from `time.ts`.
- Produces (`tg-live.ts`):

```ts
export const GROUP_TOKEN_TTL_MS: number   // 24 h
export type ListOutcome = 'posted' | 'empty' | 'edited' | 'unchanged' | 'deleted' | 'failed' | 'unlinked'
export async function buildList(d: GroupDeps, group: ChannelGroup, site: SiteInfo, now: Date, prevTokens: Record<string, string>): Promise<{ rendered: RenderedList; tokens: Record<string, string> }>
export async function deleteListMessage(api: TgApi, chatId: string, messageId: string): Promise<void>          // best effort
export async function repostList(d: GroupDeps, api: TgApi, group: ChannelGroup, site: SiteInfo, now: Date): Promise<ListOutcome>    // 'posted' | 'empty' | 'failed' | 'unlinked'
export async function repostGroup(d: GroupDeps, api: TgApi, group: ChannelGroup, now: Date): Promise<ListOutcome[]>                // every site of the group
export async function refreshList(d: GroupDeps, api: TgApi, group: ChannelGroup, row: LiveListRow, site: SiteInfo | null, now: Date): Promise<ListOutcome>
export async function refreshGroupSite(d: GroupDeps, api: TgApi, groupId: string, siteId: string, now: Date): Promise<ListOutcome | null>   // null = no list there
export async function unlinkGroup(d: GroupDeps, api: TgApi, group: ChannelGroup, now: Date): Promise<void>      // delete its lists (best effort) + mark unlinked
```

- Produces (`fakes/group-deps.ts`, test-only): `NOW`, `GROUP`, `SITE`, `TEMP_ITEM`, `tpl(o)`, `fakeGroupDeps(init?, over?) → { d: GroupDeps; s: FakeState }`, `fakeTgApi(respond?) → { api: TgApi; calls: { method: string; body: any }[] }` (sendMessage returns `message_id` 101, 102, …), `FakeState` as written below.

- [ ] **Step 1: Write the shared fakes**

```ts
// src/lib/whatsapp/__tests__/fakes/group-deps.ts
// In-memory GroupDeps + Bot API fake for the Telegram group tests (live list, group bot, cron, form API).
import type { GroupDeps, GroupFormToken, LiveListRow, ChannelGroup, CompletionWho } from '../../../../../supabase/functions/_shared/channels/groups-db'
import type { TgApi, TgApiResult } from '../../../../../supabase/functions/_shared/channels/telegram'
import type { Person, Template, TemplateItem } from '../../../../../supabase/functions/_shared/checklists-core/types'
import type { SiteInfo } from '../../../../../supabase/functions/_shared/channels/bot'

export const NOW = new Date('2026-10-14T09:40:00Z')   // 10:40 Europe/London (BST)
export const GROUP: ChannelGroup = { id: 'g1', business_id: 'b', channel: 'telegram', chat_id: '-1001', title: 'Kitchen', alerts: false }
export const SITE: SiteInfo = { id: 's1', name: 'Wharf Side', timezone: 'Europe/London' }
export const TEMP_ITEM: TemplateItem = { id: 'i1', name: 'Walk-in fridge', item_type: 'temperature', required: true, min_value: 0, max_value: 5, unit: '°C', sort_order: 0 }
export const tpl = (o: Partial<Template> & { id: string; name: string }): Template => ({
  business_id: 'b', site_id: null, frequency: 'daily', deadline_time: null, multi_per_day: false, min_per_day: null,
  assigned_roles: [], assigned_role_ids: [], active: true, ...o,
})

type GroupRow = ChannelGroup & { unlinked_at: string | null; linked_by: string | null; perm_check: string | null; perm_warn: string | null }
export interface FakeState {
  groups: GroupRow[]
  mappings: { group_id: string; template_id: string }[]
  templates: Template[]
  items: Record<string, TemplateItem[]>
  sites: SiteInfo[]
  completions: CompletionWho[]
  names: Record<string, string>
  lists: LiveListRow[]
  tokens: GroupFormToken[]
  codes: { code: string; business_id: string; issued_by: string; expires_at: string; used_at: string | null }[]
  linkFails: { chatId: string; at: Date }[]
  reminders: Set<string>
  inbound: Set<string>
  ready: Record<string, boolean>
  businessNames: Record<string, string>
  identities: { business_id: string; tg_user_id: string; profile_id: string }[]
  people: Person[]
  created: { businessId: string; siteId: string; tgUserId: string; displayName: string }[]
  completionRows: any[]
  responses: any[]
  notifications: any[]
}

export const groupRow = (g: ChannelGroup, o: Partial<GroupRow> = {}): GroupRow => ({ ...g, unlinked_at: null, linked_by: 'm1', perm_check: null, perm_warn: null, ...o })

export function fakeGroupDeps(init: Partial<FakeState> = {}, over: Partial<GroupDeps> = {}) {
  const s: FakeState = {
    groups: [groupRow(GROUP)], mappings: [], templates: [], items: {}, sites: [SITE], completions: [], names: {}, lists: [],
    tokens: [], codes: [], linkFails: [], reminders: new Set(), inbound: new Set(), ready: { b: true }, businessNames: { b: 'Fern & Fig' },
    identities: [], people: [], created: [], completionRows: [], responses: [], notifications: [], ...init,
  }
  let tokN = 0; let listN = 0; let personN = 0
  const DAY = 86400_000
  const pub = (g: GroupRow): ChannelGroup => ({ id: g.id, business_id: g.business_id, channel: g.channel, chat_id: g.chat_id, title: g.title, alerts: g.alerts })
  const daily = (g: GroupRow, k: 'perm_check' | 'perm_warn', now: Date) => {
    if (g[k] && now.getTime() - new Date(g[k]!).getTime() < DAY) return false
    g[k] = now.toISOString(); return true
  }
  const d: GroupDeps = {
    now: () => NOW,
    newToken: () => `tok${++tokN}`,
    claimInbound: async (id) => { if (s.inbound.has(id)) return false; s.inbound.add(id); return true },
    ready: async (b) => !!s.ready[b],
    businessName: async (b) => s.businessNames[b] ?? 'your team',
    groupByChat: async (c) => { const g = s.groups.find((x) => x.chat_id === c && !x.unlinked_at); return g ? pub(g) : null },
    groupById: async (id) => { const g = s.groups.find((x) => x.id === id && !x.unlinked_at); return g ? pub(g) : null },
    linkedGroups: async () => s.groups.filter((g) => !g.unlinked_at).map(pub),
    alertGroups: async (b) => s.groups.filter((g) => g.business_id === b && g.alerts && !g.unlinked_at).map(pub),
    claimGroupLinkCode: async (code, now) => {
      const c = s.codes.find((x) => x.code === code && !x.used_at && new Date(x.expires_at) > now)
      if (!c) return null
      c.used_at = now.toISOString()
      return { business_id: c.business_id, issued_by: c.issued_by }
    },
    releaseGroupLinkCode: async (code, at) => { const c = s.codes.find((x) => x.code === code && x.used_at === at); if (c) c.used_at = null },
    linkFailures: async (chatId, since) => s.linkFails.filter((f) => f.chatId === chatId && f.at >= since).length,
    recordLinkFailure: async (chatId, at) => { s.linkFails.push({ chatId, at }) },
    linkGroup: async (a) => {
      let g = s.groups.find((x) => x.chat_id === a.chat_id)
      if (g) {
        if (g.business_id !== a.business_id) { const id = g.id; s.mappings = s.mappings.filter((m) => m.group_id !== id); g.alerts = false }
        Object.assign(g, { business_id: a.business_id, title: a.title, linked_by: a.linked_by, unlinked_at: null })
      } else {
        g = groupRow({ id: `g${s.groups.length + 1}`, business_id: a.business_id, channel: 'telegram', chat_id: a.chat_id, title: a.title, alerts: false }, { linked_by: a.linked_by })
        s.groups.push(g)
      }
      return pub(g)
    },
    markGroupUnlinked: async (id, now) => { const g = s.groups.find((x) => x.id === id && !x.unlinked_at); if (g) g.unlinked_at = now.toISOString() },
    migrateGroupChat: async (o, n) => { for (const g of s.groups) if (g.chat_id === o) g.chat_id = n },
    claimPermissionCheck: async (id, now) => daily(s.groups.find((x) => x.id === id)!, 'perm_check', now),
    claimPermissionWarning: async (id, now) => daily(s.groups.find((x) => x.id === id)!, 'perm_warn', now),
    mappedTemplates: async (gid) => s.templates.filter((t) => t.active && s.mappings.some((m) => m.group_id === gid && m.template_id === t.id)),
    sites: async () => s.sites,
    completionsSince: async (_b, since) => s.completions.filter((c) => new Date(c.completed_at) >= since),
    // s.names first, else the first word of a fake person's full name (as the real query does).
    firstNames: async (ids) => new Map(ids.flatMap((i) => {
      const n = s.names[i] ?? s.people.find((p) => p.profile_id === i)?.full_name.split(' ')[0]
      return n ? [[i, n] as [string, string]] : []
    })),
    items: async (tid) => s.items[tid] ?? [TEMP_ITEM],
    liveLists: async (gid) => s.lists.filter((l) => l.group_id === gid).map((l) => ({ ...l })),
    orphanLiveLists: async () => s.lists.flatMap((l) => {
      const g = s.groups.find((x) => x.id === l.group_id)
      return g?.unlinked_at ? [{ row: { ...l }, chat_id: g.chat_id }] : []
    }),
    saveLiveList: async (r) => {
      const i = s.lists.findIndex((l) => l.group_id === r.group_id && l.site_id === r.site_id)
      const row = { id: i >= 0 ? s.lists[i].id : `l${++listN}`, ...r }
      if (i >= 0) s.lists[i] = row; else s.lists.push(row)
    },
    updateLiveList: async (id, p) => { const l = s.lists.find((x) => x.id === id); if (l) Object.assign(l, p) },
    deleteLiveList: async (id) => { s.lists = s.lists.filter((l) => l.id !== id) },
    saveGroupToken: async (t) => { s.tokens.push({ ...t }) },
    peekGroupToken: async (tok) => { const t = s.tokens.find((x) => x.token === tok); return t ? { ...t } : null },
    takeGroupToken: async (tok, now, by) => {
      const t = s.tokens.find((x) => x.token === tok)
      if (!t || t.used_at || new Date(t.expires_at) <= now) return null
      t.used_at = now.toISOString(); t.used_by_name = by
      return { ...t }
    },
    releaseGroupToken: async (tok, at) => { const t = s.tokens.find((x) => x.token === tok && x.used_at === at); if (t) { t.used_at = null; t.used_by_name = null } },
    claimGroupReminders: async (gid, sid, keys) => {
      const out = new Set<string>()
      for (const k of keys) {
        const key = `${gid}:${k.template_id}:${sid}:${k.period_key}`
        if (!s.reminders.has(key)) { s.reminders.add(key); out.add(`${k.template_id}:${k.period_key}`) }
      }
      return out
    },
    releaseGroupReminders: async (gid, sid, keys) => { for (const k of keys) s.reminders.delete(`${gid}:${k.template_id}:${sid}:${k.period_key}`) },
    person: async (pid) => s.people.find((p) => p.profile_id === pid) ?? null,
    telegramIdentity: async (b, uid) => {
      const i = s.identities.find((x) => x.business_id === b && x.tg_user_id === uid)
      return i && s.people.some((p) => p.profile_id === i.profile_id) ? { profile_id: i.profile_id } : null
    },
    createTelegramPerson: async (a) => {
      const existing = s.identities.find((x) => x.business_id === a.businessId && x.tg_user_id === a.tgUserId)
      if (existing) return { profile_id: existing.profile_id, created: false }
      const pid = `new${++personN}`
      s.created.push({ ...a })
      s.people.push({ profile_id: pid, business_id: a.businessId, full_name: a.displayName, role: 'kitchen_staff', role_id: 'r-staff' })
      s.identities.push({ business_id: a.businessId, tg_user_id: a.tgUserId, profile_id: pid })
      return { profile_id: pid, created: true }
    },
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
    managerIds: async () => ['m1'],
    insertNotifications: async (rows) => { s.notifications.push(...rows) },
    ...over,
  }
  return { d, s }
}

/** Bot API fake: every call succeeds unless `respond` returns an override; sendMessage → message_id 101, 102, … */
export function fakeTgApi(respond: (method: string, body: any) => Partial<TgApiResult> | undefined = () => undefined) {
  const calls: { method: string; body: any }[] = []
  let mid = 100
  const api: TgApi = async (method, body) => {
    calls.push({ method, body })
    const r = respond(method, body)
    const base: TgApiResult = { ok: true, status: 200, description: '', result: method === 'sendMessage' ? { message_id: ++mid } : true, migrateTo: null }
    return { ...base, ...r }
  }
  return { api, calls }
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/whatsapp/__tests__/tg-live.test.ts
import { describe, it, expect } from 'vitest'
import { repostList, repostGroup, refreshList, refreshGroupSite, unlinkGroup } from '../../../../supabase/functions/_shared/channels/tg-live'
import { fakeGroupDeps, fakeTgApi, NOW, GROUP, SITE, tpl } from './fakes/group-deps'

const link = (t: string) => `https://t.me/BluerollChecksBot/form?startapp=${t}`
const FRIDGE = tpl({ id: 'tA', name: 'Fridge temps', deadline_time: '11:00' })   // 10:00Z → 🟠 at 09:40Z
const CLEAN = tpl({ id: 'tB', name: 'Cleaning' })
const MAP = [{ group_id: 'g1', template_id: 'tA' }, { group_id: 'g1', template_id: 'tB' }]
const setup = (init = {}) => fakeGroupDeps({ templates: [FRIDGE, CLEAN], mappings: MAP, ...init })
const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }

describe('repostList', () => {
  it('sends the list (notifying), stores the row with fresh tokens', async () => {
    const { d, s } = setup()
    const { api, calls } = fakeTgApi()
    expect(await repostList(d, api, GROUP, SITE, NOW)).toBe('posted')
    expect(calls).toEqual([{ method: 'sendMessage', body: {
      chat_id: '-1001', ...HTML,
      text: '📋 <b>Wharf Side</b> — 0 of 2 done\n🟠 Fridge temps · due 11:00\n⚪ Cleaning',
      reply_markup: { inline_keyboard: [[{ text: '🟠 Fridge temps', url: link('tok1') }], [{ text: '⚪ Cleaning', url: link('tok2') }]] },
    } }])
    expect(s.lists).toEqual([{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '101', tokens: { tA: 'tok1', tB: 'tok2' }, rendered_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }])
    expect(s.tokens.map((t) => [t.token, t.kind, t.group_id, t.site_id, t.template_id, t.item_ids, t.expires_at, t.used_at])).toEqual([
      ['tok1', 'group_checklist', 'g1', 's1', 'tA', ['i1'], '2026-10-15T09:40:00.000Z', null],
      ['tok2', 'group_checklist', 'g1', 's1', 'tB', ['i1'], '2026-10-15T09:40:00.000Z', null],
    ])
  })
  it('a second repost sends a new message first, then deletes the previous one; tokens are fresh', async () => {
    const { d, s } = setup()
    const { api, calls } = fakeTgApi()
    await repostList(d, api, GROUP, SITE, NOW)
    await repostList(d, api, GROUP, SITE, NOW)
    expect(calls.map((c) => c.method)).toEqual(['sendMessage', 'sendMessage', 'deleteMessage'])
    expect(calls[2].body).toEqual({ chat_id: '-1001', message_id: 101 })
    expect(s.lists).toHaveLength(1)
    expect(s.lists[0]).toMatchObject({ message_id: '102', tokens: { tA: 'tok3', tB: 'tok4' } })
  })
  it('app-only checklist (required photo): listed without a button, no token', async () => {
    const { d, s } = setup({ items: { tB: [{ id: 'ip', name: 'Label photo', item_type: 'photo', required: true, min_value: null, max_value: null, unit: null, sort_order: 0 }] } })
    const { api, calls } = fakeTgApi()
    await repostList(d, api, GROUP, SITE, NOW)
    expect(calls[0].body.text).toBe('📋 <b>Wharf Side</b> — 0 of 2 done\n🟠 Fridge temps · due 11:00\n⚪ Cleaning · app only')
    expect(calls[0].body.reply_markup.inline_keyboard).toEqual([[{ text: '🟠 Fridge temps', url: link('tok1') }]])
    expect(s.lists[0].tokens).toEqual({ tA: 'tok1' })
  })
  it('nothing open → nothing sent, an existing list is taken down', async () => {
    const done = [{ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' }, { template_id: 'tB', site_id: 's1', completed_at: '2026-10-14T08:10:00Z', completed_by: 'p1' }]
    const { d, s } = setup({ completions: done, lists: [{ id: 'l9', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '55', tokens: {}, rendered_hash: 'x' }] })
    const { api, calls } = fakeTgApi()
    expect(await repostList(d, api, GROUP, SITE, NOW)).toBe('empty')
    expect(calls).toEqual([{ method: 'deleteMessage', body: { chat_id: '-1001', message_id: 55 } }])
    expect(s.lists).toEqual([])
  })
  it('bot kicked → group unlinked; other send errors → failed, row untouched', async () => {
    const a = setup()
    const kicked = fakeTgApi((m) => (m === 'sendMessage' ? { ok: false, status: 403, description: 'Forbidden: bot was kicked from the supergroup chat' } : undefined))
    expect(await repostList(a.d, kicked.api, GROUP, SITE, NOW)).toBe('unlinked')
    expect(a.s.groups[0].unlinked_at).not.toBeNull()
    const b = setup()
    const busy = fakeTgApi((m) => (m === 'sendMessage' ? { ok: false, status: 429, description: 'Too Many Requests' } : undefined))
    expect(await repostList(b.d, busy.api, GROUP, SITE, NOW)).toBe('failed')
    expect(b.s.lists).toEqual([])
  })
  it('repostGroup posts one list per site where a mapped checklist applies', async () => {
    const S2 = { id: 's2', name: 'Harbour', timezone: 'Europe/London' }
    const S3 = { id: 's3', name: 'Depot', timezone: 'Europe/London' }
    const { d, s } = setup({ sites: [SITE, S2, S3], templates: [FRIDGE, { ...CLEAN, site_id: 's2' }] })
    const { api } = fakeTgApi()
    expect(await repostGroup(d, api, GROUP, NOW)).toEqual(['posted', 'posted', 'posted'])
    expect(s.lists.map((l) => l.site_id)).toEqual(['s1', 's2', 's3'])
    const only = setup({ sites: [SITE, S2], templates: [{ ...FRIDGE, site_id: 's2' }, { ...CLEAN, site_id: 's2' }] })
    expect(await repostGroup(only.d, fakeTgApi().api, GROUP, NOW)).toEqual(['posted'])
  })
})

describe('refreshList', () => {
  const posted = async (init = {}) => {
    const f = setup(init)
    const t = fakeTgApi()
    await repostList(f.d, t.api, GROUP, SITE, NOW)
    t.calls.length = 0
    return { ...f, ...t }
  }
  it('nothing changed → no API call', async () => {
    const f = await posted()
    expect(await refreshList(f.d, f.api, GROUP, f.s.lists[0], SITE, NOW)).toBe('unchanged')
    expect(f.calls).toEqual([])
  })
  it('a completion from the app → silent edit with a ✅ line; unused tokens are kept', async () => {
    const f = await posted({ names: { p9: 'Maria' } })
    f.s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:30:00Z', completed_by: 'p9' })
    expect(await refreshList(f.d, f.api, GROUP, f.s.lists[0], SITE, NOW)).toBe('edited')
    expect(f.calls).toEqual([{ method: 'editMessageText', body: {
      chat_id: '-1001', message_id: 101, ...HTML,
      text: '📋 <b>Wharf Side</b> — 1 of 2 done\n⚪ Cleaning\n✅ Fridge temps · 10:30 Maria',
      reply_markup: { inline_keyboard: [[{ text: '⚪ Cleaning', url: link('tok2') }]] },
    } }])
    expect(f.s.lists[0].tokens).toEqual({ tB: 'tok2' })
  })
  it('everything done → message deleted and row removed', async () => {
    const f = await posted()
    f.s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:30:00Z', completed_by: null }, { template_id: 'tB', site_id: 's1', completed_at: '2026-10-14T09:31:00Z', completed_by: null })
    expect(await refreshList(f.d, f.api, GROUP, f.s.lists[0], SITE, NOW)).toBe('deleted')
    expect(f.calls).toEqual([{ method: 'deleteMessage', body: { chat_id: '-1001', message_id: 101 } }])
    expect(f.s.lists).toEqual([])
  })
  it('a list from a previous local day is deleted without minting tokens', async () => {
    const f = await posted()
    const before = f.s.tokens.length
    expect(await refreshList(f.d, f.api, GROUP, { ...f.s.lists[0], list_date: '2026-10-13' }, SITE, NOW)).toBe('deleted')
    expect(f.calls.map((c) => c.method)).toEqual(['deleteMessage'])
    expect(f.s.tokens).toHaveLength(before)
  })
  it('site gone (removed / no mapped checklist there any more) → deleted', async () => {
    const f = await posted()
    expect(await refreshList(f.d, f.api, GROUP, f.s.lists[0], null, NOW)).toBe('deleted')
    expect(f.s.lists).toEqual([])
  })
  it('a used token is replaced (multi-per-day checklist still open after the first submit)', async () => {
    const f = await posted({ templates: [tpl({ id: 'tA', name: 'Fridge temps', deadline_time: '11:00', multi_per_day: true, min_per_day: 3 }), CLEAN] })
    f.s.tokens[0].used_at = '2026-10-14T09:35:00.000Z'
    f.s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:35:00Z', completed_by: 'p1' })
    expect(await refreshList(f.d, f.api, GROUP, f.s.lists[0], SITE, NOW)).toBe('edited')
    expect(f.calls[0].body.reply_markup.inline_keyboard[0][0].url).toBe(link('tok3'))
    expect(f.s.lists[0].tokens).toEqual({ tA: 'tok3', tB: 'tok2' })
  })
  it('Telegram errors: not found → row dropped; not modified → success; kicked → unlinked; other → kept for retry', async () => {
    const run = async (r: object) => {
      const f = await posted()
      f.s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:30:00Z', completed_by: null })
      const t = fakeTgApi((m) => (m === 'editMessageText' ? r : undefined))
      const out = await refreshList(f.d, t.api, GROUP, f.s.lists[0], SITE, NOW)
      return { out, f }
    }
    const gone = await run({ ok: false, status: 400, description: 'Bad Request: message to edit not found' })
    expect(gone.out).toBe('deleted'); expect(gone.f.s.lists).toEqual([])
    const same = await run({ ok: false, status: 400, description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same' })
    expect(same.out).toBe('edited'); expect(same.f.s.lists[0].tokens).toEqual({ tB: 'tok2' })
    const kicked = await run({ ok: false, status: 403, description: 'Forbidden: bot was kicked from the supergroup chat' })
    expect(kicked.out).toBe('unlinked'); expect(kicked.f.s.groups[0].unlinked_at).not.toBeNull(); expect(kicked.f.s.lists).toEqual([])
    const busy = await run({ ok: false, status: 429, description: 'Too Many Requests: retry after 5' })
    expect(busy.out).toBe('failed'); expect(busy.f.s.lists[0].tokens).toEqual({ tA: 'tok1', tB: 'tok2' })
  })
})

describe('refreshGroupSite / unlinkGroup', () => {
  it('refreshGroupSite: null when the group has no list at that site', async () => {
    const { d } = setup()
    expect(await refreshGroupSite(d, fakeTgApi().api, 'g1', 's1', NOW)).toBeNull()
  })
  it('unlinkGroup deletes the list messages, the rows, and marks the group unlinked', async () => {
    const { d, s } = setup()
    const { api, calls } = fakeTgApi()
    await repostList(d, api, GROUP, SITE, NOW)
    calls.length = 0
    await unlinkGroup(d, api, GROUP, NOW)
    expect(calls).toEqual([{ method: 'deleteMessage', body: { chat_id: '-1001', message_id: 101 } }])
    expect(s.lists).toEqual([])
    expect(s.groups[0].unlinked_at).toBe(NOW.toISOString())
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/tg-live.test.ts`
Expected: FAIL — cannot resolve `tg-live`.

- [ ] **Step 4: Implement `tg-live.ts`**

```ts
// supabase/functions/_shared/channels/tg-live.ts
// Telegram live list service (spec §4): one message per (group, site). Repost = send (notifies) → store → delete the
// previous one. Refresh = edit silently when the rendered list changed; delete it when stale or all done.
import type { SiteInfo } from './bot.ts'
import { telegramFormItemIds } from './bot.ts'
import type { ChannelGroup, GroupDeps, LiveListRow } from './groups-db.ts'
import { miniAppLink, tgEditHtml, tgHtml, tgOutcome, type TgApi } from './telegram.ts'
import { localDate, refreshDecision, renderLiveList, sitesForGroup, type DoneLine, type OpenLine, type RenderedList } from './live-list.ts'
import { completionsWindowStart, dueAtSite } from '../checklists-core/due.ts'
import { periodStartUtc } from '../checklists-core/time.ts'

export const GROUP_TOKEN_TTL_MS = 24 * 3600_000
/** A kept token must stay valid long enough for someone to open and fill in the form. */
const TOKEN_REUSE_MARGIN_MS = 3600_000

export type ListOutcome = 'posted' | 'empty' | 'edited' | 'unchanged' | 'deleted' | 'failed' | 'unlinked'

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

async function tokenFor(d: GroupDeps, group: ChannelGroup, siteId: string, templateId: string, itemIds: string[], prev: string | undefined, now: Date): Promise<string> {
  if (prev) {
    const t = await d.peekGroupToken(prev)
    if (t && !t.used_at && t.group_id === group.id && t.site_id === siteId && t.template_id === templateId
      && new Date(t.expires_at).getTime() - now.getTime() > TOKEN_REUSE_MARGIN_MS && sameIds(t.item_ids, itemIds)) return prev
  }
  const token = d.newToken()
  await d.saveGroupToken({
    token, kind: 'group_checklist', business_id: group.business_id, group_id: group.id, site_id: siteId, template_id: templateId,
    item_ids: itemIds, expires_at: new Date(now.getTime() + GROUP_TOKEN_TTL_MS).toISOString(), used_at: null, used_by_name: null,
  })
  return token
}

/**
 * What the list for (group, site) shows now. `prevTokens` (template id → token) are reused while still unused, valid
 * and for the same items; otherwise a fresh group token is minted (e.g. after a submit on a multi-per-day checklist).
 */
export async function buildList(d: GroupDeps, group: ChannelGroup, site: SiteInfo, now: Date, prevTokens: Record<string, string>): Promise<{ rendered: RenderedList; tokens: Record<string, string> }> {
  const templates = (await d.mappedTemplates(group.id)).filter((t) => t.active && (t.site_id === null || t.site_id === site.id))
  const completions = templates.length ? await d.completionsSince(group.business_id, completionsWindowStart(templates, [site.timezone], now)) : []
  const due = dueAtSite({ templates, siteId: site.id, tz: site.timezone, now, completions })
  const dueIds = new Set(due.map((x) => x.template.id))
  const tokens: Record<string, string> = {}
  const open: OpenLine[] = []
  for (const x of due) {
    const ids = telegramFormItemIds(await d.items(x.template.id))
    let url: string | null = null
    if (ids) {
      const token = await tokenFor(d, group, site.id, x.template.id, ids, prevTokens[x.template.id], now)
      tokens[x.template.id] = token
      url = miniAppLink(token)
    }
    open.push({ templateId: x.template.id, name: x.template.name, deadlineUtc: x.deadline_utc, url })
  }
  // Done in the current period (any source: Telegram, app, web): latest completion per checklist.
  const doneRaw = templates.filter((t) => !dueIds.has(t.id)).flatMap((t) => {
    const start = periodStartUtc(t.multi_per_day ? 'daily' : t.frequency, now, site.timezone).getTime()
    const last = completions
      .filter((c) => c.template_id === t.id && c.site_id === site.id && new Date(c.completed_at).getTime() >= start)
      .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())[0]
    return last ? [{ t, last }] : []
  })
  const names = await d.firstNames([...new Set(doneRaw.map((x) => x.last.completed_by).filter((x): x is string => !!x))])
  const done: DoneLine[] = doneRaw.map(({ t, last }) => ({
    templateId: t.id, name: t.name, completedAt: last.completed_at, by: (last.completed_by && names.get(last.completed_by)) || null,
  }))
  return { rendered: await renderLiveList({ siteName: site.name, tz: site.timezone, now, open, done }), tokens }
}

export async function deleteListMessage(api: TgApi, chatId: string, messageId: string): Promise<void> {
  if (!messageId) return
  await api('deleteMessage', { chat_id: chatId, message_id: Number(messageId) })   // best effort: result ignored
}

async function dropList(d: GroupDeps, api: TgApi, group: ChannelGroup, row: LiveListRow) {
  await deleteListMessage(api, group.chat_id, row.message_id)
  await d.deleteLiveList(row.id)
}

export async function unlinkGroup(d: GroupDeps, api: TgApi, group: ChannelGroup, now: Date): Promise<void> {
  for (const row of await d.liveLists(group.id)) await dropList(d, api, group, row)
  await d.markGroupUnlinked(group.id, now)
}

/** Reminder or /checks: post a fresh list (notifies), then delete the previous one. Nothing open → nothing sent. */
export async function repostList(d: GroupDeps, api: TgApi, group: ChannelGroup, site: SiteInfo, now: Date): Promise<ListOutcome> {
  const prev = (await d.liveLists(group.id)).find((l) => l.site_id === site.id) ?? null
  const { rendered, tokens } = await buildList(d, group, site, now, {})
  if (!rendered.openCount) {
    if (prev) await dropList(d, api, group, prev)
    return 'empty'
  }
  const r = await api('sendMessage', tgHtml(group.chat_id, rendered.text, rendered.keyboard))
  if (!r.ok) {
    const o = tgOutcome(r)
    if (o === 'kicked') { await unlinkGroup(d, api, group, now); return 'unlinked' }
    if (o === 'migrated' && r.migrateTo) await d.migrateGroupChat(group.chat_id, r.migrateTo)
    console.error('live list send failed', group.chat_id, r.status, r.description.slice(0, 120))
    return 'failed'
  }
  await d.saveLiveList({
    group_id: group.id, site_id: site.id, list_date: localDate(now, site.timezone),
    message_id: String(r.result?.message_id ?? ''), tokens, rendered_hash: rendered.hash,
  })
  if (prev) await deleteListMessage(api, group.chat_id, prev.message_id)
  return 'posted'
}

/** /checks: repost every site of the group (sites where at least one mapped checklist applies). */
export async function repostGroup(d: GroupDeps, api: TgApi, group: ChannelGroup, now: Date): Promise<ListOutcome[]> {
  const sites = sitesForGroup(await d.mappedTemplates(group.id), await d.sites(group.business_id))
  const out: ListOutcome[] = []
  for (const site of sites) {
    const o = await repostList(d, api, group, site, now)
    out.push(o)
    if (o === 'unlinked') break
  }
  return out
}

/** Cron (every 10 min) and after a submit. `site` null = the site no longer exists or no longer has mapped checklists. */
export async function refreshList(d: GroupDeps, api: TgApi, group: ChannelGroup, row: LiveListRow, site: SiteInfo | null, now: Date): Promise<ListOutcome> {
  if (!site || row.list_date !== localDate(now, site.timezone)) { await dropList(d, api, group, row); return 'deleted' }
  const { rendered, tokens } = await buildList(d, group, site, now, row.tokens ?? {})
  const decision = refreshDecision({ listDate: row.list_date, today: localDate(now, site.timezone), openCount: rendered.openCount, storedHash: row.rendered_hash, newHash: rendered.hash })
  if (decision === 'delete_stale' || decision === 'delete_done') { await dropList(d, api, group, row); return 'deleted' }
  if (decision === 'unchanged') return 'unchanged'
  const r = await api('editMessageText', tgEditHtml(group.chat_id, row.message_id, rendered.text, rendered.keyboard))
  const o = tgOutcome(r)
  if (o === 'ok' || o === 'not_modified') { await d.updateLiveList(row.id, { tokens, rendered_hash: rendered.hash }); return 'edited' }
  if (o === 'gone') { await d.deleteLiveList(row.id); return 'deleted' }   // the next reminder or /checks posts a fresh list
  if (o === 'kicked') { await unlinkGroup(d, api, group, now); return 'unlinked' }
  if (o === 'migrated' && r.migrateTo) await d.migrateGroupChat(group.chat_id, r.migrateTo)
  console.error('live list edit failed', group.chat_id, r.status, r.description.slice(0, 120))
  return 'failed'   // row kept; next run retries
}

export async function refreshGroupSite(d: GroupDeps, api: TgApi, groupId: string, siteId: string, now: Date): Promise<ListOutcome | null> {
  const group = await d.groupById(groupId)
  if (!group) return null
  const row = (await d.liveLists(groupId)).find((l) => l.site_id === siteId)
  if (!row) return null
  const sites = sitesForGroup(await d.mappedTemplates(group.id), await d.sites(group.business_id))
  return refreshList(d, api, group, row, sites.find((s) => s.id === siteId) ?? null, now)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/whatsapp/__tests__/tg-live.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Typecheck** — `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `4`; `cd supabase/functions && deno check _shared/channels/tg-live.ts` → ok.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/channels/tg-live.ts src/lib/whatsapp/__tests__/fakes/group-deps.ts src/lib/whatsapp/__tests__/tg-live.test.ts
git commit -m "feat(telegram): live list service (repost, refresh, unlink) with Telegram error mapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Group bot + webhook; remove the personal Telegram bot paths

**Files:**
- Create: `supabase/functions/_shared/channels/tg-group-bot.ts`
- Rewrite: `supabase/functions/telegram-webhook/index.ts`
- Modify: `supabase/functions/_shared/channels/telegram.ts` (delete `parseUpdate`, `answerCallback`)
- Modify: `supabase/functions/_shared/channels/bot.ts` (delete Telegram-only branches)
- Modify: `supabase/functions/_shared/channels/ui.ts` (delete `dueForms`)
- Test: `src/lib/whatsapp/__tests__/tg-group-bot.test.ts` (new); modify `telegram.test.ts`, `bot.test.ts`; delete fixtures `tg-start.json`, `tg-command.json`, `tg-callback.json`

**Interfaces:**
- Consumes: `TgEvent`, `TgApi`, `tgText`, `membersCanInvite`, `parseGroupUpdate`, `makeTelegramApi`, `verifyWebhookSecret` (Task 2); `GroupDeps`, `ChannelGroup`, `notifyManagers`, `makeGroupDeps` (Task 4); `repostGroup`, `unlinkGroup` (Task 5); fakes `fakeGroupDeps`, `fakeTgApi`, `groupRow`, `GROUP`, `NOW`, `tpl` (Task 5).
- Produces (`tg-group-bot.ts`):

```ts
export const GROUP_TEXT: {
  privateHelp: string; linked: (business: string) => string; linkUsage: string; linkInvalid: string; linkLimited: string
  unavailable: string; notLinked: string; noChecks: string; nothingDue: string; help: string; permissionWarning: string
}
export const MAX_LINK_FAILURES = 5
export async function handleGroupEvent(e: TgEvent, d: GroupDeps, api: TgApi): Promise<void>
export async function checkGroupPermissions(d: GroupDeps, api: TgApi, group: ChannelGroup, now: Date): Promise<'ok' | 'warned' | 'skipped' | 'unknown'>
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/whatsapp/__tests__/tg-group-bot.test.ts
import { describe, it, expect } from 'vitest'
import { handleGroupEvent, checkGroupPermissions, GROUP_TEXT } from '../../../../supabase/functions/_shared/channels/tg-group-bot'
import type { TgEvent } from '../../../../supabase/functions/_shared/channels/telegram'
import { fakeGroupDeps, fakeTgApi, groupRow, GROUP, NOW, tpl } from './fakes/group-deps'

const CODE = { code: '482913', business_id: 'b', issued_by: 'm1', expires_at: '2026-10-14T09:50:00Z', used_at: null }
let n = 0
const cmd = (command: 'link' | 'checks' | 'help', arg = '', chatId = '-1002'): TgEvent => ({ kind: 'command', chatId, chatTitle: 'Kitchen', userId: '42', command, arg, id: `u${++n}` })
const texts = (calls: { method: string; body: any }[]) => calls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text)

describe('copy', () => {
  it('spec strings', () => {
    expect(GROUP_TEXT.privateHelp).toBe("Blueroll checks happen in your team's Telegram group. Ask your manager to add you.")
    expect(GROUP_TEXT.linked('Fern & Fig')).toBe('Linked to Fern & Fig. A manager will choose which checks this group does.')
    expect(GROUP_TEXT.nothingDue).toBe('Nothing is due right now 👍')
    expect(GROUP_TEXT.permissionWarning).toBe("Anyone in this group can add people. To keep checks safe, an admin should turn off 'Add members' for members in group settings.")
  })
})

describe('private chats', () => {
  it('any private message (incl. an old /start code) gets the "use your team\'s group" reply and links nothing', async () => {
    const { d, s } = fakeGroupDeps({ groups: [], codes: [{ ...CODE }] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent({ kind: 'private', chatId: '42', id: 'p1' }, d, api)
    expect(calls).toEqual([{ method: 'sendMessage', body: { chat_id: '42', text: GROUP_TEXT.privateHelp } }])
    expect(s.codes[0].used_at).toBeNull()
  })
})

describe('/link', () => {
  it('valid code → group linked with its title, reply, permission check (members can invite → warning + manager note)', async () => {
    const { d, s } = fakeGroupDeps({ groups: [], codes: [{ ...CODE }] })
    const { api, calls } = fakeTgApi((m) => (m === 'getChat' ? { result: { permissions: { can_invite_users: true } } } : undefined))
    await handleGroupEvent(cmd('link', '482913'), d, api)
    expect(s.groups).toEqual([expect.objectContaining({ business_id: 'b', channel: 'telegram', chat_id: '-1002', title: 'Kitchen', linked_by: 'm1', unlinked_at: null })])
    expect(calls.map((c) => c.method)).toEqual(['sendMessage', 'getChat', 'sendMessage'])
    expect(texts(calls)).toEqual([GROUP_TEXT.linked('Fern & Fig'), GROUP_TEXT.permissionWarning])
    expect(calls[1].body).toEqual({ chat_id: '-1002' })
    expect(s.notifications).toEqual([expect.objectContaining({ user_id: 'm1', type: 'team', title: 'Telegram group is open to new members', link: '/settings' })])
  })
  it('members cannot invite → no warning', async () => {
    const { d, s } = fakeGroupDeps({ groups: [], codes: [{ ...CODE }] })
    const { api, calls } = fakeTgApi((m) => (m === 'getChat' ? { result: { permissions: { can_invite_users: false } } } : undefined))
    await handleGroupEvent(cmd('link', '482913'), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.linked('Fern & Fig')])
    expect(s.notifications).toEqual([])
  })
  it('expired or used code → invalid reply and a recorded failure; no group', async () => {
    const { d, s } = fakeGroupDeps({ groups: [], codes: [{ ...CODE, expires_at: '2026-10-14T09:00:00Z' }, { ...CODE, code: '111111', used_at: '2026-10-14T09:00:00Z' }] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('link', '482913'), d, api)
    await handleGroupEvent(cmd('link', '111111'), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.linkInvalid, GROUP_TEXT.linkInvalid])
    expect(s.linkFails).toHaveLength(2)
    expect(s.groups).toEqual([])
  })
  it('after 5 failures in an hour the chat is refused without trying the code', async () => {
    const fails = Array.from({ length: 5 }, () => ({ chatId: '-1002', at: new Date('2026-10-14T09:10:00Z') }))
    const { d, s } = fakeGroupDeps({ groups: [], codes: [{ ...CODE }], linkFails: fails })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('link', '482913'), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.linkLimited])
    expect(s.codes[0].used_at).toBeNull()
  })
  it('/link without a 6-digit code → how-to, not a failure', async () => {
    const { d, s } = fakeGroupDeps({ groups: [] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('link', 'abc'), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.linkUsage])
    expect(s.linkFails).toEqual([])
  })
  it('team cannot use Telegram right now → code given back, unavailable reply', async () => {
    const { d, s } = fakeGroupDeps({ groups: [], codes: [{ ...CODE }], ready: { b: false } })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('link', '482913'), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.unavailable])
    expect(s.codes[0].used_at).toBeNull()
    expect(s.groups).toEqual([])
  })
  it('relinking to another business takes the old lists down and clears checklists + alerts', async () => {
    const old = groupRow({ id: 'g1', business_id: 'old', channel: 'telegram', chat_id: '-1002', title: 'Kitchen', alerts: true })
    const { d, s } = fakeGroupDeps({
      groups: [old], codes: [{ ...CODE }], mappings: [{ group_id: 'g1', template_id: 'tX' }],
      lists: [{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '77', tokens: {}, rendered_hash: 'h' }],
    })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('link', '482913'), d, api)
    expect(calls[0]).toEqual({ method: 'deleteMessage', body: { chat_id: '-1002', message_id: 77 } })
    expect(s.lists).toEqual([])
    expect(s.mappings).toEqual([])
    expect(s.groups[0]).toMatchObject({ business_id: 'b', alerts: false, unlinked_at: null })
  })
})

describe('/checks and /help', () => {
  const FRIDGE = tpl({ id: 'tA', name: 'Fridge temps', deadline_time: '11:00' })
  it('unlinked group → not linked reply', async () => {
    const { d } = fakeGroupDeps({ groups: [] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('checks'), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.notLinked])
  })
  it('linked, no checklists chosen → noChecks', async () => {
    const { d } = fakeGroupDeps()
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('checks', '', GROUP.chat_id), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.noChecks])
  })
  it('due checks → the live list is (re)posted', async () => {
    const { d, s } = fakeGroupDeps({ templates: [FRIDGE], mappings: [{ group_id: 'g1', template_id: 'tA' }] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('checks', '', GROUP.chat_id), d, api)
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ chat_id: '-1001', parse_mode: 'HTML', text: '📋 <b>Wharf Side</b> — 0 of 1 done\n🟠 Fridge temps · due 11:00' })
    expect(s.lists).toHaveLength(1)
  })
  it('nothing open → "Nothing is due right now 👍" once', async () => {
    const { d } = fakeGroupDeps({ templates: [FRIDGE], mappings: [{ group_id: 'g1', template_id: 'tA' }],
      completions: [{ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: null }] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('checks', '', GROUP.chat_id), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.nothingDue])
  })
  it('team not ready → unavailable', async () => {
    const { d } = fakeGroupDeps({ ready: { b: false }, templates: [FRIDGE], mappings: [{ group_id: 'g1', template_id: 'tA' }] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('checks', '', GROUP.chat_id), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.unavailable])
  })
  it('/help → help text', async () => {
    const { d } = fakeGroupDeps()
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('help', '', GROUP.chat_id), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.help])
  })
})

describe('membership changes and duplicates', () => {
  it('bot removed from the group → lists deleted, group unlinked', async () => {
    const { d, s } = fakeGroupDeps({ lists: [{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '55', tokens: {}, rendered_hash: 'h' }] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent({ kind: 'bot_removed', chatId: '-1001', id: 'r1' }, d, api)
    expect(calls).toEqual([{ method: 'deleteMessage', body: { chat_id: '-1001', message_id: 55 } }])
    expect(s.lists).toEqual([])
    expect(s.groups[0].unlinked_at).toBe(NOW.toISOString())
  })
  it('group migrated to a supergroup keeps its link under the new chat id', async () => {
    const { d, s } = fakeGroupDeps()
    await handleGroupEvent({ kind: 'migrated', chatId: '-1001', newChatId: '-1009', id: 'm1' }, d, fakeTgApi().api)
    expect(s.groups[0].chat_id).toBe('-1009')
  })
  it('a duplicate delivery of the same update is ignored', async () => {
    const { d } = fakeGroupDeps()
    const { api, calls } = fakeTgApi()
    await handleGroupEvent({ kind: 'private', chatId: '42', id: 'dup' }, d, api)
    await handleGroupEvent({ kind: 'private', chatId: '42', id: 'dup' }, d, api)
    expect(calls).toHaveLength(1)
  })
})

describe('checkGroupPermissions', () => {
  it('warns at most once a day; unknown when Telegram does not answer', async () => {
    const { d, s } = fakeGroupDeps()
    const open = fakeTgApi((m) => (m === 'getChat' ? { result: { permissions: { can_invite_users: true } } } : undefined))
    expect(await checkGroupPermissions(d, open.api, GROUP, NOW)).toBe('warned')
    expect(await checkGroupPermissions(d, open.api, GROUP, NOW)).toBe('skipped')
    expect(texts(open.calls)).toEqual([GROUP_TEXT.permissionWarning])
    expect(s.notifications).toHaveLength(1)
    const down = fakeTgApi((m) => (m === 'getChat' ? { ok: false, status: 0, description: 'network' } : undefined))
    expect(await checkGroupPermissions(d, down.api, GROUP, NOW)).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/tg-group-bot.test.ts`
Expected: FAIL — cannot resolve `tg-group-bot`.

- [ ] **Step 3: Implement `tg-group-bot.ts`**

```ts
// supabase/functions/_shared/channels/tg-group-bot.ts
// Telegram groups bot (spec §3, §7, §8): /link <code>, /checks, /help in groups; bot removed → unlink; group migrated
// to a supergroup → keep the link; any private message → "use your team's group". Pure over GroupDeps + TgApi.
import { membersCanInvite, tgText, type TgApi, type TgEvent } from './telegram.ts'
import { notifyManagers, type ChannelGroup, type GroupDeps } from './groups-db.ts'
import { repostGroup, unlinkGroup } from './tg-live.ts'

export const GROUP_TEXT = {
  privateHelp: "Blueroll checks happen in your team's Telegram group. Ask your manager to add you.",
  linked: (business: string) => `Linked to ${business}. A manager will choose which checks this group does.`,
  linkUsage: 'To link this group, send /link followed by the 6-digit code from Blueroll → Settings → Messaging.',
  linkInvalid: 'That code is not valid or has expired. Ask a manager for a new code in Blueroll → Settings → Messaging.',
  linkLimited: 'Too many wrong codes. Please try again in an hour.',
  unavailable: "Blueroll checks aren't available for this team right now.",
  notLinked: 'This group is not linked to Blueroll yet. A manager can link it in Blueroll → Settings → Messaging.',
  noChecks: 'No checks are chosen for this group yet. A manager can choose them in Blueroll → Settings → Messaging.',
  nothingDue: 'Nothing is due right now 👍',
  help: 'Blueroll checks: tap a check on the list to fill it in. Send /checks to see the list again.',
  permissionWarning: "Anyone in this group can add people. To keep checks safe, an admin should turn off 'Add members' for members in group settings.",
}

export const MAX_LINK_FAILURES = 5
const LINK_FAILURE_WINDOW_MS = 3600_000

/** Spec §8: on link and once a day — if members can add people, say so in the group and tell managers (≤ once a day). */
export async function checkGroupPermissions(d: GroupDeps, api: TgApi, group: ChannelGroup, now: Date): Promise<'ok' | 'warned' | 'skipped' | 'unknown'> {
  const can = membersCanInvite(await api('getChat', { chat_id: group.chat_id }))
  if (can === null) return 'unknown'
  if (!can) return 'ok'
  if (!(await d.claimPermissionWarning(group.id, now))) return 'skipped'
  await api('sendMessage', tgText(group.chat_id, GROUP_TEXT.permissionWarning))
  await notifyManagers(d, group.business_id, {
    title: 'Telegram group is open to new members',
    message: `Anyone in “${group.title || 'your Telegram group'}” can add people. An admin should turn off 'Add members' for members in the group settings.`,
    link: '/settings',
  })
  return 'warned'
}

type Command = Extract<TgEvent, { kind: 'command' }>

async function link(e: Command, d: GroupDeps, api: TgApi, now: Date) {
  const say = (text: string) => api('sendMessage', tgText(e.chatId, text))
  if (!/^\d{6}$/.test(e.arg)) { await say(GROUP_TEXT.linkUsage); return }
  if (await d.linkFailures(e.chatId, new Date(now.getTime() - LINK_FAILURE_WINDOW_MS)) >= MAX_LINK_FAILURES) { await say(GROUP_TEXT.linkLimited); return }
  const code = await d.claimGroupLinkCode(e.arg, now)
  if (!code) { await d.recordLinkFailure(e.chatId, now); await say(GROUP_TEXT.linkInvalid); return }
  const usedAt = now.toISOString()
  let ready: boolean
  try { ready = await d.ready(code.business_id) }
  catch (err) { await d.releaseGroupLinkCode(e.arg, usedAt); throw err }   // transient: don't burn the manager's code
  if (!ready) { await d.releaseGroupLinkCode(e.arg, usedAt); await say(GROUP_TEXT.unavailable); return }
  const prev = await d.groupByChat(e.chatId)
  if (prev && prev.business_id !== code.business_id) await unlinkGroup(d, api, prev, now)   // old business's lists go
  const group = await d.linkGroup({ business_id: code.business_id, chat_id: e.chatId, title: e.chatTitle, linked_by: code.issued_by, now })
  await say(GROUP_TEXT.linked(await d.businessName(code.business_id)))
  await checkGroupPermissions(d, api, group, now)
}

async function checks(e: Command, d: GroupDeps, api: TgApi, now: Date) {
  const say = (text: string) => api('sendMessage', tgText(e.chatId, text))
  const group = await d.groupByChat(e.chatId)
  if (!group) { await say(GROUP_TEXT.notLinked); return }
  if (!(await d.ready(group.business_id))) { await say(GROUP_TEXT.unavailable); return }
  if (!(await d.mappedTemplates(group.id)).length) { await say(GROUP_TEXT.noChecks); return }
  const outcomes = await repostGroup(d, api, group, now)
  if (outcomes.every((o) => o === 'empty')) await say(GROUP_TEXT.nothingDue)
}

export async function handleGroupEvent(e: TgEvent, d: GroupDeps, api: TgApi): Promise<void> {
  if (e.id && !(await d.claimInbound(e.id))) return   // Telegram re-delivered this update
  const now = d.now()
  switch (e.kind) {
    case 'private':
      await api('sendMessage', tgText(e.chatId, GROUP_TEXT.privateHelp))
      return
    case 'migrated':
      await d.migrateGroupChat(e.chatId, e.newChatId)
      return
    case 'bot_removed': {
      const group = await d.groupByChat(e.chatId)
      if (group) await unlinkGroup(d, api, group, now)
      return
    }
    case 'command':
      if (e.command === 'help') { await api('sendMessage', tgText(e.chatId, GROUP_TEXT.help)); return }
      if (e.command === 'link') return link(e, d, api, now)
      return checks(e, d, api, now)
  }
}
```

- [ ] **Step 4: Rewrite `telegram-webhook/index.ts`**

```ts
// supabase/functions/telegram-webhook/index.ts
// Telegram Bot API webhook for @BluerollChecksBot — groups only (spec 2026-10-11). Deployed with --no-verify-jwt;
// authenticity = secret-token header. Always 200 once authenticated, so Telegram doesn't retry-storm.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeTelegramApi, parseGroupUpdate, verifyWebhookSecret } from "../_shared/channels/telegram.ts";
import { makeGroupDeps } from "../_shared/channels/groups-db.ts";
import { handleGroupEvent } from "../_shared/channels/tg-group-bot.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SECRET = Deno.env.get("TG_WEBHOOK_SECRET") ?? "";
const api = makeTelegramApi({ token: Deno.env.get("TG_BOT_TOKEN") ?? "" });
const deps = makeGroupDeps(admin, "telegram");

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if (!SECRET || !verifyWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"), SECRET)) return new Response("forbidden", { status: 401 });
  const update = await req.json().catch(() => null);
  for (const e of parseGroupUpdate(update)) {
    try { await handleGroupEvent(e, deps, api); }
    catch (err) { console.error("telegram update failed", e.kind, String((err as Error)?.message ?? err).slice(0, 200)); }
  }
  return new Response("ok");
});
```

- [ ] **Step 5: Remove the personal Telegram paths**

(a) `telegram.ts`: delete the functions `parseUpdate` and `answerCallback`; change the first import to `import type { OutboundMessage, SendFn } from './types.ts'`.

(b) `ui.ts`: delete the `dueForms?(…)` member (and its doc comment) from `ChannelUI`, delete `dueForms: …` from `telegramUI`, delete the imports of `buildTelegramReminder` and `DueChecklist`.

(c) `bot.ts`:
- in `sendChecklistForm` delete the whole `if (d.ui.channel === 'telegram') { … }` block (the WhatsApp Flow path below stays as is);
- in `sendDueList` delete `const itemIdsCache = …` and the whole `if (d.ui.dueForms) { … continue }` block;
- replace the start of `handleInbound` (from `export async function handleInbound` down to and including `const id = known !== undefined ? known : await d.findIdentity(e.from)`) with:

```ts
export async function handleInbound(e: InboundEvent, d: BotDeps): Promise<void> {
  const X = textsFor(d.ui)
  const reply = (body: string) => d.ui.text(e.from, body)
  const now = d.now()
  const waId = e.id || null
  // Every inbound row is logged FIRST: uq_channel_inbound_msg turns a duplicate webhook delivery into a no-op
  // before anything is consumed, recorded or sent.
  const claim = (business_id: string | null, profile_id: string | null, kind: string) =>
    d.log({ business_id, site_id: null, profile_id, direction: 'in', kind, billable: false, wa_message_id: waId })
  const m = e.kind === 'text' ? e.text.match(/^\s*link\s*(\d{6})\s*$/i) : null
  if (m) {
    if (!(await claim(null, null, 'link'))) return
    if (await d.linkFailures(e.from, new Date(now.getTime() - LINK_FAILURE_WINDOW_MS)) >= MAX_LINK_FAILURES) {
      return out(d, { business_id: null, profile_id: null }, reply(X.linkExpired), 'link')
    }
    const r = await d.consumeLinkCode(m[1], e.from, now)
    if (!r.ok && r.reason === 'unavailable') return out(d, { business_id: null, profile_id: null }, reply(X.unavailable), 'link')
    if (!r.ok) await d.recordLinkFailure(e.from, now)
    return out(d, { business_id: r.ok ? r.identity.business_id : null, profile_id: r.ok ? r.identity.profile_id : null },
      reply(r.ok ? X.linked(r.name, r.siteName) : X.linkExpired), 'link')
  }
  const id = await d.findIdentity(e.from)
```

  (`telegramFormItemIds` and `saveChecklistToken` stay exported — `tg-live.ts` uses the former, the WhatsApp path the latter.)

(d) Tests:
- `telegram.test.ts`: remove `parseUpdate`, `answerCallback` from the import, delete `describe('parseUpdate')` and `describe('answerCallback')`, delete the imports of `start`, `command`, `callback` fixtures (keep `group`), delete the `priv` helper if now unused.
- delete `src/lib/whatsapp/__tests__/fixtures/tg-start.json`, `tg-command.json`, `tg-callback.json`.
- `bot.test.ts`: delete the whole `describe('bot on Telegram', …)` block; change imports to `import { handleInbound, TEXT, type BotDeps, type FormToken } from …/bot'` and `import { whatsappUI } from …/ui'`; delete the `parseUpdate` import. The test `corrective alert reaches a Telegram manager as text and a WhatsApp manager as the template` stays (it exercises the generic `alertManagers`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/whatsapp/__tests__/tg-group-bot.test.ts && npm test`
Expected: PASS; all WhatsApp `bot.test.ts` cases still pass unmodified.

- [ ] **Step 7: Typecheck** — `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `4`; `cd supabase/functions && deno check telegram-webhook/index.ts whatsapp-webhook/index.ts channel-form/index.ts whatsapp-reminders/index.ts` → ok (`whatsapp-reminders` still imports `tg-reminder.ts`, which still exists until Task 7).

- [ ] **Step 8: Commit**

```bash
git add -A supabase/functions/_shared/channels/tg-group-bot.ts supabase/functions/telegram-webhook/index.ts supabase/functions/_shared/channels/telegram.ts supabase/functions/_shared/channels/bot.ts supabase/functions/_shared/channels/ui.ts src/lib/whatsapp/__tests__
git commit -m "feat(telegram): groups-only bot (link, checks, unlink, migrate, permission check); drop personal Telegram bot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Reminders cron — group reminders, list refresh, daily permission check; personal Telegram reminders removed

**Files:**
- Modify: `supabase/functions/_shared/checklists-core/reminders.ts` (add `planGroupReminders`)
- Create: `supabase/functions/_shared/channels/tg-cron.ts`
- Rewrite: `supabase/functions/whatsapp-reminders/index.ts`
- Delete: `supabase/functions/_shared/channels/tg-reminder.ts`, `src/lib/whatsapp/__tests__/tg-reminder.test.ts`
- Test: `src/lib/whatsapp/__tests__/reminders.test.ts` (append), `src/lib/whatsapp/__tests__/tg-cron.test.ts` (new)

**Interfaces:**
- Consumes: `dueAtSite`, `completionsWindowStart` (Task 3/`due.ts`); `sitesForGroup` (Task 3); `GroupDeps`, `makeGroupDeps` (Task 4); `repostList`, `refreshList`, `deleteListMessage` (Task 5); `checkGroupPermissions` (Task 6); `TgApi`, `makeTelegramApi` (Task 2); fakes (Task 5).
- Produces:

```ts
// checklists-core/reminders.ts
export interface GroupReminderJob { site_id: string; items: DueChecklist[] }
export function planGroupReminders(args: { now: Date; sites: { id: string; timezone: string }[]; templates: Template[]; completions: CompletionLite[] }): GroupReminderJob[]
// channels/tg-cron.ts
export interface GroupRunResult { reposted: number; refreshed: number; removed: number; warned: number; failed: number }
export async function runTelegramGroups(d: GroupDeps, api: TgApi, now: Date): Promise<GroupRunResult>
```

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/whatsapp/__tests__/reminders.test.ts` (and add `planGroupReminders` to its import from `…/checklists-core/reminders`):

```ts
describe('planGroupReminders', () => {
  const sites = [{ id: 's1', timezone: 'Europe/London' }, { id: 's2', timezone: 'Europe/London' }]
  it('inside [deadline−30, deadline) only, per site, ignoring assignment', () => {
    const t = [{ ...tpl('open', '10:00'), assigned_role_ids: ['nobody'] }]
    expect(planGroupReminders({ now: at('2026-10-14T08:29:00Z'), sites, templates: t, completions: [] })).toEqual([])
    const jobs = planGroupReminders({ now: at('2026-10-14T08:30:00Z'), sites, templates: t, completions: [] })
    expect(jobs.map((j) => [j.site_id, j.items.map((i) => [i.template.id, i.period_key])])).toEqual([
      ['s1', [['open', '2026-10-14']]], ['s2', [['open', '2026-10-14']]],
    ])
    expect(planGroupReminders({ now: at('2026-10-14T09:00:00Z'), sites, templates: t, completions: [] })).toEqual([])
  })
  it('skips completed checklists, no-deadline checklists and other sites', () => {
    const t = [tpl('done', '10:00'), tpl('nodl', null), { ...tpl('other', '10:00'), site_id: 's2' }]
    const jobs = planGroupReminders({ now: at('2026-10-14T08:40:00Z'), sites: [sites[0]], templates: t,
      completions: [{ template_id: 'done', site_id: 's1', completed_at: '2026-10-14T08:00:00Z' }] })
    expect(jobs).toEqual([])
  })
})
```

Create `src/lib/whatsapp/__tests__/tg-cron.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { runTelegramGroups } from '../../../../supabase/functions/_shared/channels/tg-cron'
import { fakeGroupDeps, fakeTgApi, groupRow, GROUP, NOW, tpl } from './fakes/group-deps'

const FRIDGE = tpl({ id: 'tA', name: 'Fridge temps', deadline_time: '11:00' })   // reminder window 09:30–10:00Z; NOW = 09:40Z
const CLEAN = tpl({ id: 'tB', name: 'Cleaning' })
const MAP = [{ group_id: 'g1', template_id: 'tA' }, { group_id: 'g1', template_id: 'tB' }]
const quiet = (m: string) => (m === 'getChat' ? { result: { permissions: { can_invite_users: false } } } : undefined)

describe('runTelegramGroups', () => {
  it('reminder: reposts the group list once per period, then only refreshes', async () => {
    const { d, s } = fakeGroupDeps({ templates: [FRIDGE, CLEAN], mappings: MAP })
    const { api, calls } = fakeTgApi(quiet)
    const r1 = await runTelegramGroups(d, api, NOW)
    expect(r1).toMatchObject({ reposted: 1, failed: 0 })
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1)
    expect(s.reminders).toEqual(new Set(['g1:tA:s1:2026-10-14']))
    calls.length = 0
    const r2 = await runTelegramGroups(d, api, NOW)
    expect(r2).toMatchObject({ reposted: 0, refreshed: 0 })
    expect(calls.map((c) => c.method)).toEqual([])   // permission already checked today, list unchanged
  })
  it('refresh: a completion turns into a ✅ line by edit; everything done deletes the list', async () => {
    const { d, s } = fakeGroupDeps({ templates: [FRIDGE, CLEAN], mappings: MAP })
    const { api, calls } = fakeTgApi(quiet)
    await runTelegramGroups(d, api, NOW)
    s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:41:00Z', completed_by: null })
    calls.length = 0
    expect(await runTelegramGroups(d, api, NOW)).toMatchObject({ refreshed: 1 })
    expect(calls.map((c) => c.method)).toEqual(['editMessageText'])
    expect(calls[0].body.text).toContain('✅ Fridge temps · 10:41')
    s.completions.push({ template_id: 'tB', site_id: 's1', completed_at: '2026-10-14T09:42:00Z', completed_by: null })
    calls.length = 0
    expect(await runTelegramGroups(d, api, NOW)).toMatchObject({ removed: 1 })
    expect(calls.map((c) => c.method)).toEqual(['deleteMessage'])
    expect(s.lists).toEqual([])
  })
  it('a failed reminder send gives the key back so the next run retries', async () => {
    const { d, s } = fakeGroupDeps({ templates: [FRIDGE], mappings: [MAP[0]] })
    const down = fakeTgApi((m) => (m === 'sendMessage' ? { ok: false, status: 429, description: 'Too Many Requests' } : quiet(m)))
    expect(await runTelegramGroups(d, down.api, NOW)).toMatchObject({ failed: 1 })
    expect(s.reminders.size).toBe(0)
    const up = fakeTgApi(quiet)
    expect(await runTelegramGroups(d, up.api, NOW)).toMatchObject({ reposted: 1 })
  })
  it('lists from a previous day are deleted', async () => {
    const { d, s } = fakeGroupDeps({ templates: [CLEAN], mappings: [MAP[1]],
      lists: [{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-13', message_id: '50', tokens: {}, rendered_hash: 'h' }] })
    const { api, calls } = fakeTgApi(quiet)
    expect(await runTelegramGroups(d, api, NOW)).toMatchObject({ removed: 1 })
    expect(calls.filter((c) => c.method === 'deleteMessage').map((c) => c.body)).toEqual([{ chat_id: '-1001', message_id: 50 }])
    expect(s.lists).toEqual([])
  })
  it('unlinked in Settings → its lists are taken down', async () => {
    const { d, s } = fakeGroupDeps({ groups: [groupRow(GROUP, { unlinked_at: '2026-10-14T09:00:00Z' })],
      lists: [{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '60', tokens: {}, rendered_hash: 'h' }] })
    const { api, calls } = fakeTgApi(quiet)
    expect(await runTelegramGroups(d, api, NOW)).toMatchObject({ removed: 1 })
    expect(calls).toEqual([{ method: 'deleteMessage', body: { chat_id: '-1001', message_id: 60 } }])
    expect(s.lists).toEqual([])
  })
  it('business not ready (Telegram off / subscription lapsed) → lists taken down, nothing sent', async () => {
    const { d, s } = fakeGroupDeps({ ready: { b: false }, templates: [FRIDGE], mappings: [MAP[0]],
      lists: [{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '61', tokens: {}, rendered_hash: 'h' }] })
    const { api, calls } = fakeTgApi(quiet)
    await runTelegramGroups(d, api, NOW)
    expect(calls).toEqual([{ method: 'deleteMessage', body: { chat_id: '-1001', message_id: 61 } }])
    expect(s.lists).toEqual([])
    expect(s.reminders.size).toBe(0)
  })
  it('permission check runs once a day per group and warns when members can invite', async () => {
    const { d, s } = fakeGroupDeps()
    const open = fakeTgApi((m) => (m === 'getChat' ? { result: { permissions: { can_invite_users: true } } } : undefined))
    expect(await runTelegramGroups(d, open.api, NOW)).toMatchObject({ warned: 1 })
    await runTelegramGroups(d, open.api, NOW)
    expect(open.calls.filter((c) => c.method === 'getChat')).toHaveLength(1)
    expect(s.notifications).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/reminders.test.ts src/lib/whatsapp/__tests__/tg-cron.test.ts`
Expected: FAIL — `planGroupReminders` not exported; `tg-cron` not found.

- [ ] **Step 3: Implement `planGroupReminders`** — in `checklists-core/reminders.ts` change the import to `import { dueAtSite, dueChecklists } from './due.ts'` and append:

```ts
export interface GroupReminderJob { site_id: string; items: DueChecklist[] }

/**
 * Telegram groups (spec §4): what is inside its reminder window right now at each of the group's sites, regardless of
 * assignment. "Once per (group, template, site, period)" is enforced by the caller's claim on
 * channel_group_reminders_sent, not here.
 */
export function planGroupReminders(args: { now: Date; sites: { id: string; timezone: string }[]; templates: Template[]; completions: CompletionLite[] }): GroupReminderJob[] {
  const t = args.now.getTime()
  const jobs: GroupReminderJob[] = []
  for (const s of args.sites) {
    const items = dueAtSite({ templates: args.templates, siteId: s.id, tz: s.timezone, now: args.now, completions: args.completions })
      .filter((d) => {
        if (!d.deadline_utc) return false
        const dl = new Date(d.deadline_utc).getTime()
        return t >= dl - LEAD_MINUTES * 60_000 && t < dl
      })
    if (items.length) jobs.push({ site_id: s.id, items })
  }
  return jobs
}
```

- [ ] **Step 4: Implement `tg-cron.ts`**

```ts
// supabase/functions/_shared/channels/tg-cron.ts
// Telegram groups step of the 10-minute cron (spec §4, §8): take down lists of unlinked groups and of teams that can't
// use Telegram now; daily permission check; group reminders (repost); silent refresh of every other list.
import type { GroupDeps } from './groups-db.ts'
import type { TgApi } from './telegram.ts'
import { deleteListMessage, refreshList, repostList } from './tg-live.ts'
import { checkGroupPermissions } from './tg-group-bot.ts'
import { sitesForGroup } from './live-list.ts'
import { planGroupReminders } from '../checklists-core/reminders.ts'
import { completionsWindowStart } from '../checklists-core/due.ts'

export interface GroupRunResult { reposted: number; refreshed: number; removed: number; warned: number; failed: number }

const errMsg = (e: unknown) => String((e as { message?: string })?.message ?? e).slice(0, 200)

export async function runTelegramGroups(d: GroupDeps, api: TgApi, now: Date): Promise<GroupRunResult> {
  const res: GroupRunResult = { reposted: 0, refreshed: 0, removed: 0, warned: 0, failed: 0 }

  // Unlinked in Settings (the web app can't call the Bot API): delete the message, then the row.
  for (const { row, chat_id } of await d.orphanLiveLists()) {
    await deleteListMessage(api, chat_id, row.message_id)
    await d.deleteLiveList(row.id)
    res.removed++
  }

  const ready = new Map<string, boolean>()
  for (const group of await d.linkedGroups()) {
    try {
      if (!ready.has(group.business_id)) ready.set(group.business_id, await d.ready(group.business_id))
      const lists = await d.liveLists(group.id)
      if (!ready.get(group.business_id)) {
        // Telegram turned off or subscription lapsed: no reminders, and the lists come down.
        for (const row of lists) { await deleteListMessage(api, group.chat_id, row.message_id); await d.deleteLiveList(row.id); res.removed++ }
        continue
      }
      if (await d.claimPermissionCheck(group.id, now)) {
        if ((await checkGroupPermissions(d, api, group, now)) === 'warned') res.warned++
      }

      const templates = await d.mappedTemplates(group.id)
      const sites = sitesForGroup(templates, await d.sites(group.business_id))
      const reposted = new Set<string>()
      let unlinked = false
      if (templates.length && sites.length) {
        const completions = await d.completionsSince(group.business_id, completionsWindowStart(templates, [...new Set(sites.map((s) => s.timezone))], now))
        for (const job of planGroupReminders({ now, sites, templates, completions })) {
          const keys = job.items.map((it) => ({ template_id: it.template.id, period_key: it.period_key }))
          const claimed = await d.claimGroupReminders(group.id, job.site_id, keys)
          if (!claimed.size) continue
          const o = await repostList(d, api, group, sites.find((s) => s.id === job.site_id)!, now)
          if (o === 'posted') { res.reposted++; reposted.add(job.site_id) }
          else if (o === 'empty') reposted.add(job.site_id)
          else if (o === 'unlinked') { unlinked = true; break }
          else {
            res.failed++
            await d.releaseGroupReminders(group.id, job.site_id, keys.filter((k) => claimed.has(`${k.template_id}:${k.period_key}`)))
          }
        }
      }
      if (unlinked) continue

      for (const row of lists) {
        if (reposted.has(row.site_id)) continue   // replaced this run
        const o = await refreshList(d, api, group, row, sites.find((s) => s.id === row.site_id) ?? null, now)
        if (o === 'edited') res.refreshed++
        else if (o === 'deleted') res.removed++
        else if (o === 'failed') res.failed++
        else if (o === 'unlinked') break
      }
    } catch (err) {
      res.failed++
      console.error('telegram group run failed', group.id, errMsg(err))
    }
  }
  return res
}
```

- [ ] **Step 5: Rewrite `whatsapp-reminders/index.ts`** (WhatsApp personal logic unchanged; Telegram personal reminders gone; groups run added):

```ts
// supabase/functions/whatsapp-reminders/index.ts
// Every 10 minutes (pg_cron → net.http_post with x-cron-secret). The name is historical; it serves:
//  - WhatsApp personal chats: due reminders + corrective follow-ups (needs WA_TOKEN + WA_PHONE_NUMBER_ID);
//  - Telegram GROUPS: reminders (repost the live list), list refresh, daily permission check, cleanup of unlinked
//    groups' lists (tg-cron.ts; needs TG_BOT_TOKEN). There are no personal Telegram chats any more.
// Then housekeeping. Deployed with --no-verify-jwt; authenticity = x-cron-secret. Never log raw phone numbers (maskPhone).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeSender, templateMessage } from "../_shared/channels/whatsapp.ts";
import { makeTelegramApi } from "../_shared/channels/telegram.ts";
import { makeDeps, pageAll } from "../_shared/channels/db.ts";
import { isBillable, withUnit, type BotDeps } from "../_shared/channels/bot.ts";
import { alertManagers, makeAlertDeps, type Senders } from "../_shared/channels/alerts.ts";
import { whatsappUI } from "../_shared/channels/ui.ts";
import { makeGroupDeps } from "../_shared/channels/groups-db.ts";
import { runTelegramGroups, type GroupRunResult } from "../_shared/channels/tg-cron.ts";
import { maskPhone } from "../_shared/channels/mask.ts";
import { planCorrective, planReminders, reminderKey, type Recipient, type ReminderJob } from "../_shared/checklists-core/reminders.ts";
import { completionsWindowStart } from "../_shared/checklists-core/due.ts";
import type { SendFn } from "../_shared/channels/types.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CRON_SECRET = Deno.env.get("WA_CRON_SECRET") ?? "";
const WA_TOKEN = Deno.env.get("WA_TOKEN") ?? "";
const WA_PHONE = Deno.env.get("WA_PHONE_NUMBER_ID") ?? "";
const TG_TOKEN = Deno.env.get("TG_BOT_TOKEN") ?? "";
const waSend: SendFn | undefined = WA_TOKEN && WA_PHONE ? makeSender({ token: WA_TOKEN, phoneNumberId: WA_PHONE }) : undefined;
const tgApi = TG_TOKEN ? makeTelegramApi({ token: TG_TOKEN }) : undefined;
const CORRECTIVE_FLOW_ID = Deno.env.get("WA_CORRECTIVE_FLOW_ID") ?? "";
if (waSend && !CORRECTIVE_FLOW_ID) console.error("whatsapp-reminders: WA_CORRECTIVE_FLOW_ID is not set — corrective forms will be skipped");
const senders: Senders = waSend ? { whatsapp: waSend } : {};
const waDeps: BotDeps | undefined = waSend
  ? makeDeps(admin, { channel: "whatsapp", ui: whatsappUI(), send: waSend, correctiveFlowId: CORRECTIVE_FLOW_ID, senders })
  : undefined;
const groupDeps = makeGroupDeps(admin, "telegram");
const alertDeps = makeAlertDeps(admin);

const DAY_MS = 86400_000;
const REMINDER_KEY_COLS = "profile_id,template_id,site_id,period_key";

// deno-lint-ignore no-explicit-any
type Any = any;
interface Ident { id: string; business_id: string; profile_id: string; external_id: string; last_inbound_at: string | null }
interface SiteRow { name: string; timezone: string }

const hhmm = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const errMsg = (e: unknown) => String((e as Any)?.message ?? e).slice(0, 200);

/**
 * Claim a one-off corrective step (nudge / no-action alert) by inserting its log row FIRST.
 * uq_channel_messages_claim (partial unique index on (ref_id, kind)) makes overlapping runs safe:
 * a unique_violation (23505) means another run already claimed it. Returns the log row id, or null if not claimed.
 */
async function claimStep(row: { business_id: string; site_id: string; profile_id: string | null; kind: "corrective_nudge" | "alert_no_action"; template_name?: string; ref_id: string }): Promise<number | null> {
  const { data, error } = await admin.from("channel_messages_log")
    .insert({ ...row, channel: "whatsapp", direction: "out", billable: false }).select("id").single();
  if (error) {
    if (error.code !== "23505") console.error("whatsapp corrective claim failed", row.kind, errMsg(error));
    return null;
  }
  return data.id as number;
}

async function releaseKeys(job: ReminderJob, items: ReminderJob["items"]): Promise<void> {
  for (const it of items) {
    const { error } = await admin.from("channel_reminders_sent").delete()
      .eq("profile_id", job.profile_id).eq("template_id", it.template.id).eq("site_id", job.site_id).eq("period_key", it.period_key);
    if (error) console.error("reminder key release failed", maskPhone(job.external_id), it.template.id, it.period_key, errMsg(error));
  }
}

/** WhatsApp reminders for one business. */
async function remindBusiness(deps: BotDeps, send: SendFn, biz: string, list: Ident[], sites: Map<string, SiteRow>, now: Date): Promise<number> {
  const templates = await deps.templates(biz);
  if (!templates.length) return 0;
  const completions = await deps.completionsSince(biz, completionsWindowStart(templates, [...new Set([...sites.values()].map((s) => s.timezone))], now));
  const profiles = [...new Set(list.map((i) => i.profile_id))];
  const sentRows = await pageAll<Any>((from, to) => admin.from("channel_reminders_sent").select("profile_id, template_id, site_id, period_key")
    .in("profile_id", profiles).in("site_id", [...sites.keys()])
    .gte("sent_at", new Date(now.getTime() - 40 * DAY_MS).toISOString())
    .order("profile_id").order("template_id").order("site_id").order("period_key").range(from, to));
  const already = new Set(sentRows.map((r: Any) => reminderKey(r.profile_id, r.template_id, r.site_id, r.period_key)));

  // Only (template, site) pairs with a published Flow: a reminder for a checklist that can't be filled here is billable noise.
  const { data: flowRows, error: flowErr } = await admin.from("channel_flows").select("template_id, site_id")
    .eq("channel", "whatsapp").eq("status", "published").not("flow_id", "is", null).in("template_id", templates.map((t) => t.id));
  if (flowErr) throw flowErr;
  const withFlow = new Set((flowRows ?? []).map((f: Any) => `${f.template_id}:${f.site_id}`));
  if (!withFlow.size) return 0;

  const recipients: Recipient[] = [];
  for (const i of list) {
    const person = await deps.person(i.profile_id);
    if (!person || person.business_id !== biz) continue;
    for (const s of await deps.sitesFor(i.profile_id)) recipients.push({ person, external_id: i.external_id, site_id: s.id, tz: s.timezone });
  }
  if (!recipients.length) return 0;

  let sent = 0;
  // planReminders returns several jobs per recipient (chunks of MAX_PER_MESSAGE) — every job is sent.
  for (const job of planReminders({ now, recipients, templates, completions, alreadySent: already, hasFlow: (t, s) => withFlow.has(`${t}:${s}`) })) {
    // Claim the keys before sending: the PK makes overlapping runs safe; conflicting keys are skipped.
    const { data: claimed, error: claimErr } = await admin.from("channel_reminders_sent")
      .upsert(job.items.map((it) => ({ profile_id: job.profile_id, template_id: it.template.id, site_id: job.site_id, period_key: it.period_key })),
        { onConflict: REMINDER_KEY_COLS, ignoreDuplicates: true })
      .select("template_id, period_key");
    if (claimErr) { console.error("whatsapp reminder claim failed", errMsg(claimErr)); continue; }
    const claimedKeys = new Set((claimed ?? []).map((c: Any) => `${c.template_id}:${c.period_key}`));
    const items = job.items.filter((it) => claimedKeys.has(`${it.template.id}:${it.period_key}`));
    if (!items.length) continue;

    const ident = list.find((i) => i.profile_id === job.profile_id);
    const site = sites.get(job.site_id);
    const siteName = site?.name ?? "";
    const tz = site?.timezone ?? "Europe/London";
    const single = items.length === 1;
    const msg = single
      ? templateMessage(job.external_id, "checklist_reminder", [items[0].template.name, hhmm(items[0].deadline_utc!, tz), siteName], [`fill:${items[0].template.id}:${job.site_id}`])
      : templateMessage(job.external_id, "checklist_reminder_list",
        [String(items.length), siteName, items.map((x) => `${x.template.name} (${hhmm(x.deadline_utc!, tz)})`).join(", ")],
        // One QUICK_REPLY "Show checks": the bot answers with named Fill-in buttons (a template can't label its buttons per send).
        ["checks"]);
    const r = await send(msg);
    if (!r.ok) {
      console.error("whatsapp reminder send failed", maskPhone(job.external_id), r.status);
      await releaseKeys(job, items);   // the next run (still inside the lead window) retries
    } else sent++;
    await deps.log({
      business_id: biz, site_id: job.site_id, profile_id: job.profile_id, direction: "out", kind: single ? "reminder" : "reminder_list",
      template_name: single ? "checklist_reminder" : "checklist_reminder_list",
      billable: r.ok && isBillable(ident?.last_inbound_at, now), wa_message_id: r.id,
    });
  }
  return sent;
}

async function correctiveBusiness(biz: string, list: Ident[], sites: Map<string, SiteRow>, now: Date): Promise<void> {
  // Only WhatsApp-recorded answers (app completions have their own corrective flow), last 2 days.
  const { data: needed, error } = await admin.from("checklist_responses")
    .select("id, value, item:checklist_template_items(name, unit, item_type), completion:checklist_completions!inner(business_id, site_id, completed_by, completed_at, source)")
    .eq("corrective_status", "needed").eq("completion.business_id", biz).eq("completion.source", "whatsapp")
    .gte("completion.completed_at", new Date(now.getTime() - 2 * DAY_MS).toISOString());
  if (error) throw error;
  const rows: Any[] = (needed ?? []).filter((n: Any) => n.completion?.site_id && n.completion?.completed_by);
  if (!rows.length) return;

  const ids = rows.map((n) => n.id);
  const { data: logs, error: logErr } = await admin.from("channel_messages_log").select("kind, ref_id")
    .eq("business_id", biz).in("ref_id", ids).in("kind", ["corrective_nudge", "alert_no_action"]);
  if (logErr) throw logErr;
  const nudged = new Set((logs ?? []).filter((l: Any) => l.kind === "corrective_nudge").map((l: Any) => l.ref_id));
  const alerted = new Set((logs ?? []).filter((l: Any) => l.kind === "alert_no_action").map((l: Any) => l.ref_id));
  const plan = planCorrective({
    now, nudged, alerted,
    needed: rows.map((n) => ({ response_id: n.id, completed_by: n.completion.completed_by, business_id: biz, site_id: n.completion.site_id, created_at: n.completion.completed_at })),
  });

  for (const a of plan) {
    const n = rows.find((x) => x.id === a.response_id)!;
    const site = sites.get(n.completion.site_id);
    if (a.action === "nudge") {
      const ident = list.find((i) => i.profile_id === n.completion.completed_by);
      // Claim first; if the person is no longer linked the claim alone records the step (the 60-min manager alert still follows).
      const logId = await claimStep({ business_id: biz, site_id: n.completion.site_id, profile_id: ident ? n.completion.completed_by : null,
        kind: "corrective_nudge", template_name: ident ? "corrective_nudge" : undefined, ref_id: a.response_id });
      if (logId === null || !ident) continue;
      const r = await waSend!(templateMessage(ident.external_id, "corrective_nudge", [site?.name ?? ""], ["checks"]));
      if (!r.ok) console.error("whatsapp nudge send failed", maskPhone(ident.external_id), r.status);
      const { error: upErr } = await admin.from("channel_messages_log")
        .update({ billable: r.ok && isBillable(ident.last_inbound_at, now), wa_message_id: r.id }).eq("id", logId);
      if (upErr) console.error("whatsapp nudge log update failed", errMsg(upErr));
    } else {
      const logId = await claimStep({ business_id: biz, site_id: n.completion.site_id, profile_id: null, kind: "alert_no_action", ref_id: a.response_id });
      if (logId === null) continue;
      // Per-manager sends are logged separately by alertManagers (kind 'alert', one row per send).
      const { data: by } = await admin.from("profiles").select("full_name").eq("id", n.completion.completed_by).eq("business_id", biz).maybeSingle();
      await alertManagers(alertDeps, senders, biz, {
        siteName: site?.name ?? "", itemName: n.item?.name ?? "",
        value: withUnit(n.value ?? "", n.item?.unit ?? (n.item?.item_type === "temperature" ? "°C" : null)),
        time: hhmm(n.completion.completed_at, site?.timezone ?? "Europe/London"),
        byName: by?.full_name ?? "", action: "No corrective action recorded",
      }, now);
    }
  }
}

async function housekeeping(now: Date): Promise<void> {
  const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
  const twoDaysAgo = new Date(now.getTime() - 2 * DAY_MS).toISOString();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * DAY_MS).toISOString();
  // Link codes older than a day that are used or expired (two deletes = the OR, without filter-string interpolation).
  const a = await admin.from("channel_link_codes").delete().not("used_at", "is", null).lt("created_at", dayAgo);
  const b = await admin.from("channel_link_codes").delete().lt("expires_at", now.toISOString()).lt("created_at", dayAgo);
  const ga = await admin.from("channel_group_link_codes").delete().not("used_at", "is", null).lt("created_at", dayAgo);
  const gb = await admin.from("channel_group_link_codes").delete().lt("expires_at", now.toISOString()).lt("created_at", dayAgo);
  const c = await admin.from("channel_form_tokens").delete().lt("expires_at", twoDaysAgo);
  const d = await admin.from("channel_reminders_sent").delete().lt("sent_at", sixtyDaysAgo);
  const gd = await admin.from("channel_group_reminders_sent").delete().lt("sent_at", sixtyDaysAgo);
  // Privacy policy: channel message logs are kept for 12 months.
  const yearAgo = new Date(now);
  yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 12);
  const e = await admin.from("channel_messages_log").delete().lt("created_at", yearAgo.toISOString());
  for (const r of [a, b, ga, gb, c, d, gd, e]) if (r.error) console.error("channel housekeeping failed", errMsg(r.error));
}

async function runWhatsApp(now: Date): Promise<{ sent: number; failed: number }> {
  if (!waSend || !waDeps) return { sent: 0, failed: 0 };
  let idents: Ident[];
  try {
    // WhatsApp identities ONLY: Telegram identities belong to group members and never get personal messages.
    idents = await pageAll<Ident>((from, to) => admin.from("channel_identities")
      .select("id, business_id, profile_id, external_id, last_inbound_at").eq("channel", "whatsapp").is("revoked_at", null)
      .order("id").range(from, to));
  } catch (error) {
    console.error("whatsapp reminders: identities query failed", errMsg(error));
    return { sent: 0, failed: 1 };
  }
  const byBiz = new Map<string, Ident[]>();
  for (const i of idents) byBiz.set(i.business_id, [...(byBiz.get(i.business_id) ?? []), i]);
  let sent = 0;
  let failed = 0;
  for (const [biz, list] of byBiz) {
    try {
      if (!(await waDeps.ready(biz))) continue;
      const { data: siteRows, error: siteErr } = await admin.from("sites").select("id, name, timezone").eq("business_id", biz).is("removed_at", null);
      if (siteErr) throw siteErr;
      const sites = new Map<string, SiteRow>((siteRows ?? []).map((s: Any) => [s.id, { name: s.name ?? "", timezone: s.timezone ?? "Europe/London" }]));
      sent += await remindBusiness(waDeps, waSend, biz, list, sites, now);
      await correctiveBusiness(biz, list, sites, now);
    } catch (err) {
      failed++;
      console.error("whatsapp reminders: business run failed", biz, errMsg(err));
    }
  }
  return { sent, failed };
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  const now = new Date();
  if (!waSend && !tgApi) console.error("channel reminders: neither TG_BOT_TOKEN nor WA_TOKEN/WA_PHONE_NUMBER_ID is set — only housekeeping runs");
  const wa = await runWhatsApp(now);
  let groups: GroupRunResult | null = null;
  if (tgApi) {
    try { groups = await runTelegramGroups(groupDeps, tgApi, now); }
    catch (err) { console.error("telegram groups run failed", errMsg(err)); }
  }
  await housekeeping(now);
  return new Response(JSON.stringify({ ok: true, sent: wa.sent, failed: wa.failed, groups }), { headers: { "Content-Type": "application/json" } });
});
```

- [ ] **Step 6: Delete** `supabase/functions/_shared/channels/tg-reminder.ts` and `src/lib/whatsapp/__tests__/tg-reminder.test.ts`. Confirm nothing else imports it: `grep -rn "tg-reminder" supabase src` → no output.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/lib/whatsapp/__tests__/reminders.test.ts src/lib/whatsapp/__tests__/tg-cron.test.ts && npm test`
Expected: PASS.

- [ ] **Step 8: Typecheck** — `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `4`; `cd supabase/functions && deno check whatsapp-reminders/index.ts telegram-webhook/index.ts channel-form/index.ts whatsapp-webhook/index.ts` → ok.

- [ ] **Step 9: Commit**

```bash
git add -A supabase/functions/_shared/checklists-core/reminders.ts supabase/functions/_shared/channels/tg-cron.ts supabase/functions/whatsapp-reminders/index.ts supabase/functions/_shared/channels/tg-reminder.ts src/lib/whatsapp/__tests__
git commit -m "feat(telegram): group reminders, live-list refresh and daily permission check in the cron; drop personal Telegram reminders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Group form API — membership, mapping, first submit wins, auto-profile, consent, group alerts, list refresh

**Files:**
- Modify: `supabase/functions/_shared/channels/alerts.ts` (add `alertGroups`, `groupAlertText`; manager recipients WhatsApp-only)
- Rewrite: `supabase/functions/_shared/channels/form-api.ts`
- Rewrite: `supabase/functions/channel-form/index.ts` (deps only; CORS/body handling unchanged)
- Test: rewrite `src/lib/whatsapp/__tests__/form-api.test.ts`; append to `src/lib/whatsapp/__tests__/alerts.test.ts`

**Interfaces:**
- Consumes: `GroupDeps`, `GroupFormToken`, `ChannelGroup`, `notifyManagers`, `makeGroupDeps` (Task 4); `refreshGroupSite` (Task 5); `memberStatus`, `tgText`, `tgOutcome`, `TgApi`, `TgUser`, `verifyInitData`, `makeTelegramApi` (Task 2); `telegramDisplayName` (Task 4); `recordCompletion` (`record.ts`, GroupDeps extends CoreDb); `CORRECTIVE_ACTIONS`; fakes (Task 5).
- Produces:

```ts
// alerts.ts
export const groupAlertText: (a: ManagerAlert) => string   // same text as the old Telegram manager alert
export async function alertGroups(g: Pick<GroupDeps, 'groupById' | 'alertGroups' | 'markGroupUnlinked' | 'now'>, api: TgApi, businessId: string, sourceGroupId: string | null, a: ManagerAlert): Promise<void>
// makeAlertDeps(admin).managerRecipients now returns WhatsApp identities only.

// form-api.ts
export interface FormApiDeps {
  g: GroupDeps
  api: TgApi
  verifyInitData(initData: string): Promise<TgUser | null>
  alertManagers(businessId: string, a: ManagerAlert): Promise<void>   // WhatsApp-linked owners/managers
}
export const consentText: (business: string) => string
export async function handleFormGet(d: FormApiDeps, token: string, initData: string): Promise<{ status: number; body: unknown }>
export async function handleFormPost(d: FormApiDeps, body: unknown, initData: string): Promise<{ status: number; body: unknown }>
```

Response contract for the Mini App (Task 9 relies on it):
- 200 GET `{ templateName, siteName, items: [{ id, name, type, required, min, max, unit }], correctiveActions, consent: string | null }`; 200 POST `{ ok: true }`
- 400 `{ error: 'bad_request' | 'missing' | 'corrective_required', items? }`; 401 `{ error: 'unauthorized' }`
- 403 `{ error: 'not_member' }` / `{ error: 'unavailable' }`
- 410 `{ error: 'expired' }` / `{ error: 'moved' }` / `{ error: 'changed' }` / `{ error: 'used', by: string | null }`
- 500 `{ error: 'retry' }`; 503 `{ error: 'retry_later' }` (Telegram did not answer the membership check)

- [ ] **Step 1: Write the failing tests** — replace `src/lib/whatsapp/__tests__/form-api.test.ts` entirely:

```ts
// src/lib/whatsapp/__tests__/form-api.test.ts
import { describe, it, expect } from 'vitest'
import { handleFormGet, handleFormPost, consentText, type FormApiDeps } from '../../../../supabase/functions/_shared/channels/form-api'
import { CORRECTIVE_ACTIONS } from '../../../../supabase/functions/_shared/channels/whatsapp-flows'
import type { GroupFormToken } from '../../../../supabase/functions/_shared/channels/groups-db'
import type { TemplateItem } from '../../../../supabase/functions/_shared/checklists-core/types'
import { fakeGroupDeps, fakeTgApi, groupRow, GROUP, NOW, tpl } from './fakes/group-deps'

const T = tpl({ id: 't1', name: 'Fridge temps', deadline_time: '11:00' })
const T2 = tpl({ id: 't2', name: 'Cleaning' })
const ITEMS: TemplateItem[] = [
  { id: 'i1', name: 'Walk-in fridge', item_type: 'temperature', required: true, min_value: 0, max_value: 5, unit: '°C', sort_order: 0 },
  { id: 'i2', name: 'Door seals OK', item_type: 'yes_no', required: true, min_value: null, max_value: null, unit: null, sort_order: 1 },
  { id: 'i3', name: 'Notes', item_type: 'text', required: false, min_value: null, max_value: null, unit: null, sort_order: 2 },
  { id: 'i4', name: 'Photo', item_type: 'photo', required: false, min_value: null, max_value: null, unit: null, sort_order: 3 },
]
const tok = (o: Partial<GroupFormToken> = {}): GroupFormToken => ({
  token: 'tokA', kind: 'group_checklist', business_id: 'b', group_id: 'g1', site_id: 's1', template_id: 't1',
  item_ids: ['i1', 'i2', 'i3'], expires_at: '2026-10-15T09:00:00Z', used_at: null, used_by_name: null, ...o,
})
// Telegram users: 111 Anna Smith (member), 222 Ben (member), 333 Eve (left), 444 restricted non-member, 555 restricted member, 999 → API down
const USERS: Record<string, { userId: string; firstName: string; lastName: string }> = {
  anna: { userId: '111', firstName: 'Anna', lastName: 'Smith' }, ben: { userId: '222', firstName: 'Ben', lastName: '' },
  eve: { userId: '333', firstName: 'Eve', lastName: '' }, rex: { userId: '444', firstName: 'Rex', lastName: '' },
  ria: { userId: '555', firstName: 'Ria', lastName: '' }, dan: { userId: '999', firstName: 'Dan', lastName: '' },
}
const memberApi = (left: Set<string> = new Set(['333'])) => fakeTgApi((m, body) => {
  if (m !== 'getChatMember') return undefined
  const u = String(body.user_id)
  if (u === '999') return { ok: false, status: 0, description: 'network', result: null }
  if (u === '444') return { result: { status: 'restricted', is_member: false } }
  if (u === '555') return { result: { status: 'restricted', is_member: true } }
  return { result: { status: left.has(u) ? 'left' : 'member' } }
})

function setup(init: Parameters<typeof fakeGroupDeps>[0] = {}, api = memberApi()) {
  const f = fakeGroupDeps({
    templates: [T, T2], mappings: [{ group_id: 'g1', template_id: 't1' }, { group_id: 'g1', template_id: 't2' }],
    items: { t1: ITEMS }, tokens: [tok(), tok({ token: 'tokB', template_id: 't2', item_ids: ['i1'] })], ...init,
  })
  const waAlerts: any[] = []
  const d: FormApiDeps = {
    g: f.d, api: api.api,
    verifyInitData: async (s) => USERS[s] ?? null,
    alertManagers: async (b, a) => { waAlerts.push({ b, ...a }) },
  }
  return { d, s: f.s, calls: api.calls, waAlerts }
}
const ok = { t: 'tokA', answers: { i1: '3', i2: 'yes' }, corrective: {} }
const sends = (calls: { method: string; body: any }[]) => calls.filter((c) => c.method === 'sendMessage').map((c) => [c.body.chat_id, c.body.text])

describe('GET', () => {
  it('a group member gets the form; first time in this business → consent notice; GET never consumes', async () => {
    const { d, s, calls } = setup()
    const r = await handleFormGet(d, 'tokA', 'anna')
    expect(r).toEqual({ status: 200, body: {
      templateName: 'Fridge temps', siteName: 'Wharf Side',
      items: [
        { id: 'i1', name: 'Walk-in fridge', type: 'temperature', required: true, min: 0, max: 5, unit: '°C' },
        { id: 'i2', name: 'Door seals OK', type: 'yes_no', required: true, min: null, max: null, unit: null },
        { id: 'i3', name: 'Notes', type: 'text', required: false, min: null, max: null, unit: null },
      ],
      correctiveActions: CORRECTIVE_ACTIONS,
      consent: "Your name will be recorded with checks in Fern & Fig's food safety records.",
    } })
    expect(consentText('Fern & Fig')).toBe("Your name will be recorded with checks in Fern & Fig's food safety records.")
    expect(calls).toEqual([{ method: 'getChatMember', body: { chat_id: '-1001', user_id: 111 } }])
    expect(s.tokens[0].used_at).toBeNull()
  })
  it('known person in this business → no consent notice', async () => {
    const { d } = setup({ identities: [{ business_id: 'b', tg_user_id: '111', profile_id: 'p1' }], people: [{ profile_id: 'p1', business_id: 'b', full_name: 'Anna Smith', role: 'kitchen_staff', role_id: 'r' }] })
    expect(((await handleFormGet(d, 'tokA', 'anna')).body as any).consent).toBeNull()
  })
  it('invalid initData → 401', async () => expect(await handleFormGet(setup().d, 'tokA', 'forged')).toEqual({ status: 401, body: { error: 'unauthorized' } }))
  it('left / restricted non-member → 403 not_member; restricted member → 200; Telegram down → 503', async () => {
    const { d } = setup()
    expect(await handleFormGet(d, 'tokA', 'eve')).toEqual({ status: 403, body: { error: 'not_member' } })
    expect(await handleFormGet(d, 'tokA', 'rex')).toEqual({ status: 403, body: { error: 'not_member' } })
    expect((await handleFormGet(d, 'tokA', 'ria')).status).toBe(200)
    expect(await handleFormGet(d, 'tokA', 'dan')).toEqual({ status: 503, body: { error: 'retry_later' } })
  })
  it('unknown, expired or old personal token → 410 expired', async () => {
    const { d } = setup({ tokens: [tok({ expires_at: '2026-10-14T09:00:00Z' })] })
    expect(await handleFormGet(d, 'tokA', 'anna')).toEqual({ status: 410, body: { error: 'expired' } })
    expect(await handleFormGet(d, 'nope', 'anna')).toEqual({ status: 410, body: { error: 'expired' } })
    expect(await handleFormGet(d, 'bad token!', 'anna')).toEqual({ status: 410, body: { error: 'expired' } })
    // A personal reminder token (kind 'checklist') is invisible to peekGroupToken → expired, never a 500.
    const personal = setup({}, memberApi())
    personal.d.g.peekGroupToken = async () => null
    expect(await handleFormGet(personal.d, 'oldPersonalTok', 'anna')).toEqual({ status: 410, body: { error: 'expired' } })
  })
  it('group unlinked or checklist no longer mapped → 410 moved', async () => {
    const unlinked = setup({ groups: [groupRow(GROUP, { unlinked_at: '2026-10-14T09:00:00Z' })] })
    expect(await handleFormGet(unlinked.d, 'tokA', 'anna')).toEqual({ status: 410, body: { error: 'moved' } })
    const unmapped = setup({ mappings: [{ group_id: 'g1', template_id: 't2' }] })
    expect(await handleFormGet(unmapped.d, 'tokA', 'anna')).toEqual({ status: 410, body: { error: 'moved' } })
    const otherSite = setup({ templates: [{ ...T, site_id: 's2' }, T2] })
    expect(await handleFormGet(otherSite.d, 'tokA', 'anna')).toEqual({ status: 410, body: { error: 'moved' } })
  })
  it('team not ready → 403 unavailable; items re-created → 410 changed', async () => {
    expect(await handleFormGet(setup({ ready: { b: false } }).d, 'tokA', 'anna')).toEqual({ status: 403, body: { error: 'unavailable' } })
    const changed = setup({ items: { t1: ITEMS.map((i) => ({ ...i, id: i.id + 'x' })) } })
    expect(await handleFormGet(changed.d, 'tokA', 'anna')).toEqual({ status: 410, body: { error: 'changed' } })
  })
})

describe('POST', () => {
  it('new person: profile + identity created, completion recorded as telegram, managers told, no "Recorded" chat message', async () => {
    const { d, s, calls } = setup()
    expect(await handleFormPost(d, ok, 'anna')).toEqual({ status: 200, body: { ok: true } })
    expect(s.created).toEqual([{ businessId: 'b', siteId: 's1', tgUserId: '111', displayName: 'Anna S.' }])
    expect(s.completionRows).toEqual([expect.objectContaining({ template_id: 't1', site_id: 's1', completed_by: 'new1', source: 'telegram' })])
    expect(s.responses.map((r) => [r.item_id, r.value, r.flagged])).toEqual([['i1', '3', false], ['i2', 'yes', false]])
    expect(s.notifications).toEqual([expect.objectContaining({ user_id: 'm1', type: 'team', title: 'New person in Telegram checks', link: '/team' })])
    expect(s.tokens[0]).toMatchObject({ used_by_name: 'Anna' })
    expect(sends(calls)).toEqual([])
  })
  it('first submit wins: the second person gets "used" with the winner\'s first name (GET and POST)', async () => {
    const { d, s } = setup()
    await handleFormPost(d, ok, 'anna')
    expect(await handleFormPost(d, ok, 'ben')).toEqual({ status: 410, body: { error: 'used', by: 'Anna' } })
    expect(await handleFormGet(d, 'tokA', 'ben')).toEqual({ status: 410, body: { error: 'used', by: 'Anna' } })
    expect(s.completionRows).toHaveLength(1)
  })
  it('lost the race after the peek → used with the winner\'s name', async () => {
    const { d, s } = setup()
    const take = d.g.takeGroupToken
    d.g.takeGroupToken = async (t, now) => { await take(t, now, 'Ben'); return null }
    expect(await handleFormPost(d, ok, 'anna')).toEqual({ status: 410, body: { error: 'used', by: 'Ben' } })
    expect(s.completionRows).toEqual([])
  })
  it('existing identity is reused: no new profile, no new-person notification', async () => {
    const { d, s } = setup({ identities: [{ business_id: 'b', tg_user_id: '111', profile_id: 'p1' }], people: [{ profile_id: 'p1', business_id: 'b', full_name: 'Anna Smith', role: 'kitchen_staff', role_id: 'r' }] })
    expect((await handleFormPost(d, ok, 'anna')).status).toBe(200)
    expect(s.created).toEqual([])
    expect(s.completionRows[0].completed_by).toBe('p1')
    expect(s.notifications).toEqual([])
  })
  it('a person known in another business gets a new profile in this one', async () => {
    const { d, s } = setup({ identities: [{ business_id: 'b2', tg_user_id: '111', profile_id: 'px' }], people: [{ profile_id: 'px', business_id: 'b2', full_name: 'Anna Smith', role: 'kitchen_staff', role_id: 'r' }] })
    expect((await handleFormPost(d, ok, 'anna')).status).toBe(200)
    expect(s.created).toEqual([{ businessId: 'b', siteId: 's1', tgUserId: '111', displayName: 'Anna S.' }])
  })
  it('the same new person submitting two checks gets one profile; consent notice only the first time', async () => {
    const { d, s } = setup()
    await handleFormPost(d, ok, 'anna')
    expect(((await handleFormGet(d, 'tokB', 'anna')).body as any).consent).toBeNull()
    expect((await handleFormPost(d, { t: 'tokB', answers: { i1: '4' }, corrective: {} }, 'anna')).status).toBe(200)
    expect(s.created).toHaveLength(1)
    expect(s.completionRows.map((c) => c.completed_by)).toEqual(['new1', 'new1'])
  })
  it('removed from the group between opening and submitting → 403, nothing recorded', async () => {
    const left = new Set<string>()
    const api = memberApi(left)
    const { d, s } = setup({}, api)
    expect((await handleFormGet(d, 'tokA', 'anna')).status).toBe(200)
    left.add('111')
    expect(await handleFormPost(d, ok, 'anna')).toEqual({ status: 403, body: { error: 'not_member' } })
    expect(s.completionRows).toEqual([])
    expect(s.tokens[0].used_at).toBeNull()
  })
  it('missing required → 400 and the token stays usable', async () => {
    const { d, s } = setup()
    expect(await handleFormPost(d, { t: 'tokA', answers: { i1: '3' }, corrective: {} }, 'anna')).toEqual({ status: 400, body: { error: 'missing', items: ['Door seals OK'] } })
    expect(s.tokens[0].used_at).toBeNull()
  })
  it('out of range without an action → 400; with an action → recorded, alerts to the source group and every alerts group once, WhatsApp managers told', async () => {
    const alertsGroup = groupRow({ id: 'g2', business_id: 'b', channel: 'telegram', chat_id: '-1002', title: 'Managers', alerts: true })
    const { d, s, calls, waAlerts } = setup({ groups: [groupRow(GROUP), alertsGroup] })
    const bad = { t: 'tokA', answers: { i1: '9', i2: 'yes' }, corrective: {} }
    expect(await handleFormPost(d, bad, 'anna')).toEqual({ status: 400, body: { error: 'corrective_required', items: ['Walk-in fridge'] } })
    const fixed = { ...bad, corrective: { i1: { action: 'moved', details: 'to fridge 2' } } }
    expect(await handleFormPost(d, fixed, 'anna')).toEqual({ status: 200, body: { ok: true } })
    expect(s.responses[0]).toMatchObject({ item_id: 'i1', value: '9', flagged: true, corrective_status: 'done', notes: 'Moved food to another fridge: to fridge 2' })
    const text = '⚠ Wharf Side · Walk-in fridge 9 °C at 10:40 (Anna S.). Action: Moved food to another fridge: to fridge 2. — via Blueroll'
    expect(sends(calls)).toEqual([['-1001', text], ['-1002', text]])
    expect(waAlerts).toEqual([{ b: 'b', siteName: 'Wharf Side', itemName: 'Walk-in fridge', value: '9 °C', time: '10:40', byName: 'Anna S.', action: 'Moved food to another fridge: to fridge 2' }])
  })
  it('the source group is also the alerts group → one alert there', async () => {
    const { d, calls } = setup({ groups: [groupRow({ ...GROUP, alerts: true })] })
    await handleFormPost(d, { t: 'tokA', answers: { i1: '9', i2: 'yes' }, corrective: { i1: { action: 'moved' } } }, 'anna')
    expect(sends(calls).map((x) => x[0])).toEqual(['-1001'])
  })
  it('after a submit the group list for that site is refreshed', async () => {
    const { d, calls } = setup({ lists: [{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '55', tokens: { t1: 'tokA', t2: 'tokB' }, rendered_hash: 'old' }] })
    await handleFormPost(d, ok, 'anna')
    const edit = calls.find((c) => c.method === 'editMessageText')!
    expect(edit.body).toMatchObject({ chat_id: '-1001', message_id: 55 })
    expect(edit.body.text).toContain('✅ Fridge temps · 10:40 Anna')
  })
  it('recording fails → token released, 500 retry', async () => {
    const { d, s } = setup()
    d.g.insertCompletion = async () => { throw new Error('db down') }
    expect(await handleFormPost(d, ok, 'anna')).toEqual({ status: 500, body: { error: 'retry' } })
    expect(s.tokens[0]).toMatchObject({ used_at: null, used_by_name: null })
  })
  it('bad bodies: 401 without valid initData, else 400', async () => {
    const { d } = setup()
    expect(await handleFormPost(d, null, 'forged')).toEqual({ status: 401, body: { error: 'unauthorized' } })
    expect(await handleFormPost(d, null, 'anna')).toEqual({ status: 400, body: { error: 'bad_request' } })
    expect(await handleFormPost(d, { t: 'tokA', answers: [] }, 'anna')).toEqual({ status: 400, body: { error: 'bad_request' } })
  })
})
```

Append to `src/lib/whatsapp/__tests__/alerts.test.ts` (extend the import with `makeAlertDeps, alertGroups, groupAlertText`, and import `fakeGroupDeps, fakeTgApi, groupRow, GROUP` from `./fakes/group-deps`):

```ts
describe('makeAlertDeps.managerRecipients', () => {
  it('reads WhatsApp identities only (group members\' Telegram identities never get personal alerts)', async () => {
    const calls: string[] = []
    const table = (t: string, rows: any[]) => {
      const q: any = {}
      for (const m of ['select', 'eq', 'in', 'is']) q[m] = (...args: any[]) => { calls.push(`${t}.${m}${JSON.stringify(args)}`); return q }
      q.then = (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej)
      return q
    }
    const admin = { from: (t: string) => table(t, t === 'profiles' ? [{ id: 'm1' }] : [{ channel: 'whatsapp', external_id: '447700900999', last_inbound_at: null }]) }
    expect(await makeAlertDeps(admin).managerRecipients('b')).toEqual([{ channel: 'whatsapp', external_id: '447700900999', last_inbound_at: null }])
    expect(calls).toContain('channel_identities.eq["channel","whatsapp"]')
    expect(calls.some((c) => c.includes('telegram'))).toBe(false)
  })
})

describe('alertGroups', () => {
  it('source group + every alerts group, once each; a kicked bot unlinks that group', async () => {
    const g2 = groupRow({ id: 'g2', business_id: 'b', channel: 'telegram', chat_id: '-1002', title: 'Managers', alerts: true })
    const g3 = groupRow({ id: 'g3', business_id: 'b', channel: 'telegram', chat_id: '-1003', title: 'Owners', alerts: true })
    const { d, s } = fakeGroupDeps({ groups: [groupRow(GROUP), g2, g3] })
    const { api, calls } = fakeTgApi((_m, body) => (body.chat_id === '-1003' ? { ok: false, status: 403, description: 'Forbidden: bot was kicked from the group chat' } : undefined))
    await alertGroups(d, api, 'b', 'g1', A)
    expect(calls.map((c) => c.body)).toEqual([
      { chat_id: '-1001', text: groupAlertText(A) }, { chat_id: '-1002', text: groupAlertText(A) }, { chat_id: '-1003', text: groupAlertText(A) },
    ])
    expect(groupAlertText(A)).toBe('⚠ Wharf Side · Walk-in fridge 9 °C at 10:40 (Anna). Action: Moved food to another fridge. — via Blueroll')
    expect(s.groups.find((g) => g.id === 'g3')!.unlinked_at).not.toBeNull()
  })
  it('a source group of another business is ignored', async () => {
    const { d } = fakeGroupDeps({ groups: [groupRow({ ...GROUP, business_id: 'other' })] })
    const { api, calls } = fakeTgApi()
    await alertGroups(d, api, 'b', 'g1', A)
    expect(calls).toEqual([])
  })
})
```

(`A` is the alert object already defined at the top of `alerts.test.ts`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/form-api.test.ts src/lib/whatsapp/__tests__/alerts.test.ts`
Expected: FAIL — `consentText`/`alertGroups`/`groupAlertText` not exported; handlers still personal.

- [ ] **Step 3: Implement the `alerts.ts` changes**

(a) In `makeAlertDeps` → `managerRecipients`, replace `.in('channel', ['whatsapp', 'telegram'])` with `.eq('channel', 'whatsapp')` and update the comment above `managerRecipients` in `AlertDeps` to: `/** WhatsApp identities of active owners/managers. Telegram alerts go to groups (alertGroups), never to personal chats. */`.

(b) Add imports and the group alert:

```ts
import { tgText, tgOutcome, type TgApi } from './telegram.ts'
import type { GroupDeps, ChannelGroup } from './groups-db.ts'

/** Plain text (no parse mode), same wording as the old personal Telegram manager alert. */
export const groupAlertText = (a: ManagerAlert) =>
  `⚠ ${a.siteName} · ${a.itemName} ${a.value} at ${a.time} (${a.byName}). Action: ${a.action}. — via Blueroll`

/** Spec §2: the group where the check was filled in + every group marked "Alerts" in that business, once each. */
export async function alertGroups(g: Pick<GroupDeps, 'groupById' | 'alertGroups' | 'markGroupUnlinked' | 'now'>, api: TgApi, businessId: string, sourceGroupId: string | null, a: ManagerAlert): Promise<void> {
  const targets = new Map<string, ChannelGroup>()
  if (sourceGroupId) {
    const src = await g.groupById(sourceGroupId)
    if (src && src.business_id === businessId) targets.set(src.id, src)
  }
  for (const x of await g.alertGroups(businessId)) targets.set(x.id, x)
  for (const t of targets.values()) {
    try {
      const r = await api('sendMessage', tgText(t.chat_id, groupAlertText(a)))
      // Bot removed from an alerts group without us hearing about it: unlink; the cron takes its lists down.
      if (!r.ok && tgOutcome(r) === 'kicked') await g.markGroupUnlinked(t.id, g.now())
      else if (!r.ok) console.error('group alert failed', t.chat_id, r.status)
    } catch (err) {
      console.error('group alert failed', t.chat_id, String((err as Error)?.message ?? err).slice(0, 200))
    }
  }
}
```

- [ ] **Step 4: Rewrite `form-api.ts`**

```ts
// supabase/functions/_shared/channels/form-api.ts
// Telegram Mini App form API for GROUP checklists (spec §5, §6). Pure over FormApiDeps (unit-tested with fakes);
// channel-form/index.ts wires it to Supabase + the Bot API.
//
// Order for both handlers: initData signature (401) → token shape/kind (410 expired) → group still linked (410 moved)
// → Telegram membership of that group (403 not_member / 503 retry_later) → token used (410 used + winner's first name)
// / expired (410) → team can use Telegram (403 unavailable) → checklist still mapped + site valid (410 moved) → item ids
// unchanged (410 changed). POST validates answers BEFORE taking the token; the atomic take decides "first submit wins".
import type { Person, Template, TemplateItem } from '../checklists-core/types.ts'
import { fieldName, formItems, parseFormAnswers } from '../checklists-core/answers.ts'
import { recordCompletion } from '../checklists-core/record.ts'
import { CORRECTIVE_ACTIONS } from './whatsapp-flows.ts'
import { withUnit, type SiteInfo } from './bot.ts'
import { memberStatus, type TgApi, type TgUser } from './telegram.ts'
import { notifyManagers, type ChannelGroup, type GroupDeps, type GroupFormToken } from './groups-db.ts'
import { refreshGroupSite } from './tg-live.ts'
import { alertGroups } from './alerts.ts'
import type { ManagerAlert } from './ui.ts'
import { telegramDisplayName } from './members.ts'

export interface FormApiDeps {
  g: GroupDeps
  api: TgApi
  verifyInitData(initData: string): Promise<TgUser | null>
  /** WhatsApp-linked owners/managers (alerts.ts alertManagers). Telegram alerts go to groups. */
  alertManagers(businessId: string, a: ManagerAlert): Promise<void>
}

export const consentText = (business: string) => `Your name will be recorded with checks in ${business}'s food safety records.`

type Res = { status: number; body: unknown }
const res = (status: number, body: unknown): Res => ({ status, body })
const UNAUTHORIZED = res(401, { error: 'unauthorized' })
const NOT_MEMBER = res(403, { error: 'not_member' })
const UNAVAILABLE = res(403, { error: 'unavailable' })
const EXPIRED = res(410, { error: 'expired' })
const MOVED = res(410, { error: 'moved' })
const CHANGED = res(410, { error: 'changed' })
const RETRY_LATER = res(503, { error: 'retry_later' })
const used = (by: string | null) => res(410, { error: 'used', by })
const DETAILS_MAX = 300
const TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const own = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined
const errMsg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200)

type Ctx = { user: TgUser; tok: GroupFormToken; group: ChannelGroup; site: SiteInfo; template: Template; items: TemplateItem[] }

/** Shared checks for GET and POST. Never consumes the token. */
async function authorize(d: FormApiDeps, token: string, initData: string): Promise<Res | Ctx> {
  const user = initData ? await d.verifyInitData(initData) : null
  if (!user) return UNAUTHORIZED
  const tok = TOKEN_RE.test(token) ? await d.g.peekGroupToken(token) : null
  if (!tok) return EXPIRED
  const group = await d.g.groupById(tok.group_id)
  if (!group || group.business_id !== tok.business_id) return MOVED
  // Spec §5: checked on every open and submit — someone removed from the group can't submit from an open form.
  const m = memberStatus(await d.api('getChatMember', { chat_id: group.chat_id, user_id: Number(user.userId) }))
  if (m === 'not_member') return NOT_MEMBER
  if (m === 'unknown') return RETRY_LATER
  if (tok.used_at) return used(tok.used_by_name)
  if (new Date(tok.expires_at).getTime() <= d.g.now().getTime()) return EXPIRED
  if (!(await d.g.ready(group.business_id))) return UNAVAILABLE
  const [templates, sites] = await Promise.all([d.g.mappedTemplates(group.id), d.g.sites(group.business_id)])
  const template = templates.find((t) => t.id === tok.template_id && (t.site_id === null || t.site_id === tok.site_id))
  const site = sites.find((s) => s.id === tok.site_id)
  if (!template || !site) return MOVED
  const items = await d.g.items(template.id)
  const known = new Set(items.map((i) => i.id))
  // Editors delete + re-insert items on save: stale ids can't be mapped safely → the page asks to reopen the list.
  if (!tok.item_ids.length || tok.item_ids.some((x) => !known.has(x))) return CHANGED
  return { user, tok, group, site, template, items }
}

export async function handleFormGet(d: FormApiDeps, token: string, initData: string): Promise<Res> {
  const a = await authorize(d, token, initData)
  if ('status' in a) return a
  const supported = new Map(formItems(a.items).supported.map((i) => [i.id, i]))
  const items = a.tok.item_ids.map((id) => supported.get(id)).filter((i): i is TemplateItem => !!i)
    .map((i) => ({ id: i.id, name: i.name, type: i.item_type, required: i.required, min: i.min_value, max: i.max_value, unit: i.unit }))
  const known = await d.g.telegramIdentity(a.group.business_id, a.user.userId)
  const consent = known ? null : consentText(await d.g.businessName(a.group.business_id))
  return res(200, { templateName: a.template.name, siteName: a.site.name, items, correctiveActions: CORRECTIVE_ACTIONS, consent })
}

async function personFor(d: FormApiDeps, a: Ctx): Promise<{ person: Person; created: boolean }> {
  const ident = await d.g.telegramIdentity(a.group.business_id, a.user.userId)
  const existing = ident ? await d.g.person(ident.profile_id) : null
  if (existing) return { person: existing, created: false }
  const c = await d.g.createTelegramPerson({
    businessId: a.group.business_id, siteId: a.site.id, tgUserId: a.user.userId,
    displayName: telegramDisplayName(a.user.firstName, a.user.lastName),
  })
  const person = await d.g.person(c.profile_id)
  if (!person) throw new Error('group member profile missing after create')
  return { person, created: c.created }
}

export async function handleFormPost(d: FormApiDeps, body: unknown, initData: string): Promise<Res> {
  const bad = res(400, { error: 'bad_request' })
  const answersIn = isObj(body) ? (body.answers ?? {}) : null
  const correctiveIn = isObj(body) ? (body.corrective ?? {}) : null
  if (!isObj(body) || typeof body.t !== 'string' || !body.t || !isObj(answersIn) || !isObj(correctiveIn)) {
    // Still require a valid initData first so an anonymous caller learns nothing beyond 401.
    return (initData && (await d.verifyInitData(initData))) ? bad : UNAUTHORIZED
  }
  const a = await authorize(d, body.t, initData)
  if ('status' in a) return a

  // Answers keyed by item id → f<i> by the token's item order, so validation is identical to the WhatsApp Flow path.
  const response: Record<string, unknown> = {}
  a.tok.item_ids.forEach((id, i) => { response[fieldName(i)] = own(answersIn, id) })
  const parsed = parseFormAnswers(a.tok.item_ids, a.items, response)
  if (parsed.missingRequired.length) return res(400, { error: 'missing', items: parsed.missingRequired })

  const byId = new Map(a.items.map((i) => [i.id, i]))
  const notes: Record<string, string> = {}
  const lacking: string[] = []
  for (const x of parsed.answers.filter((p) => p.flagged)) {
    const c = own(correctiveIn, x.item_id)
    const action = isObj(c) && typeof c.action === 'string' ? CORRECTIVE_ACTIONS.find((k) => k.id === c.action) : undefined
    if (!action) { lacking.push(byId.get(x.item_id)!.name); continue }
    const details = isObj(c) && typeof c.details === 'string' ? c.details.trim().slice(0, DETAILS_MAX).trim() : ''
    notes[x.item_id] = details ? `${action.title}: ${details}` : action.title
  }
  if (lacking.length) return res(400, { error: 'corrective_required', items: lacking })

  const now = d.g.now()
  const byName = [...(a.user.firstName.trim() || 'someone')].slice(0, 64).join('')
  const taken = await d.g.takeGroupToken(a.tok.token, now, byName)
  if (!taken) {
    // Someone else's submit won between our peek and take.
    const again = await d.g.peekGroupToken(a.tok.token)
    return again?.used_at ? used(again.used_by_name) : EXPIRED
  }

  let person: Person
  let created: boolean
  let rec: Awaited<ReturnType<typeof recordCompletion>>
  try {
    ({ person, created } = await personFor(d, a))
    rec = await recordCompletion(d.g, { person, siteId: a.site.id, template: a.template, items: a.items, answers: parsed.answers, source: 'telegram', now, correctiveNotes: notes })
  } catch (err) {
    console.error('group form record failed', errMsg(err))
    // Give the token back so the same form can be resubmitted.
    try { await d.g.releaseGroupToken(taken.token, taken.used_at ?? now.toISOString()) }
    catch (e2) { console.error('group form token release failed', errMsg(e2)) }
    return res(500, { error: 'retry' })
  }

  // Everything below is best effort: the record is already saved.
  const safe = async (what: string, f: () => Promise<unknown>) => { try { await f() } catch (err) { console.error(`group form ${what} failed`, errMsg(err)) } }
  if (created) {
    await safe('new-person note', () => notifyManagers(d.g, a.group.business_id, {
      title: 'New person in Telegram checks',
      message: `${person.full_name} filled in ${a.template.name} from the Telegram group “${a.group.title || 'Telegram'}” for the first time.`,
      link: '/team',
    }))
  }
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: a.site.timezone || 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  for (const f of rec.flagged) {
    const alert: ManagerAlert = {
      siteName: a.site.name, itemName: f.item.name, time, byName: person.full_name, action: f.notes ?? '',
      value: withUnit(f.value, f.item.unit ?? (f.item.item_type === 'temperature' ? '°C' : null)),
    }
    await safe('manager alert', () => d.alertManagers(a.group.business_id, alert))
    await safe('group alert', () => alertGroups(d.g, d.api, a.group.business_id, a.group.id, alert))
  }
  await safe('list refresh', () => refreshGroupSite(d.g, d.api, a.group.id, a.site.id, now))
  return res(200, { ok: true })
}
```

- [ ] **Step 5: Rewrite `channel-form/index.ts`** — keep `ALLOWED_ORIGINS`, `MAX_BODY`, `cors`, `json`, `readBody` and `Deno.serve` exactly as they are; replace everything from the imports down to (and including) the `const deps: FormApiDeps = { … };` block with:

```ts
// supabase/functions/channel-form/index.ts
// Telegram Mini App form API for group checklists: GET (header X-Form-Token, or ?t=<token>) → form JSON;
// POST {t, answers, corrective} → record. Deploy with --no-verify-jwt: callers are Telegram users, not Supabase users.
// Authenticity = the Mini App's signed initData (header X-Telegram-Init-Data, HMAC with TG_BOT_TOKEN) + a live group
// token + current membership of that group (getChatMember); all rules in _shared/channels/form-api.ts.
// CORS: https://app.blueroll.app and http://localhost:3001 (dev) only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleFormGet, handleFormPost, type FormApiDeps } from "../_shared/channels/form-api.ts";
import { makeTelegramApi, verifyInitData } from "../_shared/channels/telegram.ts";
import { makeSender } from "../_shared/channels/whatsapp.ts";
import { alertManagers, makeAlertDeps } from "../_shared/channels/alerts.ts";
import { makeGroupDeps } from "../_shared/channels/groups-db.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TOKEN = Deno.env.get("TG_BOT_TOKEN") ?? "";
// WhatsApp sender only when configured: alerts to WhatsApp-linked managers; the function works without any WA env.
const WA_TOKEN = Deno.env.get("WA_TOKEN") ?? "";
const WA_PHONE = Deno.env.get("WA_PHONE_NUMBER_ID") ?? "";
const waSend = WA_TOKEN && WA_PHONE ? makeSender({ token: WA_TOKEN, phoneNumberId: WA_PHONE }) : undefined;

const ALLOWED_ORIGINS = new Set(["https://app.blueroll.app", "http://localhost:3001"]);
const MAX_BODY = 64 * 1024;

const alertDeps = makeAlertDeps(admin);
const deps: FormApiDeps = {
  g: makeGroupDeps(admin, "telegram"),
  api: makeTelegramApi({ token: TOKEN }),
  verifyInitData: (s) => (TOKEN ? verifyInitData(s, TOKEN, new Date()) : Promise.resolve(null)),
  alertManagers: (b, a) => (waSend ? alertManagers(alertDeps, { whatsapp: waSend }, b, a, new Date()) : Promise.resolve()),
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/whatsapp/__tests__/form-api.test.ts src/lib/whatsapp/__tests__/alerts.test.ts && npm test`
Expected: PASS (the existing `alertManagers` tests in `alerts.test.ts` and `bot.test.ts` still pass — the pure function is unchanged).

- [ ] **Step 7: Typecheck** — `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `4`; `cd supabase/functions && deno check channel-form/index.ts telegram-webhook/index.ts whatsapp-reminders/index.ts whatsapp-webhook/index.ts` → ok.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/channels/alerts.ts supabase/functions/_shared/channels/form-api.ts supabase/functions/channel-form/index.ts src/lib/whatsapp/__tests__/form-api.test.ts src/lib/whatsapp/__tests__/alerts.test.ts
git commit -m "feat(telegram): group form API — membership check, first submit wins, auto-profile, group alerts, list refresh

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Mini App page — `start_param`, consent notice, group error texts

**Files:**
- Modify: `src/lib/whatsapp/tg-form.ts`
- Modify: `src/app/tg/form/form.tsx`
- Test: `src/lib/whatsapp/__tests__/tg-form.test.ts` (replace `describe('statusMessage')`, add `resolveToken`)

**Interfaces:**
- Consumes: the channel-form response contract from Task 8 (statuses/errors, `consent`, `by`).
- Produces (`tg-form.ts`):

```ts
export interface FormData { templateName: string; siteName: string; items: FormItem[]; correctiveActions: CorrectiveAction[]; consent: string | null }
export const FORM_MSG: { outside; expired; changed; moved; notMember; unavailable; used; unauthorized; busy; generic; retry }   // strings below
export function usedBy(by: unknown): string                       // 'Already submitted ✓ by Anna' | 'Already submitted ✓'
export function statusMessage(status: number, error: unknown, by?: unknown): string
export function resolveToken(startParam: unknown, queryToken: string): string   // start_param first, then ?t=, else ''
```

Read `node_modules/next/dist/docs/01-app/03-api-reference/02-components/script.md` (the page keeps `<Script strategy="afterInteractive" onReady>`; no change of strategy).

- [ ] **Step 1: Write the failing tests** — in `src/lib/whatsapp/__tests__/tg-form.test.ts` change the import to
`import { normaliseTemp, isFlagged, validateForm, buildPayload, statusMessage, resolveToken, usedBy, FORM_MSG, type FormItem } from '../tg-form'`
and replace `describe('statusMessage', …)` with:

```ts
describe('statusMessage', () => {
  it('group errors use the spec copy', () => {
    expect(statusMessage(403, 'not_member')).toBe("You're no longer in this group.")
    expect(statusMessage(410, 'moved')).toBe('This check was moved — open the list again.')
    expect(statusMessage(410, 'used', 'Anna')).toBe('Already submitted ✓ by Anna')
    expect(statusMessage(410, 'used', null)).toBe('Already submitted ✓')
    expect(statusMessage(410, 'used')).not.toMatch(/expired/i)
  })
  it('other statuses', () => {
    expect(statusMessage(410, 'expired')).toBe(FORM_MSG.expired)
    expect(statusMessage(410, 'changed')).toBe(FORM_MSG.changed)
    expect(statusMessage(401, 'unauthorized')).toBe(FORM_MSG.unauthorized)
    expect(statusMessage(403, 'unavailable')).toBe(FORM_MSG.unavailable)
    expect(statusMessage(503, 'retry_later')).toBe(FORM_MSG.busy)
    expect(statusMessage(500, 'server')).toBe(FORM_MSG.generic)
    expect(FORM_MSG.expired).not.toMatch(/\/checks|send/i)   // no personal chat to send commands to any more
  })
  it('usedBy trims and falls back', () => {
    expect(usedBy('  Ben ')).toBe('Already submitted ✓ by Ben')
    expect(usedBy('')).toBe('Already submitted ✓')
    expect(usedBy(42)).toBe('Already submitted ✓')
  })
})

describe('resolveToken', () => {
  it('direct-link start_param first, then ?t=, rejecting junk', () => {
    expect(resolveToken('abc_DEF-1', 'q')).toBe('abc_DEF-1')
    expect(resolveToken(undefined, 'q1')).toBe('q1')
    expect(resolveToken('bad token!', 'q1')).toBe('q1')
    expect(resolveToken('', '')).toBe('')
    expect(resolveToken(null, 'x'.repeat(129))).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/tg-form.test.ts`
Expected: FAIL — `resolveToken`/`usedBy` not exported; old copy.

- [ ] **Step 3: Implement `tg-form.ts`** — change `FormData` and replace `FORM_MSG` and `statusMessage` (everything else unchanged):

```ts
export interface FormData { templateName: string; siteName: string; items: FormItem[]; correctiveActions: CorrectiveAction[]; consent: string | null }
```

```ts
/** Mini App page copy (group checks: there is no personal chat to send commands to). */
export const FORM_MSG = {
  outside: 'Open this form from Telegram.',
  expired: 'This check has expired — open the list in your group again.',
  changed: 'This checklist was updated — open the list in your group again.',
  moved: 'This check was moved — open the list again.',
  notMember: "You're no longer in this group.",
  unavailable: "Blueroll checks aren't available for this team right now.",
  used: 'Already submitted ✓',
  unauthorized: "Couldn't verify your Telegram session. Close and open the form again from Telegram.",
  busy: "Couldn't check your group membership. Please try again in a minute.",
  generic: 'Something went wrong. Please try again.',
  retry: "Couldn't save your answers. Please press Submit again.",
}

export const usedBy = (by: unknown) => (typeof by === 'string' && by.trim() ? `${FORM_MSG.used} by ${by.trim()}` : FORM_MSG.used)

/** Page message for a non-OK channel-form response (`by` = winner's first name on 410 used). */
export function statusMessage(status: number, error: unknown, by?: unknown): string {
  if (status === 401) return FORM_MSG.unauthorized
  if (status === 403) return error === 'unavailable' ? FORM_MSG.unavailable : FORM_MSG.notMember
  if (status === 410) {
    if (error === 'used') return usedBy(by)
    if (error === 'changed') return FORM_MSG.changed
    if (error === 'moved') return FORM_MSG.moved
    return FORM_MSG.expired
  }
  if (status === 503) return FORM_MSG.busy
  return FORM_MSG.generic
}

const TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/
/** The live list opens the Mini App by direct link (?startapp= → initDataUnsafe.start_param); ?t= stays as a fallback. */
export function resolveToken(startParam: unknown, queryToken: string): string {
  if (typeof startParam === 'string' && TOKEN_RE.test(startParam)) return startParam
  return TOKEN_RE.test(queryToken) ? queryToken : ''
}
```

- [ ] **Step 4: Update `src/app/tg/form/form.tsx`**

(a) Import line → `import { buildPayload, FORM_MSG, isFlagged, resolveToken, statusMessage, validateForm, type Answers, type Corrective, type FormData, type FormItem } from '@/lib/whatsapp/tg-form'`.

(b) In `interface TgWebApp` add `initDataUnsafe?: { start_param?: string }` after `initData: string`.

(c) In `TgForm`, below `const done = useRef(false)` add `const formToken = useRef('')`.

(d) In `init`, replace
```ts
    if (!token) { setPhase({ kind: 'message', text: MSG.expired }); return }
    fetch(API, { method: 'GET', headers: { 'X-Telegram-Init-Data': wa.initData, 'X-Form-Token': token }, cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (r.ok && body && Array.isArray(body.items)) setPhase({ kind: 'form', data: body as FormData })
        else setPhase({ kind: 'message', text: statusMessage(r.status, body?.error) })
      })
```
with
```ts
    const t = resolveToken(wa.initDataUnsafe?.start_param, token)
    formToken.current = t
    if (!t) { setPhase({ kind: 'message', text: MSG.expired }); return }
    fetch(API, { method: 'GET', headers: { 'X-Telegram-Init-Data': wa.initData, 'X-Form-Token': t }, cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (r.ok && body && Array.isArray(body.items)) setPhase({ kind: 'form', data: { ...body, consent: typeof body.consent === 'string' ? body.consent : null } as FormData })
        else setPhase({ kind: 'message', text: statusMessage(r.status, body?.error, body?.by) })
      })
```

(e) In `submit`: `body: JSON.stringify(buildPayload(token, items, answers, corrective))` → `body: JSON.stringify(buildPayload(formToken.current, items, answers, corrective))`; replace the branch
```ts
      } else if (r.status === 401 || r.status === 403 || r.status === 410) {
        setPhase({ kind: 'message', text: statusMessage(r.status, body?.error) })
```
with
```ts
      } else if (r.status === 503) {
        setSubmitError({ text: MSG.busy })
      } else if (r.status === 401 || r.status === 403 || r.status === 410) {
        setPhase({ kind: 'message', text: statusMessage(r.status, body?.error, body?.by) })
```
and in the `useCallback` dependency list of `submit` replace `token` with nothing (remove it: `[phase, v, items, answers, corrective]`).

(f) In the form JSX, right after the `submitError` block (still inside the `phase.kind === 'form'` fragment) add:
```tsx
            {phase.data.consent && <p className="mt-4 text-xs text-[var(--tg-hint)]">{phase.data.consent}</p>}
```

`page.tsx` stays as is (it still passes `?t=` as the fallback token).

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `npx vitest run src/lib/whatsapp/__tests__/tg-form.test.ts && npm test && npx tsc --noEmit 2>&1 | grep -c "error TS" && npx eslint src/app/tg src/lib/whatsapp/tg-form.ts`
Expected: tests PASS; `4`; no ESLint errors.

- [ ] **Step 6: Manual check (dev)** — `npm run dev`, open `http://localhost:3001/tg/form?t=abc` in a normal browser → "Open this form from Telegram." (no crash). Real Telegram check happens in the Task 11 pilot.

- [ ] **Step 7: Commit**

```bash
git add src/lib/whatsapp/tg-form.ts src/app/tg/form/form.tsx src/lib/whatsapp/__tests__/tg-form.test.ts
git commit -m "feat(telegram): Mini App reads start_param, shows the consent notice and group error texts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Web — Settings → Messaging (toggles + Telegram groups), Team cleanup

**Files:**
- Create: `src/lib/telegram/groups.ts`, `src/lib/telegram/__tests__/groups.test.ts`
- Create: `src/app/(dashboard)/settings/telegram-groups.tsx`
- Modify: `src/app/(dashboard)/settings/whatsapp-settings.tsx` (export `MessagingSettings` instead of `WhatsAppSettings`)
- Modify: `src/app/(dashboard)/settings/page.tsx` (Messaging tab)
- Modify: `src/lib/whatsapp/client.ts`, `src/lib/whatsapp/__tests__/client.test.ts`
- Modify: `src/app/(dashboard)/team/page.tsx`, `src/app/(dashboard)/team/add-whatsapp-member.tsx`, `src/app/(dashboard)/team/whatsapp-connect.tsx`

**Interfaces:**
- Consumes: DB from Task 1 (`channel_groups`, `channel_group_checklists`, RPC `issue_group_link_code`), RLS for managers; `useAuthStore` (`business`, `sites`, `setBusiness`); `Button`, `Switch` UI components.
- Produces (`src/lib/telegram/groups.ts`):

```ts
export interface TelegramGroup { id: string; title: string; alerts: boolean; linked_at: string; template_ids: string[] }
export interface ChecklistOption { id: string; name: string; site_id: string | null }
export const LINK_CODE_TTL_SEC = 900
export function GROUP_LINK_STEPS(code: string): string[]
export function mappingDiff(current: string[], next: string[]): { add: string[]; remove: string[] }
export function checklistLabel(o: ChecklistOption, siteNames: Map<string, string>): string
export async function listGroups(businessId: string): Promise<TelegramGroup[]>
export async function listChecklistOptions(businessId: string): Promise<ChecklistOption[]>
export async function issueGroupLinkCode(): Promise<string>
export async function saveGroupChecklists(groupId: string, current: string[], next: string[]): Promise<void>
export async function setGroupAlerts(groupId: string, alerts: boolean): Promise<void>
export async function unlinkGroup(groupId: string): Promise<void>
```
- `client.ts`: `export type LinkChannel = 'whatsapp'`; `CHANNELS: Record<LinkChannel, …>` (Telegram entry and `TELEGRAM_BOT` removed); `listIdentities` also returns `consent_source`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/telegram/__tests__/groups.test.ts
import { describe, it, expect } from 'vitest'
import { GROUP_LINK_STEPS, mappingDiff, checklistLabel, LINK_CODE_TTL_SEC } from '../groups'

describe('telegram groups helpers', () => {
  it('link steps carry the /link command with the code', () => {
    const steps = GROUP_LINK_STEPS('482913')
    expect(steps).toContain('Send this message in the group: /link 482913')
    expect(steps[1]).toBe('Add @BluerollChecksBot to the group.')
    expect(LINK_CODE_TTL_SEC).toBe(900)
  })
  it('mappingDiff adds and removes only what changed', () => {
    expect(mappingDiff(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] })
    expect(mappingDiff(['a'], ['a'])).toEqual({ add: [], remove: [] })
    expect(mappingDiff([], ['a', 'a'])).toEqual({ add: ['a'], remove: [] })
  })
  it('checklistLabel names the site for site-specific checklists', () => {
    const sites = new Map([['s1', 'Wharf Side']])
    expect(checklistLabel({ id: 't', name: 'Fridge temps', site_id: null }, sites)).toBe('Fridge temps')
    expect(checklistLabel({ id: 't', name: 'Fridge temps', site_id: 's1' }, sites)).toBe('Fridge temps · Wharf Side')
    expect(checklistLabel({ id: 't', name: 'Fridge temps', site_id: 'gone' }, sites)).toBe('Fridge temps · other site')
  })
})
```

In `src/lib/whatsapp/__tests__/client.test.ts` replace the test `telegram channel builds a t.me deep link and is never null` and the `displayId is channel-aware` test with:

```ts
  it('only WhatsApp has a personal connect flow (Telegram works through groups)', () => {
    expect(Object.keys(CHANNELS)).toEqual(['whatsapp'])
    expect(CHANNELS.whatsapp.displayId('447700900123')).toBe('+44 7••• ••23')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/telegram/__tests__/groups.test.ts src/lib/whatsapp/__tests__/client.test.ts`
Expected: FAIL — `../groups` missing; `CHANNELS` still has `telegram`.

- [ ] **Step 3: Implement `src/lib/telegram/groups.ts`**

```ts
// Web client for Telegram groups (Settings → Messaging). Writes go through RLS: managers may map checklists, flip
// `alerts` and unlink (a DB trigger blocks every other column). The bot links groups; the cron removes an unlinked
// group's lists within 10 minutes (the web app can't call the Bot API).
import { supabase } from '@/lib/supabase'

export interface TelegramGroup { id: string; title: string; alerts: boolean; linked_at: string; template_ids: string[] }
export interface ChecklistOption { id: string; name: string; site_id: string | null }

export const LINK_CODE_TTL_SEC = 900

export const GROUP_LINK_STEPS = (code: string) => [
  'Open the staff group in Telegram (for example “Kitchen”), or create one.',
  'Add @BluerollChecksBot to the group.',
  `Send this message in the group: /link ${code}`,
  'In the group settings → Permissions, turn off “Add members” for members.',
]

export function mappingDiff(current: string[], next: string[]) {
  const cur = new Set(current)
  const nxt = new Set(next)
  return { add: [...nxt].filter((x) => !cur.has(x)), remove: [...cur].filter((x) => !nxt.has(x)) }
}

export const checklistLabel = (o: ChecklistOption, siteNames: Map<string, string>) =>
  o.site_id ? `${o.name} · ${siteNames.get(o.site_id) ?? 'other site'}` : o.name

export async function listGroups(businessId: string): Promise<TelegramGroup[]> {
  const { data, error } = await supabase.from('channel_groups')
    .select('id, title, alerts, linked_at, channel_group_checklists(template_id)')
    .eq('business_id', businessId).eq('channel', 'telegram').is('unlinked_at', null).order('linked_at')
  if (error) throw error
  return ((data ?? []) as { id: string; title: string | null; alerts: boolean; linked_at: string; channel_group_checklists: { template_id: string }[] | null }[])
    .map((g) => ({ id: g.id, title: g.title || 'Telegram group', alerts: !!g.alerts, linked_at: g.linked_at, template_ids: (g.channel_group_checklists ?? []).map((m) => m.template_id) }))
}

export async function listChecklistOptions(businessId: string): Promise<ChecklistOption[]> {
  const { data, error } = await supabase.from('checklist_templates').select('id, name, site_id')
    .eq('business_id', businessId).eq('active', true).order('name')
  if (error) throw error
  return (data ?? []) as ChecklistOption[]
}

/** Server-generated 6-digit code for the caller's business (15 min, one use). */
export async function issueGroupLinkCode(): Promise<string> {
  const { data, error } = await supabase.rpc('issue_group_link_code', { p_channel: 'telegram' })
  if (error) throw error
  return data as string
}

export async function saveGroupChecklists(groupId: string, current: string[], next: string[]): Promise<void> {
  const { add, remove } = mappingDiff(current, next)
  if (remove.length) {
    const { error } = await supabase.from('channel_group_checklists').delete().eq('group_id', groupId).in('template_id', remove)
    if (error) throw error
  }
  if (add.length) {
    const { error } = await supabase.from('channel_group_checklists').insert(add.map((template_id) => ({ group_id: groupId, template_id })))
    if (error) throw error
  }
}

export async function setGroupAlerts(groupId: string, alerts: boolean): Promise<void> {
  const { error } = await supabase.from('channel_groups').update({ alerts }).eq('id', groupId)
  if (error) throw error
}

export async function unlinkGroup(groupId: string): Promise<void> {
  // The DB trigger stamps the real time; the value sent only needs to be non-null.
  const { error } = await supabase.from('channel_groups').update({ unlinked_at: new Date().toISOString() }).eq('id', groupId)
  if (error) throw error
}
```

- [ ] **Step 4: Create `src/app/(dashboard)/settings/telegram-groups.tsx`**

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useAuthStore } from '@/stores/auth-store'
import {
  GROUP_LINK_STEPS, LINK_CODE_TTL_SEC, checklistLabel, issueGroupLinkCode, listChecklistOptions, listGroups, mappingDiff,
  saveGroupChecklists, setGroupAlerts, unlinkGroup, type ChecklistOption, type TelegramGroup,
} from '@/lib/telegram/groups'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Settings → Messaging → Telegram groups: link a group, choose its checks, mark it as an alerts group, unlink. */
export function TelegramGroups() {
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const queryClient = useQueryClient()
  const [linking, setLinking] = useState(false)
  const groupsKey = ['telegram-groups', business?.id]
  const { data: groups = [], isLoading } = useQuery({
    queryKey: groupsKey, enabled: !!business?.id, queryFn: () => listGroups(business!.id),
    refetchInterval: linking ? 5000 : false,   // the new group shows up as soon as /link arrives
  })
  const { data: options = [] } = useQuery({
    queryKey: ['telegram-checklist-options', business?.id], enabled: !!business?.id, queryFn: () => listChecklistOptions(business!.id),
  })
  const siteNames = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites])
  if (!business) return null
  const refresh = () => queryClient.invalidateQueries({ queryKey: groupsKey })

  return (
    <section className="rounded-xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Telegram groups</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Anyone in a linked group can fill in that group&apos;s checks. Each group gets one live list per site.</p>
        </div>
        <Button onClick={() => setLinking(true)}>Link a group</Button>
      </div>
      {isLoading ? (
        <p className="mt-4 text-[13px] text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted-foreground">No groups linked yet.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {groups.map((g) => (
            // Remount when the saved mapping changes so the checkbox state starts from it.
            <GroupCard key={`${g.id}:${g.template_ids.join(',')}`} group={g} options={options} siteNames={siteNames} onChanged={refresh} />
          ))}
        </div>
      )}
      {linking && <LinkGroupDialog onClose={() => { setLinking(false); refresh() }} />}
    </section>
  )
}

function GroupCard({ group, options, siteNames, onChanged }: {
  group: TelegramGroup; options: ChecklistOption[]; siteNames: Map<string, string>; onChanged: () => void
}) {
  const [selected, setSelected] = useState<string[]>(group.template_ids)
  const [busy, setBusy] = useState(false)
  const diff = mappingDiff(group.template_ids, selected)
  const dirty = diff.add.length + diff.remove.length > 0
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const save = async () => {
    setBusy(true)
    try { await saveGroupChecklists(group.id, group.template_ids, selected); toast.success('Checks saved'); onChanged() }
    catch (e) { toast.error(errText(e)) } finally { setBusy(false) }
  }
  const alerts = async (v: boolean) => {
    try { await setGroupAlerts(group.id, v); onChanged() } catch (e) { toast.error(errText(e)) }
  }
  const unlink = async () => {
    if (!window.confirm(`Unlink “${group.title}”? Its lists disappear from the group within 10 minutes.`)) return
    try { await unlinkGroup(group.id); toast.success('Group unlinked'); onChanged() } catch (e) { toast.error(errText(e)) }
  }
  const alertsLabel = `alerts-${group.id}`
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{group.title}</p>
        <Button variant="outline" size="sm" onClick={unlink}>Unlink</Button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[13px]">
        <span id={alertsLabel}>Alerts group — out-of-range readings from every group are posted here too</span>
        <Switch checked={group.alerts} onCheckedChange={alerts} aria-labelledby={alertsLabel} />
      </div>
      <fieldset className="mt-3">
        <legend className="text-[12.5px] font-semibold text-muted-foreground">Checks this group does</legend>
        {options.length === 0 ? (
          <p className="mt-1 text-[13px] text-muted-foreground">No active checklists yet.</p>
        ) : (
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {options.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" className="size-4 accent-[#1f9d63]" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
                <span>{checklistLabel(o, siteNames)}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setSelected(group.template_ids)}>Cancel</Button>
          <Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      )}
    </div>
  )
}

function LinkGroupDialog({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [left, setLeft] = useState(LINK_CODE_TTL_SEC)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    issueGroupLinkCode()
      .then((c) => { if (alive) setCode(c) })
      .catch((e: unknown) => { if (alive) setError(errText(e)) })
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => { alive = false; clearInterval(t) }
  }, [attempt])

  // No backdrop close: a stray click must not lose the code mid-setup — only Done/Cancel closes it.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div role="dialog" aria-modal="true" aria-labelledby="link-group-title" className="w-[400px] max-w-full rounded-2xl bg-card p-6 shadow-xl">
        <h2 id="link-group-title" className="text-[17px] font-semibold">Link a Telegram group</h2>
        {error ? (
          <>
            <p className="mt-2 text-[13px] text-red-700">{error}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => { setError(null); setCode(null); setLeft(LINK_CODE_TTL_SEC); setAttempt((n) => n + 1) }}>Retry</Button>
            </div>
          </>
        ) : (
          <>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px]">
              {GROUP_LINK_STEPS(code ?? '······').map((s) => <li key={s}>{s}</li>)}
            </ol>
            <p className="mt-4 text-center font-mono text-[24px] tracking-[0.2em]">{code ?? '······'}</p>
            <p className="mt-1 text-center text-[12px] text-muted-foreground">
              {left > 0 ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired — close and try again'}
            </p>
            <p className="mt-3 text-[12px] text-muted-foreground">The group appears in this list once it is linked. Then tick the checks it does.</p>
            <div className="mt-4 flex justify-end"><Button variant="outline" onClick={onClose}>Done</Button></div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: `whatsapp-settings.tsx` → `MessagingSettings`** — keep `ChannelToggle` unchanged; add `import { TelegramGroups } from './telegram-groups'`; replace `export function WhatsAppSettings() { … }` with:

```tsx
export function MessagingSettings() {
  const telegramOn = useAuthStore((s) => !!s.business?.telegram_enabled)
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[25px] font-bold tracking-[-0.02em]">Messaging</h1>
        <p className="mt-1.5 text-[14px] text-muted-foreground">Checks in WhatsApp and Telegram for staff who work without the app.</p>
      </div>
      {/* Hidden until the WhatsApp number is configured (NEXT_PUBLIC_WHATSAPP_NUMBER). */}
      {channelAvailable('whatsapp') && <ChannelToggle
        channel="whatsapp"
        column="whatsapp_enabled"
        title="WhatsApp checks"
        description="Staff get reminders before their checks are due and complete temperatures and opening/closing checks in WhatsApp. Connect people from the Team page."
      />}
      <ChannelToggle
        channel="telegram"
        column="telegram_enabled"
        title="Telegram checks"
        description="Staff fill in checks from your team's Telegram groups. Free."
      />
      {telegramOn && <TelegramGroups />}
    </div>
  )
}
```

- [ ] **Step 6: Settings page Messaging tab** — in `src/app/(dashboard)/settings/page.tsx`:
- import: `import { MessagingSettings } from './whatsapp-settings'` (replaces the `WhatsAppSettings` import);
- `type Tab = 'Profile' | 'Sites' | 'Team' | 'Billing' | 'Notifications' | 'Messaging'`;
- `TAB_LABEL` gains `Messaging: 'Messaging'`;
- `const tabs: Tab[] = ['Profile', ...(showAdminTabs ? (["Sites", "Team"] as Tab[]) : []), 'Billing', 'Notifications', ...(showAdminTabs ? (['Messaging'] as Tab[]) : [])]`;
- replace `{tab === 'Notifications' && showAdminTabs && <div className="mt-6"><WhatsAppSettings /></div>}` with `{tab === 'Messaging' && showAdminTabs && <MessagingSettings />}`.

- [ ] **Step 7: `client.ts` — WhatsApp-only personal connect**
- delete `export const TELEGRAM_BOT = 'BluerollChecksBot'` and the `telegram: { … }` entry of `CHANNELS`;
- add `export type LinkChannel = 'whatsapp'` and type `CHANNELS` as `Record<LinkChannel, { label: string; buildLink: …; codeText: …; displayId: …; notConfiguredNote: string; scanInstruction: string; codeInstruction: string }>` (same member types as now); update its comment to `// Personal connect (QR / code) exists for WhatsApp only; Telegram works through groups (Settings → Messaging).`;
- `listIdentities`: select `'id, profile_id, external_id, consent_at, consent_source'` and add `consent_source: string` to the returned row type.

- [ ] **Step 8: Team page cleanup**
- `whatsapp-connect.tsx`: `import { CHANNELS, issueLinkCode, revokeIdentity, type LinkChannel } from '@/lib/whatsapp/client'`; `type ChannelProp = LinkChannel`.
- `add-whatsapp-member.tsx`: remove the `channels` prop, the `channel` state and the Channel `<select>`; `onCreated: (profileId: string, name: string) => void`; call `onCreated(id, name.trim())`; drop `CHANNELS`/`Channel` from the import.
- `team/page.tsx`:
  - import `import { channelAvailable, listIdentities, type LinkChannel } from '@/lib/whatsapp/client'`; `connecting` state type `{ id: string; full_name: string | null; channel: LinkChannel } | null`;
  - header button: `{waOn && <Button variant="outline" onClick={() => setAddingWa(true)}>Add staff without app login</Button>}`;
  - Telegram cell: replace the `<ChannelStatus channel="telegram" … />` cell content with
    ```tsx
    {tgIdentities.some((x) => x.profile_id === m.id)
      ? <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[12px] font-medium text-sky-700">via Telegram group</span>
      : <span className="text-[12px] text-[#b0b5bc]">—</span>}
    ```
    (keep the `{tgOn && <th className="px-3 py-2.5">Telegram</th>}` header and the `tg-identities` query);
  - `ChannelConnectDialog` `onClose`: `() => { setConnecting(null); if (waOn) refetchIds() }`; remove `refetchTgIds` from the `useQuery` destructuring if now unused;
  - `AddWhatsAppMemberDialog`: drop the `channels={…}` prop; `onCreated={(id, name) => { setAddingWa(false); queryClient.invalidateQueries({ queryKey: ['team', business?.id] }); setConnecting({ id, full_name: name, channel: 'whatsapp' }) }}`.

- [ ] **Step 9: Run tests, typecheck, lint**

Run: `npm test && npx tsc --noEmit 2>&1 | grep -c "error TS" && npx eslint "src/app/(dashboard)/settings" "src/app/(dashboard)/team" src/lib/telegram src/lib/whatsapp`
Expected: tests PASS; `4`; no new ESLint errors in touched files.

- [ ] **Step 10: Manual check (dev, against prod DB only after Task 1 is applied)** — `npm run dev` → log in as the Fern & Fig owner → Settings → Messaging: toggles render; with Telegram on, "Link a group" shows a 6-digit code and the 4 steps; Team page shows no "Connect Telegram" and the add-staff dialog has no channel picker. Before Task 1 is applied the groups query errors — that's expected; just confirm the page doesn't crash (toast/empty state).

- [ ] **Step 11: Commit**

```bash
git add src/lib/telegram "src/app/(dashboard)/settings" "src/app/(dashboard)/team" src/lib/whatsapp/client.ts src/lib/whatsapp/__tests__/client.test.ts
git commit -m "feat(web): Settings → Messaging with Telegram groups; Team connects WhatsApp only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Launch — migration, deploy, bot setup, BotFather, pilot (STOP points)

**Files:** none (operations). Record every result in the report.

- [ ] **Step 1: STOP — migration.** Ask Kostya: «Накатываю миграцию Telegram-групп (Task 1) на прод?» After «да»: apply `supabase/migrations/20261011130000_channel_groups.sql` via the Management API (`POST https://api.supabase.com/v1/projects/rszrggreuarvodcqeqrj/database/query`, bearer token from `~/Secrets/blueroll/supabase-access-token.txt`), then run `supabase/tests/channel_groups_verify.sql` and paste the `VERIFY_RESULT` json (must match Task 1's expected values).

- [ ] **Step 2: STOP — deploy functions.** Ask Kostya. After «да», from the repo root:

```bash
export SUPABASE_ACCESS_TOKEN=$(cat ~/Secrets/blueroll/supabase-access-token.txt)
for f in telegram-webhook channel-form whatsapp-reminders team-create-channel-member; do
  supabase functions deploy "$f" --project-ref rszrggreuarvodcqeqrj --no-verify-jwt || break
done
```
Secrets `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, `WA_CRON_SECRET` already exist from the previous plan — do not rotate.

- [ ] **Step 3: STOP — webhook with `my_chat_member`.** Ask Kostya, then:

```bash
cd supabase/functions && TG_BOT_TOKEN=$(cat ~/Secrets/blueroll/telegram_checks_bot_token) TG_WEBHOOK_SECRET=$(cat ~/Secrets/blueroll/telegram_webhook_secret) \
  deno eval 'import { setupBot } from "./_shared/channels/telegram.ts"; console.log(await setupBot({ token: Deno.env.get("TG_BOT_TOKEN")!, webhookUrl: "https://rszrggreuarvodcqeqrj.supabase.co/functions/v1/telegram-webhook", secret: Deno.env.get("TG_WEBHOOK_SECRET")! }))'
```
Expected `{ ok: true, errors: [] }`. Then `getWebhookInfo` (same token) must show `allowed_updates: ["message","my_chat_member"]`.

- [ ] **Step 4: Kostya in BotFather** (send him this list; wait for "done"):
  1. `/newapp` → @BluerollChecksBot → title "Blueroll checks", short description, photo 640×360, Web App URL `https://app.blueroll.app/tg/form`, short name **`form`** (if he picks another name: change `TG_MINI_APP_SHORT_NAME` in `telegram.ts`, re-run tests, redeploy `telegram-webhook`, `channel-form`, `whatsapp-reminders`).
  2. `/setjoingroups` → Enable. `/setprivacy` → Enable (privacy mode stays ON — the bot only needs commands).
  3. Check: `https://t.me/BluerollChecksBot/form?startapp=test` opens the Mini App and shows "This check has expired — open the list in your group again."

- [ ] **Step 5: Web.** Open the PR from `KNS/telegram-live-list` (do not merge). Merge only on Kostya's "yes" — Vercel auto-deploys `main`; confirm the deploy status of the merge commit with `gh api repos/KNSTNTN24/blueroll-web/commits/<sha>/status`.

- [ ] **Step 6: Pilot on «Fern & Fig»** (with Kostya and Maria; record each result):
  1. Settings → Messaging: Telegram on → Link a group → create Telegram group "Kitchen" (Kostya, Maria), add the bot, `/link <code>` → "Linked to Fern & Fig…"; if members can add people → warning in the group + bell notification.
  2. Tick two checklists for "Kitchen"; create a second group "Managers", link it, turn on **Alerts**, no checklists.
  3. In "Kitchen": `/checks` → one list per site; buttons open the Mini App; consent notice on first open; Maria submits one → list edits silently to ✅ with "Maria"; Kostya opening the same button sees "Already submitted ✓ by Maria".
  4. Out-of-range temperature with an action → alert text in "Kitchen" and in "Managers" (once each).
  5. Wait for a deadline −30 min → the list is reposted (one notification) and the previous one deleted.
  6. Complete a check in the mobile app → ✅ appears within 10 minutes.
  7. Maria leaves "Kitchen" → her open form refuses: "You're no longer in this group."
  8. A private message to the bot → "Blueroll checks happen in your team's Telegram group…".
  9. Unlink "Managers" in Settings → nothing breaks; remove the bot from "Kitchen" → its list disappears and the group drops off Settings.

---

## Self-Review Notes

- Spec coverage: §2 decisions → Tasks 4–8; §3 linking/unlinking/migration/commands → Tasks 2, 6, 7 (Settings unlink via cron), 10; §4 list contents/format/repost/refresh/errors/reminders → Tasks 3, 5, 7; §5 direct link, group tokens, membership, mapping, first submit wins, no "Recorded ✓" → Tasks 2, 5, 8, 9; §6 people/consent/per-business uniqueness → Tasks 1, 4, 8, 9; §7 removal → Tasks 6, 7, 10; §8 permission check → Tasks 6, 7; §9 data (channel-neutral tables) → Task 1; §10 testing → tests in every task + Task 11 pilot.
- Names used across tasks: `ChannelGroup`, `GroupDeps`, `GroupFormToken`, `LiveListRow`, `makeGroupDeps(admin, 'telegram')`, `repostList`/`repostGroup`/`refreshList`/`refreshGroupSite`/`unlinkGroup`/`deleteListMessage`, `handleGroupEvent`/`checkGroupPermissions`/`GROUP_TEXT`, `runTelegramGroups`, `planGroupReminders`, `alertGroups`/`groupAlertText`, `consentText`, `resolveToken`/`usedBy`.
