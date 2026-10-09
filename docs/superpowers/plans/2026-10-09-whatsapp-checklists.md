# WhatsApp Checklists (MVP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kitchen staff complete their assigned temperature and opening/closing checklists in WhatsApp (reminders, Flow forms, corrective actions, manager alerts), writing exactly the same records as the apps.

**Architecture:** Channel-agnostic core in `supabase/functions/_shared/checklists-core/` (due logic, flagging, answer parsing, reminder planning, recording) + a WhatsApp adapter and a pure bot state machine in `supabase/functions/_shared/channels/`. Thin Deno edge functions (`whatsapp-webhook`, `whatsapp-reminders`, `whatsapp-sync-flows`, `team-create-channel-member`) wire them to Supabase (service role) and the WhatsApp Cloud API. Web gets Team/Settings/History UI.

**Tech Stack:** Supabase Postgres + pg_cron + pg_net + Vault, Supabase Edge Functions (Deno), WhatsApp Cloud API + WhatsApp Flows (Graph API), Next.js 16 (client components), TanStack Query 5, Vitest 4, `qrcode` npm package.

**Spec:** `docs/superpowers/specs/2026-10-09-whatsapp-checklists-design.md`

## Global Constraints

- Modules under `supabase/functions/_shared/**` import only each other, with explicit `.ts` extensions (Vitest and Deno both resolve these); **no URL/npm imports** there. Edge function `index.ts` files import `_shared` with `.ts` and `https://esm.sh/@supabase/supabase-js@2`.
- `supabase/functions` is excluded from the Next.js tsconfig. Typecheck baseline for the web app: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "^.next/" | wc -l` = **3** — must not grow. Deno files: `deno check <file>` (deno is at `/opt/homebrew/bin/deno`).
- Tests live in `src/lib/whatsapp/__tests__/` and import `_shared` modules via relative paths (`../../../../supabase/functions/_shared/...`). Run: `npx vitest run <file>`; full: `npm test`.
- Values written to `checklist_responses.value` exactly like the apps: tick `'true'`; yes_no `'yes'|'no'`; temperature numeric string; text as typed.
- Flagging must equal web `autoFlag`: yes_no `'no'` → flagged; temperature: `parseFloat(value)` below `min_value` or above `max_value` → flagged; unparsable → not flagged.
- Assignment must equal the web list query: if the person has `role_id` → `template.assigned_role_ids` contains it; else `template.assigned_roles` contains `person.role`. Site: `template.site_id` null (all sites) or equal to the site. Only `active` templates.
- Period start equals web `getPeriodStart`, evaluated in the **site timezone** (`sites.timezone`, default `Europe/London`): daily/custom → local midnight; weekly → Monday 00:00; monthly → 1st 00:00; four_weekly → Monday 00:00 minus 21 days.
- Reminder window: `[deadline − 30 min, deadline)`, deadline = today's local date + `deadline_time` in site tz; at most one reminder per `(profile, template, site, period_key)`; up to 3 checklists per message.
- Entitlement: before recording or sending anything for a business: `is_business_entitled(business_id) and businesses.whatsapp_enabled`.
- Never log full phone numbers: mask as `+44 7••• ••12` (keep `+`, first 3 digits after country code start, last 2).
- Copy (UI and messages) is English. WhatsApp texts exactly as written in this plan.
- Prod changes (migration apply, secrets, function deploy, cron, Meta templates) happen **only after Kostya's explicit "yes"** — STOP points in Tasks 1, 9, 14.
- Commit trailer: blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Timezone edges (BST/GMT change, after-midnight deadlines)** — a "09:00" deadline on 2026-10-25 (clocks go back) must be 09:00 London local. Test in Task 2.
2. **Same number linked twice / re-link after STOP** — a second `LINK` for an already-linked number must move the identity (revoke old, create new), not error. Test in Task 7.
3. **Form submitted for a checklist that changed since the Flow was sent** — answers must map by the token's stored item ids, ignoring items that no longer exist and never misattributing values. Test in Task 4.
4. **Out-of-range on several items at once** — one corrective form per flagged item, each closing its own response. Test in Task 7.
5. **Cron runs twice / overlapping runs** — never two reminders for the same key (DB primary key + planner exclusion). Test in Task 5 + DB constraint in Task 1.

---

## File Structure

```
supabase/migrations/20261010120000_whatsapp_channel.sql      schema, RLS, triggers, helper fns
supabase/migrations/20261010120100_whatsapp_cron.sql         pg_cron job (applied in Task 9)
supabase/tests/whatsapp_channel_verify.sql                   rolled-back verification (DO block)
supabase/functions/_shared/checklists-core/
  types.ts        shared types
  time.ts         timezone helpers (localParts, zonedToUtc, periodStartUtc, periodKey, deadlineUtc)
  due.ts          isAssigned, availableChecklists, dueChecklists
  flagging.ts     flagResponse (parity with web autoFlag)
  answers.ts      parseFormAnswers (Flow response → values) + required check
  reminders.ts    planReminders, planCorrective
  record.ts       recordCompletion over a CoreDb interface
supabase/functions/_shared/channels/
  types.ts        InboundEvent, OutboundMessage, ChannelSender
  mask.ts         maskPhone
  whatsapp.ts     verifySignature, parseInbound, message builders, sendWhatsApp
  whatsapp-flows.ts  buildChecklistFlow, CORRECTIVE_FLOW_JSON, itemsHash
  bot.ts          handleInbound (pure state machine over BotDeps)
  db.ts           Supabase-backed BotDeps/CoreDb factories (thin, Deno-only use)
