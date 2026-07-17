set search_path = public;

-- Per-member capability overrides on top of the role (Phase 4).
-- Row present = override; granted=true grants on top of role, false revokes from role.
-- No row = inherit from role. (profile_id, capability) unique.
create table if not exists public.member_capability_overrides (
  profile_id uuid    not null references public.profiles(id) on delete cascade,
  capability text    not null,
  granted    boolean not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, capability)
);
create index if not exists idx_mco_profile on public.member_capability_overrides(profile_id);
alter table public.member_capability_overrides enable row level security;

-- Owner-managed (manage_roles), scoped to the actor's business.
drop policy if exists member_capability_overrides_rw on public.member_capability_overrides;
create policy member_capability_overrides_rw on public.member_capability_overrides for all to authenticated
  using (
    profile_id in (select id from public.profiles where business_id = public.get_my_business_id())
    and public.has_capability('manage_roles')
  )
  with check (
    profile_id in (select id from public.profiles where business_id = public.get_my_business_id())
    and public.has_capability('manage_roles')
  );
