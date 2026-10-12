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
