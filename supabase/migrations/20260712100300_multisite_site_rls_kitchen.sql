set search_path = public;
begin;

-- recipes: NULL site_id = shared (all sites can see); else own site or admin.
drop policy if exists "Business members can view recipes" on recipes;
create policy "Business members can view recipes" on recipes
  for select using (business_id = get_my_business_id() and can_see_shared_row(site_id));
drop policy if exists "Chefs can manage recipes" on recipes;
create policy "Chefs can manage recipes" on recipes
  for all using (business_id = get_my_business_id() and get_my_role() = any (array['owner','manager','chef']) and can_write_kitchen_row(site_id))
  with check (business_id = get_my_business_id() and get_my_role() = any (array['owner','manager','chef']) and can_write_kitchen_row(site_id));

-- suppliers
drop policy if exists "Business members can view suppliers" on suppliers;
create policy "Business members can view suppliers" on suppliers
  for select using (business_id = get_my_business_id() and can_see_shared_row(site_id));
drop policy if exists "Managers can manage suppliers" on suppliers;
create policy "Managers can manage suppliers" on suppliers
  for all using (business_id = get_my_business_id() and get_my_role() = any (array['owner','manager']) and can_write_kitchen_row(site_id))
  with check (business_id = get_my_business_id() and get_my_role() = any (array['owner','manager']) and can_write_kitchen_row(site_id));

commit;
