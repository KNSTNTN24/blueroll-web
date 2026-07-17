-- Per-site menus: dishes created before site_ids existed carry an empty array,
-- which would make them appear on no site. Put every such dish on every site of
-- its business, preserving the previous business-wide behaviour. New dishes are
-- placed per-site by the menu UI; this only touches the empty legacy rows.
update public.menu_items m
set site_ids = coalesce(
  (select array_agg(s.id) from public.sites s where s.business_id = m.business_id),
  '{}'::uuid[]
)
where m.site_ids = '{}';
