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
-- Personal Telegram chats are dropped (spec §7): revoke them (pilot only: Fern & Fig). Group-form identities (this
-- feature) are left alone, so a re-run does not revoke them.
update public.channel_identities set revoked_at = now()
 where channel = 'telegram' and revoked_at is null and consent_source <> 'group_form';
drop index if exists public.uq_channel_identity_active;
create unique index if not exists uq_channel_identity_active
  on public.channel_identities(business_id, channel, external_id) where revoked_at is null;
-- WhatsApp stays "one business per number" (inbound resolves by (channel, external_id) alone); db.ts consumeLinkCode
-- also revokes the number's other identities before linking, this index makes it hold under concurrency.
create unique index if not exists uq_channel_identity_whatsapp_active
  on public.channel_identities(channel, external_id) where channel = 'whatsapp' and revoked_at is null;
-- WhatsApp inbound lookups are by (channel, external_id) only.
create index if not exists idx_channel_identity_external
  on public.channel_identities(channel, external_id) where revoked_at is null;
