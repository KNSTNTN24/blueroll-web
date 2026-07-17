create or replace function public.billable_site_count(p_business_id uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.sites
  where business_id = p_business_id and coalesce(status,'') <> 'archived';
$$;
