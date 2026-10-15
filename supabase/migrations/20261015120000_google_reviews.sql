-- supabase/migrations/20261015120000_google_reviews.sql
-- Google reviews in Telegram (spec docs/superpowers/specs/2026-10-15-google-reviews-design.md §12).
-- Writes come from edge functions (service role) except: google_locations.site_id/enabled, review_routes, review_settings.
set search_path = public;

-- 1. Capability ---------------------------------------------------------------------------------------------------
insert into public.capability_catalog(cap) values ('manage_reviews') on conflict (cap) do nothing;

create or replace function public.seed_business_roles()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text[] := array['complete_checklists','view_reports','manage_incidents','manage_deliveries'];
begin
  insert into public.roles (business_id, name, base_tier, capabilities, is_system) values
    (new.id, 'Owner','owner', array['manage_checklists','complete_checklists','sign_off','manage_recipes','manage_documents','view_documents','manage_incidents','manage_deliveries','manage_suppliers','manage_team','manage_roles','manage_sites','manage_billing','view_reports','manage_reviews'], true),
    (new.id, 'Manager','manager', base || array['manage_checklists','sign_off','manage_recipes','manage_documents','manage_suppliers','manage_team','manage_reviews'], true),
    (new.id, 'Chef','chef', base || array['manage_recipes'], true),
    (new.id, 'Kitchen Staff','kitchen_staff', base, true),
    (new.id, 'Front of House','front_of_house', base, true)
  on conflict (business_id, name) do nothing;
  return new;
end $$;

-- Backfill the existing Owner/Manager presets (custom roles are left to their owners).
update public.roles set capabilities = array_append(capabilities, 'manage_reviews')
 where is_system and base_tier in ('owner','manager') and not ('manage_reviews' = any(capabilities));

-- The caller holds manage_reviews in business b (and is an active member of it).
create or replace function public.can_manage_reviews(b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select b is not null
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.business_id = b and p.removed_at is null)
     and public.has_capability('manage_reviews')
$$;
revoke execute on function public.can_manage_reviews(uuid) from public, anon;
grant execute on function public.can_manage_reviews(uuid) to authenticated, service_role;

