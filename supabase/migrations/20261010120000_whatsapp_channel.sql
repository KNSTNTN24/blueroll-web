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
-- Two removal paths exist: business_id changes/null, and the mobile `remove_member` RPC soft-removal
-- which stamps profiles.removed_at and keeps business_id. removed_at is read via to_jsonb so this
-- function compiles/runs even where that column is absent. Profile DELETE cascades via the FK.
create or replace function public.revoke_channel_identities_on_profile_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.business_id is not distinct from old.business_id
     and not ((to_jsonb(new) ->> 'removed_at') is not null and (to_jsonb(old) ->> 'removed_at') is null) then
    return new;
  end if;
  update channel_identities set revoked_at = now() where profile_id = old.id and revoked_at is null;
  return new;
end $$;
drop trigger if exists trg_revoke_channel_identities on public.profiles;
create trigger trg_revoke_channel_identities after update on public.profiles
  for each row execute function public.revoke_channel_identities_on_profile_change();
