set search_path = public;

-- ============================================================================
-- Scope the sites LIST to a member's assigned sites (member_sites), so a
-- manager assigned to a subset of sites no longer sees the whole estate in the
-- switcher. Data tables already scope via can_see_site_row(); only the `sites`
-- table itself was still business-wide, which is why site assignment appeared
-- to do nothing.
--
-- Graceful, non-breaking:
--   * group admins (is_group_admin) see every site (unchanged);
--   * a member WITH member_sites rows sees only those sites;
--   * a member with NO member_sites rows falls back to the whole business
--     (current behaviour) — so nobody is blinded, including the few profiles
--     that have neither a site_id nor a membership yet.
-- ============================================================================

-- Backfill: give every non-admin member with a primary site_id an explicit
-- member_sites row for it, so existing single-site members become properly
-- scoped (their sites list now matches their data scope).
insert into public.member_sites (profile_id, site_id)
select p.id, p.site_id
from public.profiles p
where p.business_id is not null
  and p.site_id is not null
  and not coalesce(p.is_group_admin, false)
  and not exists (select 1 from public.member_sites ms
                  where ms.profile_id = p.id and ms.site_id = p.site_id)
on conflict do nothing;

-- Membership check as a SECURITY DEFINER helper: reading member_sites inside it
-- bypasses that table's RLS (which itself references `sites`), so the sites
-- policy below doesn't recurse. Encodes the graceful fallback.
create or replace function public.can_list_site(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.am_i_group_admin()
      or not exists (select 1 from public.member_sites ms where ms.profile_id = auth.uid())
      or exists (select 1 from public.member_sites ms
                 where ms.profile_id = auth.uid() and ms.site_id = p_site)
$$;

-- Swap the sites SELECT policy to membership-aware. Business scope preserved.
drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites for select
using (business_id = get_my_business_id() and public.can_list_site(id));