-- Active members of b holding cap (owner tier, role caps, overrides). For edge functions (notifications).
create or replace function public.profiles_with_capability(b uuid, cap text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p join public.roles r on r.id = p.role_id
   where p.business_id = b and p.removed_at is null
     and (r.base_tier = 'owner'
          or ((cap = any(r.capabilities)
               or exists (select 1 from public.member_capability_overrides o where o.profile_id = p.id and o.capability = cap and o.granted))
              and not exists (select 1 from public.member_capability_overrides o where o.profile_id = p.id and o.capability = cap and not o.granted)))
$$;
revoke execute on function public.profiles_with_capability(uuid, text) from public, anon, authenticated;
grant execute on function public.profiles_with_capability(uuid, text) to service_role;

-- 2. Channel value 'telegram_reviews' ------------------------------------------------------------------------------
alter table public.channel_groups drop constraint if exists channel_groups_channel_check;
alter table public.channel_groups add constraint channel_groups_channel_check
  check (channel in ('telegram','whatsapp','telegram_reviews'));
alter table public.channel_groups drop constraint if exists channel_groups_chat_check;
alter table public.channel_groups add constraint channel_groups_chat_check
  check (channel not in ('telegram','telegram_reviews') or chat_id is not null);
alter table public.channel_group_link_codes drop constraint if exists channel_group_link_codes_channel_check;
alter table public.channel_group_link_codes add constraint channel_group_link_codes_channel_check
  check (channel in ('telegram','whatsapp','telegram_reviews'));

drop policy if exists "review managers read review groups" on public.channel_groups;
create policy "review managers read review groups" on public.channel_groups for select
  using (channel = 'telegram_reviews' and public.can_manage_reviews(business_id));
drop policy if exists "review managers update review groups" on public.channel_groups;
create policy "review managers update review groups" on public.channel_groups for update
  using (channel = 'telegram_reviews' and public.can_manage_reviews(business_id))
  with check (channel = 'telegram_reviews' and public.can_manage_reviews(business_id));
drop policy if exists "review managers read review link codes" on public.channel_group_link_codes;
create policy "review managers read review link codes" on public.channel_group_link_codes for select
  using (channel = 'telegram_reviews' and public.can_manage_reviews(business_id));

-- Reviews groups need only an entitled business (no per-business switch).
create or replace function public.channel_ready(b uuid, ch text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_business_entitled(b) and coalesce((
    select case ch when 'whatsapp' then whatsapp_enabled when 'telegram' then telegram_enabled
                   when 'telegram_reviews' then true else false end
    from public.businesses where id = b), false)
$$;

create or replace function public.issue_group_link_code(p_channel text default 'telegram')
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_biz  uuid;
  v_code text;
begin
  select p.business_id into v_biz from profiles p
   where p.id = auth.uid() and p.removed_at is null and p.business_id is not null;
  if v_biz is null then
    raise exception 'only owners and managers can link groups' using errcode = 'insufficient_privilege';
  end if;
  if not ((p_channel = 'telegram' and public.is_active_business_manager(v_biz))
       or (p_channel = 'telegram_reviews' and public.can_manage_reviews(v_biz))) then
    if p_channel in ('telegram','telegram_reviews') then
      raise exception 'you cannot link groups' using errcode = 'insufficient_privilege';
    end if;
    raise exception 'unsupported channel' using errcode = 'invalid_parameter_value';
  end if;

  delete from channel_group_link_codes
   where business_id = v_biz and (used_at is not null or expires_at < now()) and created_at < now() - interval '1 day';

  for i in 1..5 loop
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

-- 3. Google connection, OAuth state, locations --------------------------------------------------------------------
create table if not exists public.google_connections (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  google_email    text not null default '',
  vault_secret_id uuid,
  scopes          text[] not null default '{}',
  status          text not null default 'active' check (status in ('active','error','revoked')),
  last_error      text,
  connected_by    uuid references public.profiles(id) on delete set null,
  connected_at    timestamptz not null default now(),
  last_sync_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);
create unique index if not exists uq_google_connection_live on public.google_connections(business_id) where status <> 'revoked';
alter table public.google_connections enable row level security;
revoke all on public.google_connections from anon, authenticated;
grant select (id, business_id, google_email, scopes, status, last_error, connected_by, connected_at, last_sync_at, revoked_at) on public.google_connections to authenticated;
drop policy if exists "review managers read connections" on public.google_connections;
create policy "review managers read connections" on public.google_connections for select using (public.can_manage_reviews(business_id));

create table if not exists public.google_oauth_states (
  state         text primary key,
  business_id   uuid not null references public.businesses(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  code_verifier text not null,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.google_oauth_states enable row level security;   -- service role only
revoke all on public.google_oauth_states from anon, authenticated;

create table if not exists public.google_locations (
  id                      uuid primary key default gen_random_uuid(),
  connection_id           uuid not null references public.google_connections(id) on delete cascade,
  business_id             uuid not null references public.businesses(id) on delete cascade,
  gbp_account             text not null,
  gbp_location            text not null,
  title                   text not null default '',
  address                 text not null default '',
  postcode                text not null default '',
  maps_uri                text,
  can_reply               boolean not null default false,
  site_id                 uuid references public.sites(id) on delete set null,
  enabled                 boolean not null default false,
  enabled_at              timestamptz,
  last_review_update_time timestamptz,
  last_full_pass_at       timestamptz,
  created_at              timestamptz not null default now(),
  unique (connection_id, gbp_location)
);
create index if not exists idx_google_locations_business on public.google_locations(business_id);
alter table public.google_locations enable row level security;
drop policy if exists "review managers read locations" on public.google_locations;
create policy "review managers read locations" on public.google_locations for select using (public.can_manage_reviews(business_id));
drop policy if exists "review managers update locations" on public.google_locations;
create policy "review managers update locations" on public.google_locations for update
  using (public.can_manage_reviews(business_id)) with check (public.can_manage_reviews(business_id));
drop policy if exists entitlement_write_gate_upd on public.google_locations;
create policy entitlement_write_gate_upd on public.google_locations as restrictive for update
  using (public.is_business_entitled(business_id)) with check (public.is_business_entitled(business_id));

-- Clients may change only site_id and enabled; a location Google won't let us reply to can't be enabled; the site
-- must be a live site of the same business; enabled_at is stamped whenever enabled flips on (any caller).
create or replace function public.guard_google_locations_update()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('authenticated','anon') then
    if new.connection_id is distinct from old.connection_id or new.business_id is distinct from old.business_id
       or new.gbp_account is distinct from old.gbp_account or new.gbp_location is distinct from old.gbp_location
       or new.title is distinct from old.title or new.address is distinct from old.address
       or new.postcode is distinct from old.postcode or new.maps_uri is distinct from old.maps_uri
       or new.can_reply is distinct from old.can_reply or new.enabled_at is distinct from old.enabled_at
       or new.last_review_update_time is distinct from old.last_review_update_time
       or new.last_full_pass_at is distinct from old.last_full_pass_at or new.created_at is distinct from old.created_at then
      raise exception 'only the site and sync switch can be changed' using errcode = 'insufficient_privilege';
    end if;
    if new.site_id is not null and not exists (
         select 1 from public.sites s where s.id = new.site_id and s.business_id = new.business_id and s.removed_at is null) then
      raise exception 'choose one of your sites' using errcode = 'check_violation';
    end if;
    if new.enabled and not new.can_reply then
      raise exception 'Not verified on Google — replies are disabled' using errcode = 'check_violation';
    end if;
    if new.enabled and new.site_id is null then
      raise exception 'choose a site first' using errcode = 'check_violation';
    end if;
  end if;
  if new.enabled and not old.enabled then new.enabled_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_guard_google_locations_update on public.google_locations;
create trigger trg_guard_google_locations_update before update on public.google_locations
  for each row execute function public.guard_google_locations_update();

-- 4. Routing and reply style --------------------------------------------------------------------------------------
create table if not exists public.review_routes (
  site_id     uuid not null references public.sites(id) on delete cascade,
  group_id    uuid not null references public.channel_groups(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (site_id, group_id)
);
create index if not exists idx_review_routes_group on public.review_routes(group_id);
alter table public.review_routes enable row level security;
drop policy if exists "review managers read routes" on public.review_routes;
create policy "review managers read routes" on public.review_routes for select using (public.can_manage_reviews(business_id));
drop policy if exists "review managers add routes" on public.review_routes;
create policy "review managers add routes" on public.review_routes for insert with check (
  public.can_manage_reviews(business_id)
  and exists (select 1 from public.sites s where s.id = site_id and s.business_id = review_routes.business_id and s.removed_at is null)
  and exists (select 1 from public.channel_groups g where g.id = group_id and g.business_id = review_routes.business_id
                and g.channel = 'telegram_reviews' and g.unlinked_at is null));
drop policy if exists "review managers remove routes" on public.review_routes;
create policy "review managers remove routes" on public.review_routes for delete using (public.can_manage_reviews(business_id));
drop policy if exists entitlement_write_gate_ins on public.review_routes;
create policy entitlement_write_gate_ins on public.review_routes as restrictive for insert
  with check (public.is_business_entitled(business_id));

create table if not exists public.review_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  tone        text not null default 'warm' check (tone in ('warm','neutral','formal')),
  sign_off    text not null default '' check (length(sign_off) <= 120),
  avoid       text not null default '' check (length(avoid) <= 1000),
  contact     text not null default '' check (length(contact) <= 200),
  examples    text[] not null default '{}' check (coalesce(array_length(examples, 1), 0) <= 3),
  updated_at  timestamptz not null default now()
);
alter table public.review_settings enable row level security;
drop policy if exists "review managers read settings" on public.review_settings;
create policy "review managers read settings" on public.review_settings for select using (public.can_manage_reviews(business_id));
drop policy if exists "review managers insert settings" on public.review_settings;
create policy "review managers insert settings" on public.review_settings for insert with check (public.can_manage_reviews(business_id));
drop policy if exists "review managers update settings" on public.review_settings;
create policy "review managers update settings" on public.review_settings for update
  using (public.can_manage_reviews(business_id)) with check (public.can_manage_reviews(business_id));
drop policy if exists entitlement_write_gate_ins on public.review_settings;
create policy entitlement_write_gate_ins on public.review_settings as restrictive for insert
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.review_settings;
create policy entitlement_write_gate_upd on public.review_settings as restrictive for update
  using (public.is_business_entitled(business_id)) with check (public.is_business_entitled(business_id));

-- 5. Reviews, drafts, cards, edit prompts, audit ------------------------------------------------------------------
create table if not exists public.reviews (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  location_id         uuid references public.google_locations(id) on delete set null,
  site_id             uuid references public.sites(id) on delete set null,
  -- Google's review id (stable across accounts); the API path is rebuilt from the current location.
  google_review_id    text not null,
  version             int not null default 1 check (version >= 1),
  delivered_version   int not null default 0,
  stars               int not null check (stars between 1 and 5),
  comment             text not null default '',
  reviewer_name       text not null default '',
  create_time         timestamptz not null,
  update_time         timestamptz not null,
  google_reply        text,
  google_reply_time   timestamptz,
  language            text,
  flags               text[] not null default '{}',
  notify              boolean not null default false,
  status              text not null default 'new'
                      check (status in ('new','drafted','publishing','published','skipped','answered_elsewhere','deleted')),
  publishing_by       text,
  publishing_at       timestamptz,
  published_text      text,
  published_at        timestamptz,
  published_by_profile uuid references public.profiles(id) on delete set null,
  published_by_channel text,
  published_by_name   text,
  skipped_at          timestamptz,
  skipped_by_name     text,
  created_at          timestamptz not null default now(),
  unique (business_id, google_review_id)
);
create index if not exists idx_reviews_site on public.reviews(site_id, update_time desc);
create index if not exists idx_reviews_pending on public.reviews(business_id) where notify and status in ('new','drafted');
alter table public.reviews enable row level security;
drop policy if exists "reviews readable" on public.reviews;
create policy "reviews readable" on public.reviews for select using (
  public.can_manage_reviews(business_id)
  or (site_id is not null and business_id = public.get_my_business_id() and public.can_see_site_row(site_id)));

create table if not exists public.review_drafts (
  id                 uuid primary key default gen_random_uuid(),
  review_id          uuid not null references public.reviews(id) on delete cascade,
  review_version     int not null,
  draft_version      int not null,
  text               text not null check (length(text) <= 4000),
  source             text not null check (source in ('ai','edited')),
  author_profile     uuid references public.profiles(id) on delete set null,
  author_channel     text,
  author_external_id text,
  author_name        text,
  created_at         timestamptz not null default now(),
  unique (review_id, review_version, draft_version)
);
alter table public.review_drafts enable row level security;
drop policy if exists "review drafts readable" on public.review_drafts;
create policy "review drafts readable" on public.review_drafts for select using (
  exists (select 1 from public.reviews r where r.id = review_drafts.review_id));   -- reviews RLS applies inside
-- A column REVOKE is inert while a table-level grant exists: revoke the table, grant the safe columns.
revoke all on public.review_drafts from anon, authenticated;
grant select (id, review_id, review_version, draft_version, text, source, author_profile, author_channel, author_name, created_at) on public.review_drafts to authenticated;

create table if not exists public.review_cards (
  review_id  uuid not null references public.reviews(id) on delete cascade,
  group_id   uuid references public.channel_groups(id) on delete cascade,
  chat_id    text not null,
  message_id text not null,
  sent_at    timestamptz not null default now(),
  primary key (chat_id, message_id)
);
create index if not exists idx_review_cards_review on public.review_cards(review_id);
alter table public.review_cards enable row level security;   -- service role only
revoke all on public.review_cards from anon, authenticated;

-- Telegram "Edit": the force-reply prompt we sent and who may answer it (WhatsApp sessions come in v1.1).
create table if not exists public.review_edit_prompts (
  chat_id           text not null,
  prompt_message_id text not null,
  card_message_id   text not null,
  review_id         uuid not null references public.reviews(id) on delete cascade,
  review_version    int not null,
  user_id           text not null,
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now(),
  primary key (chat_id, prompt_message_id)
);
alter table public.review_edit_prompts enable row level security;   -- service role only
revoke all on public.review_edit_prompts from anon, authenticated;

create table if not exists public.review_audit (
  id                 bigint generated always as identity primary key,
  review_id          uuid not null references public.reviews(id) on delete cascade,
  business_id        uuid not null references public.businesses(id) on delete cascade,
  action             text not null check (action in ('imported','drafted','regenerated','edited','published','skipped',
                                                     'publish_failed','answered_elsewhere','deleted')),
  actor_profile      uuid references public.profiles(id) on delete set null,
  actor_channel      text,
  actor_external_id  text,
  actor_name         text,
  at                 timestamptz not null default now(),
  details            jsonb not null default '{}'::jsonb
);
create index if not exists idx_review_audit_review on public.review_audit(review_id, at);
alter table public.review_audit enable row level security;
drop policy if exists "review managers read audit" on public.review_audit;
create policy "review managers read audit" on public.review_audit for select using (public.can_manage_reviews(business_id));
revoke all on public.review_audit from anon, authenticated;
grant select (id, review_id, business_id, action, actor_profile, actor_channel, actor_name, at, details) on public.review_audit to authenticated;

-- 6. Vault wrappers (refresh tokens). Service role only. ------------------------------------------------------------
create or replace function public.reviews_store_token(p_token text, p_name text)
returns uuid language sql volatile security definer set search_path = '' as $$
  select vault.create_secret(p_token, p_name, 'Google refresh token (Blueroll reviews)')
$$;
create or replace function public.reviews_read_token(p_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id
$$;
create or replace function public.reviews_delete_token(p_id uuid)
returns void language sql volatile security definer set search_path = '' as $$
  delete from vault.secrets where id = p_id
$$;
revoke execute on function public.reviews_store_token(text, text) from public, anon, authenticated;
grant execute on function public.reviews_store_token(text, text) to service_role;
revoke execute on function public.reviews_read_token(uuid) from public, anon, authenticated;
grant execute on function public.reviews_read_token(uuid) to service_role;
revoke execute on function public.reviews_delete_token(uuid) from public, anon, authenticated;
grant execute on function public.reviews_delete_token(uuid) to service_role;