supabase/functions/whatsapp-webhook/index.ts
supabase/functions/whatsapp-reminders/index.ts
supabase/functions/whatsapp-sync-flows/index.ts
supabase/functions/team-create-channel-member/index.ts
src/lib/whatsapp/__tests__/*.test.ts
src/lib/whatsapp/__tests__/fixtures/*.json                  Meta webhook payload samples
src/lib/whatsapp/client.ts                                  web: link codes, status, toggle, sync call
src/app/(dashboard)/team/whatsapp-connect.tsx               QR dialog + status/disconnect
src/app/(dashboard)/team/add-whatsapp-member.tsx            WhatsApp-only member dialog
src/app/(dashboard)/settings/whatsapp-settings.tsx          toggle
docs/whatsapp/meta-setup.md                                 Meta setup + template texts (Task 14)
```

---

### Task 1: Database migration + verification script

**Files:**
- Create: `supabase/migrations/20261010120000_whatsapp_channel.sql`
- Create: `supabase/tests/whatsapp_channel_verify.sql`

**Interfaces — Produces (DB):**
- `sites.timezone text not null default 'Europe/London'`
- `businesses.whatsapp_enabled boolean not null default false`
- `checklist_completions.source text not null default 'app'` (`app|whatsapp|telegram`)
- `checklist_responses.corrective_status text null` (`needed|done`)
- tables `channel_identities`, `channel_link_codes`, `channel_reminders_sent`, `channel_messages_log`, `channel_flows`, `channel_form_tokens`
- functions `public.whatsapp_ready(b uuid) returns boolean`, `public.revoke_channel_identities_on_profile_change()` trigger

`channel_form_tokens` and `channel_identities.last_inbound_at` are additions to the spec: the bot needs a server-side record of which form was sent to whom (token → profile, template, site, item ids), and the 24-hour window state for billing.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20261010120000_whatsapp_channel.sql
set search_path = public;

-- ============================================================================
-- WhatsApp checklists (spec 2026-10-09). Additive only.
-- ============================================================================

alter table public.sites add column if not exists timezone text not null default 'Europe/London';
alter table public.businesses add column if not exists whatsapp_enabled boolean not null default false;
alter table public.checklist_completions add column if not exists source text not null default 'app';
alter table public.checklist_completions drop constraint if exists checklist_completions_source_check;
alter table public.checklist_completions add constraint checklist_completions_source_check check (source in ('app','whatsapp','telegram'));
alter table public.checklist_responses add column if not exists corrective_status text;
alter table public.checklist_responses drop constraint if exists checklist_responses_corrective_status_check;
alter table public.checklist_responses add constraint checklist_responses_corrective_status_check check (corrective_status is null or corrective_status in ('needed','done'));

-- Only owners/managers may flip the WhatsApp switch (column-level guard via trigger; RLS on businesses is row-level).
create or replace function public.guard_whatsapp_enabled()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.whatsapp_enabled is distinct from old.whatsapp_enabled
     and auth.uid() is not null
     and not exists (select 1 from profiles p where p.id = auth.uid() and p.business_id = new.id and p.role in ('owner','manager')) then
    raise exception 'only owners and managers can change WhatsApp settings';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_whatsapp_enabled on public.businesses;
create trigger trg_guard_whatsapp_enabled before update on public.businesses for each row execute function public.guard_whatsapp_enabled();

create or replace function public.whatsapp_ready(b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select whatsapp_enabled from businesses where id = b), false) and public.is_business_entitled(b)
$$;
grant execute on function public.whatsapp_ready(uuid) to authenticated, service_role;

create table if not exists public.channel_identities (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses(id) on delete cascade,
  profile_id           uuid not null references public.profiles(id) on delete cascade,
  channel              text not null check (channel in ('whatsapp','telegram')),
  external_id          text not null,
  consent_at           timestamptz not null default now(),
  consent_source       text not null default 'qr_code',
  consent_text_version int  not null default 1,
  linked_by            uuid references public.profiles(id) on delete set null,
  last_inbound_at      timestamptz,
  revoked_at           timestamptz,
  created_at           timestamptz not null default now()
);
create unique index if not exists uq_channel_identity_active on public.channel_identities(channel, external_id) where revoked_at is null;
create unique index if not exists uq_channel_identity_profile on public.channel_identities(profile_id, channel) where revoked_at is null;
alter table public.channel_identities enable row level security;
drop policy if exists "managers read channel identities" on public.channel_identities;
create policy "managers read channel identities" on public.channel_identities
  for select using (public.is_business_manager(business_id) or profile_id = auth.uid());
drop policy if exists "managers revoke channel identities" on public.channel_identities;
create policy "managers revoke channel identities" on public.channel_identities
  for update using (public.is_business_manager(business_id)) with check (public.is_business_manager(business_id) and revoked_at is not null);

create table if not exists public.channel_link_codes (
  code        text primary key check (code ~ '^[0-9]{6}$'),
  business_id uuid not null references public.businesses(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  site_id     uuid references public.sites(id) on delete cascade,
  issued_by   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  expires_at  timestamptz not null default now() + interval '15 minutes',
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.channel_link_codes enable row level security;
drop policy if exists "managers issue link codes" on public.channel_link_codes;
create policy "managers issue link codes" on public.channel_link_codes
  for insert with check (
    public.is_business_manager(business_id)
    and exists (select 1 from profiles p where p.id = profile_id and p.business_id = channel_link_codes.business_id)
    and used_at is null
  );
drop policy if exists "managers read link codes" on public.channel_link_codes;
create policy "managers read link codes" on public.channel_link_codes for select using (public.is_business_manager(business_id));

create table if not exists public.channel_reminders_sent (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  site_id     uuid not null references public.sites(id) on delete cascade,
  period_key  text not null,
  sent_at     timestamptz not null default now(),
  primary key (profile_id, template_id, site_id, period_key)
);
alter table public.channel_reminders_sent enable row level security;  -- service role only

create table if not exists public.channel_messages_log (
  id            bigserial primary key,
  business_id   uuid references public.businesses(id) on delete cascade,
  site_id       uuid references public.sites(id) on delete set null,
  profile_id    uuid references public.profiles(id) on delete set null,
  channel       text not null,
  direction     text not null check (direction in ('in','out')),
  kind          text not null,
  template_name text,
  billable      boolean not null default false,
  ref_id        text,
  wa_message_id text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_channel_messages_log_biz on public.channel_messages_log(business_id, created_at desc);
create index if not exists idx_channel_messages_log_ref on public.channel_messages_log(kind, ref_id);
alter table public.channel_messages_log enable row level security;
drop policy if exists "managers read message log" on public.channel_messages_log;
create policy "managers read message log" on public.channel_messages_log for select using (public.is_business_manager(business_id));

create table if not exists public.channel_flows (
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  site_id     uuid not null references public.sites(id) on delete cascade,
  channel     text not null default 'whatsapp',
  flow_id     text,
  items_hash  text not null,
  item_ids    uuid[] not null,
  status      text not null check (status in ('published','error','unsupported')),
  error       text,
  updated_at  timestamptz not null default now(),
  primary key (template_id, site_id, channel)
);
alter table public.channel_flows enable row level security;
drop policy if exists "managers read flows" on public.channel_flows;
create policy "managers read flows" on public.channel_flows
  for select using (exists (select 1 from checklist_templates t where t.id = template_id and public.is_business_manager(t.business_id)));

create table if not exists public.channel_form_tokens (
  token       text primary key,
  kind        text not null check (kind in ('checklist','corrective')),
  business_id uuid not null references public.businesses(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  site_id     uuid not null references public.sites(id) on delete cascade,
  template_id uuid references public.checklist_templates(id) on delete cascade,
  item_ids    uuid[],
  response_id uuid references public.checklist_responses(id) on delete cascade,
  expires_at  timestamptz not null default now() + interval '24 hours',
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.channel_form_tokens enable row level security;  -- service role only

-- A removed team member must stop receiving messages: revoke when the profile leaves the business.
create or replace function public.revoke_channel_identities_on_profile_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.business_id is not distinct from old.business_id then return new; end if;
  update channel_identities set revoked_at = now() where profile_id = old.id and revoked_at is null;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_revoke_channel_identities on public.profiles;
create trigger trg_revoke_channel_identities after update of business_id on public.profiles
  for each row execute function public.revoke_channel_identities_on_profile_change();
```

- [ ] **Step 2: Write the verification script**

```sql
-- supabase/tests/whatsapp_channel_verify.sql
-- Run via the Management API as ONE DO block; it always raises at the end so everything rolls back.
-- Uses the demo business «Fern & Fig» (owner 981197ca-…), never a client.
do $v$
declare
  biz uuid := '2693f7de-c0ba-4d52-bbe9-602106eac784';
  owner uuid := '981197ca-3648-4c6c-9f18-ff7b6ae68786';
  other_biz_profile uuid; res jsonb := '{}'; n int;
begin
  select id into other_biz_profile from profiles where business_id <> biz limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- owner can flip the switch
  update businesses set whatsapp_enabled = true where id = biz;
  res := res || jsonb_build_object('toggle', (select whatsapp_enabled from businesses where id = biz));
  -- owner issues a code for own staff
  insert into channel_link_codes (code, business_id, profile_id) values ('123456', biz, owner);
  res := res || '{"code_own":"ok"}';
  -- cannot issue for another business's profile
  begin
    insert into channel_link_codes (code, business_id, profile_id) values ('654321', biz, other_biz_profile);
    res := res || '{"code_foreign":"ALLOWED (BAD)"}';
  exception when others then res := res || jsonb_build_object('code_foreign', 'rejected'); end;
  -- service-role-only tables are invisible to the owner
  select count(*) into n from channel_form_tokens; res := res || jsonb_build_object('tokens_visible', n);
  execute 'reset role';
  -- duplicate reminder key is rejected
  insert into channel_reminders_sent (profile_id, template_id, site_id, period_key)
    select owner, t.id, s.id, '2026-10-10' from checklist_templates t, sites s where t.business_id = biz and s.business_id = biz limit 1;
  begin
    insert into channel_reminders_sent (profile_id, template_id, site_id, period_key)
      select owner, t.id, s.id, '2026-10-10' from checklist_templates t, sites s where t.business_id = biz and s.business_id = biz limit 1;
    res := res || '{"dup_reminder":"ALLOWED (BAD)"}';
  exception when unique_violation then res := res || '{"dup_reminder":"rejected"}'; end;
  res := res || jsonb_build_object('ready', whatsapp_ready(biz));
  raise exception 'VERIFY_RESULT %', res;
end
$v$;
```

Expected result (inside the raised message): `toggle: true, code_own: ok, code_foreign: rejected, tokens_visible: 0, dup_reminder: rejected, ready: true`.

- [ ] **Step 3: Static check**

Parse-check with pglast (create a venv in the scratchpad: `python3 -m venv /tmp/pg && /tmp/pg/bin/pip -q install pglast`): `pglast.parse_sql(open(file).read())` for both files; and `pglast.parse_plpgsql` for each function body + the DO block. Record output in the report.

- [ ] **Step 4: STOP — ask Kostya before applying to prod**

Post in chat: «Миграция WhatsApp готова (новые таблицы channel_*, колонки timezone/whatsapp_enabled/source/corrective_status, триггеры; данные не меняются). Накатываю на прод?» Apply only after «да» — via the Management API (`POST /v1/projects/rszrggreuarvodcqeqrj/database/query`, token `~/Secrets/blueroll/supabase-access-token.txt`), then run the verify DO block and record the result.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261010120000_whatsapp_channel.sql supabase/tests/whatsapp_channel_verify.sql
git commit -m "feat(db): WhatsApp channel schema (identities, link codes, reminders, flows, form tokens)"
```

---

### Task 2: Core types + timezone/period helpers

**Files:**
- Create: `supabase/functions/_shared/checklists-core/types.ts`, `supabase/functions/_shared/checklists-core/time.ts`
- Test: `src/lib/whatsapp/__tests__/time.test.ts`

**Interfaces — Produces:**

```ts
// types.ts
export type ItemType = 'tick' | 'temperature' | 'text' | 'yes_no' | 'photo' | 'initials'
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'four_weekly' | 'custom'
export interface TemplateItem {
  id: string; name: string; item_type: ItemType; required: boolean
  min_value: number | null; max_value: number | null; unit: string | null; sort_order: number
}
export interface Template {
  id: string; business_id: string; site_id: string | null; name: string; frequency: Frequency
  deadline_time: string | null; multi_per_day: boolean; min_per_day: number | null
  assigned_roles: string[]; assigned_role_ids: string[]; active: boolean
}
export interface Person { profile_id: string; business_id: string; full_name: string; role: string; role_id: string | null }
export interface CompletionLite { template_id: string; site_id: string | null; completed_at: string }
export interface DueChecklist { template: Template; site_id: string; deadline_utc: string | null; period_key: string; overdue: boolean }
export interface Answer { item_id: string; value: string; flagged: boolean }
```

```ts
// time.ts
export function localParts(now: Date, tz: string): { y: number; m: number; d: number; hh: number; mm: number; weekday: number } // weekday 1=Mon..7=Sun
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date
export function periodStartUtc(freq: Frequency, now: Date, tz: string): Date
export function periodKey(freq: Frequency, now: Date, tz: string): string   // YYYY-MM-DD of local period start
export function deadlineUtc(deadlineTime: string | null, now: Date, tz: string): Date | null // today local + HH:mm
```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/whatsapp/__tests__/time.test.ts
import { describe, it, expect } from 'vitest'
import { localParts, zonedToUtc, periodStartUtc, periodKey, deadlineUtc } from '../../../../supabase/functions/_shared/checklists-core/time'

const L = 'Europe/London'
describe('time helpers', () => {
  it('localParts in BST and GMT', () => {
    expect(localParts(new Date('2026-07-01T08:30:00Z'), L)).toMatchObject({ y: 2026, m: 7, d: 1, hh: 9, mm: 30, weekday: 3 })
    expect(localParts(new Date('2026-12-01T08:30:00Z'), L)).toMatchObject({ hh: 8, mm: 30, weekday: 2 })
  })
  it('zonedToUtc handles both offsets', () => {
    expect(zonedToUtc(2026, 7, 1, 9, 0, L).toISOString()).toBe('2026-07-01T08:00:00.000Z')
    expect(zonedToUtc(2026, 12, 1, 9, 0, L).toISOString()).toBe('2026-12-01T09:00:00.000Z')
  })
  it('deadline on the day clocks go back (25 Oct 2026) is 09:00 local = 09:00Z', () => {
    expect(deadlineUtc('09:00', new Date('2026-10-25T07:00:00Z'), L)!.toISOString()).toBe('2026-10-25T09:00:00.000Z')
    expect(deadlineUtc('09:00', new Date('2026-10-24T07:00:00Z'), L)!.toISOString()).toBe('2026-10-24T08:00:00.000Z')
  })
  it('deadlineUtc null without a deadline and tolerant of HH:mm:ss', () => {
    expect(deadlineUtc(null, new Date(), L)).toBeNull()
    expect(deadlineUtc('23:00:00', new Date('2026-12-01T10:00:00Z'), L)!.toISOString()).toBe('2026-12-01T23:00:00.000Z')
  })
  it('period starts match web getPeriodStart in site time', () => {
    const now = new Date('2026-10-14T10:00:00Z') // Wed 14 Oct 2026, BST
    expect(periodStartUtc('daily', now, L).toISOString()).toBe('2026-10-13T23:00:00.000Z')
    expect(periodStartUtc('weekly', now, L).toISOString()).toBe('2026-10-11T23:00:00.000Z')      // Mon 12 Oct local
    expect(periodStartUtc('monthly', now, L).toISOString()).toBe('2026-09-30T23:00:00.000Z')     // 1 Oct local
    expect(periodStartUtc('four_weekly', now, L).toISOString()).toBe('2026-09-20T23:00:00.000Z') // Mon 12 Oct − 21 d
    expect(periodKey('weekly', now, L)).toBe('2026-10-12')
    expect(periodKey('custom', now, L)).toBe('2026-10-14')
  })
  it('just after local midnight belongs to the new day', () => {
    expect(periodKey('daily', new Date('2026-07-01T23:30:00Z'), L)).toBe('2026-07-02')
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/whatsapp/__tests__/time.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`types.ts` exactly as in Interfaces.

```ts
// supabase/functions/_shared/checklists-core/time.ts
// Timezone helpers without libraries: Intl gives local wall-clock parts; zonedToUtc solves for the UTC instant.
import type { Frequency } from './types.ts'

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

export function localParts(now: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    weekday: 'short', hourCycle: 'h23',
  })
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]))
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, weekday: WEEKDAY[p.weekday] }
}

export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  // Start from the wall time as if it were UTC, then correct by the zone offset at that instant (twice for DST edges).
  let guess = Date.UTC(y, m - 1, d, hh, mm)
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), tz)
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm)
    guess += Date.UTC(y, m - 1, d, hh, mm) - asUtc
  }
  return new Date(guess)
}

function addDays(y: number, m: number, d: number, days: number) {
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

function periodStartLocal(freq: Frequency, now: Date, tz: string) {
  const p = localParts(now, tz)
  if (freq === 'weekly') return addDays(p.y, p.m, p.d, -(p.weekday - 1))
  if (freq === 'four_weekly') return addDays(p.y, p.m, p.d, -(p.weekday - 1) - 21)
  if (freq === 'monthly') return { y: p.y, m: p.m, d: 1 }
  return { y: p.y, m: p.m, d: p.d }
}

export function periodStartUtc(freq: Frequency, now: Date, tz: string): Date {
  const s = periodStartLocal(freq, now, tz)
  return zonedToUtc(s.y, s.m, s.d, 0, 0, tz)
}

export function periodKey(freq: Frequency, now: Date, tz: string): string {
  const s = periodStartLocal(freq, now, tz)
  return `${s.y}-${String(s.m).padStart(2, '0')}-${String(s.d).padStart(2, '0')}`
}

export function deadlineUtc(deadlineTime: string | null, now: Date, tz: string): Date | null {
  if (!deadlineTime) return null
  const m = deadlineTime.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const p = localParts(now, tz)
  return zonedToUtc(p.y, p.m, p.d, +m[1], +m[2], tz)
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/whatsapp/__tests__/time.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/checklists-core src/lib/whatsapp/__tests__/time.test.ts
git commit -m "feat(checklists-core): types and timezone/period helpers"
```

---

### Task 3: Due logic + flagging

**Files:**
- Create: `supabase/functions/_shared/checklists-core/due.ts`, `supabase/functions/_shared/checklists-core/flagging.ts`
- Test: `src/lib/whatsapp/__tests__/due.test.ts`, `src/lib/whatsapp/__tests__/flagging.test.ts`

**Interfaces:**
- Consumes: Task 2 types/time.
- Produces:
  - `isAssigned(t: Template, p: Person): boolean`
  - `availableChecklists(templates: Template[], p: Person, siteId: string): Template[]` (active + assigned + site)
  - `dueChecklists(args: { templates: Template[]; person: Person; siteId: string; tz: string; now: Date; completions: CompletionLite[] }): DueChecklist[]` — available, not done in the current period; done = count of completions for (template, site) since period start ≥ `multi_per_day ? (min_per_day ?? 0) : 1`; templates with `multi_per_day && (min_per_day ?? 0) === 0` are never due.
  - `flagResponse(item: Pick<TemplateItem,'item_type'|'min_value'|'max_value'>, value: string): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/whatsapp/__tests__/flagging.test.ts
import { describe, it, expect } from 'vitest'
import { flagResponse } from '../../../../supabase/functions/_shared/checklists-core/flagging'

const t = (min: number | null, max: number | null) => ({ item_type: 'temperature' as const, min_value: min, max_value: max })
describe('flagResponse (parity with web autoFlag)', () => {
  it.each([
    [t(0, 5), '3', false], [t(0, 5), '5', false], [t(0, 5), '5.1', true], [t(0, 5), '-0.5', true],
    [t(null, 5), '-40', false], [t(75, null), '74.9', true], [t(0, 5), '', false], [t(0, 5), 'abc', false], [t(0, 5), '9°C', true],
  ])('temperature %o value %s → %s', (item, v, exp) => expect(flagResponse(item, v as string)).toBe(exp))
  it('yes_no "no" flags, others do not', () => {
    const yn = { item_type: 'yes_no' as const, min_value: null, max_value: null }
    expect(flagResponse(yn, 'no')).toBe(true)
    expect(flagResponse(yn, 'yes')).toBe(false)
    expect(flagResponse({ item_type: 'tick', min_value: null, max_value: null }, 'false')).toBe(false)
  })
})
```

(`'9°C'` → `parseFloat` gives 9 → flagged, same as web.)

```ts
// src/lib/whatsapp/__tests__/due.test.ts
import { describe, it, expect } from 'vitest'
import { isAssigned, availableChecklists, dueChecklists } from '../../../../supabase/functions/_shared/checklists-core/due'
import type { Template, Person } from '../../../../supabase/functions/_shared/checklists-core/types'

const tpl = (o: Partial<Template>): Template => ({
  id: 't1', business_id: 'b', site_id: null, name: 'Fridge temps', frequency: 'daily', deadline_time: '11:00',
  multi_per_day: false, min_per_day: null, assigned_roles: ['kitchen_staff'], assigned_role_ids: ['r-ks'], active: true, ...o,
})
const anna: Person = { profile_id: 'p1', business_id: 'b', full_name: 'Anna', role: 'kitchen_staff', role_id: 'r-ks' }
const legacy: Person = { ...anna, profile_id: 'p2', role_id: null }
const now = new Date('2026-10-14T09:45:00Z') // 10:45 BST
const L = 'Europe/London'

describe('assignment and availability', () => {
  it('uses role_id when present, legacy role otherwise', () => {
    expect(isAssigned(tpl({}), anna)).toBe(true)
    expect(isAssigned(tpl({ assigned_role_ids: ['r-chef'] }), anna)).toBe(false)
    expect(isAssigned(tpl({ assigned_role_ids: [] }), legacy)).toBe(true)
    expect(isAssigned(tpl({ assigned_roles: ['chef'] }), legacy)).toBe(false)
  })
  it('filters by site and active', () => {
    const ts = [tpl({ id: 'a' }), tpl({ id: 'b', site_id: 's2' }), tpl({ id: 'c', site_id: 's1' }), tpl({ id: 'd', active: false })]
    expect(availableChecklists(ts, anna, 's1').map((t) => t.id)).toEqual(['a', 'c'])
  })
})

describe('dueChecklists', () => {
  it('due with deadline and not overdue before it', () => {
    const [d] = dueChecklists({ templates: [tpl({})], person: anna, siteId: 's1', tz: L, now, completions: [] })
    expect(d).toMatchObject({ site_id: 's1', deadline_utc: '2026-10-14T10:00:00.000Z', period_key: '2026-10-14', overdue: false })
  })
  it('done today → not due; done yesterday → due', () => {
    const today = [{ template_id: 't1', site_id: 's1', completed_at: '2026-10-14T06:00:00Z' }]
    const yesterday = [{ template_id: 't1', site_id: 's1', completed_at: '2026-10-13T20:00:00Z' }]
    expect(dueChecklists({ templates: [tpl({})], person: anna, siteId: 's1', tz: L, now, completions: today })).toEqual([])
    expect(dueChecklists({ templates: [tpl({})], person: anna, siteId: 's1', tz: L, now, completions: yesterday })).toHaveLength(1)
  })
  it('a completion at another site does not count', () => {
    const other = [{ template_id: 't1', site_id: 's2', completed_at: '2026-10-14T06:00:00Z' }]
    expect(dueChecklists({ templates: [tpl({})], person: anna, siteId: 's1', tz: L, now, completions: other })).toHaveLength(1)
  })
  it('multi-per-day needs min_per_day completions; 0 means optional', () => {
    const one = [{ template_id: 't1', site_id: 's1', completed_at: '2026-10-14T06:00:00Z' }]
    expect(dueChecklists({ templates: [tpl({ multi_per_day: true, min_per_day: 2 })], person: anna, siteId: 's1', tz: L, now, completions: one })).toHaveLength(1)
    expect(dueChecklists({ templates: [tpl({ multi_per_day: true, min_per_day: 0 })], person: anna, siteId: 's1', tz: L, now, completions: [] })).toEqual([])
  })
  it('overdue after the deadline; no deadline → deadline_utc null', () => {
    const late = new Date('2026-10-14T10:30:00Z')
    expect(dueChecklists({ templates: [tpl({})], person: anna, siteId: 's1', tz: L, now: late, completions: [] })[0].overdue).toBe(true)
    expect(dueChecklists({ templates: [tpl({ deadline_time: null })], person: anna, siteId: 's1', tz: L, now, completions: [] })[0].deadline_utc).toBeNull()
  })
})
```

- [ ] **Step 2: Run to see them fail** — `npx vitest run src/lib/whatsapp/__tests__/due.test.ts src/lib/whatsapp/__tests__/flagging.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// supabase/functions/_shared/checklists-core/flagging.ts
// Same rules as the web autoFlag / mobile _isFlagged — keep them in sync.
import type { TemplateItem } from './types.ts'

export function flagResponse(item: Pick<TemplateItem, 'item_type' | 'min_value' | 'max_value'>, value: string): boolean {
  if (item.item_type === 'yes_no' && value === 'no') return true
  if (item.item_type === 'temperature' && value !== '') {
    const n = parseFloat(value)
    if (isNaN(n)) return false
    if (item.min_value != null && n < item.min_value) return true
    if (item.max_value != null && n > item.max_value) return true
  }
  return false
}
```

```ts
// supabase/functions/_shared/checklists-core/due.ts
import type { CompletionLite, DueChecklist, Person, Template } from './types.ts'
import { deadlineUtc, periodKey, periodStartUtc } from './time.ts'

export function isAssigned(t: Template, p: Person): boolean {
  return p.role_id ? t.assigned_role_ids.includes(p.role_id) : t.assigned_roles.includes(p.role)
}

export function availableChecklists(templates: Template[], p: Person, siteId: string): Template[] {
  return templates.filter((t) => t.active && (t.site_id === null || t.site_id === siteId) && isAssigned(t, p))
}

export function dueChecklists(args: {
  templates: Template[]; person: Person; siteId: string; tz: string; now: Date; completions: CompletionLite[]
}): DueChecklist[] {
  const { templates, person, siteId, tz, now, completions } = args
  const out: DueChecklist[] = []
  for (const t of availableChecklists(templates, person, siteId)) {
    const need = t.multi_per_day ? (t.min_per_day ?? 0) : 1
    if (need === 0) continue
    const start = periodStartUtc(t.frequency, now, tz).getTime()
    const done = completions.filter((c) =>
      c.template_id === t.id && c.site_id === siteId && new Date(c.completed_at).getTime() >= start).length
    if (done >= need) continue
    const dl = deadlineUtc(t.deadline_time, now, tz)
    out.push({
      template: t, site_id: siteId, deadline_utc: dl ? dl.toISOString() : null,
      period_key: periodKey(t.frequency, now, tz), overdue: !!dl && now.getTime() > dl.getTime(),
    })
  }
  return out
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/checklists-core src/lib/whatsapp/__tests__/due.test.ts src/lib/whatsapp/__tests__/flagging.test.ts
git commit -m "feat(checklists-core): assignment, due checklists and flagging parity"
```

---

### Task 4: Answer parsing from forms

**Files:**
- Create: `supabase/functions/_shared/checklists-core/answers.ts`
- Test: `src/lib/whatsapp/__tests__/answers.test.ts`

**Interfaces:**
- Consumes: `TemplateItem`, `Answer` (Task 2), `flagResponse` (Task 3)
- Produces:
  - `fieldName(index: number): string` → `f0`, `f1`… (Flow field names; index into the item-id list stored on the token)
  - `formItems(items: TemplateItem[]): { supported: TemplateItem[]; unsupportedRequired: TemplateItem[] }` — sorted by `sort_order`; `photo` and `initials` are not shown in WhatsApp; a **required photo** makes the checklist unsupported (`unsupportedRequired` non-empty).
  - `parseFormAnswers(itemIds: string[], items: TemplateItem[], response: Record<string, unknown>): { answers: Answer[]; missingRequired: string[] }` — maps `f<i>` to `itemIds[i]`; ignores ids that are no longer items; normalises values (tick: true/"true" → `'true'`, else skipped; yes_no `'yes'|'no'`; temperature: trims, replaces `,` with `.`, keeps the string; text: trimmed); empty values skipped; `missingRequired` = names of required supported items without a value.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/whatsapp/__tests__/answers.test.ts
import { describe, it, expect } from 'vitest'
import { fieldName, formItems, parseFormAnswers } from '../../../../supabase/functions/_shared/checklists-core/answers'
import type { TemplateItem } from '../../../../supabase/functions/_shared/checklists-core/types'

const it_ = (id: string, item_type: TemplateItem['item_type'], o: Partial<TemplateItem> = {}): TemplateItem =>
  ({ id, name: id.toUpperCase(), item_type, required: true, min_value: null, max_value: null, unit: null, sort_order: 0, ...o })

describe('formItems', () => {
  it('sorts, drops photo/initials, reports required photos', () => {
    const r = formItems([it_('b', 'yes_no', { sort_order: 2 }), it_('a', 'temperature', { sort_order: 1 }),
      it_('p', 'photo', { required: false }), it_('i', 'initials')])
    expect(r.supported.map((x) => x.id)).toEqual(['a', 'b'])
    expect(r.unsupportedRequired).toEqual([])
    expect(formItems([it_('p', 'photo')]).unsupportedRequired.map((x) => x.id)).toEqual(['p'])
  })
})

describe('parseFormAnswers', () => {
  const items = [it_('a', 'temperature', { min_value: 0, max_value: 5 }), it_('b', 'yes_no'), it_('c', 'tick'), it_('d', 'text', { required: false })]
  const ids = ['a', 'b', 'c', 'd']
  it('maps fields by index and flags', () => {
    const r = parseFormAnswers(ids, items, { [fieldName(0)]: ' 7,5 ', f1: 'no', f2: true, f3: '  ok ' })
    expect(r.answers).toEqual([
      { item_id: 'a', value: '7.5', flagged: true },
      { item_id: 'b', value: 'no', flagged: true },
      { item_id: 'c', value: 'true', flagged: false },
      { item_id: 'd', value: 'ok', flagged: false },
    ])
    expect(r.missingRequired).toEqual([])
  })
  it('reports missing required and skips empties', () => {
    const r = parseFormAnswers(ids, items, { f0: '', f1: 'yes' })
    expect(r.answers.map((a) => a.item_id)).toEqual(['b'])
    expect(r.missingRequired).toEqual(['A', 'C'])
  })
  it('ignores ids of items deleted since the form was sent and never shifts values', () => {
    const r = parseFormAnswers(['gone', 'b'], items, { f0: '3', f1: 'yes' })
    expect(r.answers).toEqual([{ item_id: 'b', value: 'yes', flagged: false }])
  })
  it('rejects unexpected yes_no values', () => {
    expect(parseFormAnswers(['b'], items, { f0: 'maybe' }).answers).toEqual([])
  })
})
```

- [ ] **Step 2: Run to see it fail** → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// supabase/functions/_shared/checklists-core/answers.ts
import type { Answer, TemplateItem } from './types.ts'
import { flagResponse } from './flagging.ts'

export const fieldName = (i: number) => `f${i}`

export function formItems(items: TemplateItem[]) {
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order)
  return {
    supported: sorted.filter((i) => i.item_type !== 'photo' && i.item_type !== 'initials'),
    unsupportedRequired: sorted.filter((i) => i.item_type === 'photo' && i.required),
  }
}

function normalise(item: TemplateItem, raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  switch (item.item_type) {
    case 'tick': return raw === true || raw === 'true' ? 'true' : null
    case 'yes_no': return raw === 'yes' || raw === 'no' ? raw : null
    case 'temperature': {
      const s = String(raw).trim().replace(',', '.')
      return s === '' ? null : s
    }
    case 'text': {
      const s = String(raw).trim()
      return s === '' ? null : s
    }
    default: return null
  }
}

export function parseFormAnswers(itemIds: string[], items: TemplateItem[], response: Record<string, unknown>) {
  const byId = new Map(items.map((i) => [i.id, i]))
  const answers: Answer[] = []
  itemIds.forEach((id, idx) => {
    const item = byId.get(id)
    if (!item) return
    const value = normalise(item, response[fieldName(idx)])
    if (value === null) return
    answers.push({ item_id: id, value, flagged: flagResponse(item, value) })
  })
  const answered = new Set(answers.map((a) => a.item_id))
  const missingRequired = formItems(items).supported
    .filter((i) => i.required && itemIds.includes(i.id) && !answered.has(i.id)).map((i) => i.name)
  return { answers, missingRequired }
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/checklists-core/answers.ts src/lib/whatsapp/__tests__/answers.test.ts
git commit -m "feat(checklists-core): parse form answers by stored item ids"
```

---

### Task 5: Reminder and corrective planners

**Files:**
- Create: `supabase/functions/_shared/checklists-core/reminders.ts`
- Test: `src/lib/whatsapp/__tests__/reminders.test.ts`

**Interfaces:**
- Consumes: `dueChecklists`, types.
- Produces:

```ts
export const LEAD_MINUTES = 30
export const MAX_PER_MESSAGE = 3
export interface Recipient { person: Person; external_id: string; site_id: string; tz: string }
export interface ReminderJob { profile_id: string; external_id: string; site_id: string; items: DueChecklist[] }
export function reminderKey(profileId: string, templateId: string, siteId: string, periodKey: string): string
export function planReminders(args: { now: Date; recipients: Recipient[]; templates: Template[]; completions: CompletionLite[]; alreadySent: Set<string> }): ReminderJob[]
export interface NeededCorrective { response_id: string; completed_by: string; business_id: string; site_id: string; created_at: string }
export interface CorrectiveAction { response_id: string; action: 'nudge' | 'alert_no_action' }
export function planCorrective(args: { now: Date; needed: NeededCorrective[]; nudged: Set<string>; alerted: Set<string> }): CorrectiveAction[]
```

Rules: a due checklist is included when it has a deadline and `deadline − 30 min ≤ now < deadline` and its key is not in `alreadySent`; items sorted by deadline; at most 3 per job (the rest are reminded next run since their keys aren't marked). Corrective: `nudge` when `now − created_at ≥ 30 min` and not nudged; `alert_no_action` when `now − created_at ≥ 60 min` and not alerted.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/whatsapp/__tests__/reminders.test.ts
import { describe, it, expect } from 'vitest'
import { planReminders, planCorrective, reminderKey } from '../../../../supabase/functions/_shared/checklists-core/reminders'
import type { Template, Person } from '../../../../supabase/functions/_shared/checklists-core/types'

const tpl = (id: string, deadline: string | null): Template => ({
  id, business_id: 'b', site_id: null, name: id, frequency: 'daily', deadline_time: deadline,
  multi_per_day: false, min_per_day: null, assigned_roles: [], assigned_role_ids: ['r'], active: true,
})
const person: Person = { profile_id: 'p1', business_id: 'b', full_name: 'Anna', role: 'kitchen_staff', role_id: 'r' }
const rec = [{ person, external_id: '447700900123', site_id: 's1', tz: 'Europe/London' }]
const at = (iso: string) => new Date(iso)

describe('planReminders', () => {
  it('only inside [deadline−30, deadline)', () => {
    const t = [tpl('open', '10:00')] // 09:00Z in BST
    expect(planReminders({ now: at('2026-10-14T08:29:00Z'), recipients: rec, templates: t, completions: [], alreadySent: new Set() })).toEqual([])
    expect(planReminders({ now: at('2026-10-14T08:30:00Z'), recipients: rec, templates: t, completions: [], alreadySent: new Set() })).toHaveLength(1)
    expect(planReminders({ now: at('2026-10-14T09:00:00Z'), recipients: rec, templates: t, completions: [], alreadySent: new Set() })).toEqual([])
  })
  it('skips already-sent keys (overlapping cron runs)', () => {
    const sent = new Set([reminderKey('p1', 'open', 's1', '2026-10-14')])
    expect(planReminders({ now: at('2026-10-14T08:40:00Z'), recipients: rec, templates: [tpl('open', '10:00')], completions: [], alreadySent: sent })).toEqual([])
  })
  it('groups up to 3 per message, earliest first; no deadline → never', () => {
    const t = [tpl('d', '10:20'), tpl('a', '10:05'), tpl('b', '10:10'), tpl('c', '10:15'), tpl('x', null)]
    const [job] = planReminders({ now: at('2026-10-14T08:50:00Z'), recipients: rec, templates: t, completions: [], alreadySent: new Set() })
    expect(job.items.map((i) => i.template.id)).toEqual(['a', 'b', 'c'])
  })
  it('completed checklists are not reminded', () => {
    const done = [{ template_id: 'open', site_id: 's1', completed_at: '2026-10-14T07:00:00Z' }]
    expect(planReminders({ now: at('2026-10-14T08:40:00Z'), recipients: rec, templates: [tpl('open', '10:00')], completions: done, alreadySent: new Set() })).toEqual([])
  })
})

describe('planCorrective', () => {
  const n = [{ response_id: 'r1', completed_by: 'p1', business_id: 'b', site_id: 's1', created_at: '2026-10-14T09:00:00Z' }]
  it('nudge at 30 min, alert at 60 min, each once', () => {
    expect(planCorrective({ now: at('2026-10-14T09:29:00Z'), needed: n, nudged: new Set(), alerted: new Set() })).toEqual([])
    expect(planCorrective({ now: at('2026-10-14T09:30:00Z'), needed: n, nudged: new Set(), alerted: new Set() })).toEqual([{ response_id: 'r1', action: 'nudge' }])
    expect(planCorrective({ now: at('2026-10-14T10:00:00Z'), needed: n, nudged: new Set(['r1']), alerted: new Set() })).toEqual([{ response_id: 'r1', action: 'alert_no_action' }])
    expect(planCorrective({ now: at('2026-10-14T10:30:00Z'), needed: n, nudged: new Set(['r1']), alerted: new Set(['r1']) })).toEqual([])
  })
})
```

- [ ] **Step 2: Run to see it fail** → FAIL.

- [ ] **Step 3: Implement**

```ts
// supabase/functions/_shared/checklists-core/reminders.ts
import type { CompletionLite, DueChecklist, Person, Template } from './types.ts'
import { dueChecklists } from './due.ts'

export const LEAD_MINUTES = 30
export const MAX_PER_MESSAGE = 3
export interface Recipient { person: Person; external_id: string; site_id: string; tz: string }
export interface ReminderJob { profile_id: string; external_id: string; site_id: string; items: DueChecklist[] }
export interface NeededCorrective { response_id: string; completed_by: string; business_id: string; site_id: string; created_at: string }
export interface CorrectiveAction { response_id: string; action: 'nudge' | 'alert_no_action' }

export const reminderKey = (profileId: string, templateId: string, siteId: string, periodKey: string) =>
  `${profileId}:${templateId}:${siteId}:${periodKey}`

export function planReminders(args: {
  now: Date; recipients: Recipient[]; templates: Template[]; completions: CompletionLite[]; alreadySent: Set<string>
}): ReminderJob[] {
  const { now, recipients, templates, completions, alreadySent } = args
  const jobs: ReminderJob[] = []
  for (const r of recipients) {
    const due = dueChecklists({ templates, person: r.person, siteId: r.site_id, tz: r.tz, now, completions })
      .filter((d) => {
        if (!d.deadline_utc) return false
        const dl = new Date(d.deadline_utc).getTime()
        return now.getTime() >= dl - LEAD_MINUTES * 60_000 && now.getTime() < dl
          && !alreadySent.has(reminderKey(r.person.profile_id, d.template.id, r.site_id, d.period_key))
      })
      .sort((a, b) => a.deadline_utc!.localeCompare(b.deadline_utc!))
    if (due.length) jobs.push({ profile_id: r.person.profile_id, external_id: r.external_id, site_id: r.site_id, items: due.slice(0, MAX_PER_MESSAGE) })
  }
  return jobs
}

export function planCorrective(args: { now: Date; needed: NeededCorrective[]; nudged: Set<string>; alerted: Set<string> }): CorrectiveAction[] {
  const out: CorrectiveAction[] = []
  for (const n of args.needed) {
    const age = args.now.getTime() - new Date(n.created_at).getTime()
    if (age >= 60 * 60_000 && !args.alerted.has(n.response_id)) out.push({ response_id: n.response_id, action: 'alert_no_action' })
    else if (age >= 30 * 60_000 && !args.nudged.has(n.response_id)) out.push({ response_id: n.response_id, action: 'nudge' })
  }
  return out
}
```

Note: at 60 min with `nudged` empty, the plan emits only `alert_no_action` (the nudge is skipped) — acceptable: the alert is the stronger action.

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/checklists-core/reminders.ts src/lib/whatsapp/__tests__/reminders.test.ts
git commit -m "feat(checklists-core): reminder and corrective-action planners"
```

---

### Task 6: WhatsApp adapter (signature, inbound parsing, outbound builders) + Flow builder

**Files:**
- Create: `supabase/functions/_shared/channels/types.ts`, `supabase/functions/_shared/channels/mask.ts`, `supabase/functions/_shared/channels/whatsapp.ts`, `supabase/functions/_shared/channels/whatsapp-flows.ts`
- Create fixtures: `src/lib/whatsapp/__tests__/fixtures/text.json`, `button.json`, `flow.json`, `status.json`
- Test: `src/lib/whatsapp/__tests__/whatsapp.test.ts`, `src/lib/whatsapp/__tests__/flows.test.ts`

**Interfaces — Produces:**

```ts
// channels/types.ts
export type InboundEvent =
  | { kind: 'text'; from: string; text: string; id: string }
  | { kind: 'button'; from: string; payload: string; id: string }
  | { kind: 'flow'; from: string; token: string; response: Record<string, unknown>; id: string }
export type OutboundMessage = Record<string, unknown>   // Cloud API /messages body
export interface SendResult { id: string | null; ok: boolean; status: number }
export type SendFn = (msg: OutboundMessage) => Promise<SendResult>

// channels/mask.ts
export function maskPhone(e164: string): string     // '447700900123' → '+44 7••• ••23'

// channels/whatsapp.ts
export const GRAPH_VERSION = 'v23.0'
export async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean>
export function parseInbound(body: unknown): InboundEvent[]
export function textMessage(to: string, body: string): OutboundMessage
export function buttonsMessage(to: string, body: string, buttons: { id: string; title: string }[]): OutboundMessage   // ≤3, title ≤20 chars
export function templateMessage(to: string, name: string, bodyParams: string[], quickReplies: string[]): OutboundMessage   // quickReplies = payloads for QUICK_REPLY buttons in order
export function flowMessage(to: string, o: { flowId: string; token: string; cta: string; body: string; screen: string; data?: Record<string, unknown> }): OutboundMessage
export function makeSender(cfg: { token: string; phoneNumberId: string; fetchFn?: typeof fetch }): SendFn

// channels/whatsapp-flows.ts
export const FLOW_JSON_VERSION = '6.0'
export const MAX_FORM_ITEMS = 40
export async function itemsHash(items: TemplateItem[]): Promise<string>   // sha-256 hex of [id,name,type,required,min,max] in form order
export function buildChecklistFlow(templateName: string, items: TemplateItem[]): { json: Record<string, unknown>; itemIds: string[] } | null   // null if unsupported (required photo or > MAX_FORM_ITEMS)
export const CORRECTIVE_FLOW_JSON: Record<string, unknown>
export const CORRECTIVE_ACTIONS: { id: string; title: string }[]
```

Payload conventions (used by Task 7): button payloads `fill:<templateId>:<siteId>`, `checks`. Flow screens: checklist `CHECKLIST`, corrective `CORRECTIVE`.

**Before Step 1:** read Meta's current docs to confirm field names: webhook payload (`entry[].changes[].value.messages[]`, `type: 'text'|'button'|'interactive'`, `interactive.type: 'button_reply'|'nfm_reply'`, `nfm_reply.response_json` string containing `flow_token`), Flow JSON components (`TextInput` with `input-type: "number"`, `RadioButtonsGroup`, `OptIn`, `TextArea`, `Footer` with `on-click-action: { name: "complete", payload }`), and the latest stable Graph and Flow JSON versions. If they differ from `GRAPH_VERSION`/`FLOW_JSON_VERSION` above, use the docs' values and note it in the report. URLs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples , https://developers.facebook.com/docs/whatsapp/flows/reference/flowjson .

- [ ] **Step 1: Write fixtures and failing tests**

```json
// src/lib/whatsapp/__tests__/fixtures/text.json
{ "object": "whatsapp_business_account", "entry": [{ "id": "WABA", "changes": [{ "field": "messages", "value": {
  "messaging_product": "whatsapp", "metadata": { "display_phone_number": "447000000000", "phone_number_id": "PNID" },
  "contacts": [{ "profile": { "name": "Anna" }, "wa_id": "447700900123" }],
  "messages": [{ "from": "447700900123", "id": "wamid.T1", "timestamp": "1760436000", "type": "text", "text": { "body": "LINK 482913" } }] } }] }] }
```

```json
// src/lib/whatsapp/__tests__/fixtures/button.json
{ "object": "whatsapp_business_account", "entry": [{ "id": "WABA", "changes": [{ "field": "messages", "value": {
  "messaging_product": "whatsapp", "metadata": { "phone_number_id": "PNID" },
  "messages": [
    { "from": "447700900123", "id": "wamid.B1", "timestamp": "1760436000", "type": "button", "button": { "payload": "fill:t1:s1", "text": "Fill in" } },
    { "from": "447700900123", "id": "wamid.B2", "timestamp": "1760436001", "type": "interactive", "interactive": { "type": "button_reply", "button_reply": { "id": "checks", "title": "My checks" } } }
  ] } }] }] }
```

```json
// src/lib/whatsapp/__tests__/fixtures/flow.json
{ "object": "whatsapp_business_account", "entry": [{ "id": "WABA", "changes": [{ "field": "messages", "value": {
  "messaging_product": "whatsapp", "metadata": { "phone_number_id": "PNID" },
  "messages": [{ "from": "447700900123", "id": "wamid.F1", "timestamp": "1760436000", "type": "interactive",
    "interactive": { "type": "nfm_reply", "nfm_reply": { "name": "flow", "body": "Sent",
      "response_json": "{\"flow_token\":\"tok123\",\"f0\":\"4.5\",\"f1\":\"yes\"}" } } }] } }] }] }
```

```json
// src/lib/whatsapp/__tests__/fixtures/status.json
{ "object": "whatsapp_business_account", "entry": [{ "id": "WABA", "changes": [{ "field": "messages", "value": {
  "messaging_product": "whatsapp", "metadata": { "phone_number_id": "PNID" },
  "statuses": [{ "id": "wamid.X", "status": "delivered", "recipient_id": "447700900123" }] } }] }] }
```

```ts
// src/lib/whatsapp/__tests__/whatsapp.test.ts
import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import text from './fixtures/text.json'
import button from './fixtures/button.json'
import flow from './fixtures/flow.json'
import status from './fixtures/status.json'
import { verifySignature, parseInbound, textMessage, buttonsMessage, templateMessage, flowMessage, makeSender } from '../../../../supabase/functions/_shared/channels/whatsapp'
import { maskPhone } from '../../../../supabase/functions/_shared/channels/mask'

describe('verifySignature', () => {
  const body = '{"a":1}'
  const good = 'sha256=' + createHmac('sha256', 'secret').update(body).digest('hex')
  it('accepts a valid signature, rejects wrong/missing', async () => {
    expect(await verifySignature(body, good, 'secret')).toBe(true)
    expect(await verifySignature(body, good, 'other')).toBe(false)
    expect(await verifySignature(body + ' ', good, 'secret')).toBe(false)
    expect(await verifySignature(body, null, 'secret')).toBe(false)
    expect(await verifySignature(body, 'sha256=zz', 'secret')).toBe(false)
  })
})

describe('parseInbound', () => {
  it('text', () => expect(parseInbound(text)).toEqual([{ kind: 'text', from: '447700900123', text: 'LINK 482913', id: 'wamid.T1' }]))
  it('template quick reply and interactive button', () => expect(parseInbound(button)).toEqual([
    { kind: 'button', from: '447700900123', payload: 'fill:t1:s1', id: 'wamid.B1' },
    { kind: 'button', from: '447700900123', payload: 'checks', id: 'wamid.B2' },
  ]))
  it('flow reply', () => expect(parseInbound(flow)).toEqual([
    { kind: 'flow', from: '447700900123', token: 'tok123', response: { f0: '4.5', f1: 'yes' }, id: 'wamid.F1' },
  ]))
  it('statuses and junk → nothing', () => {
    expect(parseInbound(status)).toEqual([])
    expect(parseInbound(null)).toEqual([])
    expect(parseInbound({ entry: [{ changes: [{ value: { messages: [{ type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { response_json: 'not json' } } }] } }] }] })).toEqual([])
  })
})

describe('builders', () => {
  it('text and buttons', () => {
    expect(textMessage('44', 'hi')).toEqual({ messaging_product: 'whatsapp', to: '44', type: 'text', text: { body: 'hi', preview_url: false } })
    const b = buttonsMessage('44', 'Pick', [{ id: 'fill:a:s', title: 'A very long checklist name here' }]) as any
    expect(b.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20)
  })
  it('template with quick replies', () => {
    const t = templateMessage('44', 'checklist_reminder', ['Fridge temps', '11:00', 'Wharf Side'], ['fill:t1:s1']) as any
    expect(t.template.name).toBe('checklist_reminder')
    expect(t.template.language).toEqual({ code: 'en_GB' })
    expect(t.template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Fridge temps' }, { type: 'text', text: '11:00' }, { type: 'text', text: 'Wharf Side' }] },
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'fill:t1:s1' }] },
    ])
  })
  it('flow message', () => {
    const f = flowMessage('44', { flowId: 'F', token: 'tok', cta: 'Fill in', body: 'Fridge temps', screen: 'CHECKLIST' }) as any
    expect(f.interactive.type).toBe('flow')
    expect(f.interactive.action.parameters).toMatchObject({ flow_message_version: '3', flow_id: 'F', flow_token: 'tok', flow_cta: 'Fill in', flow_action: 'navigate', flow_action_payload: { screen: 'CHECKLIST' } })
  })
})

describe('makeSender', () => {
  it('posts to the phone number endpoint with bearer token and returns the message id', async () => {
    const calls: any[] = []
    const send = makeSender({ token: 'T', phoneNumberId: 'PN', fetchFn: (async (url: string, init: any) => {
      calls.push({ url, init }); return new Response(JSON.stringify({ messages: [{ id: 'wamid.OUT' }] }), { status: 200 })
    }) as any })
    expect(await send(textMessage('44', 'x'))).toEqual({ id: 'wamid.OUT', ok: true, status: 200 })
    expect(calls[0].url).toMatch(/\/PN\/messages$/)
    expect(calls[0].init.headers.Authorization).toBe('Bearer T')
  })
  it('reports failures without throwing', async () => {
    const send = makeSender({ token: 'T', phoneNumberId: 'PN', fetchFn: (async () => new Response('{}', { status: 400 })) as any })
    expect(await send(textMessage('44', 'x'))).toEqual({ id: null, ok: false, status: 400 })
  })
})

describe('maskPhone', () => {
  it('keeps country code and last two digits', () => expect(maskPhone('447700900123')).toBe('+44 7••• ••23'))
})
```

```ts
// src/lib/whatsapp/__tests__/flows.test.ts
import { describe, it, expect } from 'vitest'
import { buildChecklistFlow, itemsHash, CORRECTIVE_FLOW_JSON, MAX_FORM_ITEMS } from '../../../../supabase/functions/_shared/channels/whatsapp-flows'
import type { TemplateItem } from '../../../../supabase/functions/_shared/checklists-core/types'

const item = (id: string, item_type: TemplateItem['item_type'], o: Partial<TemplateItem> = {}): TemplateItem =>
  ({ id, name: `Item ${id}`, item_type, required: true, min_value: null, max_value: null, unit: null, sort_order: 0, ...o })

describe('buildChecklistFlow', () => {
  it('builds one screen with a component per supported item and a complete payload', () => {
    const r = buildChecklistFlow('Fridge temps', [
      item('a', 'temperature', { min_value: 0, max_value: 5, unit: '°C', sort_order: 1 }),
      item('b', 'yes_no', { sort_order: 2 }), item('c', 'tick', { sort_order: 3 }), item('d', 'text', { required: false, sort_order: 4 }),
      item('p', 'photo', { required: false, sort_order: 5 }),
    ])!
    expect(r.itemIds).toEqual(['a', 'b', 'c', 'd'])
    expect(r.json).toMatchSnapshot()
  })
  it('returns null for a required photo or too many items', () => {
    expect(buildChecklistFlow('X', [item('p', 'photo')])).toBeNull()
    expect(buildChecklistFlow('X', Array.from({ length: MAX_FORM_ITEMS + 1 }, (_, i) => item(String(i), 'tick')))).toBeNull()
  })
})

describe('itemsHash', () => {
  it('changes when an item changes, stable otherwise', async () => {
    const a = [item('a', 'temperature', { min_value: 0, max_value: 5 })]
    expect(await itemsHash(a)).toBe(await itemsHash([...a]))
    expect(await itemsHash(a)).not.toBe(await itemsHash([item('a', 'temperature', { min_value: 0, max_value: 8 })]))
  })
})

describe('corrective flow', () => {
  it('declares its data inputs', () => {
    const screen = (CORRECTIVE_FLOW_JSON.screens as any[])[0]
    expect(screen.id).toBe('CORRECTIVE')
    expect(Object.keys(screen.data)).toEqual(['item_name', 'value_text'])
  })
})
```

- [ ] **Step 2: Run to see them fail** → FAIL.

- [ ] **Step 3: Implement**

```ts
// supabase/functions/_shared/channels/types.ts
export type InboundEvent =
  | { kind: 'text'; from: string; text: string; id: string }
  | { kind: 'button'; from: string; payload: string; id: string }
  | { kind: 'flow'; from: string; token: string; response: Record<string, unknown>; id: string }
export type OutboundMessage = Record<string, unknown>
export interface SendResult { id: string | null; ok: boolean; status: number }
export type SendFn = (msg: OutboundMessage) => Promise<SendResult>
```

```ts
// supabase/functions/_shared/channels/mask.ts
export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, '')
  if (d.length < 6) return '+••'
  return `+${d.slice(0, 2)} ${d.slice(2, 3)}••• ••${d.slice(-2)}`
}
```

```ts
// supabase/functions/_shared/channels/whatsapp.ts
// WhatsApp Cloud API: signature check, inbound parsing, outbound message builders. No runtime imports.
import type { InboundEvent, OutboundMessage, SendFn } from './types.ts'

export const GRAPH_VERSION = 'v23.0'

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !header.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)))
  const got = header.slice(7)
  if (got.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

export function parseInbound(body: unknown): InboundEvent[] {
  const out: InboundEvent[] = []
  const entries = (body as any)?.entry
  if (!Array.isArray(entries)) return out
  for (const e of entries) for (const c of e?.changes ?? []) for (const m of c?.value?.messages ?? []) {
    const from = String(m?.from ?? ''); const id = String(m?.id ?? '')
    if (!from) continue
    if (m.type === 'text' && typeof m.text?.body === 'string') out.push({ kind: 'text', from, text: m.text.body, id })
    else if (m.type === 'button' && typeof m.button?.payload === 'string') out.push({ kind: 'button', from, payload: m.button.payload, id })
    else if (m.type === 'interactive' && m.interactive?.type === 'button_reply') out.push({ kind: 'button', from, payload: String(m.interactive.button_reply?.id ?? ''), id })
    else if (m.type === 'interactive' && m.interactive?.type === 'nfm_reply') {
      try {
        const parsed = JSON.parse(m.interactive.nfm_reply?.response_json ?? '')
        const { flow_token, ...response } = parsed ?? {}
        if (typeof flow_token === 'string') out.push({ kind: 'flow', from, token: flow_token, response, id })
      } catch { /* malformed flow reply: ignore */ }
    }
  }
  return out
}

