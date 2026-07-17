set search_path = public;

-- Group admin (owner / designated manager) bypasses site scoping.
create or replace function public.am_i_group_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_group_admin from public.profiles where id = auth.uid()), false)
$$;

-- Compliance visibility: my site, or I'm a group admin.
create or replace function public.can_see_site_row(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.am_i_group_admin()
      or p_site = (select site_id from public.profiles where id = auth.uid())
$$;

-- Kitchen visibility: shared (NULL) rows are visible to everyone in the group.
create or replace function public.can_see_shared_row(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_site is null or public.can_see_site_row(p_site)
$$;

-- Kitchen write: shared (NULL) rows only by a group admin; site rows by that site.
create or replace function public.can_write_kitchen_row(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when p_site is null then public.am_i_group_admin()
              else public.can_see_site_row(p_site) end
$$;

grant execute on function public.am_i_group_admin() to authenticated;
grant execute on function public.can_see_site_row(uuid) to authenticated;
grant execute on function public.can_see_shared_row(uuid) to authenticated;
grant execute on function public.can_write_kitchen_row(uuid) to authenticated;
