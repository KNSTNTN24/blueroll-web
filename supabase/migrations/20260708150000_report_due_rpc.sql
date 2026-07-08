-- Per-site scheduled "due" count from real instances, for Reports (replaces the estimate).
create or replace function public.report_due(p_from date, p_to date, p_site uuid, p_templates uuid[])
returns table(site_id uuid, due bigint)
language sql security definer set search_path=public as $$
  select ci.site_id, count(*)
  from public.checklist_instances ci
  where ci.business_id = public.get_my_business_id()
    and ci.due_date >= p_from and ci.due_date <= p_to
    and (p_site is null or ci.site_id = p_site)
    and (p_templates is null or ci.template_id = any(p_templates))
  group by ci.site_id;
$$;
grant execute on function public.report_due(date,date,uuid,uuid[]) to authenticated;
