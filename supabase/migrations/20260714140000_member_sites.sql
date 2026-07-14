set search_path = public;

create table if not exists public.member_sites (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  site_id    uuid not null references public.sites(id)    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, site_id)
);
create index if not exists idx_member_sites_profile on public.member_sites(profile_id);
create index if not exists idx_member_sites_site on public.member_sites(site_id);
alter table public.member_sites enable row level security;

drop policy if exists member_sites_select on public.member_sites;
create policy member_sites_select on public.member_sites for select to authenticated
  using (exists (select 1 from public.sites s where s.id = member_sites.site_id and s.business_id = public.get_my_business_id()));
drop policy if exists member_sites_write on public.member_sites;
create policy member_sites_write on public.member_sites for all to authenticated
  using (exists (select 1 from public.sites s where s.id = member_sites.site_id and s.business_id = public.get_my_business_id()) and public.has_capability('manage_team'))
  with check (exists (select 1 from public.sites s where s.id = member_sites.site_id and s.business_id = public.get_my_business_id()) and public.has_capability('manage_team'));

-- Backfill 1:1: each non-admin with a home site gets one membership row.
insert into public.member_sites (profile_id, site_id)
select id, site_id from public.profiles
where site_id is not null and is_group_admin = false
on conflict do nothing;

-- Keep profiles.site_id (primary) consistent with membership.
create or replace function public.keep_primary_site()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- first site becomes the primary if none set
    update public.profiles p set site_id = new.site_id
    where p.id = new.profile_id and p.site_id is null;
  elsif tg_op = 'DELETE' then
    -- if the removed site was the primary, repoint to any remaining membership
    update public.profiles p
    set site_id = (select ms.site_id from public.member_sites ms where ms.profile_id = old.profile_id order by ms.created_at limit 1)
    where p.id = old.profile_id and p.site_id = old.site_id;
  end if;
  return null;
end $$;
drop trigger if exists trg_keep_primary_site on public.member_sites;
create trigger trg_keep_primary_site after insert or delete on public.member_sites
  for each row execute function public.keep_primary_site();
