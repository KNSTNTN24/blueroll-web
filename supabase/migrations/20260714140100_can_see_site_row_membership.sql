set search_path = public;
create or replace function public.can_see_site_row(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.am_i_group_admin()
      or exists (select 1 from public.member_sites ms where ms.profile_id = auth.uid() and ms.site_id = p_site)
$$;