export const textMessage = (to: string, body: string): OutboundMessage =>
  ({ messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: false } })

export const buttonsMessage = (to: string, body: string, buttons: { id: string; title: string }[]): OutboundMessage => ({
  messaging_product: 'whatsapp', to, type: 'interactive',
  interactive: { type: 'button', body: { text: body }, action: {
    buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.length > 20 ? b.title.slice(0, 19) + '…' : b.title } })),
  } },
})

export const templateMessage = (to: string, name: string, bodyParams: string[], quickReplies: string[]): OutboundMessage => ({
  messaging_product: 'whatsapp', to, type: 'template',
  template: { name, language: { code: 'en_GB' }, components: [
    { type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) },
    ...quickReplies.map((payload, i) => ({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload }] })),
  ] },
})

export const flowMessage = (to: string, o: { flowId: string; token: string; cta: string; body: string; screen: string; data?: Record<string, unknown> }): OutboundMessage => ({
  messaging_product: 'whatsapp', to, type: 'interactive',
  interactive: { type: 'flow', body: { text: o.body }, action: { name: 'flow', parameters: {
    flow_message_version: '3', flow_id: o.flowId, flow_token: o.token, flow_cta: o.cta, flow_action: 'navigate',
    flow_action_payload: { screen: o.screen, ...(o.data ? { data: o.data } : {}) },
  } } },
})

