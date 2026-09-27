set search_path = public;

-- ============================================================================
-- Single-site self-signups could not touch their own records.
--
-- can_see_site_row() (20260714140100) gates every checklist read and write on
-- an explicit member_sites row (or is_group_admin). Self-signup grants neither:
-- is_group_admin is set only in the multi-site branch of onboarding, and the
-- 02.08 backfill only covered profiles that already had profiles.site_id, which
-- self-signup leaves NULL. Result: 28 businesses created since 30.07 with zero
-- saved checklists — the owner is refused on their own single site.
--
-- Its sibling can_list_site() (20260802140000) already encodes the graceful
-- fallback ("a member with NO member_sites rows falls back to the whole
-- business — so nobody is blinded"). The data gate never got it. This aligns
-- the two, then makes membership explicit for the accounts that lack it.
-- ============================================================================

-- 1. Same graceful fallback as can_list_site. A member WITH memberships is
--    scoped exactly as before; only the "no memberships at all" case changes,
--    and today that case can see nothing whatsoever.
create or replace function public.can_see_site_row(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.am_i_group_admin()
      or not exists (select 1 from public.member_sites ms where ms.profile_id = auth.uid())
      or exists (select 1 from public.member_sites ms
                 where ms.profile_id = auth.uid() and ms.site_id = p_site)
$$;

-- 2. Backfill, single-site businesses only (no ambiguity about which site).
insert into public.member_sites (profile_id, site_id)
select p.id, s.id
  from public.profiles p
  join public.businesses b on b.id = p.business_id and b.deleted_at is null
  join public.sites s on s.business_id = p.business_id and s.removed_at is null
 where p.business_id is not null
   and p.removed_at is null
   and not coalesce(p.is_group_admin, false)
   and not exists (select 1 from public.member_sites ms where ms.profile_id = p.id)
   and (select count(*) from public.sites s2
         where s2.business_id = p.business_id and s2.removed_at is null) = 1
on conflict do nothing;

-- 3. Keep it from recurring: a profile joining a single-site business gets that
--    site. Multi-site businesses are untouched — invites assign their own site.
create or replace function public.grant_default_site_membership()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_site uuid;
begin
  if new.business_id is null then return new; end if;
  if exists (select 1 from public.member_sites ms where ms.profile_id = new.id) then return new; end if;
  if (select count(*) from public.sites where business_id = new.business_id and removed_at is null) <> 1
    then return new; end if;
  select id into v_site from public.sites
   where business_id = new.business_id and removed_at is null;
  insert into public.member_sites (profile_id, site_id) values (new.id, v_site)
    on conflict do nothing;
  return new;
end $$;

drop trigger if exists trg_profile_default_site_membership on public.profiles;
create trigger trg_profile_default_site_membership
  after insert or update of business_id on public.profiles
  for each row execute function public.grant_default_site_membership();