export function makeSender(cfg: { token: string; phoneNumberId: string; fetchFn?: typeof fetch }): SendFn {
  const f = cfg.fetchFn ?? fetch
  return async (msg) => {
    try {
      const r = await f(`https://graph.facebook.com/${GRAPH_VERSION}/${cfg.phoneNumberId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(msg),
      })
      const j = await r.json().catch(() => ({}))
      return { id: r.ok ? (j?.messages?.[0]?.id ?? null) : null, ok: r.ok, status: r.status }
    } catch {
      return { id: null, ok: false, status: 0 }
    }
  }
}
```

```ts
// supabase/functions/_shared/channels/whatsapp-flows.ts
// Static WhatsApp Flows generated from checklist items. Field names f0..fN index into the item-id list kept on the form token.
import type { TemplateItem } from '../checklists-core/types.ts'

export const FLOW_JSON_VERSION = '6.0'
export const MAX_FORM_ITEMS = 40

function sortedSupported(items: TemplateItem[]) {
  return [...items].sort((a, b) => a.sort_order - b.sort_order).filter((i) => i.item_type !== 'photo' && i.item_type !== 'initials')
}

export async function itemsHash(items: TemplateItem[]): Promise<string> {
  const shape = sortedSupported(items).map((i) => [i.id, i.name, i.item_type, i.required, i.min_value, i.max_value])
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(shape)))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function rangeHint(i: TemplateItem): string | undefined {
  const u = i.unit ?? '°C'
  if (i.min_value != null && i.max_value != null) return `${i.min_value}–${i.max_value} ${u}`
  if (i.min_value != null) return `${i.min_value} ${u} or above`
  if (i.max_value != null) return `${i.max_value} ${u} or below`
  return undefined
}

function component(i: TemplateItem, name: string): Record<string, unknown> {
  const label = i.name.slice(0, 30)
  switch (i.item_type) {
    case 'temperature': return { type: 'TextInput', name, label, 'input-type': 'number', required: i.required, ...(rangeHint(i) ? { 'helper-text': rangeHint(i) } : {}) }
    case 'yes_no': return { type: 'RadioButtonsGroup', name, label, required: i.required, 'data-source': [{ id: 'yes', title: 'Yes' }, { id: 'no', title: 'No' }] }
    case 'tick': return { type: 'OptIn', name, label: i.name.slice(0, 120), required: i.required }
    default: return { type: 'TextArea', name, label, required: i.required }
  }
}

export function buildChecklistFlow(templateName: string, items: TemplateItem[]) {
  if (items.some((i) => i.item_type === 'photo' && i.required)) return null
  const list = sortedSupported(items)
  if (list.length === 0 || list.length > MAX_FORM_ITEMS) return null
  const names = list.map((_, idx) => `f${idx}`)
  const json = {
    version: FLOW_JSON_VERSION,
    screens: [{
      id: 'CHECKLIST', title: templateName.slice(0, 30), terminal: true, success: true,
      layout: { type: 'SingleColumnLayout', children: [{
        type: 'Form', name: 'form', children: [
          ...list.map((i, idx) => component(i, names[idx])),
          { type: 'Footer', label: 'Submit', 'on-click-action': { name: 'complete', payload: Object.fromEntries(names.map((n) => [n, `\${form.${n}}`])) } },
        ],
      }] },
    }],
  }
  return { json, itemIds: list.map((i) => i.id) }
}

export const CORRECTIVE_ACTIONS = [
  { id: 'moved', title: 'Moved food to another fridge' },
  { id: 'thermostat', title: 'Adjusted thermostat, rechecking in 30 min' },
  { id: 'discarded', title: 'Discarded food' },
  { id: 'engineer', title: 'Called engineer' },
  { id: 'other', title: 'Other' },
]

export const CORRECTIVE_FLOW_JSON: Record<string, unknown> = {
  version: FLOW_JSON_VERSION,
  screens: [{
    id: 'CORRECTIVE', title: 'Corrective action', terminal: true, success: true,
    data: { item_name: { type: 'string', __example__: 'Walk-in fridge' }, value_text: { type: 'string', __example__: '9 °C (limit 0–5 °C)' } },
    layout: { type: 'SingleColumnLayout', children: [
      { type: 'TextSubheading', text: '${data.item_name}' },
      { type: 'TextBody', text: '${data.value_text}. What did you do?' },
      { type: 'Form', name: 'form', children: [
        { type: 'RadioButtonsGroup', name: 'action', label: 'Action taken', required: true, 'data-source': CORRECTIVE_ACTIONS },
        { type: 'TextArea', name: 'details', label: 'Details', required: false },
        { type: 'Footer', label: 'Submit', 'on-click-action': { name: 'complete', payload: { action: '${form.action}', details: '${form.details}' } } },
      ] },
    ] },
  }],
}
```

- [ ] **Step 4: Run tests, review the snapshot by eye** — `npx vitest run src/lib/whatsapp/__tests__/whatsapp.test.ts src/lib/whatsapp/__tests__/flows.test.ts` → PASS; snapshot shows `TextInput number` with helper `0–5 °C`, radio Yes/No, OptIn, TextArea, Footer payload `f0..f3`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/channels src/lib/whatsapp/__tests__
git commit -m "feat(channels): WhatsApp adapter (signature, parsing, builders) and Flow builder"
```

---

### Task 7: Bot state machine + recording

**Files:**
- Create: `supabase/functions/_shared/checklists-core/record.ts`, `supabase/functions/_shared/channels/bot.ts`
- Test: `src/lib/whatsapp/__tests__/bot.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:

```ts
// record.ts
export interface CoreDb {
  insertCompletion(row: { template_id: string; business_id: string; site_id: string; completed_by: string; completed_at: string; source: 'whatsapp' | 'telegram' | 'app' }): Promise<{ id: string }>
  insertResponses(rows: { completion_id: string; item_id: string; value: string; notes: string | null; flagged: boolean; corrective_status: 'needed' | null }[]): Promise<{ id: string; item_id: string }[]>
  managerIds(businessId: string): Promise<string[]>
  insertNotifications(rows: { user_id: string; type: string; title: string; message: string; link: string }[]): Promise<void>
}
export async function recordCompletion(db: CoreDb, a: { person: Person; siteId: string; template: Template; items: TemplateItem[]; answers: Answer[]; source: 'whatsapp' | 'telegram'; now: Date }): Promise<{ completionId: string; flagged: { responseId: string; item: TemplateItem; value: string }[] }>

// bot.ts
export interface Identity { id: string; business_id: string; profile_id: string; external_id: string }
export interface SiteInfo { id: string; name: string; timezone: string }
export interface FormToken { token: string; kind: 'checklist' | 'corrective'; business_id: string; profile_id: string; site_id: string; template_id: string | null; item_ids: string[] | null; response_id: string | null; expires_at: string; used_at: string | null }
export interface BotDeps extends CoreDb {
  now(): Date
  send: SendFn
  newToken(): string
  findIdentity(externalId: string): Promise<Identity | null>
  touchIdentity(id: string, at: Date): Promise<void>
  revokeIdentity(id: string): Promise<void>
  consumeLinkCode(code: string, externalId: string, now: Date): Promise<{ ok: true; identity: Identity; siteName: string; name: string } | { ok: false }>
  ready(businessId: string): Promise<boolean>
  person(profileId: string): Promise<Person | null>
  sitesFor(profileId: string): Promise<SiteInfo[]>
  templates(businessId: string): Promise<Template[]>
  items(templateId: string): Promise<TemplateItem[]>
  completionsSince(businessId: string, since: Date): Promise<CompletionLite[]>
  flowFor(templateId: string, siteId: string): Promise<{ flow_id: string; item_ids: string[] } | null>
  correctiveFlowId(): string
  saveToken(t: FormToken): Promise<void>
  takeToken(token: string, now: Date): Promise<FormToken | null>     // marks used; null if unknown/used/expired
  setCorrective(responseId: string, notes: string): Promise<{ templateName: string; itemName: string; value: string; siteName: string; byName: string; businessId: string } | null>
  managerExternalIds(businessId: string): Promise<string[]>
  log(e: { business_id: string | null; site_id: string | null; profile_id: string | null; direction: 'in' | 'out'; kind: string; template_name?: string; billable: boolean; ref_id?: string; wa_message_id?: string | null }): Promise<void>
}
export const TEXT: Record<string, string>     // all bot copy (below)
export async function handleInbound(e: InboundEvent, d: BotDeps): Promise<void>
export async function sendManagerAlert(d: BotDeps, businessId: string, a: { siteName: string; itemName: string; value: string; time: string; byName: string; action: string }): Promise<void>
```

Bot copy (`TEXT`) — exact strings:

```ts
export const TEXT = {
  linked: (name: string, site: string) => `Hi ${name} 👋 You're connected to ${site}. I'll remind you before your checks are due. Reply STOP anytime.`,
  linkExpired: 'This link has expired — ask your manager for a new QR code.',
  unknown: 'Ask your manager for a QR code to connect to Blueroll.',
  unavailable: "Blueroll checks aren't available for your team right now. Please use the Blueroll app.",
  stopped: "You're disconnected from Blueroll. You won't get any more messages. Ask your manager for a new QR code to reconnect.",
  help: 'Blueroll checks: tap Fill in on a reminder, or type CHECKS to see what is due. Type STOP to disconnect.',
  fallback: 'I can help with your checks — tap Fill in or type CHECKS.',
  nothingDue: 'Nothing is due right now 👍',
  dueList: (site: string) => `Checks due at ${site}:`,
  appOnly: (name: string) => `${name} can only be completed in the Blueroll app.`,
  missing: (names: string[]) => `Some required answers were missing: ${names.join(', ')}. Please fill in the form again.`,
  formExpired: 'This form has expired — type CHECKS to get a new one.',
  correctiveBody: (item: string) => `${item} is out of range. Tell us what you did.`,
  correctiveThanks: 'Thanks — your manager has been told.',
}
```

Behaviour (`handleInbound`):
1. Log inbound (`direction:'in', kind: e.kind, billable:false`).
2. `text` matching `/^\s*link\s*(\d{6})\s*$/i` → `consumeLinkCode` → ok: send `TEXT.linked` (kind `link`); not ok: send `TEXT.linkExpired`. (Works even if the number had an identity before — `consumeLinkCode` revokes any active identity of that number first.)
3. Otherwise `findIdentity(from)`; none → send `TEXT.unknown`, return. Then `touchIdentity`. If `!ready(business)` → send `TEXT.unavailable`, return.
4. `text`: `stop` → `revokeIdentity`, send `TEXT.stopped`; `help` → `TEXT.help`; `checks` → `sendDueList`; else `TEXT.fallback`.
5. `button`: `checks` → `sendDueList`; `fill:<tid>:<sid>` → `sendChecklistForm(tid, sid)`.
6. `flow`: `takeToken`; null → `TEXT.formExpired`. Token profile must equal identity profile, else ignore. `kind:'checklist'` → items, `parseFormAnswers(token.item_ids, items, response)`; `missingRequired` non-empty → `TEXT.missing(...)` then re-send the same form with a new token; else `recordCompletion(source:'whatsapp')` and for each flagged item send the corrective Flow (`flowMessage` with `screen:'CORRECTIVE'`, `data: { item_name, value_text: "<value> °C (limit <min>–<max> °C)" | "Answered: No" }`, a new `kind:'corrective'` token with `response_id`). `kind:'corrective'` → `setCorrective(response_id, "<action title>[: details]")` → `sendManagerAlert(...)` → send `TEXT.correctiveThanks`.
7. `sendDueList`: for each site of the person (`sitesFor`): `dueChecklists` with `completionsSince(business, now − 32 days)`; none overall → `TEXT.nothingDue`; else per site a `buttonsMessage(TEXT.dueList(site.name), first 3 as { id: 'fill:tid:sid', title: template name })`.
8. `sendChecklistForm(tid, sid)`: template must be available to the person at that site; `flowFor(tid, sid)` null → `TEXT.appOnly(name)`; else `saveToken({kind:'checklist', item_ids: flow.item_ids, ...})` and `flowMessage(... cta 'Fill in', body template name, screen 'CHECKLIST')`.
9. Every outbound send is logged with `billable: false` (all bot replies are inside the 24-hour window opened by the inbound message).

`sendManagerAlert`: for each `managerExternalIds(business)` send `templateMessage(to, 'manager_alert', [siteName, itemName, value, time, byName, action], [])`, log `kind:'alert', template_name:'manager_alert', billable: true`.

`recordCompletion`: insert completion (`completed_at = now.toISOString()`, `source`), insert responses (`notes: null`, `corrective_status: flagged ? 'needed' : null`), then for each flagged answer one notification per manager: `{ type: 'checklist', title: 'Flagged item', message: \`"${item.name}" in ${template.name} is out of range\`, link: '/checklists' }` — identical to web `notifyFlaggedItem`.

- [ ] **Step 1: Write the failing test (fake deps)**

```ts
// src/lib/whatsapp/__tests__/bot.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { handleInbound, TEXT, type BotDeps, type FormToken } from '../../../../supabase/functions/_shared/channels/bot'
import type { Template, TemplateItem } from '../../../../supabase/functions/_shared/checklists-core/types'

const T: Template = { id: 't1', business_id: 'b', site_id: null, name: 'Fridge temps', frequency: 'daily', deadline_time: '11:00',
  multi_per_day: false, min_per_day: null, assigned_roles: [], assigned_role_ids: ['r'], active: true }
const ITEMS: TemplateItem[] = [
  { id: 'i1', name: 'Walk-in fridge', item_type: 'temperature', required: true, min_value: 0, max_value: 5, unit: '°C', sort_order: 0 },
  { id: 'i2', name: 'Freezer', item_type: 'temperature', required: true, min_value: -30, max_value: -18, unit: '°C', sort_order: 1 },
]

function fake(over: Partial<BotDeps> = {}) {
  const sent: any[] = []; const tokens = new Map<string, FormToken>(); const state: any = { completions: [], responses: [], notifs: [], corrective: [], revoked: [], logs: [] }
  let n = 0
  const d: BotDeps = {
    now: () => new Date('2026-10-14T09:40:00Z'),
    send: async (m) => { sent.push(m); return { id: 'w' + sent.length, ok: true, status: 200 } },
    newToken: () => 'tok' + ++n,
    findIdentity: async (x) => (x === '447700900123' ? { id: 'id1', business_id: 'b', profile_id: 'p1', external_id: x } : null),
    touchIdentity: async () => {},
    revokeIdentity: async (id) => { state.revoked.push(id) },
    consumeLinkCode: async (code) => code === '482913' ? { ok: true, identity: { id: 'id1', business_id: 'b', profile_id: 'p1', external_id: '447700900123' }, siteName: 'Wharf Side', name: 'Anna' } : { ok: false },
    ready: async () => true,
    person: async () => ({ profile_id: 'p1', business_id: 'b', full_name: 'Anna', role: 'kitchen_staff', role_id: 'r' }),
    sitesFor: async () => [{ id: 's1', name: 'Wharf Side', timezone: 'Europe/London' }],
    templates: async () => [T],
    items: async () => ITEMS,
    completionsSince: async () => state.completions,
    flowFor: async () => ({ flow_id: 'F1', item_ids: ['i1', 'i2'] }),
    correctiveFlowId: () => 'FC',
    saveToken: async (t) => { tokens.set(t.token, t) },
    takeToken: async (tok) => { const t = tokens.get(tok); if (!t || t.used_at) return null; t.used_at = 'x'; return t },
    setCorrective: async (rid, notes) => { state.corrective.push({ rid, notes }); return { templateName: 'Fridge temps', itemName: 'Walk-in fridge', value: '9', siteName: 'Wharf Side', byName: 'Anna', businessId: 'b' } },
    managerExternalIds: async () => ['447700900999'],
    log: async (e) => { state.logs.push(e) },
    insertCompletion: async (row) => { state.completions.push({ ...row }); return { id: 'c1' } },
    insertResponses: async (rows) => { state.responses.push(...rows); return rows.map((r, i) => ({ id: 'resp' + i, item_id: r.item_id })) },
    managerIds: async () => ['m1'],
    insertNotifications: async (rows) => { state.notifs.push(...rows) },
    ...over,
  }
  return { d, sent, tokens, state }
}
const from = '447700900123'
const textOf = (m: any) => m?.text?.body ?? m?.interactive?.body?.text

describe('bot', () => {
  it('links with a valid code and refuses an expired one', async () => {
    const f = fake()
    await handleInbound({ kind: 'text', from: '447000000001', text: 'link 482913', id: 'x' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.linked('Anna', 'Wharf Side'))
    await handleInbound({ kind: 'text', from: '447000000001', text: 'LINK 000000', id: 'y' }, f.d)
    expect(textOf(f.sent[1])).toBe(TEXT.linkExpired)
  })
  it('unknown number and unavailable business', async () => {
    const f = fake()
    await handleInbound({ kind: 'text', from: '440000', text: 'hi', id: 'x' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.unknown)
    const g = fake({ ready: async () => false })
    await handleInbound({ kind: 'text', from, text: 'checks', id: 'x' }, g.d)
    expect(textOf(g.sent[0])).toBe(TEXT.unavailable)
  })
  it('STOP revokes', async () => {
    const f = fake()
    await handleInbound({ kind: 'text', from, text: ' Stop ', id: 'x' }, f.d)
    expect(f.state.revoked).toEqual(['id1'])
    expect(textOf(f.sent[0])).toBe(TEXT.stopped)
  })
  it('CHECKS lists due checklists with fill buttons', async () => {
    const f = fake()
    await handleInbound({ kind: 'text', from, text: 'checks', id: 'x' }, f.d)
    expect(f.sent[0].interactive.action.buttons[0].reply.id).toBe('fill:t1:s1')
  })
  it('fill button sends the form with a checklist token', async () => {
    const f = fake()
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    expect(f.sent[0].interactive.action.parameters).toMatchObject({ flow_id: 'F1', flow_token: 'tok1' })
    expect(f.tokens.get('tok1')).toMatchObject({ kind: 'checklist', template_id: 't1', site_id: 's1', item_ids: ['i1', 'i2'] })
  })
  it('two out-of-range items → two corrective forms, completion recorded with source whatsapp', async () => {
    const f = fake()
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    await handleInbound({ kind: 'flow', from, token: 'tok1', response: { f0: '9', f1: '-5' }, id: 'y' }, f.d)
    expect(f.state.completions[0]).toMatchObject({ template_id: 't1', site_id: 's1', completed_by: 'p1', source: 'whatsapp' })
    expect(f.state.responses.map((r: any) => r.corrective_status)).toEqual(['needed', 'needed'])
    expect(f.state.notifs).toHaveLength(2)
    const corr = f.sent.filter((m) => m.interactive?.action?.parameters?.flow_id === 'FC')
    expect(corr).toHaveLength(2)
    expect(corr[0].interactive.action.parameters.flow_action_payload.data).toEqual({ item_name: 'Walk-in fridge', value_text: '9 °C (limit 0–5 °C)' })
  })
  it('a used or unknown token is refused', async () => {
    const f = fake()
    await handleInbound({ kind: 'flow', from, token: 'nope', response: {}, id: 'y' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.formExpired)
  })
  it('missing required answers → message and a fresh form', async () => {
    const f = fake()
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    await handleInbound({ kind: 'flow', from, token: 'tok1', response: { f0: '3' }, id: 'y' }, f.d)
    expect(f.state.completions).toHaveLength(0)
    expect(textOf(f.sent[1])).toBe(TEXT.missing(['Freezer']))
    expect(f.sent[2].interactive.action.parameters.flow_token).toBe('tok2')
  })
  it('corrective reply closes the response and alerts managers', async () => {
    const f = fake()
    await f.d.saveToken({ token: 'ct', kind: 'corrective', business_id: 'b', profile_id: 'p1', site_id: 's1', template_id: 't1', item_ids: null, response_id: 'resp0', expires_at: '2099-01-01', used_at: null })
    await handleInbound({ kind: 'flow', from, token: 'ct', response: { action: 'moved', details: 'to fridge 2' }, id: 'z' }, f.d)
    expect(f.state.corrective).toEqual([{ rid: 'resp0', notes: 'Moved food to another fridge: to fridge 2' }])
    expect(f.sent[0].template.name).toBe('manager_alert')
    expect(textOf(f.sent[1])).toBe(TEXT.correctiveThanks)
  })
  it('a token of another person is ignored', async () => {
    const f = fake()
    await f.d.saveToken({ token: 'ot', kind: 'checklist', business_id: 'b', profile_id: 'someone-else', site_id: 's1', template_id: 't1', item_ids: ['i1'], response_id: null, expires_at: '2099-01-01', used_at: null })
    await handleInbound({ kind: 'flow', from, token: 'ot', response: { f0: '3' }, id: 'z' }, f.d)
    expect(f.state.completions).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to see it fail** → FAIL.

- [ ] **Step 3: Implement `record.ts`**

```ts
// supabase/functions/_shared/checklists-core/record.ts
import type { Answer, Person, Template, TemplateItem } from './types.ts'

export interface CoreDb {
  insertCompletion(row: { template_id: string; business_id: string; site_id: string; completed_by: string; completed_at: string; source: 'whatsapp' | 'telegram' | 'app' }): Promise<{ id: string }>
  insertResponses(rows: { completion_id: string; item_id: string; value: string; notes: string | null; flagged: boolean; corrective_status: 'needed' | null }[]): Promise<{ id: string; item_id: string }[]>
  managerIds(businessId: string): Promise<string[]>
  insertNotifications(rows: { user_id: string; type: string; title: string; message: string; link: string }[]): Promise<void>
}

export async function recordCompletion(db: CoreDb, a: {
  person: Person; siteId: string; template: Template; items: TemplateItem[]; answers: Answer[]; source: 'whatsapp' | 'telegram'; now: Date
}) {
  const { id: completionId } = await db.insertCompletion({
    template_id: a.template.id, business_id: a.person.business_id, site_id: a.siteId,
    completed_by: a.person.profile_id, completed_at: a.now.toISOString(), source: a.source,
  })
  const inserted = await db.insertResponses(a.answers.map((x) => ({
    completion_id: completionId, item_id: x.item_id, value: x.value, notes: null, flagged: x.flagged,
    corrective_status: x.flagged ? 'needed' as const : null,
  })))
  const byItem = new Map(a.items.map((i) => [i.id, i]))
  const flagged = a.answers.filter((x) => x.flagged).map((x) => ({
    responseId: inserted.find((r) => r.item_id === x.item_id)!.id, item: byItem.get(x.item_id)!, value: x.value,
  }))
  if (flagged.length) {
    const managers = await db.managerIds(a.person.business_id)
    await db.insertNotifications(flagged.flatMap((f) => managers.map((user_id) => ({
      user_id, type: 'checklist', title: 'Flagged item', message: `"${f.item.name}" in ${a.template.name} is out of range`, link: '/checklists',
    }))))
  }
  return { completionId, flagged }
}
```

- [ ] **Step 4: Implement `bot.ts`**

```ts
// supabase/functions/_shared/channels/bot.ts
// Channel conversation logic over injected dependencies (pure; unit-tested with fakes).
import type { InboundEvent, SendFn, OutboundMessage } from './types.ts'
import type { CompletionLite, Person, Template, TemplateItem } from '../checklists-core/types.ts'
import type { CoreDb } from '../checklists-core/record.ts'
import { recordCompletion } from '../checklists-core/record.ts'
import { availableChecklists, dueChecklists } from '../checklists-core/due.ts'
import { parseFormAnswers } from '../checklists-core/answers.ts'
import { buttonsMessage, flowMessage, templateMessage, textMessage } from './whatsapp.ts'
import { CORRECTIVE_ACTIONS } from './whatsapp-flows.ts'

export interface Identity { id: string; business_id: string; profile_id: string; external_id: string }
export interface SiteInfo { id: string; name: string; timezone: string }
export interface FormToken {
  token: string; kind: 'checklist' | 'corrective'; business_id: string; profile_id: string; site_id: string
  template_id: string | null; item_ids: string[] | null; response_id: string | null; expires_at: string; used_at: string | null
}
export interface BotDeps extends CoreDb {
  now(): Date
  send: SendFn
  newToken(): string
  findIdentity(externalId: string): Promise<Identity | null>
  touchIdentity(id: string, at: Date): Promise<void>
  revokeIdentity(id: string): Promise<void>
  consumeLinkCode(code: string, externalId: string, now: Date): Promise<{ ok: true; identity: Identity; siteName: string; name: string } | { ok: false }>
  ready(businessId: string): Promise<boolean>
  person(profileId: string): Promise<Person | null>
  sitesFor(profileId: string): Promise<SiteInfo[]>
  templates(businessId: string): Promise<Template[]>
  items(templateId: string): Promise<TemplateItem[]>
  completionsSince(businessId: string, since: Date): Promise<CompletionLite[]>
  flowFor(templateId: string, siteId: string): Promise<{ flow_id: string; item_ids: string[] } | null>
  correctiveFlowId(): string
  saveToken(t: FormToken): Promise<void>
  takeToken(token: string, now: Date): Promise<FormToken | null>
  setCorrective(responseId: string, notes: string): Promise<{ templateName: string; itemName: string; value: string; siteName: string; byName: string; businessId: string } | null>
  managerExternalIds(businessId: string): Promise<string[]>
  log(e: { business_id: string | null; site_id: string | null; profile_id: string | null; direction: 'in' | 'out'; kind: string; template_name?: string; billable: boolean; ref_id?: string; wa_message_id?: string | null }): Promise<void>
}

export const TEXT = {
  linked: (name: string, site: string) => `Hi ${name} 👋 You're connected to ${site}. I'll remind you before your checks are due. Reply STOP anytime.`,
  linkExpired: 'This link has expired — ask your manager for a new QR code.',
  unknown: 'Ask your manager for a QR code to connect to Blueroll.',
  unavailable: "Blueroll checks aren't available for your team right now. Please use the Blueroll app.",
  stopped: "You're disconnected from Blueroll. You won't get any more messages. Ask your manager for a new QR code to reconnect.",
  help: 'Blueroll checks: tap Fill in on a reminder, or type CHECKS to see what is due. Type STOP to disconnect.',
  fallback: 'I can help with your checks — tap Fill in or type CHECKS.',
  nothingDue: 'Nothing is due right now 👍',
  dueList: (site: string) => `Checks due at ${site}:`,
  appOnly: (name: string) => `${name} can only be completed in the Blueroll app.`,
  missing: (names: string[]) => `Some required answers were missing: ${names.join(', ')}. Please fill in the form again.`,
  formExpired: 'This form has expired — type CHECKS to get a new one.',
  correctiveBody: (item: string) => `${item} is out of range. Tell us what you did.`,
  correctiveThanks: 'Thanks — your manager has been told.',
}

const TOKEN_TTL_MS = 24 * 3600 * 1000

async function out(d: BotDeps, ctx: { business_id: string | null; profile_id: string | null; site_id?: string | null }, msg: OutboundMessage, kind: string) {
  const r = await d.send(msg)
  await d.log({ business_id: ctx.business_id, site_id: ctx.site_id ?? null, profile_id: ctx.profile_id, direction: 'out', kind, billable: false, wa_message_id: r.id })
}

function valueText(item: TemplateItem, value: string): string {
  if (item.item_type === 'yes_no') return 'Answered: No'
  const u = item.unit ?? '°C'
  const lim = item.min_value != null && item.max_value != null ? `limit ${item.min_value}–${item.max_value} ${u}`
    : item.min_value != null ? `limit ${item.min_value} ${u} or above` : `limit ${item.max_value} ${u} or below`
  return `${value} ${u} (${lim})`
}

export async function sendManagerAlert(d: BotDeps, businessId: string, a: { siteName: string; itemName: string; value: string; time: string; byName: string; action: string }) {
  for (const to of await d.managerExternalIds(businessId)) {
    const r = await d.send(templateMessage(to, 'manager_alert', [a.siteName, a.itemName, a.value, a.time, a.byName, a.action], []))
    await d.log({ business_id: businessId, site_id: null, profile_id: null, direction: 'out', kind: 'alert', template_name: 'manager_alert', billable: true, wa_message_id: r.id })
  }
}

async function sendChecklistForm(d: BotDeps, from: string, person: Person, templateId: string, siteId: string) {
  const ctx = { business_id: person.business_id, profile_id: person.profile_id, site_id: siteId }
  const sites = await d.sitesFor(person.profile_id)
  const t = (await d.templates(person.business_id)).find((x) => x.id === templateId)
  if (!t || !sites.some((s) => s.id === siteId) || !availableChecklists([t], person, siteId).length) return out(d, ctx, textMessage(from, TEXT.formExpired), 'reply')
  const flow = await d.flowFor(templateId, siteId)
  if (!flow) return out(d, ctx, textMessage(from, TEXT.appOnly(t.name)), 'reply')
  const token = d.newToken()
  await d.saveToken({ token, kind: 'checklist', business_id: person.business_id, profile_id: person.profile_id, site_id: siteId,
    template_id: templateId, item_ids: flow.item_ids, response_id: null, expires_at: new Date(d.now().getTime() + TOKEN_TTL_MS).toISOString(), used_at: null })
  await out(d, ctx, flowMessage(from, { flowId: flow.flow_id, token, cta: 'Fill in', body: t.name, screen: 'CHECKLIST' }), 'flow')
}

async function sendDueList(d: BotDeps, from: string, person: Person) {
  const ctx = { business_id: person.business_id, profile_id: person.profile_id }
  const now = d.now()
  const [sites, templates, completions] = await Promise.all([
    d.sitesFor(person.profile_id), d.templates(person.business_id), d.completionsSince(person.business_id, new Date(now.getTime() - 32 * 86400_000)),
  ])
  let any = false
  for (const s of sites) {
    const due = dueChecklists({ templates, person, siteId: s.id, tz: s.timezone, now, completions })
    if (!due.length) continue
    any = true
    await out(d, { ...ctx, site_id: s.id }, buttonsMessage(from, TEXT.dueList(s.name), due.slice(0, 3).map((x) => ({ id: `fill:${x.template.id}:${s.id}`, title: x.template.name }))), 'reply')
  }
  if (!any) await out(d, ctx, textMessage(from, TEXT.nothingDue), 'reply')
}

export async function handleInbound(e: InboundEvent, d: BotDeps): Promise<void> {
  const now = d.now()
  if (e.kind === 'text') {
    const m = e.text.match(/^\s*link\s*(\d{6})\s*$/i)
    if (m) {
      const r = await d.consumeLinkCode(m[1], e.from, now)
      await d.log({ business_id: r.ok ? r.identity.business_id : null, site_id: null, profile_id: r.ok ? r.identity.profile_id : null, direction: 'in', kind: 'link', billable: false, wa_message_id: e.id })
      return out(d, { business_id: r.ok ? r.identity.business_id : null, profile_id: r.ok ? r.identity.profile_id : null },
        textMessage(e.from, r.ok ? TEXT.linked(r.name, r.siteName) : TEXT.linkExpired), 'link')
    }
  }
  const id = await d.findIdentity(e.from)
  if (!id) {
    await d.log({ business_id: null, site_id: null, profile_id: null, direction: 'in', kind: e.kind, billable: false, wa_message_id: e.id })
    return out(d, { business_id: null, profile_id: null }, textMessage(e.from, TEXT.unknown), 'reply')
  }
  await d.touchIdentity(id.id, now)
  await d.log({ business_id: id.business_id, site_id: null, profile_id: id.profile_id, direction: 'in', kind: e.kind, billable: false, wa_message_id: e.id })
  const ctx = { business_id: id.business_id, profile_id: id.profile_id }
  if (!(await d.ready(id.business_id))) return out(d, ctx, textMessage(e.from, TEXT.unavailable), 'reply')
  const person = await d.person(id.profile_id)
  if (!person) return out(d, ctx, textMessage(e.from, TEXT.unknown), 'reply')

  if (e.kind === 'text') {
    const cmd = e.text.trim().toLowerCase()
    if (cmd === 'stop') { await d.revokeIdentity(id.id); return out(d, ctx, textMessage(e.from, TEXT.stopped), 'reply') }
    if (cmd === 'help') return out(d, ctx, textMessage(e.from, TEXT.help), 'reply')
    if (cmd === 'checks') return sendDueList(d, e.from, person)
    return out(d, ctx, textMessage(e.from, TEXT.fallback), 'reply')
  }

  if (e.kind === 'button') {
    if (e.payload === 'checks') return sendDueList(d, e.from, person)
    const f = e.payload.match(/^fill:([0-9a-zA-Z-]+):([0-9a-zA-Z-]+)$/)
    if (f) return sendChecklistForm(d, e.from, person, f[1], f[2])
    return out(d, ctx, textMessage(e.from, TEXT.fallback), 'reply')
  }

  // flow reply
  const tok = await d.takeToken(e.token, now)
  if (!tok) return out(d, ctx, textMessage(e.from, TEXT.formExpired), 'reply')
  if (tok.profile_id !== id.profile_id) return
  if (tok.kind === 'checklist') {
    const template = (await d.templates(person.business_id)).find((t) => t.id === tok.template_id)
    if (!template) return out(d, ctx, textMessage(e.from, TEXT.formExpired), 'reply')
    const items = await d.items(template.id)
    const parsed = parseFormAnswers(tok.item_ids ?? [], items, e.response)
    if (parsed.missingRequired.length) {
      await out(d, ctx, textMessage(e.from, TEXT.missing(parsed.missingRequired)), 'reply')
      return sendChecklistForm(d, e.from, person, template.id, tok.site_id)
    }
    const rec = await recordCompletion(d, { person, siteId: tok.site_id, template, items, answers: parsed.answers, source: 'whatsapp', now })
    for (const fl of rec.flagged) {
      const token = d.newToken()
      await d.saveToken({ token, kind: 'corrective', business_id: person.business_id, profile_id: person.profile_id, site_id: tok.site_id,
        template_id: template.id, item_ids: null, response_id: fl.responseId, expires_at: new Date(now.getTime() + TOKEN_TTL_MS).toISOString(), used_at: null })
      await out(d, { ...ctx, site_id: tok.site_id }, flowMessage(e.from, {
        flowId: d.correctiveFlowId(), token, cta: 'Add action', body: TEXT.correctiveBody(fl.item.name), screen: 'CORRECTIVE',
        data: { item_name: fl.item.name, value_text: valueText(fl.item, fl.value) },
      }), 'corrective_flow')
    }
    return
  }
  // corrective
  const action = CORRECTIVE_ACTIONS.find((a) => a.id === e.response.action)?.title ?? 'Other'
  const details = typeof e.response.details === 'string' && e.response.details.trim() ? `: ${e.response.details.trim()}` : ''
  const info = tok.response_id ? await d.setCorrective(tok.response_id, `${action}${details}`) : null
  if (info) {
    const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
    await sendManagerAlert(d, info.businessId, { siteName: info.siteName, itemName: info.itemName, value: info.value, time: hhmm, byName: info.byName, action: `${action}${details}` })
  }
  await out(d, ctx, textMessage(e.from, TEXT.correctiveThanks), 'reply')
}
```

- [ ] **Step 5: Run tests** — `npx vitest run src/lib/whatsapp/__tests__/bot.test.ts` → PASS; then `npm test`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared src/lib/whatsapp/__tests__/bot.test.ts
git commit -m "feat(channels): bot conversation state machine and channel-agnostic recording"
```

---

### Task 8: Supabase-backed deps + `whatsapp-webhook` function

**Files:**
- Create: `supabase/functions/_shared/channels/db.ts`, `supabase/functions/whatsapp-webhook/index.ts`

**Interfaces:**
- Consumes: `BotDeps`, `handleInbound`, `parseInbound`, `verifySignature`, `makeSender`, `maskPhone`.
- Produces: `makeDeps(admin: any, cfg: { send: SendFn; correctiveFlowId: string }): BotDeps` (also used by Task 9); endpoint `GET/POST /functions/v1/whatsapp-webhook`.

- [ ] **Step 1: Implement `db.ts`** — every method is one query with the service-role client `admin`:

```ts
// supabase/functions/_shared/channels/db.ts
// Supabase-backed BotDeps. `admin` is a service-role supabase-js client (typed loosely to keep this file import-free).
import type { BotDeps, FormToken } from './bot.ts'
import type { SendFn } from './types.ts'

export function makeDeps(admin: any, cfg: { send: SendFn; correctiveFlowId: string }): BotDeps {
  const one = async (q: any) => { const { data, error } = await q; if (error) throw error; return data }
  return {
    now: () => new Date(),
    send: cfg.send,
    newToken: () => crypto.randomUUID().replace(/-/g, ''),
    correctiveFlowId: () => cfg.correctiveFlowId,
    findIdentity: async (x) => (await one(admin.from('channel_identities').select('id, business_id, profile_id, external_id')
      .eq('channel', 'whatsapp').eq('external_id', x).is('revoked_at', null).maybeSingle())) ?? null,
    touchIdentity: async (id, at) => { await one(admin.from('channel_identities').update({ last_inbound_at: at.toISOString() }).eq('id', id)) },
    revokeIdentity: async (id) => { await one(admin.from('channel_identities').update({ revoked_at: new Date().toISOString() }).eq('id', id)) },
    consumeLinkCode: async (code, externalId, now) => {
      const c = await one(admin.from('channel_link_codes').select('code, business_id, profile_id, site_id, issued_by, expires_at, used_at').eq('code', code).maybeSingle())
      if (!c || c.used_at || new Date(c.expires_at) < now) return { ok: false }
      const ready = await one(admin.rpc('whatsapp_ready', { b: c.business_id }))
      if (!ready) return { ok: false }
      const { data: used } = await admin.from('channel_link_codes').update({ used_at: now.toISOString() }).eq('code', code).is('used_at', null).select('code')
      if (!used?.length) return { ok: false }
      await one(admin.from('channel_identities').update({ revoked_at: now.toISOString() })
        .eq('channel', 'whatsapp').is('revoked_at', null).or(`external_id.eq.${externalId},profile_id.eq.${c.profile_id}`))
      const identity = await one(admin.from('channel_identities').insert({
        business_id: c.business_id, profile_id: c.profile_id, channel: 'whatsapp', external_id: externalId,
        consent_source: 'qr_code', consent_text_version: 1, linked_by: c.issued_by, last_inbound_at: now.toISOString(),
      }).select('id, business_id, profile_id, external_id').single())
      const prof = await one(admin.from('profiles').select('full_name, site_id').eq('id', c.profile_id).single())
      const siteId = c.site_id ?? prof.site_id
      const site = siteId ? await one(admin.from('sites').select('name').eq('id', siteId).maybeSingle()) : null
      return { ok: true, identity, name: (prof.full_name ?? '').split(' ')[0] || 'there', siteName: site?.name ?? 'your team' }
    },
    ready: async (b) => !!(await one(admin.rpc('whatsapp_ready', { b }))),
    person: async (pid) => {
      const p = await one(admin.from('profiles').select('id, business_id, full_name, role, role_id').eq('id', pid).maybeSingle())
      return p ? { profile_id: p.id, business_id: p.business_id, full_name: p.full_name ?? '', role: p.role, role_id: p.role_id } : null
    },
    sitesFor: async (pid) => {
      const prof = await one(admin.from('profiles').select('business_id, site_id, is_group_admin').eq('id', pid).single())
      const ms = await one(admin.from('member_sites').select('site_id').eq('profile_id', pid))
      let ids: string[] = (ms ?? []).map((r: any) => r.site_id)
      if (prof.site_id && !ids.includes(prof.site_id)) ids.push(prof.site_id)
      const q = admin.from('sites').select('id, name, timezone, status').eq('business_id', prof.business_id)
      const rows = await one(ids.length && !prof.is_group_admin ? q.in('id', ids) : q)
      return (rows ?? []).filter((s: any) => s.status !== 'removed').map((s: any) => ({ id: s.id, name: s.name, timezone: s.timezone ?? 'Europe/London' }))
    },
    templates: async (b) => (await one(admin.from('checklist_templates')
      .select('id, business_id, site_id, name, frequency, deadline_time, multi_per_day, min_per_day, assigned_roles, assigned_role_ids, active')
      .eq('business_id', b).eq('active', true))).map((t: any) => ({ ...t, assigned_roles: t.assigned_roles ?? [], assigned_role_ids: t.assigned_role_ids ?? [] })),
    items: async (tid) => await one(admin.from('checklist_template_items')
      .select('id, name, item_type, required, min_value, max_value, unit, sort_order').eq('template_id', tid)),
    completionsSince: async (b, since) => await one(admin.from('checklist_completions')
      .select('template_id, site_id, completed_at').eq('business_id', b).gte('completed_at', since.toISOString())),
    flowFor: async (tid, sid) => {
      const f = await one(admin.from('channel_flows').select('flow_id, item_ids, status').eq('template_id', tid).eq('site_id', sid).eq('channel', 'whatsapp').maybeSingle())
      return f && f.status === 'published' && f.flow_id ? { flow_id: f.flow_id, item_ids: f.item_ids } : null
    },
    saveToken: async (t: FormToken) => { await one(admin.from('channel_form_tokens').insert(t)) },
    takeToken: async (token, now) => {
      const { data } = await admin.from('channel_form_tokens').update({ used_at: now.toISOString() })
        .eq('token', token).is('used_at', null).gt('expires_at', now.toISOString()).select('*')
      return data?.[0] ?? null
    },
    setCorrective: async (rid, notes) => {
      const r = await one(admin.from('checklist_responses').update({ notes, corrective_status: 'done' }).eq('id', rid)
        .select('value, item:checklist_template_items(name), completion:checklist_completions(business_id, site_id, completed_by, template:checklist_templates(name))').single())
      const site = await one(admin.from('sites').select('name').eq('id', r.completion.site_id).maybeSingle())
      const by = await one(admin.from('profiles').select('full_name').eq('id', r.completion.completed_by).maybeSingle())
      return { templateName: r.completion.template?.name ?? '', itemName: r.item?.name ?? '', value: r.value, siteName: site?.name ?? '', byName: by?.full_name ?? '', businessId: r.completion.business_id }
    },
    managerExternalIds: async (b) => {
      const mgr = await one(admin.from('profiles').select('id').eq('business_id', b).in('role', ['owner', 'manager']))
      if (!mgr?.length) return []
      const ids = await one(admin.from('channel_identities').select('external_id').eq('channel', 'whatsapp').is('revoked_at', null).in('profile_id', mgr.map((m: any) => m.id)))
      return (ids ?? []).map((i: any) => i.external_id)
    },
    log: async (e) => { await admin.from('channel_messages_log').insert({ ...e, channel: 'whatsapp' }) },
    insertCompletion: async (row) => await one(admin.from('checklist_completions').insert(row).select('id').single()),
    insertResponses: async (rows) => await one(admin.from('checklist_responses').insert(rows).select('id, item_id')),
    managerIds: async (b) => ((await one(admin.from('profiles').select('id').eq('business_id', b).in('role', ['owner', 'manager']))) ?? []).map((p: any) => p.id),
    insertNotifications: async (rows) => { if (rows.length) await one(admin.from('notifications').insert(rows)) },
  }
}
```

`sites.status` exists (see `Site.status` in `src/stores/auth-store.ts`); removed sites have `status = 'removed'`.

- [ ] **Step 2: Implement the function**

```ts
// supabase/functions/whatsapp-webhook/index.ts
// Meta webhook for the Blueroll WhatsApp bot. Deployed with --no-verify-jwt; authenticity = X-Hub-Signature-256.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySignature, parseInbound, makeSender } from "../_shared/channels/whatsapp.ts";
import { handleInbound } from "../_shared/channels/bot.ts";
import { makeDeps } from "../_shared/channels/db.ts";
import { maskPhone } from "../_shared/channels/mask.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const APP_SECRET = Deno.env.get("WA_APP_SECRET") ?? "";
const VERIFY_TOKEN = Deno.env.get("WA_VERIFY_TOKEN") ?? "";
const send = makeSender({ token: Deno.env.get("WA_TOKEN") ?? "", phoneNumberId: Deno.env.get("WA_PHONE_NUMBER_ID") ?? "" });
const deps = makeDeps(admin, { send, correctiveFlowId: Deno.env.get("WA_CORRECTIVE_FLOW_ID") ?? "" });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && VERIFY_TOKEN && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const raw = await req.text();
  if (!APP_SECRET || !(await verifySignature(raw, req.headers.get("x-hub-signature-256"), APP_SECRET))) return new Response("bad signature", { status: 401 });
  let body: unknown; try { body = JSON.parse(raw); } catch { return new Response("ok"); }
  for (const e of parseInbound(body)) {
    try { await handleInbound(e, deps); }
    catch (err) { console.error("whatsapp inbound failed", maskPhone(e.from), (err as Error).message?.slice(0, 200)); }
  }
  return new Response("ok"); // always 200 to Meta once the signature is valid, so it doesn't retry storms
});
```

- [ ] **Step 3: Check** — `deno check supabase/functions/whatsapp-webhook/index.ts` → no errors. `npm test` still green.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/channels/db.ts supabase/functions/whatsapp-webhook
git commit -m "feat(whatsapp): webhook function with Supabase-backed bot dependencies"
```

---

### Task 9: `whatsapp-reminders` function + cron (STOP before prod)

**Files:**
- Create: `supabase/functions/whatsapp-reminders/index.ts`, `supabase/migrations/20261010120100_whatsapp_cron.sql`

**Interfaces:** Consumes `planReminders`, `planCorrective`, `reminderKey`, `makeDeps`, `templateMessage`, `sendManagerAlert`.

- [ ] **Step 1: Implement the function**

```ts
// supabase/functions/whatsapp-reminders/index.ts
// Every 10 minutes (pg_cron → net.http_post with x-cron-secret): send due reminders and corrective follow-ups.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeSender, templateMessage } from "../_shared/channels/whatsapp.ts";
import { makeDeps } from "../_shared/channels/db.ts";
import { sendManagerAlert } from "../_shared/channels/bot.ts";
import { planReminders, planCorrective, reminderKey, type Recipient } from "../_shared/checklists-core/reminders.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CRON_SECRET = Deno.env.get("WA_CRON_SECRET") ?? "";
const send = makeSender({ token: Deno.env.get("WA_TOKEN") ?? "", phoneNumberId: Deno.env.get("WA_PHONE_NUMBER_ID") ?? "" });
const deps = makeDeps(admin, { send, correctiveFlowId: Deno.env.get("WA_CORRECTIVE_FLOW_ID") ?? "" });
const WINDOW_MS = 24 * 3600 * 1000;

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  const now = new Date();
  const { data: idents } = await admin.from("channel_identities")
    .select("id, business_id, profile_id, external_id, last_inbound_at").eq("channel", "whatsapp").is("revoked_at", null);
  const byBiz = new Map<string, any[]>();
  for (const i of idents ?? []) (byBiz.get(i.business_id) ?? byBiz.set(i.business_id, []).get(i.business_id)!).push(i);
  let sent = 0;
  for (const [biz, list] of byBiz) {
    if (!(await deps.ready(biz))) continue;
    const [templates, completions] = await Promise.all([deps.templates(biz), deps.completionsSince(biz, new Date(now.getTime() - 32 * 86400_000))]);
    const recipients: Recipient[] = [];
    for (const i of list) {
      const person = await deps.person(i.profile_id); if (!person) continue;
      for (const s of await deps.sitesFor(i.profile_id)) recipients.push({ person, external_id: i.external_id, site_id: s.id, tz: s.timezone });
    }
    const { data: sentRows } = await admin.from("channel_reminders_sent").select("profile_id, template_id, site_id, period_key")
      .in("profile_id", list.map((i) => i.profile_id)).gte("sent_at", new Date(now.getTime() - 40 * 86400_000).toISOString());
    const already = new Set((sentRows ?? []).map((r: any) => reminderKey(r.profile_id, r.template_id, r.site_id, r.period_key)));
    const sites = new Map((await admin.from("sites").select("id, name").eq("business_id", biz)).data?.map((s: any) => [s.id, s.name]) ?? []);
    for (const job of planReminders({ now, recipients, templates, completions, alreadySent: already })) {
      // claim the keys first (PK makes overlapping runs safe), then send
      const claim = await admin.from("channel_reminders_sent").insert(job.items.map((it) => ({
        profile_id: job.profile_id, template_id: it.template.id, site_id: job.site_id, period_key: it.period_key })));
      if (claim.error) continue;
      const ident = list.find((i) => i.profile_id === job.profile_id);
      const inWindow = !!ident?.last_inbound_at && now.getTime() - new Date(ident.last_inbound_at).getTime() < WINDOW_MS;
      const siteName = sites.get(job.site_id) ?? "";
      const hhmm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
      const msg = job.items.length === 1
        ? templateMessage(job.external_id, "checklist_reminder", [job.items[0].template.name, hhmm(job.items[0].deadline_utc!), siteName], [`fill:${job.items[0].template.id}:${job.site_id}`])
        : templateMessage(job.external_id, "checklist_reminder_list", [String(job.items.length), siteName, job.items.map((x) => `${x.template.name} (${hhmm(x.deadline_utc!)})`).join(", ")],
            job.items.map((x) => `fill:${x.template.id}:${job.site_id}`));
      const r = await send(msg);
      await deps.log({ business_id: biz, site_id: job.site_id, profile_id: job.profile_id, direction: "out", kind: job.items.length === 1 ? "reminder" : "reminder_list",
        template_name: job.items.length === 1 ? "checklist_reminder" : "checklist_reminder_list", billable: !inWindow, wa_message_id: r.id });
      if (r.ok) sent++;
    }
    // corrective follow-ups
    const { data: needed } = await admin.from("checklist_responses")
      .select("id, created_at, completion:checklist_completions!inner(business_id, site_id, completed_by, source)")
      .eq("corrective_status", "needed").eq("completion.business_id", biz).gte("created_at", new Date(now.getTime() - 2 * 86400_000).toISOString());
    const ids = (needed ?? []).map((n: any) => n.id);
    const { data: logs } = ids.length ? await admin.from("channel_messages_log").select("kind, ref_id").in("ref_id", ids).in("kind", ["corrective_nudge", "alert_no_action"]) : { data: [] };
    const nudged = new Set((logs ?? []).filter((l: any) => l.kind === "corrective_nudge").map((l: any) => l.ref_id));
    const alerted = new Set((logs ?? []).filter((l: any) => l.kind === "alert_no_action").map((l: any) => l.ref_id));
    const plan = planCorrective({ now, nudged, alerted, needed: (needed ?? []).map((n: any) => ({
      response_id: n.id, completed_by: n.completion.completed_by, business_id: biz, site_id: n.completion.site_id, created_at: n.created_at })) });
    for (const a of plan) {
      const n = (needed ?? []).find((x: any) => x.id === a.response_id);
      if (a.action === "nudge") {
        const to = list.find((i) => i.profile_id === n.completion.completed_by)?.external_id;
        if (to) {
          const r = await send(templateMessage(to, "corrective_nudge", [sites.get(n.completion.site_id) ?? ""], ["checks"]));
          await deps.log({ business_id: biz, site_id: n.completion.site_id, profile_id: n.completion.completed_by, direction: "out", kind: "corrective_nudge", template_name: "corrective_nudge", billable: true, ref_id: a.response_id, wa_message_id: r.id });
        } else {
          await deps.log({ business_id: biz, site_id: n.completion.site_id, profile_id: null, direction: "out", kind: "corrective_nudge", billable: false, ref_id: a.response_id });
        }
      } else {
        const { data: r } = await admin.from("checklist_responses").select("value, item:checklist_template_items(name)").eq("id", a.response_id).single();
        const { data: by } = await admin.from("profiles").select("full_name").eq("id", n.completion.completed_by).maybeSingle();
        await sendManagerAlert(deps, biz, { siteName: sites.get(n.completion.site_id) ?? "", itemName: (r as any)?.item?.name ?? "", value: (r as any)?.value ?? "",
          time: new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(n.created_at)),
          byName: by?.full_name ?? "", action: "No corrective action recorded" });
        await deps.log({ business_id: biz, site_id: n.completion.site_id, profile_id: null, direction: "out", kind: "alert_no_action", billable: false, ref_id: a.response_id });
      }
    }
  }
  return new Response(JSON.stringify({ ok: true, sent }), { headers: { "Content-Type": "application/json" } });
});
```

Note: `nudge` uses the `checks` quick-reply payload (opens the due list; the bot's reply then offers the form). Corrective Flows can't be opened from a template button without per-response flows, so the nudge points to CHECKS; when the person replies, the webhook window is open — follow-up corrective forms for pending responses are re-sent by `sendDueList`? **No** — keep MVP simple: the nudge text tells them to reply; add to `sendDueList` (Task 7 bot) at the top: for this person's responses with `corrective_status='needed'` re-send the corrective Flow. Implement this in Task 9 by adding to `BotDeps` `pendingCorrective(profileId): Promise<{ response_id: string; item: TemplateItem; value: string; site_id: string; template_id: string }[]>` (db.ts query: responses needed whose completion.completed_by = profile, last 2 days, joined item) and in `sendDueList` sending one corrective Flow per pending item before the due list; update `bot.test.ts` fake with `pendingCorrective: async () => []` and add a test: pending corrective → a corrective Flow is sent on CHECKS.

- [ ] **Step 2: Cron migration**

```sql
-- supabase/migrations/20261010120100_whatsapp_cron.sql
-- Requires vault secret 'whatsapp_cron_secret' (same value as the function's WA_CRON_SECRET).
select cron.unschedule('whatsapp-reminders') where exists (select 1 from cron.job where jobname = 'whatsapp-reminders');
select cron.schedule('whatsapp-reminders', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://rszrggreuarvodcqeqrj.supabase.co/functions/v1/whatsapp-reminders',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_cron_secret')),
    body := '{}'::jsonb)
$$);
```

- [ ] **Step 3: Checks** — `deno check supabase/functions/whatsapp-reminders/index.ts`; `npm test` (bot tests incl. the new pending-corrective test).

- [ ] **Step 4: Commit** (deploy and cron are applied in Task 14)

```bash
git add supabase/functions/whatsapp-reminders supabase/migrations/20261010120100_whatsapp_cron.sql supabase/functions/_shared src/lib/whatsapp/__tests__/bot.test.ts
git commit -m "feat(whatsapp): reminders/corrective follow-up function and cron schedule"
```

---

### Task 10: `whatsapp-sync-flows` function

**Files:**
- Create: `supabase/functions/whatsapp-sync-flows/index.ts`

**Behaviour:**
- Auth: either `x-cron-secret` (sync all templates of WhatsApp-ready businesses) or a user JWT of an owner/manager with body `{ template_id }` (sync that template for all its sites).
- For each `(template, site)` where the site belongs to the business and (`template.site_id` null or equal): load items; `buildChecklistFlow`; `null` → upsert `channel_flows` status `unsupported`; else compute `itemsHash`; if `channel_flows` has the same hash and `published` → skip; otherwise create a new Flow in Meta, upload JSON, publish, upsert `channel_flows` (`flow_id`, `items_hash`, `item_ids`, `status:'published'`), and deprecate the previous `flow_id` if any. On Meta error → upsert `status:'error', error: <message ≤ 300 chars>`.
- Graph calls (with `Authorization: Bearer WA_TOKEN`):
  - create: `POST https://graph.facebook.com/{GRAPH_VERSION}/{WA_WABA_ID}/flows` JSON `{ name: "<template name> · <site name> · <hash8>", categories: ["OTHER"] }` → `{ id }`
  - upload: `POST /{flow_id}/assets` multipart: `name=flow.json`, `asset_type=FLOW_JSON`, `file=<Blob JSON, type application/json>`
  - publish: `POST /{flow_id}/publish`
  - deprecate: `POST /{old_flow_id}/deprecate`
  Confirm endpoints against https://developers.facebook.com/docs/whatsapp/flows/reference/flowsapi before coding; note any difference in the report.
- Also accepts `{ corrective: true }` with the cron secret: creates and publishes `CORRECTIVE_FLOW_JSON` once and returns the `flow_id` (to store as secret `WA_CORRECTIVE_FLOW_ID` in Task 14).

- [ ] **Step 1: Implement**

```ts
// supabase/functions/whatsapp-sync-flows/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GRAPH_VERSION } from "../_shared/channels/whatsapp.ts";
import { buildChecklistFlow, itemsHash, CORRECTIVE_FLOW_JSON } from "../_shared/channels/whatsapp-flows.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TOKEN = Deno.env.get("WA_TOKEN") ?? "";
const WABA = Deno.env.get("WA_WABA_ID") ?? "";
const CRON_SECRET = Deno.env.get("WA_CRON_SECRET") ?? "";
const G = `https://graph.facebook.com/${GRAPH_VERSION}`;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function graph(path: string, init: RequestInit) {
  const r = await fetch(`${G}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message ?? `graph ${r.status}`);
  return j;
}

async function publishFlow(name: string, flowJson: unknown): Promise<string> {
  const { id } = await graph(`/${WABA}/flows`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, categories: ["OTHER"] }) });
  const fd = new FormData();
  fd.append("name", "flow.json"); fd.append("asset_type", "FLOW_JSON");
  fd.append("file", new Blob([JSON.stringify(flowJson)], { type: "application/json" }), "flow.json");
  await graph(`/${id}/assets`, { method: "POST", body: fd });
  await graph(`/${id}/publish`, { method: "POST" });
  return id;
}

async function syncTemplate(t: any) {
  const { data: sites } = await admin.from("sites").select("id, name").eq("business_id", t.business_id);
  const { data: items } = await admin.from("checklist_template_items").select("id, name, item_type, required, min_value, max_value, unit, sort_order").eq("template_id", t.id);
  for (const s of (sites ?? []).filter((s: any) => !t.site_id || t.site_id === s.id)) {
    const built = buildChecklistFlow(t.name, items ?? []);
    const { data: cur } = await admin.from("channel_flows").select("*").eq("template_id", t.id).eq("site_id", s.id).eq("channel", "whatsapp").maybeSingle();
    if (!built) {
      await admin.from("channel_flows").upsert({ template_id: t.id, site_id: s.id, channel: "whatsapp", flow_id: null, items_hash: "unsupported", item_ids: [], status: "unsupported", updated_at: new Date().toISOString() });
      continue;
    }
    const hash = await itemsHash(items ?? []);
    if (cur && cur.items_hash === hash && cur.status === "published") continue;
    try {
      const flowId = await publishFlow(`${t.name} · ${s.name} · ${hash.slice(0, 8)}`.slice(0, 120), built.json);
      await admin.from("channel_flows").upsert({ template_id: t.id, site_id: s.id, channel: "whatsapp", flow_id: flowId, items_hash: hash, item_ids: built.itemIds, status: "published", error: null, updated_at: new Date().toISOString() });
      if (cur?.flow_id) await graph(`/${cur.flow_id}/deprecate`, { method: "POST" }).catch(() => {});
    } catch (e) {
      await admin.from("channel_flows").upsert({ template_id: t.id, site_id: s.id, channel: "whatsapp", flow_id: cur?.flow_id ?? null, items_hash: cur?.items_hash ?? "error", item_ids: cur?.item_ids ?? [], status: "error", error: (e as Error).message.slice(0, 300), updated_at: new Date().toISOString() });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));
  const isCron = !!CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;
  if (isCron && body.corrective) return json(200, { flow_id: await publishFlow("Blueroll corrective action", CORRECTIVE_FLOW_JSON) });
  if (isCron) {
    const { data: biz } = await admin.from("businesses").select("id").eq("whatsapp_enabled", true);
    for (const b of biz ?? []) {
      const { data: ready } = await admin.rpc("whatsapp_ready", { b: b.id });
      if (!ready) continue;
      const { data: ts } = await admin.from("checklist_templates").select("id, business_id, site_id, name").eq("business_id", b.id).eq("active", true);
      for (const t of ts ?? []) await syncTemplate(t);
    }
    return json(200, { ok: true });
  }
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json(401, { error: "auth" });
  const { data: t } = await admin.from("checklist_templates").select("id, business_id, site_id, name").eq("id", body.template_id).maybeSingle();
  if (!t) return json(404, { error: "template" });
  const { data: me } = await admin.from("profiles").select("business_id, role").eq("id", u.user.id).single();
  if (me?.business_id !== t.business_id || !["owner", "manager"].includes(me.role)) return json(403, { error: "forbidden" });
  const { data: ready } = await admin.rpc("whatsapp_ready", { b: t.business_id });
  if (!ready) return json(200, { skipped: "not enabled" });
  await syncTemplate(t);
  return json(200, { ok: true });
});
```

- [ ] **Step 2: Check** — `deno check supabase/functions/whatsapp-sync-flows/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/whatsapp-sync-flows
git commit -m "feat(whatsapp): publish per-checklist Flows to Meta when items change"
```

---

### Task 11: `team-create-channel-member` function

**Files:**
- Create: `supabase/functions/team-create-channel-member/index.ts`

**Behaviour:** POST `{ full_name, role_id, site_id }` with an owner/manager JWT → creates an auth user (`email: wa+<uuid>@noreply.blueroll.app`, `email_confirm: true`, no password, `app_metadata: { channel_only: true }`), then the profile and site membership **the same way the invite-join path does** (read `supabase/migrations/20260714150100_rbac_phase3_join_and_backfill.sql` and copy its profile insert: `business_id`, `full_name`, `role_id`, `role` = role's `base_tier`, `site_id`; plus `member_sites` row). Returns `{ profile_id }`. Errors: 401/403/400 JSON.

- [ ] **Step 1: Implement**

```ts
// supabase/functions/team-create-channel-member/index.ts
// Owner/manager creates a WhatsApp-only team member: no email login, no password.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json(401, { error: "auth" });
  const { data: me } = await admin.from("profiles").select("business_id, role").eq("id", u.user.id).single();
  if (!me || !["owner", "manager"].includes(me.role)) return json(403, { error: "forbidden" });
  const body = await req.json().catch(() => ({}));
  const name = typeof body.full_name === "string" ? body.full_name.trim().slice(0, 80) : "";
  if (!name) return json(400, { error: "name" });
  const { data: role } = await admin.from("roles").select("id, base_tier").eq("id", body.role_id).eq("business_id", me.business_id).maybeSingle();
  if (!role || role.base_tier === "owner") return json(400, { error: "role" });
  const { data: site } = await admin.from("sites").select("id").eq("id", body.site_id).eq("business_id", me.business_id).maybeSingle();
  if (!site) return json(400, { error: "site" });
  const { data: created, error } = await admin.auth.admin.createUser({
    email: `wa+${crypto.randomUUID()}@noreply.blueroll.app`, email_confirm: true, app_metadata: { channel_only: true }, user_metadata: { full_name: name },
  });
  if (error || !created.user) return json(500, { error: "create" });
  const pid = created.user.id;
  const { error: pErr } = await admin.from("profiles").upsert({ id: pid, business_id: me.business_id, full_name: name, role: role.base_tier, role_id: role.id, site_id: site.id });
  if (pErr) { await admin.auth.admin.deleteUser(pid); return json(500, { error: "profile" }); }
  await admin.from("member_sites").upsert({ profile_id: pid, site_id: site.id });
  return json(200, { profile_id: pid });
});
```

Before Step 2, read the join migration and adjust the `profiles.upsert` columns to match it exactly (e.g. `email` column, defaults); list the differences in the report.

- [ ] **Step 2: Check** — `deno check supabase/functions/team-create-channel-member/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/team-create-channel-member
git commit -m "feat(team): create WhatsApp-only members (no login)"
```

---

### Task 12: Web — Team: connect QR, status, disconnect, WhatsApp-only member

**Files:**
- Create: `src/lib/whatsapp/client.ts`, `src/app/(dashboard)/team/whatsapp-connect.tsx`, `src/app/(dashboard)/team/add-whatsapp-member.tsx`
- Modify: `src/app/(dashboard)/team/page.tsx` (one column + one button)
- Modify: `package.json` (add `qrcode`, `@types/qrcode`)
- Test: `src/lib/whatsapp/__tests__/client.test.ts`

**Interfaces — Produces (`client.ts`):**

```ts
export const WA_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? ''   // E.164 without '+', e.g. 447000000000
export function newLinkCode(): string                                   // 6 random digits (crypto.getRandomValues)
export function waLink(number: string, code: string): string            // https://wa.me/<number>?text=LINK%20<code>
export async function issueLinkCode(a: { businessId: string; profileId: string; siteId: string | null }): Promise<string>  // inserts channel_link_codes; retries once on PK clash
export async function listIdentities(businessId: string): Promise<{ id: string; profile_id: string; external_id: string; consent_at: string }[]>
export async function revokeIdentity(id: string): Promise<void>
export async function createWhatsAppMember(a: { full_name: string; role_id: string; site_id: string }): Promise<string>  // calls team-create-channel-member
export async function syncTemplateFlows(templateId: string): Promise<void>  // fire-and-forget call to whatsapp-sync-flows; swallows errors
export function maskNumber(e164: string): string                          // same format as the server maskPhone
```

- [ ] **Step 1: Install QR lib** — `npm install qrcode && npm install -D @types/qrcode`.

- [ ] **Step 2: Failing test**

```ts
// src/lib/whatsapp/__tests__/client.test.ts
import { describe, it, expect } from 'vitest'
import { newLinkCode, waLink, maskNumber } from '../client'

describe('whatsapp client helpers', () => {
  it('codes are 6 digits and vary', () => {
    const a = newLinkCode(), b = newLinkCode()
    expect(a).toMatch(/^\d{6}$/); expect(b).toMatch(/^\d{6}$/)
  })
  it('wa.me link pre-fills LINK code', () => expect(waLink('447000000000', '012345')).toBe('https://wa.me/447000000000?text=LINK%20012345'))
  it('masks numbers', () => expect(maskNumber('447700900123')).toBe('+44 7••• ••23'))
})
```

- [ ] **Step 3: Implement `client.ts`**

```ts
// src/lib/whatsapp/client.ts
import { supabase } from '@/lib/supabase'

export const WA_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? ''

export function newLinkCode(): string {
  const a = new Uint32Array(1); crypto.getRandomValues(a)
  return String(a[0] % 1_000_000).padStart(6, '0')
}
export const waLink = (number: string, code: string) => `https://wa.me/${number}?text=${encodeURIComponent(`LINK ${code}`)}`
export function maskNumber(e164: string): string {
  const d = e164.replace(/\D/g, '')
  return d.length < 6 ? '+••' : `+${d.slice(0, 2)} ${d.slice(2, 3)}••• ••${d.slice(-2)}`
}

export async function issueLinkCode(a: { businessId: string; profileId: string; siteId: string | null }): Promise<string> {
  for (let i = 0; i < 2; i++) {
    const code = newLinkCode()
    const { error } = await supabase.from('channel_link_codes').insert({ code, business_id: a.businessId, profile_id: a.profileId, site_id: a.siteId })
    if (!error) return code
    if (error.code !== '23505') throw error
  }
  throw new Error('Could not create a code — try again')
}

export async function listIdentities(businessId: string) {
  const { data, error } = await supabase.from('channel_identities').select('id, profile_id, external_id, consent_at')
    .eq('business_id', businessId).eq('channel', 'whatsapp').is('revoked_at', null)
  if (error) throw error
  return data ?? []
}

export async function revokeIdentity(id: string) {
  const { error } = await supabase.from('channel_identities').update({ revoked_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

async function callFn(name: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`)
  return j
}

export async function createWhatsAppMember(a: { full_name: string; role_id: string; site_id: string }): Promise<string> {
  return (await callFn('team-create-channel-member', a)).profile_id
}

export async function syncTemplateFlows(templateId: string): Promise<void> {
  try { await callFn('whatsapp-sync-flows', { template_id: templateId }) } catch { /* best effort; nightly sync catches up */ }
}
```

- [ ] **Step 4: Connect dialog**

```tsx
// src/app/(dashboard)/team/whatsapp-connect.tsx
'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { WA_NUMBER, issueLinkCode, revokeIdentity, waLink, maskNumber } from '@/lib/whatsapp/client'

export function WhatsAppStatus({ identity, onChanged, onConnect }: {
  identity: { id: string; external_id: string } | undefined; onChanged: () => void; onConnect: () => void
}) {
  if (!identity) return <button className="text-[12px] font-medium text-primary underline" onClick={onConnect}>Connect WhatsApp</button>
  return (
    <span className="inline-flex items-center gap-2 text-[12px]">
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">WhatsApp {maskNumber(identity.external_id)}</span>
      <button className="text-muted-foreground underline" onClick={async () => {
        try { await revokeIdentity(identity.id); toast.success('WhatsApp disconnected'); onChanged() } catch (e: any) { toast.error(e.message) }
      }}>Disconnect</button>
    </span>
  )
}

export function WhatsAppConnectDialog({ businessId, member, siteId, onClose }: {
  businessId: string; member: { id: string; full_name: string | null }; siteId: string | null; onClose: () => void
}) {
  const [code, setCode] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [left, setLeft] = useState(15 * 60)

  useEffect(() => {
    let alive = true
    issueLinkCode({ businessId, profileId: member.id, siteId })
      .then(async (c) => { if (!alive) return; setCode(c); setQr(await QRCode.toDataURL(waLink(WA_NUMBER, c), { margin: 1, width: 240 })) })
      .catch((e) => toast.error(e.message))
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => { alive = false; clearInterval(t) }
  }, [businessId, member.id, siteId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[360px] rounded-2xl bg-card p-6 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[17px] font-semibold">Connect {member.full_name || 'team member'} to WhatsApp</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Ask them to scan this with their phone camera and press Send in WhatsApp.</p>
        {qr ? <img src={qr} alt="WhatsApp connect QR code" className="mx-auto my-4 h-[240px] w-[240px]" /> : <div className="my-4 h-[240px]" />}
        {code && <p className="font-mono text-[15px]">LINK {code}</p>}
        <p className="mt-1 text-[12px] text-muted-foreground">
          {left > 0 ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired — close and try again'}
        </p>
        <p className="mt-3 text-[11px] text-muted-foreground">By connecting, they agree to receive checklist reminders from Blueroll on WhatsApp. They can reply STOP at any time.</p>
        <Button className="mt-4" variant="outline" onClick={onClose}>Done</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: WhatsApp-only member dialog**

```tsx
// src/app/(dashboard)/team/add-whatsapp-member.tsx
'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createWhatsAppMember } from '@/lib/whatsapp/client'

export function AddWhatsAppMemberDialog({ roles, sites, defaultSiteId, onCreated, onClose }: {
  roles: { id: string; name: string; base_tier: string }[]; sites: { id: string; name: string }[]; defaultSiteId: string | null
  onCreated: (profileId: string, name: string) => void; onClose: () => void
}) {
  const [name, setName] = useState('')
  const [roleId, setRoleId] = useState(roles.find((r) => r.base_tier === 'kitchen_staff')?.id ?? roles[0]?.id ?? '')
  const [siteId, setSiteId] = useState(defaultSiteId ?? sites[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try { const id = await createWhatsAppMember({ full_name: name, role_id: roleId, site_id: siteId }); onCreated(id, name) }
    catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[380px] rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[17px] font-semibold">Add WhatsApp-only member</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">For staff who complete checks in WhatsApp and don't need an app login.</p>
        <div className="mt-4 flex flex-col gap-3">
          <Input aria-label="Name" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <select aria-label="Role" className="h-10 rounded-md border px-2 text-[14px]" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.filter((r) => r.base_tier !== 'owner').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {sites.length > 1 && (
            <select aria-label="Site" className="h-10 rounded-md border px-2 text-[14px]" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim() || !roleId || !siteId || busy} onClick={submit}>{busy ? 'Adding…' : 'Add and connect'}</Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Mount in Team page** (`src/app/(dashboard)/team/page.tsx`)
1. Imports: `useQuery` already there; add `import { listIdentities } from '@/lib/whatsapp/client'` and the two components.
2. State: `const [connecting, setConnecting] = useState<{ id: string; full_name: string | null } | null>(null)`, `const [addingWa, setAddingWa] = useState(false)`.
3. Query (managers only): `const { data: identities = [], refetch: refetchIds } = useQuery({ queryKey: ['wa-identities', business?.id], enabled: !!business?.id && isManager && !!business?.whatsapp_enabled, queryFn: () => listIdentities(business!.id) })` — add `whatsapp_enabled?: boolean` to the `Business` interface in `src/stores/auth-store.ts` if missing.
4. In each member row (the `<tr>` around line 283), add a cell (and a header cell "WhatsApp") rendering `<WhatsAppStatus identity={identities.find((x) => x.profile_id === m.id)} onChanged={refetchIds} onConnect={() => setConnecting(m)} />` — only when `isManager && business?.whatsapp_enabled`.
5. Next to "Invite member" (line ~145): `{isManager && business?.whatsapp_enabled && <Button variant="outline" onClick={() => setAddingWa(true)}>Add WhatsApp-only member</Button>}`.
6. Render dialogs at the end: `connecting && <WhatsAppConnectDialog businessId={business!.id} member={connecting} siteId={currentSiteId} onClose={() => { setConnecting(null); refetchIds() }} />`; `addingWa && <AddWhatsAppMemberDialog roles={roles} sites={sites} defaultSiteId={currentSiteId} onClose={() => setAddingWa(false)} onCreated={(id, name) => { setAddingWa(false); queryClient.invalidateQueries({ queryKey: ['team', business?.id] }); setConnecting({ id, full_name: name }) }} />`.
7. In the members list, show `wa+…@noreply.blueroll.app` emails as "WhatsApp only" (where the email is rendered): `m.email?.endsWith('@noreply.blueroll.app') ? 'WhatsApp only' : m.email`.

- [ ] **Step 7: Checks** — `npx vitest run src/lib/whatsapp/__tests__/client.test.ts`; `npx tsc --noEmit … | wc -l` ≤ 3; `npx eslint "src/app/(dashboard)/team" src/lib/whatsapp` no new errors; `npm test`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/whatsapp "src/app/(dashboard)/team" src/stores/auth-store.ts
git commit -m "feat(team): connect staff to WhatsApp via QR, WhatsApp-only members, disconnect"
```

---

### Task 13: Web — settings toggle, history badge, flow sync on template save

**Files:**
- Create: `src/app/(dashboard)/settings/whatsapp-settings.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx` (mount the section, owner/manager only), `src/app/(dashboard)/checklists/[id]/history/page.tsx` (badge), `src/app/(dashboard)/checklists/new/page.tsx` and `src/app/(dashboard)/checklists/edit/[id]/page.tsx` (call `syncTemplateFlows` after a successful save)

- [ ] **Step 1: Settings section**

```tsx
// src/app/(dashboard)/settings/whatsapp-settings.tsx
'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { Switch } from '@/components/ui/switch'

export function WhatsAppSettings() {
  const business = useAuthStore((s) => s.business)
  const setBusiness = useAuthStore((s) => s.setBusiness)
  const [busy, setBusy] = useState(false)
  if (!business) return null
  const on = !!business.whatsapp_enabled
  const toggle = async (v: boolean) => {
    setBusy(true)
    const { error } = await supabase.from('businesses').update({ whatsapp_enabled: v }).eq('id', business.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    setBusiness({ ...business, whatsapp_enabled: v })
    toast.success(v ? 'WhatsApp checks turned on' : 'WhatsApp checks turned off')
  }
  return (
    <section className="rounded-xl border p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">WhatsApp checks</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Staff get reminders before their checks are due and complete temperatures and opening/closing checks in WhatsApp.
            Connect people from the Team page.
          </p>
        </div>
        <Switch checked={on} disabled={busy} onCheckedChange={toggle} aria-label="WhatsApp checks" />
      </div>
    </section>
  )
}
```

Check `src/stores/auth-store.ts` for the exact setter name (`setBusiness` or similar) and `Switch` props (`onCheckedChange` vs `onChange`) in `src/components/ui/switch.tsx`; adapt and note it.

Mount in `settings/page.tsx` beside the other sections, guarded by `isManager`.

- [ ] **Step 2: History badge** — in `checklists/[id]/history/page.tsx`, add `source` to the completions select and render next to the completer name: `{c.source === 'whatsapp' && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">via WhatsApp</span>}`.

- [ ] **Step 3: Sync after save** — in both new and edit checklist pages, after the template and items are saved successfully: `if (business?.whatsapp_enabled) void syncTemplateFlows(templateId)` (import from `@/lib/whatsapp/client`).

- [ ] **Step 4: Checks + commit** — tsc ≤ 3, eslint no new errors, `npm test`.

```bash
git add "src/app/(dashboard)/settings" "src/app/(dashboard)/checklists"
git commit -m "feat(whatsapp): settings toggle, via-WhatsApp badge, sync Flows after template save"
```

---

### Task 14: Meta setup, deploy and pilot (STOP points)

**Files:**
- Create: `docs/whatsapp/meta-setup.md`

- [ ] **Step 1: Write the setup doc** with: Meta Business + WABA under Cherrypicked Design Ltd (D-U-N-S 225604652); business verification; dedicated number; display name "Blueroll"; system user token with `whatsapp_business_messaging` + `whatsapp_business_management`; webhook URL `https://rszrggreuarvodcqeqrj.supabase.co/functions/v1/whatsapp-webhook` subscribed to `messages`; template texts (category UTILITY, language en_GB):
  - `checklist_reminder` — body: `{{1}} is due at {{2}} at {{3}}.` · button QUICK_REPLY `Fill in`
  - `checklist_reminder_list` — body: `{{1}} checks are due soon at {{2}}: {{3}}.` · up to 3 QUICK_REPLY buttons `Fill in`
  - `manager_alert` — body: `⚠ {{1}} · {{2}} {{3}} at {{4}} ({{5}}). Action: {{6}}.` · footer `via Blueroll`
  - `corrective_nudge` — body: `A check at {{1}} still needs a corrective action. Tap below to add it.` · QUICK_REPLY `My checks`
  Secrets list (Supabase + `~/Secrets/blueroll/`): `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_WABA_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, `WA_CRON_SECRET`, `WA_CORRECTIVE_FLOW_ID`; vault secret `whatsapp_cron_secret`; Vercel env `NEXT_PUBLIC_WHATSAPP_NUMBER`.

- [ ] **Step 2: STOP — ask Kostya** to (a) create the Meta app/WABA and start verification, (b) give the test number credentials; confirm before setting secrets.

- [ ] **Step 3: After «да»:** set secrets; deploy functions with `--no-verify-jwt` (`whatsapp-webhook`, `whatsapp-reminders`, `whatsapp-sync-flows`, `team-create-channel-member`); call `whatsapp-sync-flows` with `{ corrective: true }` and store the returned id as `WA_CORRECTIVE_FLOW_ID`; register the webhook in Meta; apply `20261010120100_whatsapp_cron.sql` after creating the vault secret.

- [ ] **Step 4: Pilot on the Meta test number with «Fern & Fig»:** enable WhatsApp in Settings; connect Kostya's and Maria's phones via QR; sync flows; run through: CHECKS → Fill in → in-range submit; out-of-range submit → corrective form → manager alert; STOP; reconnect. Record results and `channel_messages_log` counts in the report.

- [ ] **Step 5: PR** (after the pilot): push, open PR with summary, merge only on Kostya's «да» (Vercel auto-deploys `main`).

- [ ] **Step 6: Commit the doc**

```bash
git add docs/whatsapp/meta-setup.md
git commit -m "docs(whatsapp): Meta setup, templates and secrets"
```
